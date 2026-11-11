/* Franchise Tycoon — league server. One shared, authoritative game per fantasy league.
   No dependencies. Run: node server.js   (PORT, DATA_FILE, CREATE_KEY and DEMO=1 are optional environment variables)

   - Serves the game page (dist/franchise-tycoon.html) and a small JSON API under /api.
   - Reads fantasy results from Sleeper itself, so nobody can edit them.
   - Every owner has a private link (a token). Builds, prices and promotions are accepted only while the week is open.
   - When Sleeper finalizes a week, every franchise is settled with the same engine the solo game uses, alongside an
     auto-pilot twin per team, and the bonus table for the following week is posted. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const FT = require('./src/engine.js');
require('./src/league.js');

const COLORS = ['#e4572e', '#f2b33d', '#3aa88f', '#4f8fd9', '#b06ab3', '#d9436b', '#5aa845', '#d8d2c2'];
const SYNC_MS = 4 * 60 * 1000;
const PAYOUTS = ['all', 'half', 'top3'];
/** League settings the commissioner can change. Defaults come from Sleeper where Sleeper knows the answer. */
function defaultSettings(data) {
  return { mode: 'bonus', simMetric: 'net', prize: '', cap: 5, travelCut: 0.5, payout: 'all', playoffStart: data.playoffStart || 15, lastWeek: data.lastWeek || 17, playoffBonus: false, miniBoost: true, lockDay: 4, lockHour: 20 };
}
function cleanSettings(base, inp) {
  const s = Object.assign({}, base), int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  if (typeof inp.cap === 'number' && inp.cap >= 0 && inp.cap <= 25) s.cap = Math.round(inp.cap * 2) / 2;
  if (typeof inp.travelCut === 'number' && inp.travelCut >= 0 && inp.travelCut <= 0.75) s.travelCut = Math.round(inp.travelCut * 20) / 20;
  if (inp.mode === 'bonus' || inp.mode === 'sim') s.mode = inp.mode;
  if (inp.simMetric === 'net' || inp.simMetric === 'value') s.simMetric = inp.simMetric;
  if (typeof inp.prize === 'string') s.prize = inp.prize.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 140);
  if (PAYOUTS.indexOf(inp.payout) >= 0) s.payout = inp.payout;
  if (int(inp.lastWeek, 1, 18)) s.lastWeek = inp.lastWeek;
  if (int(inp.playoffStart, 2, 19)) s.playoffStart = inp.playoffStart;
  if (typeof inp.playoffBonus === 'boolean') s.playoffBonus = inp.playoffBonus;
  if (typeof inp.miniBoost === 'boolean') s.miniBoost = inp.miniBoost;
  if (int(inp.lockDay, 0, 6)) s.lockDay = inp.lockDay;
  if (int(inp.lockHour, 0, 23)) s.lockHour = inp.lockHour;
  return s;
}

/** UTC instant of a wall-clock hour in New York on a given date (handles daylight saving). */
function easternToUtc(y, m, d, hour) {
  const guess = Date.UTC(y, m - 1, d, hour + 5);
  const shown = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(guess));
  return guess + (hour - shown) * 3600e3;
}
/** When decisions for `week` lock. Null when the season start is unknown (demo leagues lock by hand). */
function lockAt(leagueData, week, settings) {
  if (!leagueData.seasonStart) return null;
  const lockDay = settings ? settings.lockDay : 4, lockHour = settings ? settings.lockHour : 20;
  const [y, m, d] = leagueData.seasonStart.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  // the NFL week runs Tuesday to Monday, and the season start date is the day before the first Thursday game
  const offset = (lockDay - start.getUTCDay() + 7) % 7;
  const day = new Date(start.getTime() + (offset + 7 * (week - 1)) * 86400e3);
  return easternToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), lockHour);
}

