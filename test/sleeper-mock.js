// Checks the Sleeper normalizer against responses shaped like Sleeper's documented API. Run: node test/sleeper-mock.js
const assert = require('assert');
const FT = require('../src/engine.js');
require('../src/league.js');
const N = 4, WEEK = 4;
const routes = {
  '/user/liz': { user_id: 'u1', display_name: 'Liz' },
  '/state/nfl': { week: WEEK, season: '2026', league_season: '2026', season_type: 'regular', previous_season: '2025' },
  '/user/u1/leagues/nfl/2026': [{ league_id: 'L1', name: 'Test League', season: '2026', status: 'in_season', total_rosters: N, settings: { playoff_week_start: 15 } }],
  '/league/L1': { league_id: 'L1', name: 'Test League', season: '2026', status: 'in_season', settings: { playoff_week_start: 15, last_scored_leg: 3 } },
  '/league/L1/rosters': [1, 2, 3, 4].map((i) => ({ roster_id: i, owner_id: 'u' + i, co_owners: null })),
  '/league/L1/users': [1, 2, 3, 4].map((i) => ({ user_id: 'u' + i, display_name: 'Owner' + i, metadata: i === 1 ? { team_name: 'Liz FC' } : {} })),
  '/players/nfl': { p1a: { first_name: 'Ada', last_name: 'Quick', position: 'RB' } },
};
for (let w = 1; w <= WEEK; w++) {
  routes['/league/L1/matchups/' + w] = [1, 2, 3, 4].map((i) => {
    const live = w === WEEK, a = live ? 12.5 : 20 + i + w, b = live ? 0 : 8;
    return { roster_id: i, matchup_id: i <= 2 ? 1 : 2, points: a + b, starters: ['p' + i + 'a', 'p' + i + 'b', '0'], starters_points: [a, b, 0], players_points: { ['p' + i + 'a']: a, ['p' + i + 'b']: b, ['p' + i + 'c']: 6.5 } };
  });
}
routes['/league/L1/transactions/3'] = [{ type: 'trade', status: 'complete', roster_ids: [1, 2], adds: { p2a: 1, p1b: 2 }, drops: { p2a: 2, p1b: 1 } }, { type: 'waiver', status: 'complete', roster_ids: [3], adds: { zz: 3 }, drops: null }];
global.fetch = async (url) => { const p = url.replace('https://api.sleeper.app/v1', ''); return { ok: p in routes, status: p in routes ? 200 : 404, json: async () => routes[p] }; };
(async () => {
  const found = await FT.Sleeper.findLeagues('liz');
  assert.deepStrictEqual(found.leagues.map((l) => l.id), ['L1']);
  const L = await FT.Sleeper.loadLeague('L1', found.user.id);
  assert.strictEqual(L.myRosterId, 1); assert.strictEqual(L.teams[0].name, 'Liz FC'); assert.strictEqual(L.teams[1].name, 'Team Owner2');
  assert.strictEqual(L.lastWeek, 17);
  assert(L.weeks[3].complete && !L.weeks[4].complete && L.weeks[4].live, 'weeks before the current one are final; the current one is live');
  assert.strictEqual(L.weeks[1].teams[1].bench, 6.5); assert.strictEqual(L.weeks[1].teams[1].starters.length, 2);
  const r = FT.weekResult(L, 1, 1);
  assert.strictEqual(r.oppId, 2); assert.strictEqual(r.stars, 1); assert.strictEqual(r.win, false);
  assert.strictEqual(L.trades[3].length, 1, 'only completed trades are kept');
  const tr = FT.tradeImpact(L, 3, 1), tr2 = FT.tradeImpact(L, 3, 2);
  assert(tr.net > 0 && tr2.net < 0 && Math.abs(tr.net + tr2.net) < 1e-9, 'a trade is a gain for one side and the same loss for the other');
  assert.strictEqual(FT.tradeImpact(L, 3, 3), null);
  assert.strictEqual(FT.weekResult(L, 3, 1).trade.net, tr.net);
  const S = FT.newGame(L, {});
  for (let i = 0; i < 3; i++) assert(FT.playWeek(S, L));
  assert.strictEqual(FT.nextWeek(S, L).status, 'live');
  await FT.Sleeper.loadNames(L); assert.strictEqual(L.players.p1a.n, 'A. Quick');
  console.log('sleeper normalizer ok');
})().catch((e) => { console.error(e); process.exit(1); });
