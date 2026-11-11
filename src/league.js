/* Franchise Tycoon — league data. Turns Sleeper's API (or a generated demo season) into one normalized shape:
   league = { source, leagueId, name, season, playoffStart, lastWeek, myRosterId,
              teams: [{rosterId, name, owner}], players: {id: {n, pos}},
              trades: { [week]: [{rosters, adds: {playerId: rosterId}, drops}] }, ppw: { [week]: {playerId: pts} },
              weeks: { [week]: { complete, live, teams: { [rosterId]: {pts, mid, starters: [[id, pts]], bench, playoff} } } } } */
(function (root) {
  'use strict';
  const FT = (root.FT = root.FT || {});
  const API = 'https://api.sleeper.app/v1';

  async function get(path) {
    let res;
    try {
      res = await fetch(API + path);
    } catch (e) {
      const err = new Error('Sleeper could not be reached from this page.');
      err.code = 'network';
      throw err;
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('Sleeper returned an error (' + res.status + '). Try again in a minute.');
    return res.json();
  }

  /** Step 1: username -> user and their leagues for the current season (falls back to last season). */
  async function findLeagues(username) {
    const user = await get('/user/' + encodeURIComponent(username.trim()));
    if (!user || !user.user_id) throw new Error('No Sleeper account found for "' + username + '". Check the spelling of your username.');
    const state = (await get('/state/nfl')) || {};
    const seasons = [state.league_season || state.season, state.previous_season].filter(Boolean);
    let leagues = [], season = seasons[0];
    for (const yr of seasons) {
      const ls = (await get('/user/' + user.user_id + '/leagues/nfl/' + yr)) || [];
      const started = ls.filter((l) => l.status === 'in_season' || l.status === 'complete' || l.status === 'post_season');
      if (started.length) { leagues = started; season = yr; break; }
      if (!leagues.length) { leagues = ls; season = yr; }
    }
    return {
      user: { id: user.user_id, name: user.display_name || user.username },
      season,
      leagues: leagues.map((l) => ({ id: l.league_id, name: l.name, season: l.season, status: l.status, size: l.total_rosters })),
    };
  }

  /** Step 2: pull a whole league season and normalize it. */
  async function loadLeague(leagueId, userId) {
    const [lg, rosters, users, state] = await Promise.all([
      get('/league/' + leagueId), get('/league/' + leagueId + '/rosters'), get('/league/' + leagueId + '/users'), get('/state/nfl'),
    ]);
    if (!lg || !rosters) throw new Error('That league could not be loaded from Sleeper.');
    const uname = {};
    (users || []).forEach((u) => (uname[u.user_id] = { team: u.metadata && u.metadata.team_name, owner: u.display_name }));
    const teams = rosters.map((r) => {
      const u = uname[r.owner_id] || {};
      return { rosterId: r.roster_id, name: u.team || (u.owner ? 'Team ' + u.owner : 'Roster ' + r.roster_id), owner: u.owner || '', ownerId: r.owner_id, co: r.co_owners || [] };
    });
    const mine = teams.find((t) => t.ownerId === userId) || teams.find((t) => t.co.indexOf(userId) >= 0);
    const settings = lg.settings || {};
    const playoffStart = settings.playoff_week_start || 15;
    let lastWeek = playoffStart >= 16 ? 18 : 17; // fantasy seasons end in NFL week 17 unless the playoffs start late
    const sameSeason = state && String(state.league_season || state.season) === String(lg.season);
    const done = lg.status === 'complete' || !sameSeason || (state && state.season_type === 'post');
    const current = done ? 99 : state && state.season_type === 'regular' ? state.week : 0;
    const through = done ? 18 : Math.min(lastWeek, current);

    const weekNums = [];
    for (let w = 1; w <= through; w++) weekNums.push(w);
    const rawTrades = await Promise.all(weekNums.map((w) => get('/league/' + leagueId + '/transactions/' + w).catch(() => null)));
    const raw = await Promise.all(weekNums.map((w) => get('/league/' + leagueId + '/matchups/' + w).catch(() => null)));
    let bracket = null;
    if (through >= playoffStart) bracket = await get('/league/' + leagueId + '/winners_bracket').catch(() => null);
    const inBracket = (w, rid) => !!bracket && bracket.some((m) => playoffStart + m.r - 1 === w && (m.t1 === rid || m.t2 === rid));

    const weeks = {}, ppw = {}, trades = {};
    weekNums.forEach((w, i) => {
      const done = (rawTrades[i] || []).filter((x) => x && x.type === 'trade' && x.status === 'complete' && x.adds);
      if (done.length) trades[w] = done.map((x) => ({ rosters: x.roster_ids || [], adds: x.adds || {}, drops: x.drops || {} }));
      const rows = raw[i];
      if (!rows || !rows.length) return;
      ppw[w] = {};
      rows.forEach((m) => { for (const id in m.players_points || {}) if (+m.players_points[id] > 0) ppw[w][id] = +m.players_points[id]; });
      const tm = {};
      let total = 0;
      rows.forEach((m) => {
        const pts = +m.points || 0;
        total += pts;
        const st = (m.starters || []).map((id, j) => [id, +((m.starters_points || [])[j] != null ? m.starters_points[j] : (m.players_points || {})[id]) || 0]);
        const startSum = st.reduce((a, x) => a + x[1], 0);
        const all = Object.values(m.players_points || {}).reduce((a, x) => a + (+x || 0), 0);
        tm[m.roster_id] = { pts, mid: m.matchup_id == null ? null : m.matchup_id, starters: st.filter((x) => x[0] && x[0] !== '0'), bench: Math.max(0, Math.round((all - startSum) * 10) / 10), playoff: inBracket(w, m.roster_id) };
      });
      const complete = w < current && total > 0;
      weeks[w] = { complete, live: !complete && w === current, teams: tm };
    });
    if (done) lastWeek = Math.max(0, ...Object.keys(weeks).map(Number).filter((w) => weeks[w].complete));
    return {
      source: 'sleeper', leagueId, name: lg.name, season: String(lg.season), playoffStart, lastWeek,
      myRosterId: mine ? mine.rosterId : null, teams: teams.map((t) => ({ rosterId: t.rosterId, name: t.name, owner: t.owner })),
      players: {}, weeks, ppw, trades, syncedAt: Date.now(), seasonStart: (sameSeason && state && state.season_start_date) || null,
    };
  }

  /** Optional: resolve player ids to names for the game-day report. One large download, so it is cached by the caller. */
  async function loadNames(league) {
    const need = {};
    Object.values(league.weeks).forEach((wk) => Object.values(wk.teams).forEach((t) => t.starters.forEach(([id]) => { if (!league.players[id]) need[id] = 1; })));
    Object.values(league.trades || {}).forEach((list) => list.forEach((tr) => Object.keys(tr.adds).concat(Object.keys(tr.drops)).forEach((id) => { if (!league.players[id]) need[id] = 1; })));
    if (!Object.keys(need).length) return false;
    const all = await get('/players/nfl');
    if (!all) return false;
    Object.keys(need).forEach((id) => {
      const p = all[id];
      if (p) league.players[id] = { n: p.position === 'DEF' ? (p.first_name + ' ' + p.last_name) : ((p.first_name || '').charAt(0) + '. ' + (p.last_name || '')), pos: p.position || '' };
    });
    return true;
  }

  // ---- Demo league -----------------------------------------------------------------
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const DEMO_TEAMS = ['Harbor City Herons', 'Gridiron Goblins', 'Sunday Scaries', 'Waiver Wire Wizards', 'Flex Appeal', 'The Bye Weeks', 'Hail Mary Poppins', 'Trade Deadline Blues', 'Couch Coordinators', 'Fourth and Wrong'];
  const FIRST = 'Dex Milo Jace Tobin Rafe Kato Bram Odell Zeke Lando Cruz Nico Tate Abel Ivo Sully Remy Quill'.split(' ');
  const LAST = 'Varga Okoro Lindqvist Marsh Castellan Brody Imani Thackeray Oyelaran Pruitt Santoro Wexler Dunmore Achterberg Fonoti Kiplagat Rourke Yamada'.split(' ');
  const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
  const SLOT_AVG = [19, 14, 12, 14, 12, 9, 11, 8, 8];

  function demoLeague(seed, through) {
    const r = rng(seed || 2026);
    const n = DEMO_TEAMS.length;
    const teams = DEMO_TEAMS.map((name, i) => ({ rosterId: i + 1, name, owner: 'demo' + (i + 1) }));
    const strength = teams.map(() => 0.88 + r() * 0.26);
    strength[0] = 1.06; // your team: good, not dominant
    const players = {}, lineup = {};
    teams.forEach((t) => {
      lineup[t.rosterId] = SLOTS.map((pos, j) => {
        const id = 'd' + t.rosterId + '_' + j;
        players[id] = { n: pos === 'DEF' ? t.name.split(' ')[0] + ' D/ST' : FIRST[Math.floor(r() * FIRST.length)].charAt(0) + '. ' + LAST[Math.floor(r() * LAST.length)], pos };
        return id;
      });
    });
    // some players are simply better than their slot: these are the ones a trade is about
    const r2 = rng((seed || 2026) + 777), pm = {};
    Object.keys(players).forEach((id) => (pm[id] = 0.72 + r2() * 0.7));
    const trades = {};
    const swap = (w, a, b, sign) => {
      let j = 1;
      for (let k = 1; k <= 4; k++) if (sign * (pm[lineup[b][k]] - pm[lineup[a][k]]) > sign * (pm[lineup[b][j]] - pm[lineup[a][j]])) j = k;
      const x = lineup[a][j], y = lineup[b][j];
      lineup[a][j] = y; lineup[b][j] = x;
      (trades[w] = trades[w] || []).push({ rosters: [a, b], adds: { [y]: a, [x]: b }, drops: { [x]: a, [y]: b } });
    };
    const dealWeek = (w) => { if (w === 6) swap(6, 1, 3, 1); if (w === 8) swap(8, 2, 7, 1); if (w === 12) swap(12, 1, 6, -1); if (w === 13) swap(13, 4, 9, 1); };
    const gauss = () => (r() + r() + r() + r() - 2) / 0.58;
    const score = (rid) => {
      const st = lineup[rid].map((id, j) => [id, Math.max(0, Math.round((SLOT_AVG[j] * strength[rid - 1] * pm[id] * (1 + gauss() * 0.5)) * 10) / 10)]);
      return { pts: Math.round(st.reduce((a, x) => a + x[1], 0) * 100) / 100, starters: st, bench: Math.round((25 + r() * 40) * 10) / 10 };
    };
    const weeks = {};
    const ids = teams.map((t) => t.rosterId);
    const ring = ids.slice();
    for (let w = 1; w <= 14; w++) {
      dealWeek(w);
      const tm = {};
      for (let i = 0; i < n / 2; i++) {
        [ring[i], ring[n - 1 - i]].forEach((rid) => (tm[rid] = Object.assign(score(rid), { mid: i + 1, playoff: false })));
      }
      weeks[w] = { complete: true, live: false, teams: tm };
      ring.splice(1, 0, ring.pop());
    }
    const league = { source: 'demo', leagueId: 'demo-' + (seed || 2026), name: 'Demo League', season: '2026', playoffStart: 15, lastWeek: 16, myRosterId: 1, teams, players, weeks, trades, ppw: {}, seed: seed || 2026 };
    // Playoffs: top four, two rounds. Everyone else plays consolation games.
    const order = Object.values(FT.standings(league, 14)).sort((a, b) => a.rank - b.rank).map((x) => x.rid);
    const round = (w, pairs, playoffPairs) => {
      const tm = {};
      pairs.forEach((p, i) => p.forEach((rid) => (tm[rid] = Object.assign(score(rid), { mid: i + 1, playoff: i < playoffPairs }))));
      weeks[w] = { complete: true, live: false, teams: tm };
      return tm;
    };
    const semi = round(15, [[order[0], order[3]], [order[1], order[2]], [order[4], order[5]], [order[6], order[7]], [order[8], order[9]]], 2);
    const winner = (a, b) => (semi[a].pts >= semi[b].pts ? a : b);
    const f1 = winner(order[0], order[3]), f2 = winner(order[1], order[2]);
    const rest = order.filter((x) => x !== f1 && x !== f2);
    round(16, [[f1, f2], [rest[0], rest[1]], [rest[2], rest[3]], [rest[4], rest[5]], [rest[6], rest[7]]], 1);
    for (const w in weeks) { league.ppw[w] = {}; Object.values(weeks[w].teams).forEach((t) => t.starters.forEach(([id, p]) => { if (p > 0) league.ppw[w][id] = p; })); }
    setDemoWeek(league, through == null ? 9 : through);
    return league;
  }
  /** Demo time travel: mark weeks 1..through as final and the next one as in progress. */
  function setDemoWeek(league, through) {
    through = Math.max(0, through);
    league.demoThrough = Math.min(league.lastWeek, through);
    for (let w = 1; w <= league.lastWeek; w++) {
      league.weeks[w].complete = w <= league.demoThrough;
      league.weeks[w].live = w === league.demoThrough + 1;
    }
  }

  FT.Sleeper = { findLeagues, loadLeague, loadNames };
  FT.demoLeague = demoLeague;
  FT.setDemoWeek = setDemoWeek;
  if (typeof module !== 'undefined' && module.exports) module.exports = FT;
})(typeof window !== 'undefined' ? window : globalThis);
