// Engine checks + a balance readout. Run: node test/sim.js
const assert = require('assert');
const FT = require('../src/engine.js');
require('../src/league.js');

const fmt = (n) => '$' + (n / 1e6).toFixed(2) + 'M';

// A simple human-ish strategy: buy the best affordable thing after every game day.
function playerTurn(s) {
  const want = [
    ['concessions', '0-1'], ['retail', '4-2'], ['transit', '4-1'], ['fanzone', '4-3'], ['media', '1-0'], ['stadium'],
    ['suites', '3-1'], ['concessions', '1-3'], ['up', '0-1'], ['up', '4-2'], ['scouting', '0-4'], ['stadium'], ['up', '4-1'],
    ['up', '1-0'], ['up', '3-1'], ['medical', '0-0'], ['stadium'], ['up', '1-3'], ['up', '4-3'],
  ];
  s.i = s.i || 0;
  while (s.i < want.length) {
    const [w, k] = want[s.i];
    const ok = w === 'stadium' ? FT.upgradeStadium(s) : w === 'up' ? FT.upgrade(s, k) : FT.build(s, k, w);
    if (!ok) break;
    s.i++;
  }
  const f = FT.forecast(s);
  s.price = f.demand > Math.min(f.capacity, f.access) * 1.3 ? 2 : 1;
}

for (const seed of [2026, 7, 99]) {
  const league = FT.demoLeague(seed, 16);
  const s = FT.newGame(league, {});
  playerTurn(s);
  let rep;
  const rows = [];
  while ((rep = FT.playWeek(s, league))) {
    assert(Number.isFinite(rep.net) && Number.isFinite(s.cash) && Number.isFinite(s.fans), 'finite numbers');
    assert(s.hype >= 0 && s.hype <= 100, 'hype in range');
    assert(rep.attendance <= rep.capacity, 'attendance within capacity');
    rows.push(`wk${String(rep.r.week).padStart(2)} ${rep.r.home ? 'H' : rep.r.bye ? '-' : 'A'} ${rep.r.win ? 'W' : 'L'} ${rep.r.pts.toFixed(0).padStart(3)} net ${fmt(rep.net).padStart(7)} cash ${fmt(s.cash).padStart(7)} fans ${String(s.fans).padStart(6)} hype ${s.hype.toFixed(0).padStart(3)} att ${rep.attendance}`);
    playerTurn(s);
  }
  assert.strictEqual(s.history.length, 16, 'played all 16 weeks');
  assert.strictEqual(FT.nextWeek(s, league).status, 'done');
  console.log(`\nseed ${seed}: record ${s.wins}-${s.losses}, stadium L${s.stadium}, lots ${Object.keys(s.grid).length}`);
  console.log(rows.join('\n'));
  console.log(FT.leaderboard(s, league).map((x, i) => `${i + 1}. ${x.me ? '>> ' : ''}${x.name} ${x.record} ${fmt(x.value)} L${x.stadium} lots ${x.lots}`).join('\n'));
}

// Rules
{
  const league = FT.demoLeague(1, 9);
  const s = FT.newGame(league, {});
  assert(!FT.build(s, '1-1', 'retail'), 'cannot build on the stadium');
  assert(FT.build(s, '0-1', 'concessions'));
  assert(!FT.build(s, '0-1', 'retail'), 'lot taken');
  assert.strictEqual(FT.synergy(s, '0-1', 'concessions'), 1.2);
  assert.strictEqual(FT.synergy(s, '0-0', 'concessions'), 1);
  const cash = s.cash; FT.demolish(s, '0-1');
  assert.strictEqual(s.cash, cash + 72e3); assert.strictEqual(s.invested, 0);
  // both sides of a matchup agree on who is home
  for (let w = 1; w <= 9; w++) for (const t of league.teams) {
    const a = FT.weekResult(league, w, t.rosterId);
    if (a.oppId) assert.notStrictEqual(a.home, FT.weekResult(league, w, a.oppId).home);
  }
  for (let i = 0; i < 9; i++) assert(FT.playWeek(s, league));
  assert.strictEqual(FT.playWeek(s, league), null);
  assert.strictEqual(FT.nextWeek(s, league).status, 'live');
  FT.setDemoWeek(league, 10);
  assert.strictEqual(FT.nextWeek(s, league).status, 'ready');
  assert(JSON.parse(JSON.stringify(s)), 'state serializes');
}
console.log('\nall checks passed');
