// Deals between owners: transfer fees, matchup wagers and rail links, in the engine and on the league server.
const assert = require('assert');
const FT = require('../src/engine.js');
require('../src/league.js');
const { createApp } = require('../server.js');
const U = (p) => new URL('http://x' + p);
const rejects = async (p, status) => { try { await p; } catch (e) { assert.strictEqual(e.status, status, e.message); return; } assert.fail('expected ' + status); };

(async () => {
  // --- engine: a real trade moves sim cash from the side that gained star power to the side that lost it
  const L = FT.demoLeague(2026, 16), S = FT.newGame(L, {});
  const t6 = FT.tradeImpact(L, 6, 1); assert(t6.net > 0);
  for (let i = 0; i < 5; i++) FT.playWeek(S, L);
  const cashRival = S.rivals[3].cash, rep = FT.playWeek(S, L);
  const fee = rep.lines.find((l) => l.label === 'Transfer fee');
  assert(fee && fee.deal && Math.abs(fee.amount + Math.round(t6.net * FT.TRADE_FEE)) <= 1, 'the gainer pays');
  assert.strictEqual(rep.deals, fee.amount);
  assert(S.news.some((n) => n.kind === 'trade' && /transfer fee/.test(n.text)), 'trade headline');
  console.log('headline:', S.news.find((n) => n.kind === 'trade').text);

  // --- engine: rail links need level-2 transit on both sides, cost both, and pay tourism every week
  const R = FT.newGame(L, {}); R.cash = 5e6;
  assert(FT.buildRail(R, R.rivals[2]), 'no transit, no rail');
  FT.build(R, '4-1', 'transit'); FT.upgrade(R, '4-1');
  const rv = R.rivals[2]; rv.cash = 5e6; FT.build(rv, '4-1', 'transit'); FT.upgrade(rv, '4-1');
  assert.strictEqual(FT.proposeRailSolo(R, 2), null); assert(FT.linked(R, rv) && FT.linked(rv, R));
  assert(FT.proposeRailSolo(R, 2), 'no double link');
  const R2 = FT.newGame(L, {}); R2.cash = 5e6; FT.build(R2, '4-1', 'transit'); FT.upgrade(R2, '4-1');
  const poor = R2.rivals[4]; poor.cash = 3e6; FT.build(poor, '4-1', 'transit'); FT.upgrade(poor, '4-1'); poor.cash = 300e3;
  assert(poor.cash < FT.RAIL_COST + 100e3 && FT.railPriceSolo(R2, 4) === 2 * FT.RAIL_COST);
  const c0 = R2.cash, p0 = poor.cash;
  assert.strictEqual(FT.proposeRailSolo(R2, 4), null);
  assert.strictEqual(c0 - R2.cash, 2 * FT.RAIL_COST, 'you cover their half'); assert.strictEqual(poor.cash, p0, 'they pay nothing');
  const away = { fans: 40000, hype: 60, streak: 0, grid: {}, rid: 1 }, host = { stadium: 3, grid: {}, rid: 2 };
  const plain = FT.travelers(away, host); away.links = [2];
  assert(FT.travelers(away, host) > plain * 1.5, 'linked cities travel in bigger numbers');
  const rr = FT.playWeek(R, L), tour = rr.lines.find((l) => l.label === 'Rail tourism');
  assert(tour && tour.amount > 0 && tour.deal, 'weekly rail tourism');

  // --- engine: solo wagers only before kickoff, settle onto both sides
  const W = FT.newGame(FT.demoLeague(5, 9), {}); W.cash = 2e6;
  Object.values(W.rivals).forEach((x) => (x.cash = 2e6));
  const WL = FT.demoLeague(5, 9);
  assert(FT.offerWagerSolo(W, WL, 9, 50e3).error, 'a finished week cannot be bet on');
  const off = FT.offerWagerSolo(W, WL, 10, 50e3);
  assert(!off.error, off.error);
  assert(FT.offerWagerSolo(W, WL, 10, 50e3).error, 'one offer a week');
  for (let i = 0; i < 9; i++) FT.playWeek(W, WL);
  FT.setDemoWeek(WL, 10);
  const opp = W.rivals[off.opp], before = opp.cash;
  const wr = FT.playWeek(W, WL), line = wr.lines.find((l) => l.label === 'Matchup wager');
  if (off.accepted) { assert(line && Math.abs(line.amount) === 50e3, 'wager paid'); assert(W.wagers['2026:10'].status === 'settled'); }
  else assert(!line, 'a declined wager pays nothing');
  console.log('solo wager accepted:', off.accepted, 'line:', line && line.amount);

  // --- server: wagers and rail links between real owners; deal money never moves the bonus edge
  const app = createApp({ demo: true });
  const admin = (await app.api('POST', U('/api/leagues'), { demo: true })).token;
  let v = await app.api('GET', U('/api/state?t=' + admin), {});
  const tok = {}; v.invites.forEach((i) => (tok[i.rid] = i.token));
  const me = v.S.rid, m = FT.matchup(v.league, v.week, me), oppTok = tok[m.oppId];
  await rejects(app.api('POST', U('/api/act?t=' + admin), { a: 'wager', amount: 5e3 }), 400);
  await rejects(app.api('POST', U('/api/act?t=' + admin), { a: 'wager', amount: 9e9 }), 400);
  v = await app.api('POST', U('/api/act?t=' + admin), { a: 'wager', amount: 100e3 });
  assert.strictEqual(v.wagers[0].status, 'offered');
  await rejects(app.api('POST', U('/api/act?t=' + admin), { a: 'wager', amount: 100e3 }), 400);
  await rejects(app.api('POST', U('/api/act?t=' + admin), { a: 'wagerReply', accept: true }), 400);
  let o = await app.api('GET', U('/api/state?t=' + oppTok), {});
  assert.strictEqual(o.wagers[0].to, o.S.rid, 'the opponent sees the offer');
  o = await app.api('POST', U('/api/act?t=' + oppTok), { a: 'wagerReply', accept: true });
  assert.strictEqual(o.wagers[0].status, 'accepted');
  assert(o.news.some((n) => n.kind === 'wager'));
  // a rail offer between two owners who are not ready is refused; once both have transit it builds
  const third = Object.keys(tok).map(Number).find((r) => r !== me && r !== m.oppId);
  await rejects(app.api('POST', U('/api/act?t=' + admin), { a: 'rail', to: third }), 400);
  await app.api('POST', U('/api/act?t=' + admin), { a: 'build', k: '4-1', type: 'transit' });
  await app.api('POST', U('/api/act?t=' + admin), { a: 'upgrade', k: '4-1' }).catch(() => {});
  const db = app.db(), lg = Object.values(db.leagues)[0];
  [me, third].forEach((r) => { const f = lg.teams[r].f; f.cash = 3e6; if (!f.grid['4-1']) FT.build(f, '4-1', 'transit'); if (f.grid['4-1'].level < 2) FT.upgrade(f, '4-1'); });
  v = await app.api('POST', U('/api/act?t=' + admin), { a: 'rail', to: third });
  assert.strictEqual(v.railOffers.length, 1);
  await rejects(app.api('POST', U('/api/act?t=' + tok[third]), { a: 'railReply', with: 999, accept: true }), 400);
  const t3 = await app.api('POST', U('/api/act?t=' + tok[third]), { a: 'railReply', with: me, accept: true });
  assert.deepStrictEqual(t3.board.find((x) => x.rid === third).links, [me]);
  assert(t3.news.some((n) => n.kind === 'rail'));
  // settle the week: wager pays out, and both owners' edges ignore the deal money
  await app.api('POST', U('/api/act?t=' + admin), { a: 'demoLock' });
  v = await app.api('POST', U('/api/act?t=' + admin), { a: 'demoFinish' });
  const meRep = lg.teams[me].f.history[0], oppRep = lg.teams[m.oppId].f.history[0];
  const wl = meRep.lines.find((l) => l.label === 'Matchup wager'), ol = oppRep.lines.find((l) => l.label === 'Matchup wager');
  assert(wl && ol && wl.amount === -ol.amount && Math.abs(wl.amount) === 100e3, 'zero-sum wager');
  const row = v.bonus[10].rows.find((r) => r.rid === me), orow = v.bonus[10].rows.find((r) => r.rid === m.oppId);
  assert.strictEqual(row.net - row.twinNet, meRep.net - meRep.deals - (row.twinNet - meRep.deals), 'sanity');
  assert(orow.edge === 0 || Math.abs(orow.net - orow.twinNet) < Math.abs(ol.amount), 'the twin carries the same wager, so the edge does not');
  assert(v.news.some((n) => /won a \$100k wager|push/.test(n.text)));
  console.log('deals ok');
})().catch((e) => { console.error(e); process.exit(1); });
