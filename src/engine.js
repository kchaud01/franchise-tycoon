/* Franchise Tycoon — game engine. Pure logic, no DOM. Runs in the browser and in Node (tests). */
(function (root) {
  'use strict';
  const FT = (root.FT = root.FT || {});

  const GRID = 5;
  const STADIUM_TILES = ['1-1', '1-2', '2-1', '2-2'];
  const key = (r, c) => r + '-' + c;
  const isStadium = (k) => STADIUM_TILES.indexOf(k) >= 0;

  // ---- Catalog -------------------------------------------------------------
  // cost[level-1] is the price to reach that level. `v` is the per-level effect value.
  const BUILDINGS = {
    concessions: {
      name: 'Concessions', cost: [180e3, 420e3, 950e3], v: [2.5, 5, 8.5],
      blurb: 'Food and drink sales per fan in the building on home game days.',
      link: 'Scales with your fantasy score against the league median that week.',
      synergy: 'Next to the stadium: +20%',
      unit: (v) => '$' + v.toFixed(2) + ' per fan',
    },
    transit: {
      name: 'Transit Hub', cost: [220e3, 520e3, 1.2e6], v: [8e3, 18e3, 32e3],
      blurb: 'Parking and rail. Raises how many fans can physically reach the stadium.',
      link: 'Matters most when hype is high and the stadium would otherwise sell out the roads.',
      synergy: 'On the outer edge of the district: +10%',
      unit: (v) => '+' + Math.round(v / 1e3) + 'k fan access',
    },
    retail: {
      name: 'Team Store', cost: [260e3, 600e3, 1.4e6], v: [0.6, 1.3, 2.2],
      blurb: 'Merchandise sold to your whole fanbase every week, home or away.',
      link: 'Each starter who scores 20+ fantasy points adds 30% (jersey sales). Wins add 15%.',
      synergy: 'Next to a Transit Hub or Fan Plaza: +15% each (max +30%)',
      unit: (v) => '$' + v.toFixed(2) + ' per fan in the fanbase',
    },
    suites: {
      name: 'VIP Suites', cost: [600e3, 1.4e6, 3.2e6], v: [45e3, 100e3, 190e3],
      blurb: 'Corporate boxes leased on home game days.',
      link: 'Lease rates follow your league standing: 150% in 1st place down to 60% in last. Doubled in the playoffs.',
      synergy: 'Next to the stadium: +25%',
      unit: (v) => '$' + Math.round(v / 1e3) + 'k base per home game',
    },
    media: {
      name: 'Broadcast Center', cost: [450e3, 1e6, 2.4e6], v: [30e3, 65e3, 120e3],
      blurb: 'TV and streaming rights paid every week, home or away.',
      link: 'Close games (decided by under 10) pay +40%. Shootouts pay +30%. Night games pay +25%. Playoff games pay +50%.',
      synergy: 'Next to the stadium: +20%',
      unit: (v) => '$' + Math.round(v / 1e3) + 'k base per week',
    },
    fanzone: {
      name: 'Fan Plaza', cost: [240e3, 560e3, 1.3e6], v: [3, 6, 10],
      blurb: 'Watch parties earn money on away weeks, and good news travels further.',
      link: 'Boosts every hype gain by 10% per level. Away weeks: a fifth of your fanbase shows up to watch.',
      synergy: 'Next to Concessions: +15% each (max +30%)',
      unit: (v) => '$' + v + ' per watch-party fan',
    },
    medical: {
      name: 'Performance Center', cost: [350e3, 800e3, 1.8e6], v: [0.3, 0.55, 0.8],
      blurb: 'Sports medicine and training. Keeps the fanbase calm when things go wrong.',
      link: 'Cuts the hype hit from starters who bust (under 4 points) and softens losses by 10% per level.',
      synergy: 'No placement bonus',
      unit: (v) => Math.round(v * 100) + '% less bust damage',
    },
    scouting: {
      name: 'Front Office', cost: [300e3, 700e3, 1.6e6], v: [600, 1300, 2200],
      blurb: 'Scouts and analysts. Turns roster depth into money and grows the fanbase faster.',
      link: 'Pays for every point your bench scores. Fanbase growth +8% per level.',
      synergy: 'No placement bonus',
      unit: (v) => '$' + v + ' per bench point',
    },
  };
  const TYPES = Object.keys(BUILDINGS);

  const STADIUM = {
    cap: [18e3, 28e3, 40e3, 55e3, 72e3],
    cost: [0, 1.2e6, 3e6, 7e6, 15e6],
    name: ['Community Field', 'County Bowl', 'Metro Stadium', 'Grand Arena', 'Skyline Dome'],
  };
  const PRICES = [
    { id: 0, name: 'Value', price: 12, turnout: 1.15, hype: 1 },
    { id: 1, name: 'Standard', price: 20, turnout: 1, hype: 0 },
    { id: 2, name: 'Premium', price: 30, turnout: 0.8, hype: -1 },
  ];
  const PROMOS = {
    none: { name: 'No promotion', cost: 0, text: 'Save the money.' },
    giveaway: { name: 'Bobblehead Night', cost: 40e3, text: '+15% turnout at a home game.' },
    guarantee: { name: 'Guarantee a Win', cost: 0, text: 'Win: +8 hype and +20% merch. Lose: -8 hype.' },
    shootout: { name: 'Shootout Special', cost: 25e3, text: 'Beat the league median score: concessions and watch parties +50%.' },
  };
  const BASE_ACCESS = 14e3;
  const START_CASH = 700e3;
  const START_FANS = 20e3;
  const PAYROLL = 60e3;
  const SHARE = 110e3;
  const NIGHT_RATE = 38; // percent of regular-season games played at night
  const SALT = 281; // chosen so home and away weeks alternate reasonably
  const UPKEEP_RATE = 0.025;
  const STAR_PTS = 20;
  const BUST_PTS = 4;

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const dim = (vals) => vals.slice().sort((a, b) => b - a).reduce((s, v, i) => s + v / (1 + 0.4 * i), 0);

  // ---- League helpers --------------------------------------------------------
  function median(nums) {
    if (!nums.length) return 0;
    const s = nums.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function opponentOf(wk, rid) {
    const me = wk.teams[rid];
    if (!me || me.mid == null) return null;
    for (const id in wk.teams) if (+id !== +rid && wk.teams[id].mid === me.mid) return +id;
    return null;
  }
  /** Regular-season standings through `through` (inclusive). Returns {rid: {w,l,t,pf,rank}}. */
  function standings(league, through) {
    const tab = {};
    league.teams.forEach((t) => (tab[t.rosterId] = { rid: t.rosterId, w: 0, l: 0, t: 0, pf: 0 }));
    const last = Math.min(through, (league.playoffStart || 99) - 1);
    for (let w = 1; w <= last; w++) {
      const wk = league.weeks[w];
      if (!wk || !wk.complete) continue;
      for (const id in wk.teams) {
        const opp = opponentOf(wk, +id);
        if (opp == null || !tab[id]) continue;
        const a = wk.teams[id].pts, b = wk.teams[opp].pts;
        tab[id].pf += a;
        if (a > b) tab[id].w++; else if (a < b) tab[id].l++; else tab[id].t++;
      }
    }
    const order = Object.values(tab).sort((a, b) => (b.w + b.t / 2) - (a.w + a.t / 2) || b.pf - a.pf || a.rid - b.rid);
    order.forEach((r, i) => (r.rank = i + 1));
    return tab;
  }
  const teamName = (league, rid) => {
    const t = league.teams.find((x) => x.rosterId === rid);
    return t ? t.name : 'Bye';
  };

  /** Who hosts and whether it is a night game: a coin flip both sides of a matchup agree on. */
  function slot(week, rid, oppId) {
    const lo = Math.min(rid, oppId), hi = Math.max(rid, oppId);
    let x = SALT ^ Math.imul(week, 73856093) ^ Math.imul(lo, 19349663) ^ Math.imul(hi, 83492791);
    x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
    let y = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b); y ^= y >>> 15; y = Math.imul(y, 0xc2b2ae35); y ^= y >>> 13;
    return { home: ((x & 1) === 0) === (rid === lo), night: ((y >>> 0) % 100) < NIGHT_RATE };
  }
  /** The fixture for a week, known before any points are scored. Null when the week has no data yet. */
  function matchup(league, week, rid) {
    const wk = league.weeks[week], me = wk && wk.teams[rid];
    if (!me) return null;
    const oppId = opponentOf(wk, rid);
    if (oppId == null) return { week, bye: true, oppId: null, oppName: 'Bye', home: false, night: false, playoff: false, pts: me.pts, oppPts: 0 };
    const sl = slot(week, rid, oppId);
    return { week, bye: false, oppId, oppName: teamName(league, oppId), home: sl.home, night: !!me.playoff || sl.night, playoff: !!me.playoff, pts: me.pts, oppPts: wk.teams[oppId].pts };
  }
  /** League-mode bonus points. Each row compares an owner's weekly net with an auto-pilot twin that had the same
      fantasy result, so the table rewards decisions and not the fantasy score itself.
      rows: [{rid, net, twinNet, twinGross}] -> adds edge (percent), beaten, bonus. Ties share the lower bonus.
      payout: 'all' (sliding scale down to zero for last place), 'half' (top half only) or 'top3'. */
  function bonusTable(rows, cap, payout) {
    const out = rows.map((r) => Object.assign({}, r, { edge: Math.round(((r.net - r.twinNet) / Math.max(1, r.twinGross)) * 1000) / 10 }));
    const n = out.length;
    out.forEach((r) => {
      r.beaten = out.filter((o) => o.edge < r.edge).length;
      // k = how many places are paid: everyone but last, the top half, or the top three
      const k = Math.max(1, Math.min(n - 1, payout === 'top3' ? 3 : payout === 'half' ? Math.ceil(n / 2) : n - 1));
      const step = r.beaten - (n - k) + 1;
      r.bonus = n > 1 && step > 0 ? Math.round((cap * step / k) * 10) / 10 : 0;
    });
    return out.sort((a, b) => b.edge - a.edge || a.rid - b.rid);
  }

  // ---- Trades ---------------------------------------------------------------------------
  const REPLACEMENT = 8; // a player averaging this many points is easy to replace, so fans do not care
  /** A player's scoring average over finished weeks before `before`, counting only weeks they scored. */
  function playerAvg(league, id, before) {
    let g = 0, t = 0;
    for (let w = 1; w < before; w++) {
      const p = league.ppw && league.ppw[w] && league.ppw[w][id];
      if (p > 0 && league.weeks[w] && league.weeks[w].complete) { g++; t += p; }
    }
    return g ? t / g : 0;
  }
  /** What a team's trades in `week` did to its star power. Null when it made none.
      net = points-per-game above replacement gained minus given up. Draft picks are ignored. */
  function tradeImpact(league, week, rid) {
    const list = (league.trades && league.trades[week]) || [];
    const got = [], gave = [];
    let net = 0;
    const item = (id) => { const avg = playerAvg(league, id, week); return { id, n: (league.players && league.players[id] && league.players[id].n) || '', avg: Math.round(avg * 10) / 10, v: Math.max(0, avg - REPLACEMENT) }; };
    list.forEach((tr) => {
      if (tr.rosters.indexOf(rid) < 0) return;
      for (const id in tr.adds || {}) if (tr.adds[id] === rid) { const it = item(id); got.push(it); net += it.v; }
      for (const id in tr.drops || {}) if (tr.drops[id] === rid) { const it = item(id); gave.push(it); net -= it.v; }
    });
    if (!got.length && !gave.length) return null;
    const byAvg = (a, b) => b.avg - a.avg;
    return { net: Math.round(net * 10) / 10, in: got.sort(byAvg), out: gave.sort(byAvg) };
  }

  /** Everything the sim needs to know about one team's fantasy week. */
  function weekResult(league, week, rid) {
    const wk = league.weeks[week];
    if (!wk || !wk.complete) return null;
    const me = wk.teams[rid];
    if (!me) return null;
    const oppId = opponentOf(wk, rid);
    const n = league.teams.length;
    const st = standings(league, week)[rid] || { rank: n, w: 0, l: 0, t: 0 };
    const scores = Object.values(wk.teams).map((t) => t.pts).filter((p) => p > 0);
    const res = {
      season: league.season, week, rid, bye: oppId == null, playoff: !!me.playoff,
      pts: me.pts, oppId, oppPts: 0, oppName: 'Bye', win: false, tie: false, margin: 0,
      median: median(scores), rank: st.rank, n, record: st.w + '-' + st.l + (st.t ? '-' + st.t : ''),
      night: false, stars: 0, busts: 0, top: null, benchPts: me.bench || 0, home: false, trade: tradeImpact(league, week, rid),
    };
    (me.starters || []).forEach(([id, p]) => {
      if (p >= STAR_PTS) res.stars++;
      if (p < BUST_PTS) res.busts++;
      if (!res.top || p > res.top.pts) res.top = { id, pts: p };
    });
    if (oppId != null) {
      res.oppPts = wk.teams[oppId].pts;
      res.oppName = teamName(league, oppId);
      res.win = res.pts > res.oppPts;
      res.tie = res.pts === res.oppPts;
      res.margin = Math.abs(res.pts - res.oppPts);
      const sl = slot(week, rid, oppId);
      res.home = sl.home;
      res.night = res.playoff || sl.night;
    }
    return res;
  }

  // ---- Franchise state ---------------------------------------------------------
  function newFranchise(rid) {
    return {
      rid, cash: START_CASH, fans: START_FANS, hype: 50, stadium: 1, grid: {},
      price: 1, promo: 'none', streak: 0, invested: 0, sellouts: 0, wins: 0, losses: 0,
    };
  }
  function newGame(league, opts) {
    const s = newFranchise(league.myRosterId);
    s.v = 1;
    s.name = (opts && opts.name) || teamName(league, league.myRosterId);
    s.color = (opts && opts.color) || '#e4572e';
    s.played = {};
    s.history = [];
    s.badges = {};
    s.rivals = {};
    league.teams.forEach((t) => {
      if (t.rosterId !== league.myRosterId) s.rivals[t.rosterId] = newFranchise(t.rosterId);
    });
    return s;
  }

  function neighbors(k) {
    const [r, c] = k.split('-').map(Number);
    return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
      .filter(([a, b]) => a >= 0 && b >= 0 && a < GRID && b < GRID)
      .map(([a, b]) => key(a, b));
  }
  const nearStadium = (k) => neighbors(k).some(isStadium);
  const onEdge = (k) => { const [r, c] = k.split('-').map(Number); return r === 0 || c === 0 || r === GRID - 1 || c === GRID - 1; };

  /** Placement multiplier for a building of `type` on lot `k`. */
  function synergy(s, k, type) {
    const adj = neighbors(k).map((n) => (s.grid[n] ? s.grid[n].type : null));
    const count = (t) => adj.filter((a) => a === t).length;
    switch (type) {
      case 'concessions': return nearStadium(k) ? 1.2 : 1;
      case 'suites': return nearStadium(k) ? 1.25 : 1;
      case 'media': return nearStadium(k) ? 1.2 : 1;
      case 'transit': return onEdge(k) ? 1.1 : 1;
      case 'retail': return 1 + Math.min(0.3, 0.15 * (count('transit') + count('fanzone')));
      case 'fanzone': return 1 + Math.min(0.3, 0.15 * count('concessions'));
      default: return 1;
    }
  }

  /** Aggregate building effects for a franchise. */
  function effects(s) {
    const by = {};
    TYPES.forEach((t) => (by[t] = []));
    let levels = 0;
    for (const k in s.grid) {
      const b = s.grid[k];
      const mini = (s.mini && s.mini[b.type] && s.mini[b.type].boost) || 0; // this week's mini-game medal
      by[b.type].push(BUILDINGS[b.type].v[b.level - 1] * synergy(s, k, b.type) * (1 + mini));
      levels += b.level;
    }
    const lv = (t) => Object.values(s.grid).filter((b) => b.type === t).reduce((a, b) => a + b.level, 0);
    return {
      capacity: STADIUM.cap[s.stadium - 1],
      access: BASE_ACCESS + by.transit.reduce((a, b) => a + b, 0),
      perCap: dim(by.concessions),
      merch: dim(by.retail),
      suites: dim(by.suites),
      media: dim(by.media),
      party: dim(by.fanzone),
      hypeBoost: 1 + Math.min(0.5, 0.1 * lv('fanzone')),
      bustCut: Math.min(0.9, by.medical.reduce((a, b) => a + b, 0)),
      lossCut: Math.min(0.4, 0.1 * lv('medical')),
      bench: dim(by.scouting),
      growth: 1 + 0.08 * lv('scouting'),
      upkeep: Math.round(s.invested * UPKEEP_RATE) + PAYROLL,
      levels,
    };
  }

  const turnoutRate = (s) => (0.25 + 0.6 * (s.hype / 100)) * PRICES[s.price].turnout;
  function forecast(s) {
    const e = effects(s);
    const demand = Math.round(s.fans * turnoutRate(s));
    return { demand, capacity: e.capacity, access: e.access, attendance: Math.min(demand, e.capacity, e.access), e };
  }

  function value(s) {
    return Math.round(s.cash + s.invested * 0.7 + s.fans * 25 + s.hype * 10e3);
  }

  // ---- Actions -------------------------------------------------------------------
  function canAfford(s, cost) { return s.cash >= cost; }
  function build(s, k, type) {
    if (isStadium(k) || s.grid[k] || !BUILDINGS[type]) return false;
    const cost = BUILDINGS[type].cost[0];
    if (!canAfford(s, cost)) return false;
    s.cash -= cost; s.invested += cost;
    s.grid[k] = { type, level: 1 };
    return true;
  }
  function upgrade(s, k) {
    const b = s.grid[k];
    if (!b || b.level >= 3) return false;
    const cost = BUILDINGS[b.type].cost[b.level];
    if (!canAfford(s, cost)) return false;
    s.cash -= cost; s.invested += cost; b.level++;
    return true;
  }
  function spentOn(b) { return BUILDINGS[b.type].cost.slice(0, b.level).reduce((a, c) => a + c, 0); }
  function refund(b) { return Math.round(spentOn(b) * 0.4); }
  function demolish(s, k) {
    const b = s.grid[k];
    if (!b) return false;
    s.cash += refund(b); s.invested -= spentOn(b);
    delete s.grid[k];
    return true;
  }
  function upgradeStadium(s) {
    if (s.stadium >= 5) return false;
    const cost = STADIUM.cost[s.stadium];
    if (!canAfford(s, cost)) return false;
    s.cash -= cost; s.invested += cost; s.stadium++;
    return true;
  }

  // ---- Travelling fans ------------------------------------------------------------------
  /** How many of the away owner's fans follow the team to the host's stadium. Hype is the main driver; a Transit
      Hub and a win streak add to it. The host stadium only offers a fifth of its seats to visitors. */
  function travelers(away, host) {
    const transit = Object.values(away.grid).filter((b) => b.type === 'transit').reduce((a, b) => a + b.level, 0);
    const rate = 0.01 + 0.05 * (away.hype / 100) + 0.005 * Math.min(4, transit) + (away.streak >= 3 ? 0.01 : 0);
    return Math.round(Math.min(away.fans * rate, STADIUM.cap[host.stadium - 1] * 0.2));
  }
  /** Tag each team's result with its travelling support. Call before any franchise is settled, so both sides of a
      matchup are measured from the same pre-game state. results: {rid: weekResult}, franchises: {rid: franchise}. */
  function attachTravel(results, franchises) {
    for (const rid in results) {
      const r = results[rid], me = franchises[rid], opp = r && franchises[r.oppId];
      if (!r || r.bye || !me || !opp) continue;
      r.travel = r.home ? { in: travelers(opp, me), from: r.oppId } : { out: travelers(me, opp) };
    }
  }

  // ---- Weekly settlement -------------------------------------------------------------
  // ---- Mini-games -----------------------------------------------------------------------
  // One arcade game per building. A medal boosts that building's output for the coming game day only.
  // tiers = score needed for bronze, silver, gold (for `lower` games, the time to beat).
  const MINI = {
    concessions: { game: 'pour', name: 'Perfect Pour', unit: 'points', tiers: [8, 14, 20], how: 'Hold to pour and let go on the green line. A dead-on pour counts double, a spill counts nothing. 25 seconds.' },
    transit: { game: 'shuttle', name: 'Shuttle Run', unit: 'fans', tiers: [10, 16, 22], how: 'Tap the left or right side (or use the arrow keys) to change lanes. Pick up fans and stay off the cones. 25 seconds.' },
    retail: { game: 'order', name: 'Rush Order', unit: 'orders', tiers: [12, 17, 22], how: 'Tap the jersey that matches the order. A wrong jersey costs you time. 25 seconds.' },
    suites: { game: 'stack', name: 'Sky Suite Stacker', unit: 'floors', tiers: [6, 10, 15], how: 'Tap to drop each floor. Anything hanging over the edge is cut off, and a miss ends the build.' },
    media: { game: 'signal', name: 'Signal Lock', unit: '% locked', tiers: [40, 58, 74], how: 'Hold to raise the needle, let go to drop it. Keep it inside the moving band for 20 seconds.' },
    fanzone: { game: 'kick', name: 'Field Goal Frenzy', unit: 'of 5', tiers: [2, 3, 5], how: 'Tap once to set your aim, again to set power. The green zone already allows for the wind. Five kicks, each one narrower.' },
    medical: { game: 'dash', name: 'Combine Dash', unit: 'seconds', lower: true, tiers: [10, 7.5, 6], how: 'Alternate left and right taps (or arrow keys) to run 40 yards. Hitting the same side twice makes you stumble.' },
    scouting: { game: 'scout', name: "Scout's Eye", unit: 'of 10', tiers: [5, 7, 9], how: 'Three prospects with three ratings each. Tap the one with the best total before the clock runs out. Ten rounds, each faster.' },
  };
  const MINI_TRIES = 3;
  const MINI_BOOST = [0, 0.04, 0.07, 0.1];
  const MEDALS = ['No medal', 'Bronze', 'Silver', 'Gold'];
  /** 0 = no medal, 1 = bronze, 2 = silver, 3 = gold. */
  function miniMedal(type, score) {
    const m = MINI[type];
    if (!m || typeof score !== 'number' || !isFinite(score)) return 0;
    return m.tiers.filter((t) => (m.lower ? score <= t : score >= t)).length;
  }
  /** Record one counted try. Returns what happened; never throws on a practice run.
      Needs the building to exist, and stops counting after MINI_TRIES tries a week. */
  function recordMini(s, type, score) {
    const medal = miniMedal(type, score);
    const owns = Object.values(s.grid).some((b) => b.type === type);
    s.mini = s.mini || {};
    const m = s.mini[type] || { tries: 0, medal: 0, boost: 0 };
    if (!MINI[type] || !owns || m.tries >= MINI_TRIES) return { medal, counted: false, best: m.medal, boost: m.boost, triesLeft: Math.max(0, MINI_TRIES - m.tries) };
    m.tries++;
    if (medal > m.medal) { m.medal = medal; m.boost = MINI_BOOST[medal]; }
    s.mini[type] = m;
    return { medal, counted: true, best: m.medal, boost: m.boost, triesLeft: MINI_TRIES - m.tries };
  }

  const BADGES = [
    { id: 'sellout', name: 'First Sellout', reward: 100e3, test: (s, rep) => rep.sellout },
    { id: 'streak3', name: 'Three Straight Wins', reward: 150e3, test: (s) => s.streak >= 3 },
    { id: 'fans50', name: '50,000 Fans', reward: 200e3, test: (s) => s.fans >= 50e3 },
    { id: 'fans150', name: '150,000 Fans', reward: 600e3, test: (s) => s.fans >= 150e3 },
    { id: 'district', name: 'Ten Lots Developed', reward: 300e3, test: (s) => Object.keys(s.grid).length >= 10 },
    { id: 'million', name: 'Million-Dollar Week', reward: 250e3, test: (s, rep) => rep.net >= 1e6 },
    { id: 'playoffW', name: 'Playoff Win', reward: 500e3, test: (s, rep) => rep.r.playoff && rep.r.win },
    { id: 'fever', name: 'Fever Pitch (95 hype)', reward: 200e3, test: (s) => s.hype >= 95 },
  ];

  /** Apply one fantasy week to a franchise. Mutates `s`, returns the report. */
  function settle(s, r) {
    const e = effects(s);
    const lines = [];
    const add = (label, amount, note) => { if (Math.round(amount)) lines.push({ label, amount: Math.round(amount), note }); };
    const promo = s.promo || 'none';
    const beatMedian = r.pts > r.median;
    const scoreMult = r.median ? clamp(r.pts / r.median, 0.7, 1.5) : 1;
    const shootoutPromo = promo === 'shootout' && beatMedian ? 1.5 : 1;
    const tnet = r.trade ? r.trade.net : 0;
    const rep = { r, lines, home: r.home, attendance: 0, capacity: e.capacity, sellout: false, limiter: null, promo, badges: [] };

    if (r.home) {
      let demand = s.fans * turnoutRate(s);
      if (promo === 'giveaway') demand *= 1.15;
      demand *= 1 + clamp(tnet * 0.012, -0.12, 0.12); // a blockbuster arrival sells seats; a fire sale empties them
      if (r.playoff) demand *= 1.25;
      const own = Math.round(Math.min(demand, e.capacity, e.access));
      // visiting fans only get the seats the home crowd left empty, so a full house keeps them out
      const visitors = r.travel && r.travel.in ? Math.max(0, Math.min(r.travel.in, Math.round(Math.min(e.capacity, e.access)) - own)) : 0;
      const att = own + visitors;
      rep.visitors = visitors;
      rep.visitorShare = att ? visitors / att : 0;
      rep.attendance = att;
      rep.demand = Math.round(demand);
      rep.sellout = att >= e.capacity;
      rep.limiter = demand > att ? (e.access < e.capacity ? 'access' : 'capacity') : 'demand';
      add('Tickets', att * PRICES[s.price].price * (r.playoff ? 1.5 : 1),
        att.toLocaleString() + ' fans at ' + PRICES[s.price].name.toLowerCase() + ' prices' + (visitors ? ', including ' + visitors.toLocaleString() + ' visiting fans' : '') + (r.playoff ? ', playoff premium' : ''));
      add('Concessions', att * e.perCap * scoreMult * shootoutPromo * (r.night ? 1.1 : 1),
        'You scored ' + r.pts.toFixed(1) + ' vs a league median of ' + r.median.toFixed(1) + ' (x' + scoreMult.toFixed(2) + ')' + (r.night ? '. Night crowd +10%' : ''));
      const standing = 1.5 - (r.n > 1 ? ((r.rank - 1) / (r.n - 1)) * 0.9 : 0);
      add('VIP Suites', e.suites * standing * (r.playoff ? 2 : 1),
        'Ranked ' + r.rank + ' of ' + r.n + ' in the league (x' + standing.toFixed(2) + ')' + (r.playoff ? ', doubled for the playoffs' : ''));
    } else if (!r.bye) {
      add('Watch Parties', s.fans * 0.2 * e.party * shootoutPromo, 'A fifth of the fanbase gathered at the Fan Plaza');
      if (r.travel && r.travel.out) add('Road Merchandise', r.travel.out * 6, r.travel.out.toLocaleString() + ' of your fans travelled to the game');
    }
    const merchMult = (1 + 0.3 * r.stars) * (r.win ? 1.15 : 1) * (promo === 'guarantee' && r.win ? 1.2 : 1) * (1 + clamp(tnet * 0.04, 0, 0.5));
    add('Merchandise', s.fans * e.merch * merchMult * (r.bye ? 0.5 : 1),
      r.stars + (r.stars === 1 ? ' starter' : ' starters') + ' scored ' + STAR_PTS + '+' + (r.win ? ', plus a win bump' : '') + (tnet >= 1 ? ', plus a new-jersey rush from the trade' : ''));
    if (!r.bye) {
      const close = r.margin < 10, shoot = r.pts + r.oppPts > 2.3 * r.median;
      const exc = 1 + (close ? 0.4 : 0) + (shoot ? 0.3 : 0) + (r.playoff ? 0.5 : 0) + (r.night ? 0.25 : 0);
      add('Broadcast Rights', e.media * exc,
        (close ? 'Decided by ' + r.margin.toFixed(1) + '. ' : '') + (shoot ? 'A shootout. ' : '') + (r.playoff ? 'Playoff audience. ' : '') + (r.night ? 'Prime-time slot +25%. ' : '') + (!close && !shoot && !r.playoff && !r.night ? 'A routine afternoon broadcast.' : ''));
    }
    add('League Revenue Share', SHARE, 'Every franchise gets an equal cut of the national deal');
    add('Front Office', r.benchPts * e.bench, 'Your bench scored ' + r.benchPts.toFixed(1));
    add('Payroll & Upkeep', -e.upkeep, 'Staff plus 2.5% of everything you have built');
    if (PROMOS[promo].cost) add(PROMOS[promo].name, -PROMOS[promo].cost, 'Promotion cost');

    // Hype: the fantasy result is the story of the week.
    const hl = [];
    const h = (label, d) => { if (Math.abs(d) >= 0.05) hl.push({ label, d }); };
    if (!r.bye) {
      if (r.win) h('Win', 7); else if (!r.tie) h('Loss', -7 * (1 - e.lossCut));
      if (r.median) h(beatMedian ? 'Outscored the league median' : 'Below the league median', clamp(((r.pts - r.median) / r.median) * 20, -6, 8));
      const streak = r.win ? Math.max(1, s.streak + 1) : r.tie ? 0 : Math.min(-1, s.streak - 1);
      if (streak >= 3) h(streak + '-game win streak', 3);
      if (r.stars) h(r.stars + ' star performance' + (r.stars > 1 ? 's' : ''), 1.5 * r.stars);
      if (r.busts) h(r.busts + ' starter' + (r.busts > 1 ? 's' : '') + ' busted', -2 * r.busts * (1 - e.bustCut));
      if (r.playoff && r.win) h('Playoff win', 6);
      if (promo === 'guarantee') h(r.win ? 'Guarantee delivered' : 'Guarantee broken', r.win ? 8 : -8);
      if (r.home && PRICES[s.price].hype) h(PRICES[s.price].name + ' ticket prices', PRICES[s.price].hype);
      s.streak = streak;
      if (r.win) s.wins++; else if (!r.tie) s.losses++;
    }
    if (r.travel && r.travel.out >= 500) h(r.travel.out.toLocaleString() + ' fans made the road trip', clamp(r.travel.out / 2000, 0.3, 3));
    if (r.trade && Math.abs(tnet) >= 1) {
      const who = tnet > 0 ? r.trade.in[0] : r.trade.out[0];
      h(tnet > 0 ? 'Trade: fans welcome ' + ((who && who.n) || 'a new star') : 'Trade: fans miss ' + ((who && who.n) || 'a departed star'), clamp(tnet * 0.7, -9, 9));
    }
    let dh = hl.reduce((a, x) => a + (x.d > 0 ? x.d * e.hypeBoost : x.d), 0);
    const hype0 = s.hype, fans0 = s.fans;
    s.hype = clamp(s.hype + dh, 0, 100);
    s.hype += (50 - s.hype) * 0.1; // excitement cools, despair fades
    s.hype = Math.round(s.hype * 10) / 10;
    const growth = ((s.hype - 40) / 100) * 0.18;
    s.fans = Math.max(5e3, Math.round(s.fans * (1 + (growth > 0 ? growth * e.growth : growth)) + (r.win ? 400 : 0)));

    rep.hypeLines = hl;
    rep.hype = [hype0, s.hype];
    rep.fans = [fans0, s.fans];
    rep.net = lines.reduce((a, l) => a + l.amount, 0);
    rep.gross = lines.reduce((a, l) => a + Math.max(0, l.amount), 0);
    s.cash += rep.net;
    if (rep.sellout) s.sellouts++;
    s.promo = 'none';
    rep.mini = s.mini || {};
    s.mini = {}; // medals last one game day
    if (s.badges) {
      BADGES.forEach((b) => {
        if (!s.badges[b.id] && b.test(s, rep)) { s.badges[b.id] = r.season + ':' + r.week; s.cash += b.reward; rep.badges.push(b); }
      });
    }
    rep.cash = s.cash;
    return rep;
  }

  // ---- Rival owners -------------------------------------------------------------------
  // A fixed build order, rotated per team so the league does not develop identically.
  const AI_PLAN = [
    ['concessions', '0-1'], ['retail', '4-2'], ['transit', '4-1'], ['media', '1-0'], ['stadium'],
    ['fanzone', '4-3'], ['suites', '3-1'], ['up', '0-1'], ['scouting', '0-4'], ['concessions', '1-3'],
    ['up', '4-2'], ['stadium'], ['transit', '4-0'], ['up', '1-0'], ['medical', '0-0'], ['up', '3-1'],
    ['up', '4-1'], ['suites', '2-3'], ['stadium'], ['up', '0-1'], ['up', '4-2'], ['up', '1-3'], ['up', '4-3'],
    ['media', '0-2'], ['up', '1-0'], ['up', '3-1'], ['stadium'], ['up', '2-3'], ['up', '0-2'], ['up', '4-0'],
  ];
  function aiTurn(s) {
    s.step = s.step || 0;
    for (let guard = 0; guard < 3 && s.step < AI_PLAN.length; guard++) {
      const [what, k] = AI_PLAN[s.step];
      const reserve = 120e3;
      let cost;
      if (what === 'stadium') cost = STADIUM.cost[s.stadium] || Infinity;
      else if (what === 'up') cost = s.grid[k] && s.grid[k].level < 3 ? BUILDINGS[s.grid[k].type].cost[s.grid[k].level] : 0;
      else cost = s.grid[k] ? 0 : BUILDINGS[what].cost[0];
      if (cost === 0 || cost === Infinity) { s.step++; continue; }
      if (s.cash - reserve < cost) break;
      if (what === 'stadium') upgradeStadium(s); else if (what === 'up') upgrade(s, k); else build(s, k, what);
      s.step++;
    }
    // Rivals price by demand: premium when they would sell out anyway.
    const f = forecast(s);
    s.price = f.demand > Math.min(f.capacity, f.access) * 1.3 ? 2 : f.demand < Math.min(f.capacity, f.access) * 0.7 ? 0 : 1;
  }

  // ---- Turn flow ---------------------------------------------------------------------
  const playedKey = (league, w) => league.season + ':' + w;
  /** What is the next game day and can it be played yet? */
  function nextWeek(s, league) {
    const last = league.lastWeek || 17;
    let backlog = 0, first = null;
    for (let w = 1; w <= last; w++) {
      if (s.played[playedKey(league, w)]) continue;
      const wk = league.weeks[w];
      if (wk && wk.complete) { backlog++; if (first == null) first = w; }
      else if (first == null) {
        return { week: w, status: wk && wk.live ? 'live' : 'waiting', backlog: 0, wk: wk || null };
      } else break;
    }
    if (first == null) return { week: null, status: 'done', backlog: 0 };
    return { week: first, status: 'ready', backlog, result: weekResult(league, first, s.rid) };
  }
  function playWeek(s, league) {
    const nx = nextWeek(s, league);
    if (nx.status !== 'ready' || !nx.result) return null;
    // travelling support is measured before anyone settles
    const results = { [s.rid]: nx.result }, all = { [s.rid]: s };
    for (const id in s.rivals) { results[id] = weekResult(league, nx.week, +id); all[id] = s.rivals[id]; }
    attachTravel(results, all);
    const rep = settle(s, nx.result);
    s.played[playedKey(league, nx.week)] = 1;
    s.history.push(rep);
    for (const id in s.rivals) {
      const rr = results[id];
      if (rr) { settle(s.rivals[id], rr); aiTurn(s.rivals[id]); }
    }
    return rep;
  }
  /** League table of franchise values, the player's included. */
  function leaderboard(s, league) {
    const through = Math.max(0, ...Object.keys(s.played).filter((k) => k.indexOf(league.season + ':') === 0).map((k) => +k.split(':')[1]));
    const st = standings(league, through);
    const rows = [{ rid: s.rid, me: true, f: s }].concat(Object.keys(s.rivals).map((id) => ({ rid: +id, me: false, f: s.rivals[id] })));
    return rows
      .filter((x) => league.teams.some((t) => t.rosterId === x.rid))
      .map((x) => ({
        rid: x.rid, me: x.me, name: x.me ? s.name : teamName(league, x.rid), value: value(x.f), fans: x.f.fans,
        stadium: x.f.stadium, lots: Object.keys(x.f.grid).length,
        record: st[x.rid] ? st[x.rid].w + '-' + st[x.rid].l + (st[x.rid].t ? '-' + st[x.rid].t : '') : '0-0',
      }))
      .sort((a, b) => b.value - a.value);
  }

  Object.assign(FT, {
    GRID, STADIUM_TILES, BUILDINGS, TYPES, STADIUM, PRICES, PROMOS, BADGES, STAR_PTS, BUST_PTS,
    key, isStadium, median, standings, teamName, weekResult, newGame, newFranchise, neighbors, nearStadium, onEdge,
    synergy, effects, forecast, value, build, upgrade, demolish, refund, upgradeStadium, settle, aiTurn,
    nextWeek, playWeek, leaderboard, clamp, slot, matchup, bonusTable, opponentOf, tradeImpact, playerAvg, travelers, attachTravel, MINI, MINI_TRIES, MINI_BOOST, MEDALS, miniMedal, recordMini,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = FT;
})(typeof window !== 'undefined' ? window : globalThis);
