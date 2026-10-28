#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""NBA 数据预取：球队 / 排名 / 赛程赛果 / 球员赛季数据。

用法：
    python prefetch.py                 # 预取默认赛季 2026/2025/2024
    python prefetch.py 2026            # 只预取 2025-26 赛季
    python prefetch.py 2026 2025       # 预取两个赛季

数据来源：ESPN 公开 JSON 接口（无需 API Key）。
"""
import json
import os
import ssl
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
CACHE = os.path.join(DATA, "cache")

CORE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
COMMON = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba"
V2 = "https://site.api.espn.com/apis/v2/sports/basketball/nba"

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

DEFAULT_SEASONS = [2026, 2025, 2024]

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) NBA-Explorer/1.0"

# abbr -> logo，供泽程中补齐比赛用队标
TEAM_LOGOS = {}


def http_json(url, retries=3, timeout=30):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout, context=CTX) as resp:
                return json.loads(resp.read().decode("utf-8", "replace"))
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(0.6 * (i + 1))
    raise RuntimeError(f"请求失败 {url}: {last}")


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:  # noqa: BLE001
        return default


def season_label(year):
    return f"{year - 1}-{str(year)[2:]}"


def team_brief(t):
    logos = t.get("logos") or []
    logo = ""
    for item in logos:
        if "default" in (item.get("rel") or []):
            logo = item.get("href") or ""
            break
    if not logo and logos:
        logo = logos[0].get("href") or ""
    return {
        "id": t.get("id"),
        "abbr": t.get("abbreviation"),
        "name": t.get("name"),
        "displayName": t.get("displayName"),
        "logo": logo,
        "color": t.get("color"),
        "altColor": t.get("alternateColor"),
    }


def fetch_teams():
    payload = http_json(f"{CORE}/teams")
    teams = payload["sports"][0]["leagues"][0]["teams"]
    out = [team_brief(item["team"]) for item in teams]
    write_json(os.path.join(DATA, "teams.json"), out)
    TEAM_LOGOS.clear()
    TEAM_LOGOS.update({t["abbr"]: t["logo"] for t in out if t.get("abbr")})
    print(f"[teams] {len(out)} 支球队")
    return out


def fetch_standings(year):
    payload = http_json(f"{V2}/standings?season={year}")
    groups = []
    for conf in payload.get("children") or []:
        entries = []
        for e in (conf.get("standings") or {}).get("entries") or []:
            stats = {}
            for st in e.get("stats") or []:
                if "displayValue" in st:
                    stats[st["name"]] = st["displayValue"]
                elif "value" in st:
                    stats[st["name"]] = st["value"]
            entries.append({"team": team_brief(e["team"]), "stats": stats})
        entries.sort(key=lambda x: int(x["stats"].get("wins") or 0), reverse=True)
        groups.append({"name": conf.get("name"), "abbr": conf.get("abbreviation"), "entries": entries})
    result = {"season": year, "label": season_label(year), "groups": groups}
    write_json(os.path.join(DATA, f"standings-{year}.json"), result)
    print(f"[standings] {season_label(year)}: " + ", ".join(f"{g['name']} {len(g['entries'])}" for g in groups))
    return result


def parse_competitor(c):
    team = c.get("team") or {}
    recs = c.get("records") or []
    logos = team.get("logos") or []
    abbr = team.get("abbreviation") or ""
    logo = ""
    for item in logos:
        if "default" in (item.get("rel") or []):
            logo = item.get("href") or ""
            break
    if not logo and logos:
        logo = logos[0].get("href", "")
    return {
        "id": team.get("id"),
        "abbr": abbr,
        "name": team.get("name") or "",
        "displayName": team.get("displayName") or team.get("name") or "",
        "logo": logo or team.get("logo") or TEAM_LOGOS.get(abbr, ""),
        "score": c.get("score"),
        "winner": bool(c.get("winner")),
        "record": recs[0].get("summary") if recs else "",
        "seed": c.get("seed"),
    }


def normalize_event(ev):
    comp = ev["competitions"][0]
    status = comp.get("status") or {}
    stype = status.get("type") or {}
    home = away = None
    for c in comp.get("competitors") or []:
        if c.get("homeAway") == "home":
            home = parse_competitor(c)
        else:
            away = parse_competitor(c)
    season = ev.get("season") or {}
    iso = ev.get("date") or ""
    return {
        "id": ev.get("id"),
        "date": iso,
        "gameDate": iso[:10],
        "season": season.get("year"),
        "seasonType": season.get("type"),
        "name": ev.get("name"),
        "shortName": ev.get("shortName"),
        "home": home,
        "away": away,
        "status": {
            "state": stype.get("state"),
            "completed": bool(stype.get("completed")),
            "detail": stype.get("detail") or stype.get("shortDetail") or "",
            "period": status.get("period"),
            "clock": status.get("displayClock"),
        },
        "venue": ((comp.get("venue") or {}).get("fullName")) or "",
        "neutral": bool(comp.get("neutralSite")),
    }


def daterange(start, end):
    cur = start
    while cur <= end:
        yield cur
        cur += timedelta(days=1)


def fetch_games(year):
    """抓取赛季内每一天的赛程，按天缓存，支持断点续跑。"""
    cache_dir = os.path.join(CACHE, "games")
    os.makedirs(cache_dir, exist_ok=True)
    start = date(year - 1, 10, 1)
    end = date(year, 6, 30)
    days = list(daterange(start, end))
    print(f"[games] {season_label(year)}: {len(days)} 天待检查")

    def one(day):
        key = day.strftime("%Y%m%d")
        path = os.path.join(cache_dir, f"{key}.json")
        cached = read_json(path)
        if cached is not None:
            # 旧缓存里可能没有队标，用最新球队表补齐
            for ev in cached:
                for side in ("home", "away"):
                    s = ev.get(side) or {}
                    if not s.get("logo") and s.get("abbr"):
                        s["logo"] = TEAM_LOGOS.get(s["abbr"], "")
            return cached
        try:
            payload = http_json(f"{CORE}/scoreboard?dates={key}", timeout=25)
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {key} 失败: {exc}")
            return None
        events = [
            normalize_event(ev)
            for ev in payload.get("events") or []
            if (ev.get("season") or {}).get("year") == year
        ]
        write_json(path, events)
        return events

    games, done = {}, 0
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = {pool.submit(one, d): d for d in days}
        for fut in as_completed(futures):
            done += 1
            events = fut.result()
            for ev in events or []:
                games[ev["id"]] = ev
            if done % 25 == 0:
                print(f"  ... {done}/{len(days)} 天，已收集 {len(games)} 场")

    ordered = sorted(games.values(), key=lambda g: (g["date"] or "", g["id"]))
    write_json(
        os.path.join(DATA, f"games-{year}.json"),
        {"season": year, "label": season_label(year), "count": len(ordered), "games": ordered},
    )
    print(f"[games] {season_label(year)}: {len(ordered)} 场（常规赛+季后赛）")
    return ordered


def fetch_players(year):
    """联赛球员赛季场均数据（分页拉取），并抽取常用字段。"""
    base = (
        f"{COMMON}/statistics/byathlete?region=us&lang=en&contentorigin=espn"
        f"&isqualified=true&season={year}&seasontype=2&sort=offensive.avgPoints%3Adesc"
    )
    first = http_json(base + "&page=1&limit=100")
    cats = first.get("categories") or []
    cat_names = {c["name"]: c.get("names") or [] for c in cats}
    pages = (first.get("pagination") or {}).get("pages") or 1

    athletes = list(first.get("athletes") or [])
    for p in range(2, pages + 1):
        payload = http_json(base + f"&page={p}&limit=100")
        athletes.extend(payload.get("athletes") or [])

    def build(a):
        ath = a.get("athlete") or {}
        values = {}
        for cat in a.get("categories") or []:
            names = cat_names.get(cat.get("name")) or []
            for name, val in zip(names, cat.get("values") or []):
                if name not in values:
                    values[name] = val
        team_logos = ath.get("teamLogos") or []
        headshot = (ath.get("headshot") or {}).get("href") if isinstance(ath.get("headshot"), dict) else ""
        return {
            "id": ath.get("id"),
            "name": ath.get("displayName"),
            "shortName": ath.get("shortName"),
            "position": (ath.get("position") or {}).get("abbreviation") or "",
            "positionName": (ath.get("position") or {}).get("displayName") or "",
            "teamId": ath.get("teamId"),
            "teamAbbr": ath.get("teamShortName"),
            "teamLogo": team_logos[0].get("href") if team_logos else "",
            "age": ath.get("age"),
            "debutYear": ath.get("debutYear"),
            "headshot": headshot,
            "stats": values,
        }

    players = [build(a) for a in athletes if a.get("athlete")]
    players.sort(key=lambda p: -(p["stats"].get("avgPoints") or 0))
    write_json(
        os.path.join(DATA, f"players-{year}.json"),
        {"season": year, "label": season_label(year), "count": len(players), "players": players},
    )
    print(f"[players] {season_label(year)}: {len(players)} 人")
    return players


def main(argv):
    years = [int(x) for x in argv[1:]] or DEFAULT_SEASONS
    os.makedirs(DATA, exist_ok=True)
    teams = fetch_teams()
    meta = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "seasons": [],
        "teamCount": len(teams),
        "source": "ESPN public APIs",
    }
    for year in years:
        seasons = []
        try:
            fetch_standings(year)
            games = fetch_games(year)
            players = fetch_players(year)
            seasons = sorted({g["seasonType"] for g in games if g.get("seasonType")})
            meta_season = {
                "year": year,
                "label": season_label(year),
                "games": len(games),
                "players": len(players),
                "seasonTypes": seasons,
            }
        except Exception as exc:  # noqa: BLE001
            print(f"[!] {season_label(year)} 处理失败: {exc}")
            meta_season = {"year": year, "label": season_label(year), "error": str(exc)}
        meta["seasons"].append(meta_season)
    meta["seasons"].sort(key=lambda s: -s["year"])
    write_json(os.path.join(DATA, "meta.json"), meta)
    print("[meta] 完成:", [s["year"] for s in meta["seasons"]])


if __name__ == "__main__":
    main(sys.argv)
