'use strict';

/* ============================== 基础工具 ============================== */
const $ = (sel) => document.querySelector(sel);
const app = $('#app');

const state = {
  meta: null,
  season: null,
  seasons: [],
  teams: [],
  teamMap: {},
  route: '',
};

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));

const num = (value, digits = 1) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return n.toFixed(digits);
};

const pad2 = (n) => String(n).padStart(2, '0');

function formatDate(iso, withWeek = false) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const week = '日一二三四五六'[d.getDay()];
  const thisYear = new Date().getFullYear();
  const yPrefix = d.getFullYear() !== thisYear ? `${d.getFullYear()}年` : '';
  const base = `${d.getMonth() + 1}月${d.getDate()}日`;
  return withWeek ? `${yPrefix}${base} · 周${week}` : `${yPrefix}${base}`;
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const logoOf = (team) => (team && team.logo) || '';
const abbrOf = (team) => (team && (team.abbr || team.abbreviation)) || '';

/* ============================== API ============================== */
async function api(path, params = {}) {
  // 纯静态版（GitHub Pages）：交给 api-static.js 的本地/ESPN 实现
  if (typeof window !== 'undefined' && window.STATIC_API) return window.STATIC_API(path, params);
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  });
  const url = `/api/${path}${search.toString() ? `?${search}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${text.slice(0, 160)}`);
  }
  return res.json();
}

let loadingCount = 0;
function setLoading(on) {
  loadingCount += on ? 1 : -1;
  $('#loading').hidden = loadingCount <= 0;
}

async function withLoading(task) {
  setLoading(true);
  try {
    return await task();
  } catch (err) {
    console.error(err);
    toast(`加载失败：${err.message || err}`);
    return null;
  } finally {
    setLoading(false);
  }
}

let toastTimer = null;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

/* ============================== 组件 ============================== */
function teamTag(team, { logo = true } = {}) {
  if (!team) return '';
  const img = logo && team.logo ? `<img src="${escapeHtml(team.logo)}" alt="" loading="lazy">` : '';
  return `<span class="team-cell">${img}<span>${escapeHtml(abbrOf(team) || team.name || '')}</span></span>`;
}

function gameCard(game) {
  const home = game.home || {};
  const away = game.away || {};
  const status = game.status || {};
  const stateName = status.state;
  const completed = stateName === 'post' && status.completed;
  const live = stateName === 'in';
  const homeWin = completed && Number(home.score) > Number(away.score);
  const awayWin = completed && Number(away.score) > Number(home.score);
  const score = (stateName === 'pre')
    ? `<span class="gc-meta">${escapeHtml(formatTime(game.date))} 开赛</span>`
    : `<div class="gc-score">
         <span class="${homeWin ? 'win' : ''}">${escapeHtml(home.score ?? '-')}</span>
         <span class="sep">:</span>
         <span class="${awayWin ? 'win' : ''}">${escapeHtml(away.score ?? '-')}</span>
       </div>
       <div class="gc-meta">${completed ? '全场' : live ? '<span class="live">进行中</span>' : ''}
         ${status.detail && !completed ? escapeHtml(status.detail) : ''}</div>`;
  return `
    <a class="game-card" href="#/game/${encodeURIComponent(game.id)}">
      <div class="gc-team">
        ${home.logo ? `<img src="${escapeHtml(home.logo)}" alt="" loading="lazy">` : ''}
        <span><span class="abbr">${escapeHtml(abbrOf(home))}</span>
          <span class="nm">${escapeHtml(home.name || '')}</span></span>
      </div>
      <div class="gc-mid">${score}</div>
      <div class="gc-team right">
        <span><span class="abbr">${escapeHtml(abbrOf(away))}</span>
          <span class="nm">${escapeHtml(away.name || '')}</span></span>
        ${away.logo ? `<img src="${escapeHtml(away.logo)}" alt="" loading="lazy">` : ''}
      </div>
    </a>`;
}

function playerLine(p, rank) {
  const stats = p.stats || {};
  return `
    <a class="prow" href="#/player/${encodeURIComponent(p.id)}">
      ${rank ? `<span class="rank">${rank}</span>` : ''}
      ${p.headshot ? `<img class="avatar" src="${escapeHtml(p.headshot)}" alt="" loading="lazy">` : '<span class="avatar"></span>'}
      <span class="who">
        <span class="nm">${escapeHtml(p.name)}</span>
        <span class="tm">${escapeHtml(p.teamAbbr || '')} · ${escapeHtml(p.position || '')} </span>
      </span>
      <span class="val">${num(stats.avgPoints)}<small> 分</small></span>
    </a>`;
}

function emptyState(title, hint) {
  return `<div class="empty"><b>${escapeHtml(title)}</b>${escapeHtml(hint || '')}</div>`;
}

/* ============================== 路由 ============================== */
function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart] = raw.split('?');
  const seg = pathPart.split('/').filter(Boolean);
  return { seg, q: Object.fromEntries(new URLSearchParams(queryPart || '')) };
}

function router() {
  const { seg, q } = parseHash();
  state.route = seg[0] || 'home';
  const qSeason = q && q.season ? String(q.season) : '';
  if (qSeason && qSeason !== String(state.season) && (state.seasons || []).some((s) => String(s.year) === qSeason)) {
    state.season = qSeason;
    localStorage.setItem('nba-season', qSeason);
    renderSeasonSelect();
  }
  document.querySelectorAll('#nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === (state.route === 'home' ? '' : state.route));
  });
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  const views = {
    home: viewHome,
    games: viewGames,
    game: viewGame,
    players: viewPlayers,
    player: viewPlayer,
    teams: viewTeams,
    team: viewTeam,
    leaders: viewLeaders,
    compare: viewCompare,
    calendar: viewCalendar,
    shots: viewShots,
  };
  const view = views[state.route] || viewHome;
  app.innerHTML = '<div class="skeleton" style="height:220px"></div>';
  view(seg, q);
}

/* ============================== 首页 ============================== */
async function viewHome() {
  const season = state.season;
  const metaSeason = (state.meta?.seasons || []).find((s) => s.year === season) || {};
  const data = await withLoading(() => Promise.all([
    api('games', { season, order: 'desc' }),
    api('leaders', { season, stat: 'avgPoints' }),
    api('standings', { season }),
  ]));
  if (!data) return;
  const [gamesResp, leaders, standings] = data;
  const games = (gamesResp.games || [])
    .filter((g) => g.status?.state === 'post')
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, 6);

  const topScorers = (leaders.players || []).slice(0, 6);
  const confs = standings.groups || [];
  const confTable = (group) => `
    <table>
      <thead><tr><th>#</th><th>球队</th><th>胜</th><th>负</th><th>胜率</th></tr></thead>
      <tbody>
        ${(group.entries || []).slice(0, 8).map((e, i) => `
          <tr class="clickable" onclick="location.hash='#/team/${encodeURIComponent(e.team.id)}'">
            <td>${i + 1}</td>
            <td>${teamTag(e.team)}</td>
            <td>${escapeHtml(e.stats.wins ?? '—')}</td>
            <td>${escapeHtml(e.stats.losses ?? '—')}</td>
            <td>${escapeHtml(e.stats.winPercent ?? '—')}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  app.innerHTML = `
    <section class="hero">
      <div class="eyebrow">NBA · All-Time Explorer</div>
      <h1>每一场比赛，<br>每一个<em>球员数据</em>，都能查到。</h1>
      <p>按赛季、日期、球队自由检索 NBA 赛程赛果，查看单场技术统计；浏览球员生涯赛季数据与逐场表现。数据覆盖多个赛季，并支持按日期回溯。</p>
      <div class="hero-actions">
        <a class="btn primary" href="#/games">浏览赛程赛果 →</a>
        <a class="btn" href="#/players">球员数据</a>
        <a class="btn" href="#/leaders">数据榜</a>
      </div>
      <div class="hero-stats">
        <div class="hero-stat"><b>${metaSeason.games ? metaSeason.games.toLocaleString('zh-CN') : '—'}</b><span>${escapeHtml(metaSeason.label || '')} 赛季比赛场次</span></div>
        <div class="hero-stat"><b>${state.teams.length || 30}</b><span>支球队</span></div>
        <div class="hero-stat"><b>${metaSeason.players || '—'}</b><span>位球员赛季数据</span></div>
        <div class="hero-stat"><b>${(state.meta?.seasons || []).length}</b><span>个赛季可回溯</span></div>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>最近赛果</h2>
        <a class="more" href="#/games">查看全部 →</a>
      </div>
      <div class="grid-2">
        <div class="game-list">${games.length ? games.map(gameCard).join('') : emptyState('暂无比赛数据', '请先运行 python prefetch.py 预取数据')}</div>
        <div class="card">
          <h3>得分榜 TOP 6</h3>
          ${topScorers.map((p, i) => playerLine(p, i + 1)).join('')}
          <a class="more" style="display:inline-block;margin-top:12px" href="#/leaders">完整数据榜 →</a>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>东西部排名</h2><a class="more" href="#/teams">全部球队 →</a></div>
      <div class="standings">
        ${confs.map((g) => `<div class="table-wrap" style="padding:6px">${confTable(g)}</div>`).join('')}
      </div>
    </section>

    <section class="section grid-3">
      <a class="card hover" href="#/games">
        <h3>赛程赛果</h3>
        <div style="font-size:22px;font-weight:800;margin-bottom:6px">按日期检索</div>
        <div style="color:var(--muted);font-size:13.5px">选择任意日期，查看当天全部比赛与比分，点击进入单场技术统计。</div>
      </a>
      <a class="card hover" href="#/players">
        <h3>球员数据</h3>
        <div style="font-size:22px;font-weight:800;margin-bottom:6px">${metaSeason.players || '—'} 位球员</div>
        <div style="color:var(--muted);font-size:13.5px">按球队、位置筛选，按得分/篮板/助攻等排序，进入球员主页查看生涯赛季数据与比赛日志。</div>
      </a>
      <a class="card hover" href="#/teams">
        <h3>球队档案</h3>
        <div style="font-size:22px;font-weight:800;margin-bottom:6px">30 支球队</div>
        <div style="color:var(--muted);font-size:13.5px">战绩排名、赛季赛程、当前阵容名单，一处查看。</div>
      </a>
    </section>
  `;
}

/* ============================== 赛程赛果 ============================== */
async function viewGames(seg, q) {
  const date = q.date || '';
  const team = (q.team || '').toUpperCase();
  const season = q.season ? Number(q.season) : state.season;
  if (q.season && String(season) !== String(state.season)) {
    state.season = season;
    localStorage.setItem('nba-season', String(season));
    renderSeasonSelect();
  }
  app.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Schedule & Results</div>
        <h1>赛程与赛果</h1>
        <div class="sub">选择日期或球队检索比赛，点击任意比赛查看单场技术统计</div>
      </div>
    </div>
    <div class="filters">
      <div class="field">
        <label>日期</label>
        <input type="date" id="fDate" value="${escapeHtml(date)}">
      </div>
      <div class="field">
        <label>球队</label>
        <select id="fTeam"><option value="">全部球队</option></select>
      </div>
      <button class="btn small" id="btnToday">今天</button>
      <button class="btn small" id="btnClear">最近比赛</button>
      <div class="spacer"></div>
      <div class="result-count" id="gCount"></div>
    </div>
    <div id="gList" class="game-list"><div class="skeleton"></div></div>
  `;
  const teamSelect = $('#fTeam');
  teamSelect.innerHTML += state.teams
    .slice().sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
    .map((t) => `<option value="${escapeHtml(t.abbr)}" ${t.abbr === team ? 'selected' : ''}>${escapeHtml(t.displayName)}</option>`)
    .join('');

  const go = (next) => {
    const params = new URLSearchParams();
    if (next.date) params.set('date', next.date);
    if (next.team) params.set('team', next.team);
    location.hash = `#/games${params.toString() ? `?${params}` : ''}`;
  };
  $('#fDate').addEventListener('change', (e) => go({ date: e.target.value, team: $('#fTeam').value }));
  teamSelect.addEventListener('change', () => go({ date: $('#fDate').value, team: teamSelect.value }));
  $('#btnToday').addEventListener('click', () => go({ date: todayStr(), team: teamSelect.value }));
  $('#btnClear').addEventListener('click', () => go({ team: teamSelect.value }));

  const resp = await withLoading(() => api('games', {
    season, date, team, ...(date ? {} : { order: 'desc', limit: 80 }),
  }));
  if (!resp) return;
  const games = resp.games || [];
  $('#gCount').textContent = `${resp.count} 场比赛`;
  const list = $('#gList');
  if (!games.length) {
    list.innerHTML = emptyState('没有找到比赛', date ? '该日期暂无比赛，换一天试试，或点“最近比赛”' : '该赛季暂无数据');
    return;
  }
  const groups = new Map();
  games.forEach((g) => {
    const key = g.gameDate || (g.date || '').slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  });
  list.innerHTML = [...groups.entries()].map(([day, items]) => `
    <div style="margin-top:6px;color:var(--muted);font-size:13px;letter-spacing:.6px">${escapeHtml(formatDate(day + 'T00:00:00', true))} · ${items.length} 场</div>
    <div class="game-list" style="margin-bottom:6px">${items.map(gameCard).join('')}</div>
  `).join('');
}

/* ============================== 比赛详情 ============================== */
function statValue(row, key) {
  const labels = row.stats || {};
  const v = labels[key];
  return v === undefined || v === null || v === '' ? '—' : v;
}

async function viewGame(seg) {
  const id = seg[1];
  if (!id) { location.hash = '#/games'; return; }
  const payload = await withLoading(() => api('game', { id, season: state.season }));
  if (!payload) return;
  const { game, box } = payload;
  const gameDateStr = String(game?.date || game?.gameDate || '').slice(0, 10);
  if (gameDateStr.length === 10) {
    const [gy, gm] = gameDateStr.split('-').map(Number);
    const gameSeason = gm >= 9 ? gy + 1 : gy;
    if (String(gameSeason) !== String(state.season)) {
      state.season = String(gameSeason);
      localStorage.setItem('nba-season', state.season);
      renderSeasonSelect();
    }
  }
  if (!game) {
    app.innerHTML = emptyState('未找到该场比赛', '可能是历史比赛或数据尚未收录，可回到赛程页按日期查询');
    return;
  }
  const home = game.home || {};
  const away = game.away || {};
  const done = game.status?.state === 'post';
  const homeWin = done && Number(home.score) > Number(away.score);
  const awayWin = done && Number(away.score) > Number(home.score);
  const players = (box?.boxscore?.players) || [];
  const teamStats = (box?.boxscore?.teams) || [];

  const boxTable = (teamBlock) => {
    const rows = teamBlock.rows || [];
    const labels = ['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', 'FG', '3PT', 'FT', '+/-'];
    return `
      <div class="box-col">
      <div class="box-team">
        ${teamBlock.team.logo ? `<img src="${escapeHtml(teamBlock.team.logo)}" alt="">` : ''}
        <b>${escapeHtml(teamBlock.team.displayName || abbrOf(teamBlock.team))}</b>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>球员</th>${labels.map((l) => `<th>${l}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.map((row) => {
              const dnp = (row.stats?.MIN || '') === '' || row.stats?.MIN === 'DNP';
              return `<tr class="${dnp ? '' : 'clickable'}" ${dnp ? '' : `onclick="location.hash='#/player/${row.id}'"`}>
                <td><div class="tplayer"><span class="tmeta"><b>${escapeHtml(row.name)}</b><span>${escapeHtml(row.position || '')}${row.starter ? ' · 首发' : ''}</span></span></div></td>
                ${labels.map((l) => `<td>${escapeHtml(statValue(row, l))}</td>`).join('')}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      </div>`;
  };

  const compare = (() => {
    if (teamStats.length < 2) return '';
    const a = teamStats[0];
    const b = teamStats[1];
    const labelMap = new Map();
    (a.stats || []).forEach((s) => labelMap.set(s.label, { label: s.label, a: s.value, b: '' }));
    (b.stats || []).forEach((s) => {
      if (labelMap.has(s.label)) labelMap.get(s.label).b = s.value;
      else labelMap.set(s.label, { label: s.label, a: '', b: s.value });
    });
    const rows = [...labelMap.values()].filter((r) => r.a !== undefined && r.b !== undefined).slice(0, 14);
    return `
      <div class="section">
        <div class="section-head"><h2>球队数据对比</h2><span class="more">${escapeHtml(abbrOf(a.team))} vs ${escapeHtml(abbrOf(b.team))}</span></div>
        <div class="card">
          ${rows.map((r) => {
            const na = parseFloat(String(r.a).replace(/[^\d.-]/g, '')) || 0;
            const nb = parseFloat(String(r.b).replace(/[^\d.-]/g, '')) || 0;
            const total = na + nb || 1;
            return `<div class="compare-row">
              <div class="l">${escapeHtml(r.a)}<div class="bar"><i style="width:${(na / total * 100).toFixed(0)}%;background:var(--accent)"></i></div></div>
              <div class="label">${escapeHtml(r.label)}</div>
              <div class="r">${escapeHtml(r.b)}<div class="bar"><i style="width:${(nb / total * 100).toFixed(0)}%;background:var(--blue)"></i></div></div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  })();

  app.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Box Score</div>
        <h1>比赛详情</h1>
        <div class="sub">${escapeHtml(formatDate(game.date, true))} · ${escapeHtml(game.venue || '')}</div>
      </div>
      <a class="btn small" href="#/shots?game=${encodeURIComponent(id)}" style="${id.indexOf('538-') === 0 ? 'display:none' : ''}">投篮热区 →</a>
      <a class="btn small ghost" href="#/games">← 返回赛程</a>
    </div>

    <div class="scoreboard">
      <div class="sb-team">
        ${home.logo ? `<img src="${escapeHtml(home.logo)}" alt="">` : ''}
        <div class="nm">${escapeHtml(home.displayName || abbrOf(home))}</div>
        <div class="rec">${escapeHtml(home.record || '')}</div>
      </div>
      <div class="sb-center">
        <div class="sb-score">
          <span class="${homeWin ? 'win' : ''}">${escapeHtml(home.score ?? '-')}</span>
          <span class="sep">:</span>
          <span class="${awayWin ? 'win' : ''}">${escapeHtml(away.score ?? '-')}</span>
        </div>
        <div class="sb-status">${escapeHtml(game.status?.detail || (done ? '比赛结束' : '未开始'))}</div>
        <div class="sb-meta">${escapeHtml(box?.header?.venue || game.venue || '')}</div>
      </div>
      <div class="sb-team">
        ${away.logo ? `<img src="${escapeHtml(away.logo)}" alt="">` : ''}
        <div class="nm">${escapeHtml(away.displayName || abbrOf(away))}</div>
        <div class="rec">${escapeHtml(away.record || '')}</div>
      </div>
    </div>

    ${players.length ? `
      <div class="box-grid">
        ${boxTable(players[0])}
        ${players[1] ? boxTable(players[1]) : ''}
      </div>
      <div class="mini-note">点击球员可进入球员主页；DNP 表示未出场。</div>
    ` : emptyState('暂无本场技术统计', id.indexOf('538-') === 0 ? '1996 年以前的赛季仅收录比赛结果，暂不提供逐场技术统计' : '该场比赛的技术统计暂未收录')}

    ${compare}
  `;
}

/* ============================== 球员列表 ============================== */
async function viewPlayers(seg, q) {
  const season = state.season;
  const sort = q.sort || 'avgPoints';
  const search = q.q || '';
  const team = (q.team || '').toUpperCase();
  const pos = (q.pos || '').toUpperCase();
  const offset = Number(q.offset || 0);
  const limit = 60;

  const sortOptions = [
    ['avgPoints', '场均得分'], ['avgRebounds', '场均篮板'], ['avgAssists', '场均助攻'],
    ['avgSteals', '场均抢断'], ['avgBlocks', '场均盖帽'], ['avgMinutes', '场均时间'],
    ['fieldGoalPct', '投篮命中率'], ['threePointFieldGoalPct', '三分命中率'], ['freeThrowPct', '罚球命中率'],
    ['doubleDouble', '两双次数'],
  ];

  app.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Players</div>
        <h1>球员数据</h1>
        <div class="sub">按球队、位置筛选，按任意数据排序；点击球员查看生涯数据</div>
      </div>
    </div>
    <div class="filters">
      <div class="field grow">
        <label>搜索球员</label>
        <input type="search" id="fSearch" placeholder="输入球员姓名，例如 LeBron" value="${escapeHtml(search)}">
      </div>
      <div class="field">
        <label>球队</label>
        <select id="fTeam"><option value="">全部</option></select>
      </div>
      <div class="field">
        <label>位置</label>
        <select id="fPos">
          <option value="">全部</option>
          ${['G', 'F', 'C', 'G-F', 'F-C'].map((p) => `<option value="${p}" ${p === pos ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>排序</label>
        <select id="fSort">
          ${sortOptions.map(([v, t]) => `<option value="${v}" ${v === sort ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="spacer"></div>
      <div class="result-count" id="pCount"></div>
    </div>
    <div class="table-wrap"><div id="pTable" style="padding:12px"><div class="skeleton"></div></div></div>
  `;

  const teamSel = $('#fTeam');
  teamSel.innerHTML += state.teams
    .slice().sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
    .map((t) => `<option value="${escapeHtml(t.abbr)}" ${t.abbr === team ? 'selected' : ''}>${escapeHtml(t.displayName)}</option>`)
    .join('');

  let timer = null;
  const go = (overrides = {}) => {
    const params = new URLSearchParams();
    const next = { sort, q: search, team, pos, offset: 0, ...overrides };
    if (next.q) params.set('q', next.q);
    if (next.team) params.set('team', next.team);
    if (next.pos) params.set('pos', next.pos);
    if (next.sort && next.sort !== 'avgPoints') params.set('sort', next.sort);
    if (next.offset) params.set('offset', next.offset);
    location.hash = `#/players${params.toString() ? `?${params}` : ''}`;
  };
  $('#fSearch').addEventListener('input', (e) => {
    clearTimeout(timer);
    const value = e.target.value.trim();
    timer = setTimeout(() => go({ q: value }), 320);
  });
  $('#fSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(timer); go({ q: e.target.value.trim() }); }
  });
  teamSel.addEventListener('change', () => go({ team: teamSel.value }));
  $('#fPos').addEventListener('change', () => go({ pos: $('#fPos').value }));
  $('#fSort').addEventListener('change', () => go({ sort: $('#fSort').value }));

  const resp = await withLoading(() => api('players', { season, q: search, team, pos, sort, limit, offset }));
  if (!resp) return;
  $('#pCount').textContent = `共 ${resp.total} 人`;
  const players = resp.players || [];
  if (!players.length) {
    const metaSeason = (state.meta?.seasons || []).find((s) => String(s.year) === String(season)) || {};
    const noData = !metaSeason.players && Number(season) <= 1995;
    $('#pTable').innerHTML = emptyState(
      noData ? '该赛季暂无球员数据' : '没有匹配的球员',
      noData ? '1996 年以前的赛季仅收录比赛结果，球员赛季数据自 1996-97 赛季起提供' : '换个关键词或清空筛选条件',
    );
    return;
  }
  $('#pTable').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th><th>球员</th><th>球队</th><th>位置</th><th>场次</th><th>场均时间</th>
          <th>得分</th><th>篮板</th><th>助攻</th><th>抢断</th><th>盖帽</th>
          <th>FG%</th><th>3P%</th><th>FT%</th>
        </tr>
      </thead>
      <tbody>
        ${players.map((p, i) => {
          const s = p.stats || {};
          return `<tr class="clickable" onclick="location.hash='#/player/${encodeURIComponent(p.id)}'">
            <td>${offset + i + 1}</td>
            <td><div class="tplayer">${p.headshot ? `<img class="av" src="${escapeHtml(p.headshot)}" alt="" loading="lazy">` : '<span class="av"></span>'}
              <span class="tmeta"><b>${escapeHtml(p.name)}</b><span>${escapeHtml(p.age ? `${p.age} 岁` : '')}</span></span></div></td>
            <td>${p.teamLogo ? `<span class="team-cell"><img src="${escapeHtml(p.teamLogo)}" alt="">${escapeHtml(p.teamAbbr || '')}</span>` : escapeHtml(p.teamAbbr || '—')}</td>
            <td>${escapeHtml(p.position || '—')}</td>
            <td>${num(s.gamesPlayed, 0)}</td>
            <td>${num(s.avgMinutes)}</td>
            <td><b>${num(s.avgPoints)}</b></td>
            <td>${num(s.avgRebounds)}</td>
            <td>${num(s.avgAssists)}</td>
            <td>${num(s.avgSteals)}</td>
            <td>${num(s.avgBlocks)}</td>
            <td>${num(s.fieldGoalPct)}</td>
            <td>${num(s.threePointFieldGoalPct)}</td>
            <td>${num(s.freeThrowPct)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  const pages = Math.max(1, Math.ceil(resp.total / limit));
  const current = Math.floor(offset / limit) + 1;
  if (pages > 1) {
    $('#pTable').insertAdjacentHTML('afterend', `
      <div class="pager">
        <button class="btn small" id="pPrev" ${current <= 1 ? 'disabled' : ''}>← 上一页</button>
        <span>第 ${current} / ${pages} 页</span>
        <button class="btn small" id="pNext" ${current >= pages ? 'disabled' : ''}>下一页 →</button>
      </div>`);
    $('#pPrev')?.addEventListener('click', () => go({ offset: Math.max(0, offset - limit) }));
    $('#pNext')?.addEventListener('click', () => go({ offset: offset + limit }));
  }
}

/* ============================== 球员详情 ============================== */
async function viewPlayer(seg, q) {
  const id = seg[1];
  if (!id) { location.hash = '#/players'; return; }
  const season = state.season;
  const data = await withLoading(() => Promise.all([
    api('player', { id, season }),
    api('gamelog', { id, season }).catch(() => null),
  ]));
  if (!data) return;
  const [player, log] = data;
  if (!player || !player.bio) {
    app.innerHTML = emptyState('未找到该球员', '请检查链接或从球员列表进入');
    return;
  }
  const bio = player.bio;
  const team = bio.team || {};
  const seasons = player.seasons || [];
  const current = seasons.find((s) => String(s.season) === String(season)) || seasons[seasons.length - 1];

  const seasonRows = seasons.slice().reverse().map((s) => {
    const st = s.stats || {};
    return `<tr class="${String(s.season) === String(season) ? 'clickable' : 'clickable'}" onclick="location.hash='#/player/${encodeURIComponent(id)}?season=${s.season}'">
      <td>${escapeHtml(s.label || '')}</td>
      <td>${num(st.GP, 0)}</td><td>${num(st.MIN)}</td><td><b>${num(st.PTS)}</b></td>
      <td>${num(st.REB)}</td><td>${num(st.AST)}</td><td>${num(st.STL)}</td><td>${num(st.BLK)}</td>
      <td>${num(st['FG%'])}</td><td>${num(st['3P%'])}</td><td>${num(st['FT%'])}</td>
    </tr>`;
  }).join('');

  let logTable = '';
  if (log && log.games && log.games.length) {
    const rows = log.games.filter((g) => !g.seasonType || /Regular|Playoff|Play In|Postseason/i.test(g.seasonType));
    const shown = (rows.length ? rows : log.games).slice(0, 30);
    logTable = `
      <div class="section">
        <div class="section-head"><h2>近期比赛日志</h2><span class="more">${escapeHtml(shown[0]?.seasonType || '')} · 最近 ${shown.length} 场</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>日期</th><th>对阵</th><th>主客</th><th>结果</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th></tr></thead>
            <tbody>
              ${shown.map((r) => {
                const st = r.stats || {};
                return `<tr>
                  <td>${escapeHtml(formatDate(r.date))}</td>
                  <td>${r.homeAway === 'home' ? 'vs' : '@'} ${escapeHtml(r.opponent || r.name || '')}</td>
                  <td>${r.homeAway === 'home' ? '主' : '客'}</td>
                  <td>${r.result ? `<span class="${r.result === 'W' ? 'win' : ''}">${escapeHtml(r.result)}</span> ` : ''}${escapeHtml(r.score || '')}</td>
                  <td>${escapeHtml(st.MIN || '—')}</td>
                  <td><b>${escapeHtml(st.PTS || '—')}</b></td>
                  <td>${escapeHtml(st.REB || '—')}</td>
                  <td>${escapeHtml(st.AST || '—')}</td>
                  <td>${escapeHtml(st.STL || '—')}</td>
                  <td>${escapeHtml(st.BLK || '—')}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  app.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Player Profile</div>
        <h1>球员主页</h1>
        <div class="sub">${escapeHtml(bio.name || '')} · ${escapeHtml(current?.label || '')} 赛季</div>
      </div>
      <a class="btn small" href="#/players">← 返回球员列表</a>
    </div>

    <section class="player-hero">
      ${bio.headshot ? `<img class="headshot" src="${escapeHtml(bio.headshot)}" alt="${escapeHtml(bio.name || '')}">` : ''}
      <div class="pinfo">
        <div class="pmeta">
          ${team.logo ? `<span class="team-badge"><img src="${escapeHtml(team.logo)}" alt="">${escapeHtml(team.displayName || abbrOf(team))}</span>` : ''}
          <span>#${escapeHtml(bio.jersey || '—')} · ${escapeHtml(bio.positionName || bio.position || '')}</span>
        </div>
        <h1>${escapeHtml(bio.name || '')}</h1>
        <div class="bio-chips">
          <span>身高 <b>${escapeHtml(bio.height || '—')}</b></span>
          <span>体重 <b>${escapeHtml(bio.weight || '—')}</b></span>
          <span>年龄 <b>${escapeHtml(bio.age || '—')}</b></span>
          <span>球龄 <b>${escapeHtml(bio.debutYear ? `${new Date().getFullYear() - Number(bio.debutYear)} 年` : '—')}</b></span>
          ${bio.college ? `<span>大学 <b>${escapeHtml(bio.college)}</b></span>` : ''}
          ${bio.birthPlace ? `<span>出生地 <b>${escapeHtml(bio.birthPlace)}</b></span>` : ''}
        </div>
      </div>
      ${current ? `
        <div class="card" style="min-width:210px;background:rgba(255,107,53,.07);border-color:rgba(255,107,53,.25)">
          <h3 style="margin-bottom:10px">${escapeHtml(current.label || '')} 场均</h3>
          <div style="display:flex;gap:20px">
            <div><div style="font-size:30px;font-weight:800;color:var(--accent)">${num(current.stats?.PTS)}</div><div style="color:var(--muted);font-size:12px">得分</div></div>
            <div><div style="font-size:30px;font-weight:800">${num(current.stats?.REB)}</div><div style="color:var(--muted);font-size:12px">篮板</div></div>
            <div><div style="font-size:30px;font-weight:800">${num(current.stats?.AST)}</div><div style="color:var(--muted);font-size:12px">助攻</div></div>
          </div>
        </div>` : ''}
    </section>

    <div class="section">
      <div class="section-head"><h2>生涯赛季数据（场均）</h2><span class="more">点击任意赛季可切换</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>赛季</th><th>GP</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>FG%</th><th>3P%</th><th>FT%</th></tr></thead>
          <tbody>${seasonRows || `<tr><td colspan="11">暂无赛季数据</td></tr>`}</tbody>
        </table>
      </div>
    </div>

    ${logTable}
  `;
}

/* ============================== 球队 ============================== */
async function viewTeams() {
  const season = state.season;
  const standings = await withLoading(() => api('standings', { season }));
  if (!standings) return;
  const recordMap = new Map();
  (standings.groups || []).forEach((g) => (g.entries || []).forEach((e) => recordMap.set(String(e.team.id), e)));
  const confOf = new Map();
  (standings.groups || []).forEach((g) => (g.entries || []).forEach((e) => confOf.set(String(e.team.id), g.name)));
  const teams = state.teams.slice().sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));

  app.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Teams</div>
        <h1>30 支球队</h1>
        <div class="sub">${escapeHtml(standings.label || '')} 赛季战绩 · 点击查看球队赛程与阵容</div>
      </div>
    </div>
    <div class="team-grid">
      ${teams.map((t) => {
        const rec = recordMap.get(String(t.id));
        const st = rec?.stats || {};
        return `<a class="team-card" href="#/team/${encodeURIComponent(t.id)}">
          ${t.logo ? `<img src="${escapeHtml(t.logo)}" alt="">` : ''}
          <div class="tn">${escapeHtml(t.displayName || t.name)}</div>
          <div class="tr">${escapeHtml(confOf.get(String(t.id))?.replace(' Conference', '') || '')} ${st.wins ? `· ${st.wins}-${st.losses}` : ''}</div>
        </a>`;
      }).join('')}
    </div>
  `;
}

async function viewTeam(seg) {
  const id = seg[1];
  if (!id) { location.hash = '#/teams'; return; }
  const season = state.season;
  const team = state.teamMap[String(id)];
  if (!team) { app.innerHTML = emptyState('未找到球队', ''); return; }
  const abbr = team.abbr;
  const data = await withLoading(() => Promise.all([
    api('standings', { season }),
    api('games', { season, team: abbr }),
    api('roster', { team: id, season }).catch(() => []),
  ]));
  if (!data) return;
  const [standings, gamesResp, roster] = data;
  const entry = (standings.groups || []).flatMap((g) => (g.entries || []).map((e) => ({ ...e, conf: g.name })))
    .find((e) => String(e.team.id) === String(id));
  const st = entry?.stats || {};
  const games = (gamesResp.games || []).slice().reverse();

  app.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Team</div>
        <h1>${escapeHtml(team.displayName || team.name)}</h1>
        <div class="sub">${escapeHtml(entry?.conf || '')} · ${escapeHtml(standings.label || '')} 赛季</div>
      </div>
      <a class="btn small" href="#/teams">← 全部球队</a>
    </div>

    <section class="player-hero" style="padding:24px 30px">
      ${team.logo ? `<img class="headshot" style="border-radius:50%;padding:10px;background:rgba(255,255,255,.05)" src="${escapeHtml(team.logo)}" alt="">` : ''}
      <div class="pinfo">
        <h1 style="margin-top:0">${escapeHtml(team.displayName || '')}</h1>
        <div class="pmeta">
          <div class="bio-chips" style="margin-top:6px">
            <span>战绩 <b>${escapeHtml(st.wins || '—')}-${escapeHtml(st.losses || '—')}</b></span>
            <span>胜率 <b>${escapeHtml(st.winPercent || '—')}</b></span>
            <span>场均得分 <b>${escapeHtml(st.avgPoints || '—')}</b></span>
            <span>场均失分 <b>${escapeHtml(st.avgPointsAgainst || '—')}</b></span>
            <span>主场 <b>${escapeHtml(st.Home || st.home || '—')}</b></span>
            <span>客场 <b>${escapeHtml(st.Road || st.road || '—')}</b></span>
          </div>
        </div>
      </div>
    </section>

    <div class="section">
      <div class="section-head"><h2>赛季赛程与赛果</h2><span class="more">共 ${games.length} 场</span></div>
      <div class="game-list">
        ${games.slice(0, 30).map((g) => gameCard(g)).join('') || emptyState('暂无赛程', '')}
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h2>当前阵容</h2><span class="more">${(roster || []).length} 人</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>球员</th><th>位置</th><th>年龄</th><th>身高</th><th>体重</th><th>大学</th></tr></thead>
          <tbody>
            ${(roster || []).length ? roster.map((p) => `
              <tr class="clickable" onclick="location.hash='#/player/${encodeURIComponent(p.id)}'">
                <td>${escapeHtml(p.jersey || '—')}</td>
                <td><div class="tplayer">${p.headshot ? `<img class="av" src="${escapeHtml(p.headshot)}" alt="" loading="lazy">` : ''}
                  <span class="tmeta"><b>${escapeHtml(p.name)}</b></span></div></td>
                <td>${escapeHtml(p.position || '—')}</td>
                <td>${escapeHtml(p.age ?? '—')}</td>
                <td>${escapeHtml(p.height || '—')}</td>
                <td>${escapeHtml(p.weight || '—')}</td>
                <td>${escapeHtml(p.college || '—')}</td>
              </tr>`).join('') : '<tr><td colspan="7">暂无阵容数据</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* ============================== 数据榜 ============================== */
const LEADER_TABS = [
  ['avgPoints', '场均得分'], ['avgRebounds', '场均篮板'], ['avgAssists', '场均助攻'],
  ['avgSteals', '场均抢断'], ['avgBlocks', '场均盖帽'], ['fieldGoalPct', '投篮命中率'],
  ['threePointFieldGoalPct', '三分命中率'], ['freeThrowPct', '罚球命中率'],
];

async function viewLeaders(seg, q) {
  const season = state.season;
  const stat = q.stat || 'avgPoints';
  const players = await withLoading(async () => {
    const resp = await api('players', { season, sort: stat, limit: 40 });
    return resp.players || [];
  });
  if (!players) return;
  const statKey = {
    avgPoints: 'avgPoints', avgRebounds: 'avgRebounds', avgAssists: 'avgAssists',
    avgSteals: 'avgSteals', avgBlocks: 'avgBlocks', fieldGoalPct: 'fieldGoalPct',
    threePointFieldGoalPct: 'threePointFieldGoalPct', freeThrowPct: 'freeThrowPct',
  }[stat];
  app.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Leaderboard</div>
        <h1>数据榜</h1>
        <div class="sub">${escapeHtml((state.meta?.seasons || []).find((s) => s.year === season)?.label || '')} 赛季 · 按场均数据排序</div>
      </div>
    </div>
    <div class="rank-tabs">
      ${LEADER_TABS.map(([key, label]) => `<a class="chip ${key === stat ? 'active' : ''}" href="#/leaders?stat=${key}">${label}</a>`).join('')}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>球员</th><th>球队</th><th>场次</th><th>数值</th><th>联盟排名</th></tr></thead>
        <tbody>
          ${players.slice(0, 40).map((p, i) => `
            <tr class="clickable" onclick="location.hash='#/player/${encodeURIComponent(p.id)}'">
              <td>${i + 1}</td>
              <td><div class="tplayer">${p.headshot ? `<img class="av" src="${escapeHtml(p.headshot)}" alt="" loading="lazy">` : ''}
                <span class="tmeta"><b>${escapeHtml(p.name)}</b><span>${escapeHtml(p.position || '')}</span></span></div></td>
              <td>${p.teamLogo ? `<span class="team-cell"><img src="${escapeHtml(p.teamLogo)}" alt="">${escapeHtml(p.teamAbbr || '')}</span>` : ''}</td>
              <td>${num(p.stats?.gamesPlayed, 0)}</td>
              <td><b style="font-size:16px;color:var(--accent)">${num(p.stats?.[statKey])}</b></td>
              <td>${i + 1}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/* ============================== 投篮热区 ============================== */
const COURT = { W: 50, H: 47, BY: 5.25, R3: 23.75 };
const shotState = { team: 'all', result: 'all', mode: 'scatter', player: '' };

function courtLines() {
  const { W, H, BY, R3 } = COURT;
  const arcY = BY + Math.sqrt(Math.max(0, R3 * R3 - 22 * 22));
  const arc = [];
  for (let x = 3; x <= 47.0001; x += 0.45) {
    arc.push(`${x.toFixed(2)},${(BY + Math.sqrt(Math.max(0, R3 * R3 - (x - 25) ** 2))).toFixed(2)}`);
  }
  return `
    <g class="court-lines">
      <rect x="0.4" y="0.4" width="${W - 0.8}" height="${H - 0.8}" />
      <rect x="17" y="0" width="16" height="19" />
      <circle cx="25" cy="19" r="6" />
      <rect x="19" y="0" width="12" height="19" />
      <circle cx="25" cy="${BY}" r="4" />
      <polyline points="${arc.join(' ')}" />
      <line x1="3" y1="0" x2="3" y2="${arcY.toFixed(2)}" />
      <line x1="47" y1="0" x2="47" y2="${arcY.toFixed(2)}" />
      <line x1="22" y1="4" x2="28" y2="4" />
      <circle cx="25" cy="${BY}" r="0.75" />
      <line x1="0" y1="${H - 0.2}" x2="${W}" y2="${H - 0.2}" />
      <circle cx="25" cy="${H}" r="6" />
    </g>`;
}

function shotPanel(shots) {
  const made = shots.filter((s) => s.made).length;
  const twoA = shots.filter((s) => s.points === 2).length;
  const threeA = shots.filter((s) => s.points === 3).length;
  const twoM = shots.filter((s) => s.points === 2 && s.made).length;
  const threeM = shots.filter((s) => s.points === 3 && s.made).length;
  const byPlayer = {};
  shots.forEach((s) => {
    const k = s.player || '未知';
    byPlayer[k] = byPlayer[k] || { att: 0, made: 0, id: s.playerId };
    byPlayer[k].att += 1;
    if (s.made) byPlayer[k].made += 1;
  });
  const tops = Object.entries(byPlayer).sort((a, b) => b[1].att - a[1].att).slice(0, 8);
  const pct = (a, m) => (a ? Math.round((m / a) * 1000) / 10 : 0);
  return `
    <div class="shot-summary">
      <div class="sbox"><b>${shots.length}</b><span>出手</span></div>
      <div class="sbox"><b>${made}</b><span>命中</span></div>
      <div class="sbox"><b>${pct(shots.length, made)}%</b><span>总命中率</span></div>
      <div class="sbox"><b>${twoM}/${twoA}</b><span>两分</span></div>
      <div class="sbox"><b>${threeM}/${threeA}</b><span>三分</span></div>
    </div>
    <div class="shot-players">
      ${tops.map(([name, v]) => `<button class="chip ${shotState.player === name ? 'active' : ''}" data-p="${escapeHtml(name)}">${escapeHtml(name)} <em>${v.made}/${v.att}</em></button>`).join('')}
    </div>`;
}

async function viewShots(seg, q) {
  const season = state.season;
  const gamesResp = await withLoading(() => api('games', { season, order: 'desc', limit: 80 }));
  const finished = ((gamesResp || {}).games || []).filter((g) => g.status?.state === 'post');
  const gid = q.game || seg[1] || finished[0]?.id;
  shotState.player = '';
  if (!gid) { app.innerHTML = emptyState('暂无可绘制的比赛', '请先在赛程页选择一场已结束的比赛'); return; }
  const data = await withLoading(() => api('shots', { game: gid }));
  const shotsAll = (data || {}).shots || [];
  const teams = ((data || {}).game || {}).teams || [];
  const gameInfo = finished.find((g) => String(g.id) === String(gid)) || {};
  if (!shotsAll.length) {
    app.innerHTML = `<div class="page-head"><div><div class="eyebrow">Shot Chart</div><h1>投篮热区</h1></div></div>
      ${emptyState('这场比赛暂无投篮坐标数据', 'ESPN 仅对部分场次提供逐回合坐标，换一场试试')}`;
    return;
  }
  const filtered = () => shotsAll.filter((s) => {
    if (shotState.team !== 'all' && s.team !== shotState.team) return false;
    if (shotState.result === 'made' && !s.made) return false;
    if (shotState.result === 'miss' && s.made) return false;
    if (shotState.player && s.player !== shotState.player) return false;
    return true;
  });
  const teamChips = [`<button class="chip ${shotState.team === 'all' ? 'active' : ''}" data-t="all">全部</button>`]
    .concat(teams.map((t) => `<button class="chip ${shotState.team === t.abbr ? 'active' : ''}" data-t="${escapeHtml(t.abbr)}">${escapeHtml(t.abbr)}</button>`))
    .join('');
  app.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Shot Chart</div>
        <h1>投篮热区</h1>
        <div class="sub">${escapeHtml(gameInfo.shortName || '')} · ${escapeHtml(formatDate(gameInfo.date ? new Date(gameInfo.date) : ''))} · 逐回合投篮坐标（英尺）</div>
      </div>
      <a class="btn small" href="#/game/${encodeURIComponent(gid)}">← 比赛详情</a>
    </div>
    <div class="shot-layout">
      <div class="court-card">
        <div class="court-wrap" id="courtWrap">
          <svg class="court-svg" viewBox="0 0 ${COURT.W} ${COURT.H}" preserveAspectRatio="xMidYMid meet">
            <rect x="0" y="0" width="${COURT.W}" height="${COURT.H}" fill="#101a2c"/>
            ${courtLines()}
            <g id="shotLayer"></g>
          </svg>
          <canvas class="heat-canvas" id="heatCanvas" width="1000" height="940" hidden></canvas>
        </div>
        <div class="shot-toolbar">
          <div class="chip-group">${teamChips}</div>
          <div class="chip-group">
            <button class="chip ${shotState.result === 'all' ? 'active' : ''}" data-r="all">全部</button>
            <button class="chip ${shotState.result === 'made' ? 'active' : ''}" data-r="made">命中</button>
            <button class="chip ${shotState.result === 'miss' ? 'active' : ''}" data-r="miss">未中</button>
          </div>
          <div class="chip-group">
            <button class="chip ${shotState.mode === 'scatter' ? 'active' : ''}" data-m="scatter">散点</button>
            <button class="chip ${shotState.mode === 'heat' ? 'active' : ''}" data-m="heat">热区</button>
          </div>
          <button class="btn small ghost" id="shotReset">重置</button>
        </div>
        <div id="shotSummary">${shotPanel(filtered())}</div>
      </div>
      <div class="shot-side">
        <div class="section">
          <div class="section-head"><h2>比赛</h2></div>
          <select class="select" id="shotGameSel">
            ${finished.slice(0, 40).map((g) => `<option value="${escapeHtml(g.id)}" ${String(g.id) === String(gid) ? 'selected' : ''}>${escapeHtml((g.gameDate || '') + '  ' + (g.shortName || ''))}</option>`).join('')}
          </select>
          <p class="hint">热区图基于 ESPN 逐回合数据，仅统计有坐标的出手；颜色越深表示该区域出手越密集。</p>
        </div>
      </div>
    </div>`;
  const layer = $('#shotLayer');
  const canvas = $('#heatCanvas');
  const paint = () => {
    const rows = filtered();
    if (shotState.mode === 'heat') {
      layer.innerHTML = '';
      canvas.hidden = false;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const sx = canvas.width / COURT.W;
      const sy = canvas.height / COURT.H;
      rows.forEach((s) => {
        const g = ctx.createRadialGradient(s.x * sx, s.y * sy, 0, s.x * sx, s.y * sy, 80);
        g.addColorStop(0, s.made ? 'rgba(53,208,127,.42)' : 'rgba(255,107,53,.26)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(s.x * sx, s.y * sy, 80, 0, Math.PI * 2);
        ctx.fill();
      });
    } else {
      canvas.hidden = true;
      layer.innerHTML = rows.map((s) =>
        `<circle class="shot-dot ${s.made ? 'made' : 'miss'}" cx="${s.x}" cy="${s.y}" r="${s.made ? 0.95 : 0.8}">
           <title>${escapeHtml(`${s.player} · ${s.period}Q ${s.clock} · ${s.made ? '命中' : '未中'} ${s.points}分`)}</title>
         </circle>`).join('');
    }
    $('#shotSummary').innerHTML = shotPanel(rows);
    document.querySelectorAll('#shotSummary .chip').forEach((b) => {
      b.onclick = () => { shotState.player = shotState.player === b.dataset.p ? '' : b.dataset.p; paint(); document.querySelectorAll('.shot-players .chip').forEach((x) => x.classList.toggle('active', x.dataset.p === shotState.player)); };
    });
  };
  document.querySelectorAll('.shot-toolbar .chip[data-t]').forEach((b) => {
    b.onclick = () => { shotState.team = b.dataset.t; shotState.player = ''; document.querySelectorAll('.shot-toolbar .chip[data-t]').forEach((x) => x.classList.toggle('active', x.dataset.t === shotState.team)); paint(); };
  });
  document.querySelectorAll('.shot-toolbar .chip[data-r]').forEach((b) => {
    b.onclick = () => { shotState.result = b.dataset.r; document.querySelectorAll('.shot-toolbar .chip[data-r]').forEach((x) => x.classList.toggle('active', x.dataset.r === shotState.result)); paint(); };
  });
  document.querySelectorAll('.shot-toolbar .chip[data-m]').forEach((b) => {
    b.onclick = () => { shotState.mode = b.dataset.m; document.querySelectorAll('.shot-toolbar .chip[data-m]').forEach((x) => x.classList.toggle('active', x.dataset.m === shotState.mode)); paint(); };
  });
  $('#shotReset').onclick = () => {
    shotState.team = 'all'; shotState.result = 'all'; shotState.mode = 'scatter'; shotState.player = '';
    document.querySelectorAll('.shot-toolbar .chip').forEach((x) => x.classList.toggle('active', ['all'].includes(x.dataset.t) || ['all'].includes(x.dataset.r) || ['scatter'].includes(x.dataset.m)));
    paint();
  };
  $('#shotGameSel').onchange = (e) => { location.hash = `#/shots?game=${encodeURIComponent(e.target.value)}`; };
  paint();
}

/* ============================== 球员对比 ============================== */
const CMP_PALETTE = ['#4f8cff', '#ff6b35', '#35d07f', '#ffd166'];
const CMP_METRICS = [
  ['avgPoints', '得分'], ['avgRebounds', '篮板'], ['avgAssists', '助攻'], ['avgSteals', '抢断'],
  ['avgBlocks', '盖帽'], ['fieldGoalPct', 'FG%'], ['threePointFieldGoalPct', '3P%'], ['freeThrowPct', 'FT%'],
];

async function viewCompare(seg, q) {
  const season = state.season;
  const ids = String(q.ids || '').split(',').filter(Boolean).slice(0, 4);
  const poolResp = await withLoading(() => api('players', { season, limit: 600 }));
  const pool = (poolResp || {}).players || [];
  const players = ids.length
    ? await withLoading(() => Promise.all(ids.map((id) => api('player', { id, season }).catch(() => null))))
    : [];
  const rows = (players || []).filter((p) => p && p.bio);
  const ranges = {};
  CMP_METRICS.forEach(([key]) => {
    const vals = pool.map((p) => Number(p.stats?.[key])).filter((v) => Number.isFinite(v));
    if (!vals.length) { ranges[key] = [0, 1]; return; }
    const max = Math.max(...vals);
    ranges[key] = [0, max || 1];
  });
  const norm = (key, v) => {
    const [lo, hi] = ranges[key];
    const x = Number(v);
    if (!Number.isFinite(x)) return 0;
    return Math.max(4, Math.min(100, ((x - lo) / (hi - lo)) * 100));
  };
  const radar = () => {
    const n = CMP_METRICS.length;
    const cx = 180, cy = 180, R = 132;
    const pt = (i, v) => {
      const a = (Math.PI * 2 * i) / n - Math.PI / 2;
      const rr = (v / 100) * R;
      return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
    };
    const grid = [25, 50, 75, 100].map((lv) => {
      const pts = CMP_METRICS.map((_, i) => pt(i, lv).map((v) => v.toFixed(1)).join(',')).join(' ');
      return `<polygon points="${pts}" class="rg" />`;
    }).join('');
    const axes = CMP_METRICS.map((_, i) => {
      const [x, y] = pt(i, 100);
      return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="ra" />`;
    }).join('');
    const labels = CMP_METRICS.map(([, label], i) => {
      const [x, y] = pt(i, 118);
      return `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="middle" class="rl">${label}</text>`;
    }).join('');
    const polys = rows.map((p, idx) => {
      const stats = (p.seasons || []).find((s) => String(s.season) === String(season))?.stats || {};
      const pts = CMP_METRICS.map(([key], i) => pt(i, norm(key, stats[key])).map((v) => v.toFixed(1)).join(',')).join(' ');
      return `<polygon points="${pts}" class="rp" style="stroke:${CMP_PALETTE[idx % 4]};fill:${CMP_PALETTE[idx % 4]}22" />`;
    }).join('');
    return `<svg class="radar" viewBox="0 0 360 360">${grid}${axes}${labels}${polys}</svg>`;
  };
  const legend = rows.map((p, i) => `<span class="lg"><i style="background:${CMP_PALETTE[i % 4]}"></i>${escapeHtml(p.bio.name || '')}</span>`).join('');
  const statTable = rows.length ? `
    <div class="table-wrap">
      <table class="cmp-table">
        <thead><tr><th>指标</th>${rows.map((p, i) => `<th style="color:${CMP_PALETTE[i % 4]}">${escapeHtml(p.bio.name || '')}</th>`).join('')}</tr></thead>
        <tbody>
          ${[['GP', '出场'], ['MIN', '场均分钟'], ...CMP_METRICS.map(([k, l]) => [k, l])].map(([key, label]) => `
            <tr><td>${label}</td>
              ${rows.map((p) => {
                const st = (p.seasons || []).find((s) => String(s.season) === String(season))?.stats || {};
                const v = key === 'GP' || key === 'MIN' ? num(st[key], key === 'GP' ? 0 : 1) : num(st[key]);
                return `<td>${v}</td>`;
              }).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : emptyState('还没有选择球员', '在下方输入球员名添加，最多 4 人同屏对比');
  app.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Comparison</div>
        <h1>球员对比</h1>
        <div class="sub">${escapeHtml((state.meta?.seasons || []).find((s) => s.year === season)?.label || '')} 赛季 · 雷达图为该赛季数据在联盟中的相对水平</div>
      </div>
    </div>
    <div class="cmp-tools">
      <input class="input" id="cmpInput" list="cmpPool" placeholder="输入球员姓名后回车添加（最多 4 人）">
      <datalist id="cmpPool">${pool.map((p) => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.teamAbbr || '')}</option>`).join('')}</datalist>
      <button class="btn small" id="cmpAdd">添加</button>
      ${ids.length ? `<a class="btn small ghost" href="#/compare">清空</a>` : ''}
      <span class="hint">示例：Stephen Curry、Nikola Jokic、Luka Doncic、Victor Wembanyama</span>
    </div>
    ${rows.length ? `
      <div class="cmp-grid">
        <div class="card radar-card">${radar()}<div class="legend">${legend}</div></div>
        <div class="card">${statTable}</div>
      </div>` : statTable}`;
  const add = () => {
    const name = ($('#cmpInput').value || '').trim();
    if (!name) return;
    const hit = pool.find((p) => (p.name || '').toLowerCase() === name.toLowerCase())
      || pool.find((p) => (p.name || '').toLowerCase().includes(name.toLowerCase()));
    if (!hit) { toast('没找到这个球员，换个名字试试'); return; }
    if (ids.includes(String(hit.id))) { toast('已经在对比列表里了'); return; }
    if (ids.length >= 4) { toast('最多同时对比 4 名球员'); return; }
    location.hash = `#/compare?ids=${encodeURIComponent([...ids, hit.id].join(','))}`;
  };
  $('#cmpAdd').onclick = add;
  $('#cmpInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
}

/* ============================== 赛程日历 ============================== */
function gameCache(season) {
  state.gameCache = state.gameCache || {};
  if (!state.gameCache[season]) {
    state.gameCache[season] = api('games', { season }).then((r) => (r.games || [])).catch(() => []);
  }
  return state.gameCache[season];
}

async function viewCalendar(seg, q) {
  const season = state.season;
  const games = await withLoading(() => gameCache(season));
  const list = games || [];
  const latest = list.map((g) => (g.gameDate || '').slice(0, 7)).filter(Boolean).sort().pop() || '2026-06';
  const month = /^\d{4}-\d{2}$/.test(q.month || '') ? q.month : latest;
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const startIdx = (first.getDay() + 6) % 7; // 周一为第一列
  const byDate = {};
  list.forEach((g) => {
    const d = (g.gameDate || '').slice(0, 10);
    if (!d.startsWith(month)) return;
    (byDate[d] = byDate[d] || []).push(g);
  });
  const shift = (delta) => {
    const dt = new Date(y, m - 1 + delta, 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
  };
  const cells = [];
  for (let i = 0; i < startIdx; i += 1) cells.push('<div class="cal-day empty"></div>');
  for (let d = 1; d <= daysInMonth; d += 1) {
    const key = `${month}-${String(d).padStart(2, '0')}`;
    const gs = byDate[key] || [];
    const isToday = new Date().toISOString().slice(0, 10) === key;
    cells.push(`
      <div class="cal-day ${isToday ? 'today' : ''} ${gs.length ? 'has' : ''}" ${gs.length ? `onclick="location.hash='#/games?date=${key}'"` : ''}>
        <span class="cal-date">${d}</span>
        ${gs.slice(0, 3).map((g) => {
          const done = g.status?.state === 'post';
          const hs = Number(g.home?.score) || 0;
          const as = Number(g.away?.score) || 0;
          const win = hs > as ? g.home : g.away;
          return `<span class="cal-game">${done ? `${escapeHtml(win?.abbr || '')} <b>${Math.max(hs, as)}-${Math.min(hs, as)}</b>` : escapeHtml(`${g.away?.abbr || ''} @ ${g.home?.abbr || ''}`)}</span>`;
        }).join('')}
        ${gs.length > 3 ? `<span class="cal-more">+${gs.length - 3}</span>` : ''}
      </div>`);
  }
  app.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Calendar</div>
        <h1>赛程日历</h1>
        <div class="sub">${escapeHtml((state.meta?.seasons || []).find((s) => s.year === season)?.label || '')} 赛季 · 共 ${list.length} 场 · 点击日期查看当日比赛</div>
      </div>
    </div>
    <div class="cal-head">
      <a class="btn small ghost" href="#/calendar?month=${shift(-1)}">← 上月</a>
      <b>${y} 年 ${m} 月</b>
      <a class="btn small ghost" href="#/calendar?month=${shift(1)}">下月 →</a>
    </div>
    <div class="cal-week">${['一', '二', '三', '四', '五', '六', '日'].map((w) => `<span>${w}</span>`).join('')}</div>
    <div class="cal-grid">${cells.join('')}</div>`;
}

/* ============================== 启动 ============================== */
function renderSeasonSelect() {
  const sel = $('#seasonSelect');
  const seasons = state.seasons;
  sel.innerHTML = seasons
    .filter((s) => !s.error)
    .map((s) => `<option value="${s.year}" ${String(s.year) === String(state.season) ? 'selected' : ''}>${escapeHtml(s.label || s.year)}</option>`)
    .join('');
  if (!sel.options.length) {
    seasons.forEach((s) => sel.insertAdjacentHTML('beforeend', `<option value="${s.year}">${escapeHtml(s.label || s.year)}</option>`));
  }
  sel.value = String(state.season);
}

async function boot() {
  try {
    const meta = await api('meta');
    state.meta = meta;
    state.seasons = (meta.seasons || []).slice().sort((a, b) => Number(b.year) - Number(a.year));
    const saved = localStorage.getItem('nba-season');
    const available = state.seasons.filter((s) => !s.error);
    state.season = saved && available.some((s) => String(s.year) === saved)
      ? saved
      : (available[0]?.year || state.seasons[0]?.year || 2026);
    renderSeasonSelect();
    $('#footerUpdated').textContent = meta.generatedAt ? `数据更新：${meta.generatedAt}` : '';
    $('#seasonSelect').addEventListener('change', (e) => {
      state.season = e.target.value;
      localStorage.setItem('nba-season', state.season);
      router();
    });
    $('#refreshBtn').addEventListener('click', () => { location.reload(); });
    state.teams = await api('teams');
    state.teamMap = Object.fromEntries(state.teams.map((t) => [String(t.id), t]));
    window.addEventListener('hashchange', router);
    router();
  } catch (err) {
    console.error(err);
    app.innerHTML = emptyState('无法连接数据服务', `请确认已运行 python server.py；错误：${err.message}`);
  }
}

boot();
