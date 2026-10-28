/*
 * api-static.js —— NBA Explorer 纯静态版数据层
 * 用本地 data/*.json + 浏览器直连 ESPN 公开接口，替代 server.py 的 /api/*。
 * 加载后向 window.STATIC_API 暴露 api(name, params)，app.js 检测到后自动走这里。
 */
(function (global) {
  'use strict';

  // 注意：site.api.espn.com 在浏览器里不带 CORS 头，改用同一套接口的 site.web.api 主机
  const CORE = 'https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba';
  const COMMON = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba';
  const DATA_BASE =
    global.__NBA_DATA_BASE__ ||
    (typeof document !== 'undefined' ? new URL('data/', document.baseURI).href : 'data/');

  const mem = new Map();

  async function fetchJson(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.json();
  }

  function dataFile(name) {
    const key = 'data:' + name;
    if (!mem.has(key)) mem.set(key, fetchJson(DATA_BASE + name));
    return mem.get(key);
  }

  /* ---------------- 基础工具 ---------------- */
  function logoFrom(t) {
    const logos = (t && t.logos) || [];
    let logo = '';
    for (const item of logos) {
      if ((item.rel || []).indexOf('default') >= 0) { logo = item.href || ''; break; }
    }
    if (!logo && logos.length) logo = logos[0].href || '';
    return logo;
  }

  // 兼容 ESPN 原始球队对象与本地 teams.json 的 team 对象
  function teamBrief(t) {
    if (!t) return null;
    if (t.abbr !== undefined && t.abbreviation === undefined) {
      return {
        id: t.id, abbr: t.abbr, name: t.name, displayName: t.displayName,
        logo: t.logo || '', color: t.color || null, altColor: t.altColor || null,
      };
    }
    return {
      id: t.id,
      abbr: t.abbreviation || t.abbr || '',
      name: t.name || '',
      displayName: t.displayName || '',
      logo: t.logo || logoFrom(t),
      color: t.color || null,
      altColor: t.alternateColor || t.altColor || null,
    };
  }

  function statNum(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  /* ---------------- 索引（按需加载，避免一次拉全部赛季） ---------------- */
  let IDX = null;
  async function indexes() {
    if (IDX) return IDX;
    const meta = await dataFile('meta.json');
    const teams = await dataFile('teams.json');
    const teamByAbbr = new Map(teams.map((t) => [t.abbr, t]));
    const teamById = new Map(teams.map((t) => [String(t.id), t]));
    const searchIndex = await dataFile('search-index.json').catch(() => ({ players: [] }));
    const latest = String((meta.seasons || [])[0]?.year || '');
    IDX = { meta, teams, teamByAbbr, teamById, searchIndex, latest };
    return IDX;
  }

  const seasonCache = new Map();
  function seasonGames(year) {
    const key = 'games-' + year;
    if (!seasonCache.has(key)) {
      seasonCache.set(key, dataFile(`games-${year}.json`).catch(() => ({ season: Number(year), games: [] })));
    }
    return seasonCache.get(key);
  }
  function seasonPlayers(year) {
    const key = 'players-' + year;
    if (!seasonCache.has(key)) {
      seasonCache.set(key, dataFile(`players-${year}.json`).catch(() => ({ season: Number(year), players: [] })));
    }
    return seasonCache.get(key);
  }
  // 从 538 的 game id（538-YYYYMMDDxxx）反推赛季（赛季以结束年计）
  function seasonOfGameId(id) {
    const s = String(id || '');
    if (s.indexOf('538-') === 0 && s.length >= 12) {
      const y = Number(s.slice(4, 8));
      const m = Number(s.slice(8, 10));
      if (y > 1900 && m >= 1 && m <= 12) return m >= 9 ? y + 1 : y;
    }
    return null;
  }
  async function localGame(id, seasonHint) {
    const fromId = seasonOfGameId(id);
    const year = fromId || seasonHint;
    if (!year) return null;
    const data = await seasonGames(String(year));
    return (data.games || []).find((g) => String(g.id) === String(id)) || null;
  }

  function parseCompetitor(c) {
    const t = c.team || {};
    const rec = ((c.records || [])[0] || {}).summary || '';
    const seed = c.seed;
    return {
      id: t.id,
      abbr: t.abbreviation || '',
      name: t.name || '',
      displayName: t.displayName || '',
      logo: (IDX && IDX.teamByAbbr.get(t.abbreviation)?.logo) || logoFrom(t),
      score: c.score !== undefined ? c.score : null,
      winner: Boolean(c.winner),
      record: rec,
      seed: seed === undefined || seed === null ? null : Number(seed),
    };
  }

  function normalizeEvent(ev) {
    const comp = ((ev.competitions || [])[0]) || {};
    const status = comp.status || {};
    const stype = status.type || {};
    let home = null;
    let away = null;
    for (const c of comp.competitors || []) {
      if (c.homeAway === 'home') home = parseCompetitor(c);
      else away = parseCompetitor(c);
    }
    const season = ev.season || {};
    const iso = ev.date || '';
    return {
      id: String(ev.id),
      date: iso,
      gameDate: iso.slice(0, 10),
      season: season.year,
      seasonType: season.type,
      name: ev.name || '',
      shortName: ev.shortName || '',
      home,
      away,
      status: {
        state: stype.state,
        completed: Boolean(stype.completed),
        detail: stype.detail || '',
        period: status.period,
        clock: status.displayClock,
      },
      venue: (comp.venue || {}).fullName || '',
      neutral: Boolean(comp.neutralSite),
    };
  }

  /* ---------------- 比赛 / box score ---------------- */
  function boxFromSummary(summary) {
    const bs = summary.boxscore || {};
    const teamsOut = [];
    const playersOut = [];
    for (const t of bs.teams || []) {
      const rows = (t.statistics || []).map((st) => ({
        label: st.label || st.abbreviation,
        value: st.displayValue,
      }));
      teamsOut.push({ team: teamBrief(t.team || {}), homeAway: t.homeAway, stats: rows });
    }
    for (const p of bs.players || []) {
      const st0 = (p.statistics || [{}])[0] || {};
      const labels = st0.labels || [];
      const rows = [];
      for (const a of st0.athletes || []) {
        const ath = a.athlete || {};
        const stats = {};
        labels.forEach((lb, i) => { stats[lb] = (a.stats || [])[i]; });
        rows.push({
          id: ath.id,
          name: ath.displayName,
          shortName: ath.shortName,
          position: (a.position || ath.position || {}).abbreviation || '',
          starter: Boolean(a.starter),
          stats,
          raw: a.stats || [],
        });
      }
      playersOut.push({ team: teamBrief(p.team || {}), labels, rows });
    }
    const header = summary.header || {};
    const comp = (header.competitions || [{}])[0] || {};
    return {
      boxscore: { teams: teamsOut, players: playersOut },
      header: {
        date: comp.date,
        venue: (comp.venue || {}).fullName,
        attendance: comp.attendance,
        status: ((comp.status || {}).type || {}).detail,
      },
    };
  }

  async function normalizeGameFull(eventId, seasonHint) {
    const id = String(eventId);
    const idx = await indexes();
    let detail = await localGame(id, seasonHint);
    if (id.indexOf('538-') === 0) {
      return detail ? { game: detail, box: null, source: '538' } : { game: null, box: null, source: '538' };
    }
    let box = null;
    try {
      const summary = await fetchJson(`${CORE}/summary?event=${encodeURIComponent(id)}`);
      box = boxFromSummary(summary);
      if (!detail) {
        const comp = ((summary.header || {}).competitions || [{}])[0] || {};
        const sides = {};
        for (const c of comp.competitors || []) {
          const t = c.team || {};
          sides[c.homeAway] = {
            id: t.id,
            abbr: t.abbreviation,
            name: t.name,
            displayName: t.displayName,
            logo: idx.teamByAbbr.get(t.abbreviation)?.logo || logoFrom(t),
            score: c.score,
            winner: Boolean(c.winner),
            record: ((c.records || [{}])[0] || {}).summary,
          };
        }
        if (sides.home && sides.away) {
          detail = {
            id,
            date: comp.date,
            gameDate: (comp.date || '').slice(0, 10),
            season: null,
            seasonType: null,
            name: ((comp.notes || [{}])[0] || {}).headline || '',
            shortName: '',
            home: sides.home,
            away: sides.away,
            status: { state: 'post', completed: true, detail: 'Final' },
            venue: (comp.venue || {}).fullName,
            neutral: Boolean(comp.neutralSite),
          };
        }
      }
    } catch (err) {
      // 老比赛 ESPN 没有技术统计：退化为本地比赛结果
    }
    return { game: detail, box, source: box ? 'espn' : 'local' };
  }

  /* ---------------- 球员 ---------------- */
  async function playerSeasons(athleteId) {
    const payload = await fetchJson(`${COMMON}/athletes/${encodeURIComponent(athleteId)}/stats`);
    const rows = [];
    for (const cat of payload.categories || []) {
      if (cat.name !== 'averages') continue;
      const labels = cat.labels || [];
      for (const st of cat.statistics || []) {
        const season = st.season || {};
        const stats = {};
        labels.forEach((lb, i) => { stats[lb] = (st.stats || [])[i]; });
        rows.push({
          season: season.year,
          label: season.displayName,
          teamId: st.teamId,
          position: st.position,
          stats,
        });
      }
    }
    rows.sort((a, b) => (a.season || 0) - (b.season || 0));
    return rows;
  }

  async function playerBio(athleteId, seasonYear) {
    const qs = seasonYear ? `?season=${encodeURIComponent(seasonYear)}` : '';
    const payload = await fetchJson(`${COMMON}/athletes/${encodeURIComponent(athleteId)}${qs}`);
    const ath = payload.athlete || {};
    let team = payload.team || null;
    if (!team) {
      const idx = await indexes();
      const y = String(seasonYear || idx.latest);
      const list = (await seasonPlayers(y)).players || [];
      const hit = list.find((p) => String(p.id) === String(athleteId));
      if (hit && hit.teamAbbr) {
        const t = idx.teamByAbbr.get(hit.teamAbbr) || {};
        const logo = hit.teamLogo || t.logo || '';
        team = {
          id: hit.teamId || t.id,
          abbreviation: hit.teamAbbr,
          name: t.name,
          displayName: t.displayName || hit.teamAbbr,
          logos: logo ? [{ href: logo, rel: ['default'] }] : [],
          color: t.color,
          alternateColor: t.altColor,
        };
      }
    }
    const college = ath.college;
    const headshot = ath.headshot;
    return {
      id: ath.id,
      name: ath.displayName,
      fullName: ath.fullName,
      jersey: ath.jersey,
      position: (ath.position || {}).abbreviation,
      positionName: (ath.position || {}).displayName,
      age: ath.age,
      height: ath.displayHeight,
      weight: ath.displayWeight,
      college: college && typeof college === 'object' ? college.name : college,
      birthPlace: ath.birthPlace,
      debutYear: ath.debutYear,
      headshot: headshot && typeof headshot === 'object' ? headshot.href || '' : '',
      team: team ? teamBrief(team) : null,
      draft: ath.draft,
    };
  }

  async function gamelog(athleteId, seasonYear) {
    const payload = await fetchJson(
      `${COMMON}/athletes/${encodeURIComponent(athleteId)}/gamelog?season=${encodeURIComponent(seasonYear)}`
    );
    const labels = payload.labels || [];
    const names = payload.names || [];
    const eventMap = payload.events || {};
    const games = [];
    const seen = new Set();
    for (const st of payload.seasonTypes || []) {
      const stName = String(st.displayName || st.name || '').trim();
      for (const c of st.categories || []) {
        for (const item of c.events || []) {
          const eid = String(item.eventId);
          if (seen.has(eid)) continue;
          seen.add(eid);
          const info = eventMap[eid] || {};
          const opp = info.opponent || {};
          const stats = {};
          labels.forEach((lb, i) => { stats[lb] = (item.stats || [])[i]; });
          games.push({
            eventId: eid,
            date: info.gameDate,
            seasonType: stName,
            opponent: opp.abbreviation || '',
            opponentName: opp.displayName || '',
            homeAway: info.atVs === '@' ? 'away' : 'home',
            score: info.score,
            result: info.gameResult,
            stats,
          });
        }
      }
    }
    games.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    return { labels, names, games };
  }

  async function roster(teamId, seasonYear) {
    const idx = await indexes();
    const team = idx.teamById.get(String(teamId)) || {};
    const abbr = String(team.abbr || '').toUpperCase();
    const out = [];
    if (seasonYear) {
      const players = (await seasonPlayers(String(seasonYear))).players || [];
      for (const p of players) {
        if (abbr && String(p.teamAbbr || '').toUpperCase() === abbr) {
          out.push({
            id: p.id, name: p.name, jersey: '', position: p.position,
            age: p.age, height: '', weight: '', college: '', headshot: p.headshot || '',
          });
        }
      }
    }
    if (out.length) return out;
    const payload = await fetchJson(`${CORE}/teams/${encodeURIComponent(teamId)}/roster`);
    for (const a of payload.athletes || []) {
      out.push({
        id: a.id,
        name: a.displayName || a.fullName,
        jersey: a.jersey,
        position: (a.position || {}).abbreviation,
        age: a.age,
        height: a.displayHeight,
        weight: a.displayWeight,
        college: a.college && typeof a.college === 'object' ? a.college.name : null,
        headshot: a.headshot && typeof a.headshot === 'object' ? a.headshot.href || '' : '',
      });
    }
    return out;
  }

  async function searchPlayers(q) {
    const text = (q || '').trim().toLowerCase();
    if (!text) return [];
    const idx = await indexes();
    const out = [];
    const seen = new Set();
    for (const p of (idx.searchIndex.players || [])) {
      const id = String(p.id);
      if (seen.has(id)) continue;
      if (String(p.name || '').toLowerCase().indexOf(text) >= 0) {
        seen.add(id);
        out.push({ id: p.id, name: p.name, team: p.team || '', position: p.position || '', headshot: p.headshot || '' });
      }
    }
    if (!out.length) {
      const list = (await seasonPlayers(idx.latest)).players || [];
      for (const p of list) {
        const id = String(p.id);
        if (seen.has(id)) continue;
        if (String(p.name || '').toLowerCase().indexOf(text) >= 0) {
          seen.add(id);
          out.push({ id: p.id, name: p.name, team: p.teamAbbr || '', position: p.position || '', headshot: p.headshot || '' });
        }
      }
    }
    return out.slice(0, 20);
  }

  /* ---------------- 投篮热区 ---------------- */
  async function shotChart(eventId) {
    if (!eventId) return { error: 'missing game id' };
    const summary = await fetchJson(`${CORE}/summary?event=${encodeURIComponent(eventId)}`);
    const box = summary.boxscore || {};
    const teamAbbr = {};
    const players = {};
    for (const block of box.players || []) {
      const team = block.team || {};
      teamAbbr[String(team.id)] = team.abbreviation || '';
      for (const stat of block.statistics || []) {
        for (const row of stat.athletes || []) {
          const ath = row.athlete || {};
          if (ath.id) players[String(ath.id)] = ath.displayName || '';
        }
      }
    }
    const shots = [];
    for (const p of summary.plays || []) {
      if (!p.shootingPlay) continue;
      const coord = p.coordinate || {};
      const x = coord.x;
      const y = coord.y;
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      if (x < -2 || x > 54 || y < -4 || y > 50) continue;
      const parts = (p.participants || []).map((pt) => String((pt.athlete || {}).id));
      let pid = parts.find((i) => players[i]);
      if (!pid) pid = parts[0] || '';
      const team = p.team || {};
      const tid = String(team.id);
      shots.push({
        id: p.id,
        team: teamAbbr[tid] || '',
        teamId: tid,
        playerId: pid,
        player: players[pid] || '',
        x: Math.round(x * 100) / 100,
        y: Math.round(y * 100) / 100,
        made: Boolean(p.scoringPlay),
        points: p.pointsAttempted || 2,
        period: (p.period || {}).number,
        clock: (p.clock || {}).displayValue,
        text: p.text || '',
      });
    }
    const comp = ((summary.header || {}).competitions || [{}])[0] || {};
    return {
      game: {
        id: String(eventId),
        date: comp.date,
        venue: (comp.venue || {}).fullName,
        teams: (comp.competitors || []).map((c) => ({
          abbr: teamAbbr[String((c.team || {}).id)] || '',
          id: String((c.team || {}).id),
        })),
      },
      count: shots.length,
      shots,
    };
  }

  /* ---------------- 路由 ---------------- */
  async function api(name, params) {
    const q = params || {};
    const idx = await indexes();

    switch (name) {
      case 'meta':
        return idx.meta;

      case 'teams':
        return idx.teams;

      case 'standings': {
        const year = String(q.season || idx.latest);
        return dataFile(`standings-${year}.json`);
      }

      case 'games': {
        let year = String(q.season || '');
        const dateStr = q.date || '';
        const team = String(q.team || '').toUpperCase();
        if (!year && dateStr) year = idx.latest;
        let games = [];
        if (year) {
          const g = await seasonGames(year);
          games = g.games || [];
        }
        if (dateStr) {
          games = games.filter(
            (g) => g.gameDate === dateStr || String(g.date || '').slice(0, 10) === dateStr
          );
        }
        if (!games.length && dateStr) {
          const compact = dateStr.replace(/-/g, '');
          const payload = await fetchJson(`${CORE}/scoreboard?dates=${compact}`);
          games = (payload.events || []).map(normalizeEvent).filter(
            (g) => g.gameDate === dateStr || String(g.date || '').slice(0, 10) === dateStr
          );
        }
        if (team) {
          games = games.filter(
            (g) => g.home?.abbr === team || g.away?.abbr === team
          );
        }
        const total = games.length;
        if (q.order === 'desc') games = games.slice().reverse();
        const limit = parseInt(q.limit, 10) || 0;
        if (limit) games = games.slice(0, limit);
        return { season: year, count: total, games };
      }

      case 'game':
        return normalizeGameFull(q.id, q.season);

      case 'players': {
        const year = String(q.season || idx.latest);
        const data = await seasonPlayers(year);
        let rows = data.players || [];
        const pos = String(q.pos || '').toUpperCase();
        const team = String(q.team || '').toUpperCase();
        const text = String(q.q || '').trim().toLowerCase();
        if (pos) rows = rows.filter((r) => String(r.position || '').toUpperCase() === pos);
        if (team) rows = rows.filter((r) => String(r.teamAbbr || '').toUpperCase() === team);
        if (text) rows = rows.filter((r) => String(r.name || '').toLowerCase().includes(text));
        const sort = q.sort || 'avgPoints';
        rows = rows.slice().sort((a, b) => statNum(b.stats?.[sort]) - statNum(a.stats?.[sort]));
        const total = rows.length;
        const limit = Math.min(parseInt(q.limit, 10) || 60, 300);
        const offset = parseInt(q.offset, 10) || 0;
        return {
          season: year, total, limit, offset,
          players: rows.slice(offset, offset + limit),
        };
      }

      case 'leaders': {
        const year = String(q.season || idx.latest);
        const stat = q.stat || 'avgPoints';
        const data = await seasonPlayers(year);
        const rows = (data.players || [])
          .slice()
          .sort((a, b) => statNum(b.stats?.[stat]) - statNum(a.stats?.[stat]))
          .slice(0, 15);
        return { stat, players: rows };
      }

      case 'player': {
        const [bio, seasons] = await Promise.all([
          playerBio(q.id, q.season),
          playerSeasons(q.id),
        ]);
        return { bio, seasons };
      }

      case 'gamelog':
        return gamelog(q.id, q.season || idx.latest);

      case 'roster':
        return roster(q.team, q.season || '');

      case 'search':
        return { players: await searchPlayers(q.q || '') };

      case 'shots':
        return shotChart(q.game);

      default:
        throw new Error('unknown api ' + name);
    }
  }

  global.STATIC_API = api;
  global.NBA_STATIC = { api, indexes };
  if (typeof module !== 'undefined' && module.exports) module.exports = { STATIC_API: api };
})(typeof window !== 'undefined' ? window : globalThis);
