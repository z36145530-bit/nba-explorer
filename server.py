#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""NBA Explorer 本地服务：静态站点 + ESPN 数据代理/缓存。

启动：
    python server.py [--port 8600]
然后浏览器打开 http://127.0.0.1:8600

依赖：仅 Python 标准库（3.8+）。
"""
import argparse
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import prefetch as pf

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
STATIC = os.path.join(BASE, "static")
CACHE = os.path.join(DATA, "cache", "api")

CORE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
COMMON = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba"
V2 = "https://site.api.espn.com/apis/v2/sports/basketball/nba"

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) NBA-Explorer/1.0"

_mem = {}
_lock = threading.Lock()

PLAYER_STAT_KEYS = [
    "gamesPlayed", "avgMinutes", "avgPoints", "avgRebounds", "avgAssists", "avgSteals",
    "avgBlocks", "avgTurnovers", "avgFouls", "fieldGoalPct", "threePointFieldGoalPct",
    "freeThrowPct", "doubleDouble", "tripleDouble",
]

GAMELOG_LABELS = ["MIN", "PTS", "REB", "AST", "STL", "BLK", "TO", "FG", "3PT", "FT", "+/-"]


def http_json(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout, context=pf.CTX) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def cached_json(url, ttl=300):
    key = url
    now = time.time()
    with _lock:
        hit = _mem.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    disk = os.path.join(CACHE, _safe_name(url) + ".json")
    payload = None
    if os.path.exists(disk):
        age = now - os.path.getmtime(disk)
        if age < ttl:
            payload = pf.read_json(disk)
    if payload is None:
        try:
            payload = http_json(url)
        except Exception:  # noqa: BLE001
            payload = pf.read_json(disk)
            if payload is None:
                raise
        pf.write_json(disk, payload)
    with _lock:
        _mem[key] = (now, payload)
    return payload


def _safe_name(url):
    return "".join(ch if ch.isalnum() else "_" for ch in url)[-160:]


def local(name):
    return pf.read_json(os.path.join(DATA, name))


def load_team_logos():
    teams = local("teams.json") or []
    pf.TEAM_LOGOS.clear()
    pf.TEAM_LOGOS.update({t["abbr"]: t["logo"] for t in teams if t.get("abbr") and t.get("logo")})


GAME_INDEX = {}
PLAYER_TEAM_INDEX = {}


def load_indexes():
    """本地赛季数据建索引，避免每次请求都线性扫描。"""
    meta = local("meta.json") or {"seasons": []}
    for item in meta.get("seasons") or []:
        year = item.get("year")
        data = local(f"games-{year}.json") or {}
        for g in data.get("games") or []:
            GAME_INDEX[str(g.get("id"))] = g
        players = (local(f"players-{year}.json") or {}).get("players") or []
        idx = {}
        for p in players:
            if p.get("id"):
                idx[str(p["id"])] = {
                    "teamAbbr": p.get("teamAbbr"),
                    "teamLogo": p.get("teamLogo"),
                    "teamId": p.get("teamId"),
                }
        PLAYER_TEAM_INDEX[str(year)] = idx
    return len(GAME_INDEX)


def game_meta(season_year):
    """从本地数据补一支球队的队伍简报。"""
    teams = local("teams.json") or []
    return {t.get("abbr"): t for t in teams}


def find_team(abbr):
    if not abbr:
        return None
    for t in local("teams.json") or []:
        if (t.get("abbr") or "").upper() == abbr.upper():
            return t
    return None


def box_from_summary(summary):
    """把 ESPN 的 summary 转成前端友好的 box score。"""
    bs = summary.get("boxscore") or {}
    teams_out, players_out = [], []
    for t in bs.get("teams") or []:
        rows = []
        for st in t.get("statistics") or []:
            rows.append({"label": st.get("label") or st.get("abbreviation"), "value": st.get("displayValue")})
        teams_out.append({"team": pf.team_brief(t.get("team") or {}), "homeAway": t.get("homeAway"), "stats": rows})
    for p in bs.get("players") or []:
        stats = (p.get("statistics") or [{}])[0]
        labels = stats.get("labels") or []
        rows = []
        for a in stats.get("athletes") or []:
            ath = a.get("athlete") or {}
            rows.append({
                "id": ath.get("id"),
                "name": ath.get("displayName"),
                "shortName": ath.get("shortName"),
                "position": (a.get("position") or ath.get("position") or {}).get("abbreviation") or "",
                "starter": bool(a.get("starter")),
                "stats": dict(zip(labels, a.get("stats") or [])),
                "raw": a.get("stats") or [],
            })
        players_out.append({"team": pf.team_brief(p.get("team") or {}), "labels": labels, "rows": rows})

    header = summary.get("header") or {}
    comp = (header.get("competitions") or [{}])[0]
    return {
        "boxscore": {"teams": teams_out, "players": players_out},
        "header": {
            "date": comp.get("date"),
            "venue": ((comp.get("venue") or {}).get("fullName")),
            "attendance": comp.get("attendance"),
            "status": ((comp.get("status") or {}).get("type") or {}).get("detail"),
        },
    }


def normalize_game_full(event_id):
    summary = cached_json(f"{CORE}/summary?event={event_id}", ttl=600)
    box = box_from_summary(summary)
    detail = GAME_INDEX.get(str(event_id))
    if not detail:
        comp = ((summary.get("header") or {}).get("competitions") or [{}])[0]
        comps = comp.get("competitors") or []
        sides = {}
        for c in comps:
            info = {
                "id": (c.get("team") or {}).get("id"),
                "abbr": c.get("team", {}).get("abbreviation"),
                "name": c.get("team", {}).get("name"),
                "displayName": c.get("team", {}).get("displayName"),
                "logo": pf.TEAM_LOGOS.get(c.get("team", {}).get("abbreviation"), ""),
                "score": c.get("score"),
                "winner": bool(c.get("winner")),
                "record": ((c.get("records") or [{}])[0].get("summary")),
            }
            sides[c.get("homeAway")] = info
        if sides.get("home") and sides.get("away"):
            detail = {
                "id": str(event_id),
                "date": comp.get("date"),
                "gameDate": (comp.get("date") or "")[:10],
                "season": None,
                "seasonType": None,
                "name": (comp.get("notes") or [{}])[0].get("headline") or "",
                "shortName": "",
                "home": sides["home"],
                "away": sides["away"],
                "status": {"state": "post", "completed": True, "detail": "Final"},
                "venue": ((comp.get("venue") or {}).get("fullName")),
                "neutral": bool(comp.get("neutralSite")),
            }
    return {"game": detail, "box": box, "source": "espn"}


def player_seasons(athlete_id, season_year=None):
    url = f"{COMMON}/athletes/{athlete_id}/stats"
    if season_year:
        url += f"?season={season_year}"
    payload = cached_json(url, ttl=3600)
    rows = []
    for cat in payload.get("categories") or []:
        if cat.get("name") != "averages":
            continue
        labels = cat.get("labels") or []
        for st in cat.get("statistics") or []:
            season = st.get("season") or {}
            rows.append({
                "season": season.get("year"),
                "label": season.get("displayName"),
                "teamId": st.get("teamId"),
                "position": st.get("position"),
                "stats": dict(zip(labels, st.get("stats") or [])),
            })
    rows.sort(key=lambda r: r.get("season") or 0)
    return rows


def player_bio(athlete_id, season_year):
    url = f"{COMMON}/athletes/{athlete_id}"
    if season_year:
        url += f"?season={season_year}"
    payload = cached_json(url, ttl=3600)
    ath = payload.get("athlete") or {}
    team = payload.get("team") or {}
    if not team:
        # 本赛季球员列表里补球队信息
        idx = PLAYER_TEAM_INDEX.get(str(season_year)) or {}
        hit = idx.get(str(athlete_id))
        if hit and hit.get("teamAbbr"):
            t = find_team(hit["teamAbbr"]) or {}
            logo = hit.get("teamLogo") or t.get("logo") or ""
            team = {
                "id": hit.get("teamId") or t.get("id"),
                "abbreviation": hit.get("teamAbbr"),
                "name": t.get("name"),
                "displayName": t.get("displayName") or hit.get("teamAbbr"),
                "logos": [{"href": logo, "rel": ["default"]}] if logo else [],
                "color": t.get("color"),
                "alternateColor": t.get("altColor"),
            }
    return {
        "id": ath.get("id"),
        "name": ath.get("displayName"),
        "fullName": ath.get("fullName"),
        "jersey": ath.get("jersey"),
        "position": (ath.get("position") or {}).get("abbreviation"),
        "positionName": (ath.get("position") or {}).get("displayName"),
        "age": ath.get("age"),
        "height": ath.get("displayHeight"),
        "weight": ath.get("displayWeight"),
        "college": ((ath.get("college") or {}).get("name")) if isinstance(ath.get("college"), dict) else ath.get("college"),
        "birthPlace": ath.get("birthPlace"),
        "debutYear": ath.get("debutYear"),
        "headshot": (ath.get("headshot") or {}).get("href") if isinstance(ath.get("headshot"), dict) else "",
        "team": pf.team_brief(team) if team else None,
        "draft": ath.get("draft"),
    }


def gamelog(athlete_id, season_year):
    payload = cached_json(f"{COMMON}/athletes/{athlete_id}/gamelog?season={season_year}", ttl=900)
    labels = payload.get("labels") or []
    names = payload.get("names") or []
    event_map = payload.get("events") or {}
    games = []
    seen = set()
    for st in payload.get("seasonTypes") or []:
        st_name = (st.get("displayName") or st.get("name") or "").strip()
        for c in st.get("categories") or []:
            for item in c.get("events") or []:
                eid = str(item.get("eventId"))
                if eid in seen:
                    continue
                seen.add(eid)
                info = event_map.get(eid) or {}
                opp = info.get("opponent") or {}
                games.append({
                    "eventId": eid,
                    "date": info.get("gameDate"),
                    "seasonType": st_name,
                    "opponent": opp.get("abbreviation") or "",
                    "opponentName": opp.get("displayName") or "",
                    "homeAway": "away" if info.get("atVs") == "@" else "home",
                    "score": info.get("score"),
                    "result": info.get("gameResult"),
                    "stats": dict(zip(labels, item.get("stats") or [])),
                })
    games.sort(key=lambda g: g.get("date") or "", reverse=True)
    return {"labels": labels, "names": names, "games": games}


CORE_SPORTS = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba"


def athlete_from_ref(ref_url, ttl=86400):
    """把 core API 的运动员 $ref 展开成前端需要的字段。"""
    payload = cached_json(ref_url, ttl=ttl)
    ath = payload.get("athlete") or payload
    college = ath.get("college") or {}
    return {
        "id": ath.get("id"),
        "name": ath.get("displayName") or ath.get("fullName"),
        "jersey": ath.get("jersey"),
        "position": ((ath.get("position") or {}).get("abbreviation")),
        "age": ath.get("age"),
        "height": ath.get("displayHeight"),
        "weight": ath.get("displayWeight"),
        "college": college.get("name") if isinstance(college, dict) else college,
        "headshot": ((ath.get("headshot") or {}).get("href")) if isinstance(ath.get("headshot"), dict) else "",
    }


def roster(team_id, season_year):
    """历史赛季用本地赛季球员表（ESPN 的赛季阵容接口不可靠）；否则取现役名单。"""
    teams = {str(t.get("id")): t for t in local("teams.json") or []}
    team = teams.get(str(team_id)) or {}
    abbr = (team.get("abbr") or "").upper()
    out = []
    if season_year:
        players = (local(f"players-{season_year}.json") or {}).get("players") or []
        for p in players:
            if abbr and (p.get("teamAbbr") or "").upper() == abbr:
                out.append({
                    "id": p.get("id"),
                    "name": p.get("name"),
                    "jersey": "",
                    "position": p.get("position"),
                    "age": p.get("age"),
                    "height": "",
                    "weight": "",
                    "college": "",
                    "headshot": p.get("headshot") or "",
                })
    if out:
        return out

    try:
        payload = cached_json(f"{CORE}/teams/{team_id}/roster", ttl=1800)
        for a in payload.get("athletes") or []:
            out.append({
                "id": a.get("id"),
                "name": a.get("displayName") or a.get("fullName"),
                "jersey": a.get("jersey"),
                "position": (a.get("position") or {}).get("abbreviation"),
                "age": a.get("age"),
                "height": a.get("displayHeight"),
                "weight": a.get("displayWeight"),
                "college": ((a.get("college") or {}).get("name")) if isinstance(a.get("college"), dict) else None,
                "headshot": (a.get("headshot") or {}).get("href") if isinstance(a.get("headshot"), dict) else "",
            })
    except Exception:  # noqa: BLE001
        pass
    return out


def search_players(q):
    """先用 ESPN 搜索，再回退到本地赛季球员表。"""
    out = []
    try:
        url = f"https://site.web.api.espn.com/apis/search/v2?query={urllib.parse.quote(q)}&limit=20"
        payload = cached_json(url, ttl=1800)
        for group in payload.get("results") or []:
            if group.get("type") != "player":
                continue
            for item in group.get("contents") or []:
                uid = item.get("uid") or ""
                aid = uid.split(":")[-1].replace("a", "") if uid else None
                out.append({
                    "id": aid,
                    "name": item.get("displayName") or item.get("title"),
                    "team": ((item.get("team") or {}).get("abbreviation")) if isinstance(item.get("team"), dict) else "",
                    "position": ((item.get("position") or {}).get("abbreviation")) if isinstance(item.get("position"), dict) else "",
                    "headshot": ((item.get("image") or {}).get("url")) if isinstance(item.get("image"), dict) else "",
                })
    except Exception:  # noqa: BLE001
        out = []

    if not out:
        ql = (q or "").lower()
        for year in ("2026", "2025", "2024"):
            for p in (local(f"players-{year}.json") or {}).get("players") or []:
                if ql and ql in (p.get("name") or "").lower():
                    out.append({
                        "id": p.get("id"),
                        "name": p.get("name"),
                        "team": p.get("teamAbbr") or "",
                        "position": p.get("position") or "",
                        "headshot": p.get("headshot") or "",
                    })
            if out:
                break
    else:
        # ESPN 搜索结果字段不全，用本地赛季数据补队名/位置/头像
        local_map = {}
        for year in ("2026", "2025", "2024"):
            for p in (local(f"players-{year}.json") or {}).get("players") or []:
                local_map.setdefault(str(p.get("id")), p)
        for item in out:
            hit = local_map.get(str(item.get("id")))
            if not hit:
                continue
            item["team"] = item.get("team") or hit.get("teamAbbr") or ""
            item["position"] = item.get("position") or hit.get("position") or ""
            item["headshot"] = item.get("headshot") or hit.get("headshot") or ""
    return out[:20]


class Handler(BaseHTTPRequestHandler):
    server_version = "NBAExplorer/1.0"

    def log_message(self, fmt, *args):  # noqa: A003
        if os.environ.get("NBA_QUIET") != "1":
            super().log_message(fmt, *args)

    # ---------- helpers ----------
    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path, content_type=None):
        if not os.path.isfile(path):
            self.send_json({"error": "not found"}, 404)
            return
        with open(path, "rb") as fh:
            body = fh.read()
        ctype = content_type or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def query(self):
        parsed = urllib.parse.urlparse(self.path)
        params = {k: v[-1] for k, v in urllib.parse.parse_qs(parsed.query).items()}
        return parsed.path, params

    # ---------- routing ----------
    def do_GET(self):  # noqa: N802
        path, q = self.query()
        try:
            if path.startswith("/api/"):
                self.handle_api(path, q)
                return
            self.serve_static(path)
        except Exception as exc:  # noqa: BLE001
            self.send_json({"error": str(exc)}, 500)

    def serve_static(self, path):
        if path in ("/", ""):
            path = "/index.html"
        full = os.path.normpath(os.path.join(STATIC, path.lstrip("/")))
        if not full.startswith(STATIC):
            self.send_json({"error": "forbidden"}, 403)
            return
        ext = os.path.splitext(full)[1].lower()
        ctypes = {
            ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
            ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
        }
        self.send_file(full, ctypes.get(ext, "text/plain; charset=utf-8"))

    def handle_api(self, path, q):
        route = path[len("/api/"):]

        if route == "meta":
            self.send_json(local("meta.json") or {"seasons": []})
            return

        if route == "teams":
            self.send_json(local("teams.json") or [])
            return

        if route == "standings":
            year = q.get("season") or "2026"
            data = local(f"standings-{year}.json")
            if not data:
                payload = cached_json(f"{V2}/standings?season={year}", ttl=600)
                data = payload
            self.send_json(data)
            return

        if route == "games":
            year = q.get("season") or ""
            date_str = q.get("date") or ""
            team = (q.get("team") or "").upper()
            if not year and date_str:
                meta_seasons = (local("meta.json") or {}).get("seasons") or []
                if meta_seasons:
                    year = str(max(s.get("year") for s in meta_seasons))
            local_file = local(f"games-{year}.json") if year else None
            games = (local_file or {}).get("games") or []
            if date_str:
                games = [g for g in games if g.get("gameDate") == date_str or (g.get("date") or "").startswith(date_str)]
            if not games and date_str:
                # 本地没有的日期（更早赛季/未来赛程）实时走 ESPN 记分牌
                compact = date_str.replace("-", "")
                payload = cached_json(f"{CORE}/scoreboard?dates={compact}", ttl=120)
                games = [pf.normalize_event(ev) for ev in payload.get("events") or []]
                games = [g for g in games if g.get("gameDate") == date_str or (g.get("date") or "").startswith(date_str)]
            if team:
                games = [g for g in games if g.get("home", {}).get("abbr") == team or g.get("away", {}).get("abbr") == team]
            if q.get("order") == "desc":
                games = list(reversed(games))
            limit = int(q.get("limit") or 0)
            if limit:
                games = games[:limit]
            self.send_json({"season": year, "count": len(games), "games": games})
            return

        if route == "game":
            self.send_json(normalize_game_full(q.get("id")))
            return

        if route == "players":
            year = q.get("season") or "2026"
            data = local(f"players-{year}.json") or {"players": []}
            rows = data.get("players") or []
            pos = (q.get("pos") or "").upper()
            team = (q.get("team") or "").upper()
            text = (q.get("q") or "").strip().lower()
            if pos:
                rows = [r for r in rows if (r.get("position") or "").upper() == pos]
            if team:
                rows = [r for r in rows if (r.get("teamAbbr") or "").upper() == team]
            if text:
                rows = [r for r in rows if text in (r.get("name") or "").lower()]
            sort = q.get("sort") or "avgPoints"
            rows = sorted(rows, key=lambda r: -(r.get("stats", {}).get(sort) or 0))
            total = len(rows)
            limit = min(int(q.get("limit") or 60), 300)
            offset = int(q.get("offset") or 0)
            self.send_json({"season": year, "total": total, "limit": limit, "offset": offset, "players": rows[offset:offset + limit]})
            return

        if route == "leaders":
            year = q.get("season") or "2026"
            stat = q.get("stat") or "avgPoints"
            data = local(f"players-{year}.json") or {"players": []}
            rows = sorted(data.get("players") or [], key=lambda r: -(r.get("stats", {}).get(stat) or 0))[:15]
            self.send_json({"stat": stat, "players": rows})
            return

        if route == "player":
            aid = q.get("id")
            year = q.get("season") or ""
            self.send_json({
                "bio": player_bio(aid, year),
                # 生涯数据始终取全量（带 season 参数时 ESPN 只返回该赛季）
                "seasons": player_seasons(aid),
            })
            return

        if route == "gamelog":
            self.send_json(gamelog(q.get("id"), q.get("season") or "2026"))
            return

        if route == "roster":
            self.send_json(roster(q.get("team"), q.get("season") or ""))
            return

        if route == "search":
            self.send_json({"players": search_players(q.get("q") or "")})
            return

        if route == "shots":
            self.send_json(shot_chart(q.get("game")))
            return

        self.send_json({"error": f"unknown api {route}"}, 404)


def shot_chart(event_id):
    """单场投篮分布：ESPN summary 的 plays 里带 shootingPlay 与 coordinate（英尺）。"""
    if not event_id:
        return {"error": "missing game id"}
    summary = cached_json(f"{CORE}/summary?event={event_id}", ttl=600)
    box = summary.get("boxscore") or {}
    team_abbr = {}
    players = {}
    for block in (box.get("players") or []):
        team = block.get("team") or {}
        abbr = team.get("abbreviation") or ""
        team_abbr[str(team.get("id"))] = abbr
        for stat in block.get("statistics") or []:
            for row in stat.get("athletes") or []:
                ath = row.get("athlete") or {}
                if ath.get("id"):
                    players[str(ath["id"])] = ath.get("displayName") or ""
    shots = []
    for p in summary.get("plays") or []:
        if not p.get("shootingPlay"):
            continue
        coord = p.get("coordinate") or {}
        x, y = coord.get("x"), coord.get("y")
        # 无效哨兵值为 -214748340 之类，正常坐标为英尺（x 0~50，y 0~47）
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)) or x < -2 or x > 54 or y < -4 or y > 50:
            continue
        parts = [str((pt.get("athlete") or {}).get("id")) for pt in (p.get("participants") or [])]
        pid = next((i for i in parts if i in players), parts[0] if parts else "")
        team = p.get("team") or {}
        tid = str(team.get("id"))
        shots.append({
            "id": p.get("id"),
            "team": team_abbr.get(tid, ""),
            "teamId": tid,
            "playerId": pid,
            "player": players.get(pid, ""),
            "x": round(float(x), 2),
            "y": round(float(y), 2),
            "made": bool(p.get("scoringPlay")),
            "points": p.get("pointsAttempted") or 2,
            "period": ((p.get("period") or {}).get("number")),
            "clock": ((p.get("clock") or {}).get("displayValue")),
            "text": p.get("text") or "",
        })
    header = summary.get("header") or {}
    comp = ((header.get("competitions") or [{}])[0]) or {}
    return {
        "game": {
            "id": str(event_id),
            "date": comp.get("date"),
            "venue": ((comp.get("venue") or {}).get("fullName")),
            "teams": [{"abbr": team_abbr.get(str((c.get("team") or {}).get("id")), ""),
                       "id": str((c.get("team") or {}).get("id"))}
                      for c in (comp.get("competitors") or [])],
        },
        "count": len(shots),
        "shots": shots,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8600")))
    ap.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    args = ap.parse_args()
    os.makedirs(CACHE, exist_ok=True)
    load_team_logos()
    print(f"[index] {load_indexes()} 场比赛已建索引")
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"NBA Explorer 已启动: http://{args.host}:{args.port}")
    print("按 Ctrl+C 停止")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