function createApp(opts) {
  opts = opts || {};
  const now = opts.now || (() => Date.now());
  const dataFile = opts.dataFile || null;
  const demoAllowed = !!opts.demo;
  const provider = opts.provider || {
    load: (leagueId, userId) => FT.Sleeper.loadLeague(leagueId, userId),
    names: (league) => FT.Sleeper.loadNames(league),
  };
  let db = { leagues: {} };
  if (dataFile && fs.existsSync(dataFile)) db = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const save = () => {
    if (!dataFile) return;
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile + '.tmp', JSON.stringify(db));
    fs.renameSync(dataFile + '.tmp', dataFile);
  };
  const token = () => crypto.randomBytes(18).toString('base64url');
  const fail = (status, message) => Object.assign(new Error(message), { status });

  /** The commissioner's playoff and season-length choices override what Sleeper reported. */
  function applySettings(lg) { lg.data.playoffStart = lg.settings.playoffStart; lg.data.lastWeek = lg.settings.lastWeek; }

  function newLeague(data, adminRid, cap) {
    const start = Object.keys(data.weeks).map(Number).sort((a, b) => a - b).find((w) => !data.weeks[w].complete);
    if (start == null) throw fail(400, 'This league has no unfinished week to start from. League mode begins with the next week that has not been played.');
    const lg = { id: token().slice(0, 10), data, settings: cleanSettings(defaultSettings(data), { cap }), week: start, startWeek: start, createdAt: now(), syncedAt: now(), tokens: {}, teams: {}, bonus: {}, demoLocked: false };
    data.teams.forEach((t, i) => {
      const f = FT.newFranchise(t.rosterId);
      f.badges = {}; f.history = []; f.color = COLORS[i % COLORS.length];
      lg.teams[t.rosterId] = { f, twin: FT.newFranchise(t.rosterId) };
      lg.tokens[token()] = { rid: t.rosterId, admin: t.rosterId === adminRid };
    });
    applySettings(lg);
    db.leagues[lg.id] = lg;
    return lg;
  }

  function phase(lg) {
    if (lg.week > lg.data.lastWeek || !lg.data.weeks[lg.week]) return lg.week > lg.data.lastWeek ? 'done' : 'open';
    const at = lockAt(lg.data, lg.week, lg.settings);
    return (at == null ? lg.demoLocked : now() >= at) ? 'locked' : 'open';
  }

  /** Settle every week Sleeper has finalized since the last look. */
  function settleReady(lg) {
    let changed = false;
    while (lg.week <= lg.data.lastWeek && lg.data.weeks[lg.week] && lg.data.weeks[lg.week].complete) {
      const rows = [], results = {}, pre = {}, cut = {};
      for (const id in lg.teams) { results[id] = FT.weekResult(lg.data, lg.week, +id); pre[id] = lg.teams[id].f; }
      FT.attachTravel(results, pre, (rid) => FT.teamName(lg.data, rid));
      const wagers = (lg.wagers || {})[lg.week] || [], name = (rid) => FT.teamName(lg.data, rid), news = (lg.news = lg.news || []);
      wagers.forEach((w) => {
        if (w.status === 'offered') w.status = 'expired';
        if (w.status !== 'accepted') return;
        if (!FT.attachWager(results, w)) { w.status = 'void'; return; }
        const won = results[w.from].wager.won;
        w.status = 'settled'; w.winner = won === null ? null : won ? w.from : w.to;
        news.push({ week: lg.week, kind: 'wager', weight: 5, head: w.winner == null ? 'Wager push: ' + name(w.from) + ' and ' + name(w.to) + ' tie' : 'Pay up: ' + name(w.winner) + ' collect ' + '$' + w.amount / 1e3 + 'k', text: w.winner == null ? name(w.from) + ' and ' + name(w.to) + ' tied, so their $' + w.amount / 1e3 + 'k wager is a push.' : name(w.winner) + ' won a $' + w.amount / 1e3 + 'k wager from ' + name(w.winner === w.from ? w.to : w.from) + '.' });
      });
      FT.tradeNews(lg.data, lg.week).forEach((n) => news.push(n));
      const reps = {};
      for (const id in lg.teams) {
        const r = results[id];
        if (!r) continue;
        const t = lg.teams[id];
        const rep = FT.settle(t.f, r);
        // visiting fans in the building cut the bonus the home owner brings into this matchup
        if (rep.visitors) cut[id] = { pct: Math.min(lg.settings.travelCut, Math.round(rep.visitorShare * 200) / 100), visitors: rep.visitors, from: r.oppId };
        t.f.history.push(rep); reps[id] = rep;
        const twinRep = FT.settle(t.twin, r);
        FT.aiTurn(t.twin);
        rows.push({ rid: +id, net: rep.net, twinNet: twinRep.net, twinGross: twinRep.gross });
      }
      // bonuses from this week are added to next week's fantasy score, so the playoff rule looks one week ahead
      const paid = lg.settings.mode !== 'sim' && (lg.settings.playoffBonus || lg.week + 1 < lg.settings.playoffStart);
      lg.bonus[lg.week] = { cap: paid ? lg.settings.cap : 0, payout: lg.settings.payout, paid, rows: FT.bonusTable(rows, paid ? lg.settings.cap : 0, lg.settings.payout) };
      FT.weekStories(lg.data, lg.week, reps, name).forEach((n) => news.push(n));
      lg.cut = lg.cut || {}; lg.cut[lg.week] = cut;
      lg.week++; lg.demoLocked = false; changed = true;
    }
    return changed;
  }

  const syncing = {};
  async function sync(lg, force) {
    if (lg.data.source !== 'sleeper') { if (settleReady(lg)) save(); return; }
    if (!force && now() - lg.syncedAt < SYNC_MS) return;
    if (!syncing[lg.id]) {
      syncing[lg.id] = (async () => {
        try {
          const fresh = await provider.load(lg.data.leagueId, null);
          fresh.myRosterId = null; fresh.players = lg.data.players || {};
          lg.data = fresh; lg.syncedAt = now(); applySettings(lg);
          settleReady(lg); save();
          provider.names(lg.data).then((c) => c && save()).catch(() => {});
        } finally { delete syncing[lg.id]; }
      })();
    }
    await syncing[lg.id];
  }

  function find(tok) {
    for (const id in db.leagues) { const who = db.leagues[id].tokens[tok]; if (who) return { lg: db.leagues[id], who }; }
    throw fail(401, 'This league link is not valid. Ask your commissioner for a new one.');
  }

  /** The commissioner's score sheet: for every week that carries bonuses, each team's raw Sleeper score, the bonus
      it brings (after any visiting-fan cut, or the commissioner's own edit) and the resulting score. */
  function sheets(lg) {
    const out = {};
    for (const w in lg.bonus) {
      const W = +w + 1, wk = lg.data.weeks[W], tb = lg.bonus[w];
      if (!wk || !tb.paid) continue;
      const cuts = (lg.cut || {})[W], ov = (lg.override || {})[W] || {}, by = {};
      tb.rows.forEach((r) => {
        const c = cuts && cuts[r.rid], calc = c ? Math.round(r.bonus * (1 - c.pct) * 10) / 10 : r.bonus;
        by[r.rid] = { earned: r.bonus, cut: c ? c.pct : 0, calc, bonus: ov[r.rid] != null ? ov[r.rid] : calc, edited: ov[r.rid] != null };
      });
      out[W] = {
        final: !!wk.complete && !!cuts,
        rows: Object.keys(wk.teams).map((id) => {
          const b = by[id] || { earned: 0, cut: 0, calc: 0, bonus: 0, edited: false }, raw = wk.teams[id].pts;
          return Object.assign({ rid: +id, opp: FT.opponentOf(wk, +id), raw, adj: Math.round((raw + b.bonus) * 100) / 100 }, b);
        }),
      };
    }
    return out;
  }

  function view(lg, who, origin) {
    const through = lg.week - 1;
    const st = FT.standings(lg.data, through);
    const me = lg.teams[who.rid];
    const S = Object.assign({}, me.f, { name: FT.teamName(lg.data, who.rid), v: 1 });
    const board = Object.keys(lg.teams).map((id) => {
      const f = lg.teams[id].f, s = st[id] || { w: 0, l: 0, t: 0 };
      return { rid: +id, me: +id === who.rid, name: FT.teamName(lg.data, +id), value: FT.value(f), fans: f.fans, stadium: f.stadium, lots: Object.keys(f.grid).length, rail: FT.railReady(f), links: f.links || [], gross: f.history.reduce((a, r) => a + r.gross, 0), net: f.history.reduce((a, r) => a + r.net, 0), district: { grid: f.grid, stadium: f.stadium, color: f.color, color2: f.color2, setting: f.setting, fill: Math.min(1, FT.forecast(f).attendance / FT.forecast(f).capacity) }, record: s.w + '-' + s.l + (s.t ? '-' + s.t : '') };
    }).sort((a, b) => b.value - a.value);
    const v = {
      leagueMode: true, league: Object.assign({}, lg.data, { myRosterId: who.rid }), S, admin: !!who.admin, cap: lg.settings.cap, settings: lg.settings,
      week: lg.week, startWeek: lg.startWeek, phase: phase(lg), lockAt: lockAt(lg.data, lg.week, lg.settings), now: now(), board, sheet: sheets(lg), bonus: lg.bonus, cut: lg.cut || {},
      syncedAt: lg.syncedAt, demo: lg.data.source !== 'sleeper',
    };
    const mu = FT.matchup(lg.data, lg.week, who.rid);
    if (mu && !mu.bye && lg.teams[mu.oppId]) v.travel = mu.home ? { in: FT.travelers(lg.teams[mu.oppId].f, me.f) } : { out: FT.travelers(me.f, lg.teams[mu.oppId].f) };
    v.news = (lg.news || []).slice(-400);
    v.wagers = ((lg.wagers || {})[lg.week] || []).filter((w) => w.from === who.rid || w.to === who.rid);
    v.wagerOpen = v.phase === 'open' && FT.wagerOpen(lg.data, lg.week, who.rid);
    v.railOffers = (lg.railOffers || []).filter((o) => o.status === 'offered' && (o.from === who.rid || o.to === who.rid));
    if (who.admin) {
      v.invites = Object.keys(lg.tokens).map((t) => ({ rid: lg.tokens[t].rid, name: FT.teamName(lg.data, lg.tokens[t].rid), admin: !!lg.tokens[t].admin, token: t }));
    }
    return v;
  }

  function act(lg, who, b) {
    const f = lg.teams[who.rid].f, open = phase(lg) === 'open';
    const needOpen = () => { if (!open) throw fail(409, 'This week is locked. Changes open again once the week settles.'); };
    const must = (ok, msg) => { if (!ok) throw fail(400, msg); };
    switch (b.a) {
      case 'build': needOpen(); must(FT.build(f, String(b.k), String(b.type)), 'That cannot be built there, or you cannot afford it.'); break;
      case 'upgrade': needOpen(); must(FT.upgrade(f, String(b.k)), 'That cannot be upgraded right now.'); break;
      case 'demolish': needOpen(); must(FT.demolish(f, String(b.k)), 'There is nothing to demolish there.'); break;
      case 'stadium': needOpen(); must(FT.upgradeStadium(f), 'The stadium cannot be expanded right now.'); break;
      case 'price': needOpen(); must([0, 1, 2].indexOf(b.v) >= 0, 'Unknown ticket price.'); f.price = b.v; break;
      case 'promo': needOpen(); must(FT.PROMOS[b.v] && FT.PROMOS[b.v].cost <= f.cash, 'That promotion is not available.'); f.promo = b.v; break;
      case 'mini': { // the score is reported by the owner's browser, so the boost is small and the commissioner can turn it off
        needOpen(); must(FT.MINI[b.type] && typeof b.score === 'number' && isFinite(b.score), 'Unknown mini-game.');
        FT.recordMini(f, b.type, b.score);
        if (lg.settings.miniBoost === false && f.mini[b.type]) f.mini[b.type].boost = 0;
        break;
      }
      case 'wager': { // offer this week's real opponent a cash bet on the fantasy result
        needOpen();
        const amt = Math.round(+b.amount), m = FT.matchup(lg.data, lg.week, who.rid);
        must(FT.wagerOpen(lg.data, lg.week, who.rid), 'Wagers close once the first points are scored, and need an opponent.');
        must(amt >= FT.WAGER_MIN && amt <= FT.WAGER_MAX, 'A wager is between $' + FT.WAGER_MIN / 1e3 + 'k and $' + FT.WAGER_MAX / 1e3 + 'k.');
        must(f.cash >= amt, 'You do not have that much cash.');
        const list = ((lg.wagers = lg.wagers || {})[lg.week] = lg.wagers[lg.week] || []);
        must(!list.some((w) => (w.status === 'offered' || w.status === 'accepted') && [w.from, w.to].indexOf(who.rid) >= 0), 'You already have a wager on this matchup.');
        list.push({ from: who.rid, to: m.oppId, amount: amt, status: 'offered' });
        break;
      }
      case 'wagerReply': case 'wagerCancel': {
        needOpen();
        const w = ((lg.wagers || {})[lg.week] || []).find((x) => x.status === 'offered' && (b.a === 'wagerCancel' ? x.from : x.to) === who.rid);
        must(w, 'There is no open wager offer.');
        if (b.a === 'wagerCancel') { w.status = 'cancelled'; break; }
        if (!b.accept) { w.status = 'declined'; break; }
        must(FT.wagerOpen(lg.data, lg.week, who.rid), 'Wagers close once the first points are scored.');
        must(f.cash >= w.amount && lg.teams[w.from].f.cash >= w.amount, 'Both owners need $' + w.amount / 1e3 + 'k in cash to lock this in.');
        w.status = 'accepted';
        (lg.news = lg.news || []).push({ week: lg.week, kind: 'wager', weight: 4, head: 'Money on the line: ' + FT.teamName(lg.data, w.from) + ' and ' + FT.teamName(lg.data, w.to) + ' bet $' + w.amount / 1e3 + 'k', text: FT.teamName(lg.data, w.from) + ' and ' + FT.teamName(lg.data, w.to) + ' put $' + w.amount / 1e3 + 'k on their Week ' + lg.week + ' matchup.' });
        break;
      }
      case 'rail': { // propose a rail link to another owner
        const to = +b.to, other = lg.teams[to] && lg.teams[to].f;
        must(other && to !== who.rid, 'Pick another owner.');
        must(!FT.linked(f, other), 'Those cities are already linked.');
        const offers = (lg.railOffers = lg.railOffers || []);
        must(!offers.some((o) => o.status === 'offered' && ((o.from === who.rid && o.to === to) || (o.from === to && o.to === who.rid))), 'There is already an offer between you.');
        must(FT.railReady(f), 'You need a level ' + FT.RAIL_LEVEL + ' Transit Hub and a free rail slot.');
        offers.push({ from: who.rid, to, status: 'offered' });
        break;
      }
      case 'railReply': case 'railCancel': {
        const o = (lg.railOffers || []).find((x) => x.status === 'offered' && (b.a === 'railCancel' ? x.from === who.rid && x.to === +b.with : x.to === who.rid && x.from === +b.with));
        must(o, 'There is no open rail offer.');
        if (b.a === 'railCancel') { o.status = 'cancelled'; break; }
        if (!b.accept) { o.status = 'declined'; break; }
        const err = FT.buildRail(lg.teams[o.from].f, f);
        must(!err, err);
        o.status = 'built';
        (lg.news = lg.news || []).push({ week: lg.week, kind: 'rail', weight: 5, head: 'All aboard: rail line opens between ' + FT.teamName(lg.data, o.from) + ' and ' + FT.teamName(lg.data, o.to), text: 'A rail line now links ' + FT.teamName(lg.data, o.from) + ' and ' + FT.teamName(lg.data, o.to) + '.' });
        break;
      }
      case 'style': { // cosmetic only, so it is allowed even while the week is locked
        if (b.color != null) { must(/^#[0-9a-f]{6}$/i.test(b.color), 'Unknown colour.'); f.color = b.color; }
        if (b.color2 != null) { must(/^#[0-9a-f]{6}$/i.test(b.color2), 'Unknown colour.'); f.color2 = b.color2; }
        if (b.setting != null) { must(['metro', 'mountain', 'river', 'beach'].indexOf(b.setting) >= 0, 'Unknown city setting.'); f.setting = b.setting; }
        break;
      }
      case 'color': must(/^#[0-9a-f]{6}$/i.test(b.v), 'Unknown colour.'); f.color = b.v; break;
      case 'override': { // the commissioner's own number for one team's bonus in one week; null goes back to the calculated value
        must(who.admin, 'Only the commissioner can edit score adjustments.');
        const W = +b.week; must(Number.isInteger(W) && lg.bonus[W - 1], 'There is no bonus table for that week.');
        must(b.v && typeof b.v === 'object', 'Missing adjustments.');
        lg.override = lg.override || {}; const o = (lg.override[W] = lg.override[W] || {});
        for (const id in b.v) {
          must(lg.teams[id], 'Unknown team.');
          if (b.v[id] === null) delete o[id];
          else { must(typeof b.v[id] === 'number' && b.v[id] >= 0 && b.v[id] <= 50, 'An adjustment must be between 0 and 50 points.'); o[id] = Math.round(b.v[id] * 10) / 10; }
        }
        break;
      }
      case 'settings': must(who.admin, 'Only the commissioner can change league settings.'); must(b.v && typeof b.v === 'object', 'Missing settings.'); lg.settings = cleanSettings(lg.settings, b.v); applySettings(lg); break;
      case 'demoLock': must(who.admin && lg.data.source !== 'sleeper', 'Demo leagues only.'); lg.demoLocked = true; break;
      case 'demoFinish': must(who.admin && lg.data.source !== 'sleeper', 'Demo leagues only.'); FT.setDemoWeek(lg.data, lg.data.demoThrough + 1); settleReady(lg); break;
      default: throw fail(400, 'Unknown action.');
    }
    save();
  }

  async function api(method, url, body, origin) {
    const tok = url.searchParams.get('t') || '';
    const route = method + ' ' + url.pathname;
    if (route === 'GET /api/ping') return { ok: true, demo: demoAllowed, needsKey: !!opts.createKey };
    if (route === 'POST /api/leagues') {
      if (opts.createKey && body.key !== opts.createKey) throw fail(403, 'A server key is needed to create a league here.');
      const cap = typeof body.cap === 'number' ? body.cap : 5;
      let data, adminRid;
      if (body.demo) {
        if (!demoAllowed) throw fail(403, 'Demo leagues are turned off on this server.');
        data = FT.demoLeague(2026, 9); adminRid = 1;
      } else {
        if (!/^\d{6,24}$/.test(String(body.leagueId || ''))) throw fail(400, 'Missing Sleeper league.');
        if (Object.values(db.leagues).some((l) => l.data.leagueId === String(body.leagueId))) throw fail(409, 'This Sleeper league already has a league-mode season here. Open this site in the browser you created it from to get back in, or use your commissioner link. Lost it? The README explains how to recover it from the league data.');
        data = await provider.load(String(body.leagueId), String(body.userId || ''));
        adminRid = data.myRosterId != null ? data.myRosterId : data.teams[0].rosterId;
      }
      const lg = newLeague(data, adminRid, cap);
      save();
      if (!body.demo) provider.names(lg.data).then((c) => c && save()).catch(() => {});
      return { token: Object.keys(lg.tokens).find((t) => lg.tokens[t].admin) };
    }
    if (route === 'GET /api/state') { const { lg, who } = find(tok); await sync(lg, url.searchParams.get('sync') === '1' && who.admin).catch(() => {}); return view(lg, who, origin); }
    if (route === 'POST /api/act') { const { lg, who } = find(tok); await sync(lg, false).catch(() => {}); act(lg, who, body || {}); return view(lg, who, origin); }
    throw fail(404, 'Not found.');
  }

  function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const send = (status, obj) => { const s = JSON.stringify(obj); res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(s); };
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' || (url.pathname !== '/' && url.pathname !== '/index.html')) { res.writeHead(404); return res.end('Not found'); }
      const page = path.join(__dirname, 'dist', 'franchise-tycoon.html');
      if (!fs.existsSync(page)) { res.writeHead(500); return res.end('Run "node build.js" first.'); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      return fs.createReadStream(page).pipe(res);
    }
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 20000) req.destroy(); });
    req.on('end', () => {
      let body = {};
      try { if (raw) body = JSON.parse(raw); } catch (e) { return send(400, { error: 'Bad request.' }); }
      api(req.method, url, body, req.headers.host).then((out) => send(200, out), (e) => send(e.status || 500, { error: e.status ? e.message : 'The server hit an error. Try again in a minute.' }));
    });
  }
  return { handle, api, db: () => db, lockAt, phase };
}

if (require.main === module) {
  const port = +process.env.PORT || 8787;
  const app = createApp({ dataFile: process.env.DATA_FILE || path.join(__dirname, 'data', 'leagues.json'), demo: process.env.DEMO === '1', createKey: process.env.CREATE_KEY || '' });
  http.createServer(app.handle).listen(port, () => console.log('Franchise Tycoon league server on http://localhost:' + port));
}
module.exports = { createApp, lockAt, easternToUtc, defaultSettings, cleanSettings };
