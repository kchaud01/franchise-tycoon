// League-mode server rules. Run: node test/league.js
const assert = require('assert');
const FT = require('../src/engine.js');
require('../src/league.js');
const { createApp } = require('../server.js');
const U = (p) => new URL('http://x' + p);
const rejects = async (p, status) => { try { await p; } catch (e) { assert.strictEqual(e.status, status, e.message); return; } assert.fail('expected a ' + status); };

(async () => {
  // --- demo league: the whole weekly cycle ---
  const app = createApp({ demo: true });
  const { token: admin } = await app.api('POST', U('/api/leagues'), { demo: true, cap: 5 });
  let v = await app.api('GET', U('/api/state?t=' + admin), {});
  assert.strictEqual(v.phase, 'open'); assert.strictEqual(v.week, 10); assert(v.admin); assert.strictEqual(v.invites.length, 10);
  const owner = v.invites.find((i) => !i.admin).token;
  let o = await app.api('GET', U('/api/state?t=' + owner), {});
  assert(!o.admin && !o.invites, 'owners never see other links');
  assert.notStrictEqual(o.S.rid, v.S.rid);
  await rejects(app.api('GET', U('/api/state?t=nope'), {}), 401);
  await rejects(app.api('POST', U('/api/act?t=' + owner), { a: 'settings', v: { cap: 20 } }), 400);
  await rejects(app.api('POST', U('/api/act?t=' + owner), { a: 'demoFinish' }), 400);

  v = await app.api('POST', U('/api/act?t=' + admin), { a: 'build', k: '0-1', type: 'concessions' });
  assert.strictEqual(v.S.grid['0-1'].type, 'concessions'); assert.strictEqual(v.S.cash, 700e3 - 180e3);
  await rejects(app.api('POST', U('/api/act?t=' + admin), { a: 'build', k: '1-1', type: 'retail' }), 400);
  o = await app.api('GET', U('/api/state?t=' + owner), {});
  assert(!o.S.grid['0-1'], 'one owner cannot touch another franchise');

  v = await app.api('POST', U('/api/act?t=' + admin), { a: 'demoLock' });
  assert.strictEqual(v.phase, 'locked');
  await rejects(app.api('POST', U('/api/act?t=' + admin), { a: 'build', k: '0-2', type: 'retail' }), 409);
  await rejects(app.api('POST', U('/api/act?t=' + owner), { a: 'promo', v: 'guarantee' }), 409);

  v = await app.api('POST', U('/api/act?t=' + admin), { a: 'demoFinish' });
  assert.strictEqual(v.week, 11); assert.strictEqual(v.phase, 'open'); assert.strictEqual(v.S.history.length, 1);
  let tb = v.bonus[10];
  assert.strictEqual(tb.rows.length, 10); assert(tb.paid);
  assert(tb.rows.every((r) => r.bonus >= 0 && r.bonus <= 5));
  const idle = tb.rows.filter((r) => r.rid !== v.S.rid);
  assert(idle.every((r) => r.edge === 0), 'an owner who does nothing matches the auto-pilot in week one');
  const c10 = v.cut[10], hosts = Object.keys(c10);
  assert(hosts.length > 0 && hosts.every((h) => c10[h].pct > 0 && c10[h].pct <= 0.5 && c10[h].visitors > 0), 'home owners with empty seats take a capped cut');
  assert(hosts.every((h) => FT.weekResult(v.league, 10, +h).home), 'only home owners are cut');
  console.log('week 10 visiting-fan cuts:', hosts.map((h) => h + ':' + Math.round(c10[h].pct * 100) + '%').join(' '));
  console.log('week 10 table:', tb.rows.map((r) => r.rid + ':' + r.edge + '%/+' + r.bonus).join('  '));

  v = await app.api('POST', U('/api/act?t=' + admin), { a: 'settings', v: { cap: 8, travelCut: 0.2, payout: 'top3', playoffStart: 13, lastWeek: 14, lockDay: 0, lockHour: 13 } });
  assert.deepStrictEqual([v.settings.cap, v.settings.payout, v.settings.playoffStart, v.settings.lastWeek, v.settings.lockDay], [8, 'top3', 13, 14, 0]);
  assert.strictEqual(v.league.lastWeek, 14);
  v = await app.api('POST', U('/api/act?t=' + admin), { a: 'demoFinish' });
  tb = v.bonus[11];
  assert(Object.values(v.cut[11]).every((c) => c.pct <= 0.2), 'the commissioner cap on cuts is respected');
  assert(tb.rows.filter((r) => r.bonus > 0).length <= 3 && Math.max(...tb.rows.map((r) => r.bonus)) <= 8, 'top three, capped at 8');
  assert.strictEqual(v.bonus[10].cap, 5, 'posted tables keep their rules');
  v = await app.api('POST', U('/api/act?t=' + admin), { a: 'demoFinish' }); // week 12 -> applies to week 13 = playoffs
  assert(!v.bonus[12].paid && v.bonus[12].rows.every((r) => r.bonus === 0), 'no bonus into the playoffs unless enabled');
  await app.api('POST', U('/api/act?t=' + admin), { a: 'demoFinish' });
  v = await app.api('POST', U('/api/act?t=' + admin), { a: 'demoFinish' });
  assert.strictEqual(v.phase, 'done');

  // --- Sleeper-shaped league: the clock locks the week, Sleeper finalizing it settles it ---
  let clock = Date.UTC(2026, 10, 10, 15); // Tue Nov 10
  const src = FT.demoLeague(7, 9); src.source = 'sleeper'; src.leagueId = '123456789'; src.seasonStart = '2026-09-09';
  const copy = () => JSON.parse(JSON.stringify(src));
  const app2 = createApp({ now: () => clock, provider: { load: async () => copy(), names: async () => false } });
  const t2 = (await app2.api('POST', U('/api/leagues'), { leagueId: '123456789', userId: 'u1' })).token;
  await rejects(app2.api('POST', U('/api/leagues'), { leagueId: '123456789', userId: 'u1' }), 409);
  let s = await app2.api('GET', U('/api/state?t=' + t2), {});
  assert.strictEqual(s.phase, 'open'); assert.strictEqual(new Date(s.lockAt).toISOString(), '2026-11-13T01:00:00.000Z');
  await app2.api('POST', U('/api/act?t=' + t2), { a: 'price', v: 2 });
  clock = Date.UTC(2026, 10, 13, 2);
  await rejects(app2.api('POST', U('/api/act?t=' + t2), { a: 'price', v: 0 }), 409);
  FT.setDemoWeek(src, 10); clock = Date.UTC(2026, 10, 17, 15); // Sleeper finalizes week 10 on Tuesday
  s = await app2.api('GET', U('/api/state?t=' + t2), {});
  assert.strictEqual(s.week, 11); assert(s.bonus[10]); assert.strictEqual(s.phase, 'open');
  assert.strictEqual(s.S.price, 2, 'the locked-in price was the one used');
  console.log('league server ok');
})().catch((e) => { console.error(e); process.exit(1); });
