// Mini-games: every game ends, scores sensibly under random and scripted play, and the medal rules hold.
const assert = require('assert');
const FT = require('../src/engine.js');
require('../src/league.js'); require('../src/minigames.js');
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const ctx = new Proxy({}, { get: (t, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : typeof k === 'string' ? () => {} : undefined), set: () => true });

// 1. random mashing: every game terminates with a finite score, and draw never throws
for (const type of FT.TYPES) {
  const def = FT.MINI[type]; assert(def && FT.Mini.GAMES[def.game], 'game for ' + type);
  const r = rng(type.length * 7 + 1), g = FT.Mini.GAMES[def.game]({ color: '#e4572e', rnd: r });
  let steps = 0, held = false;
  while (!g.done && steps < 60 * 90) {
    if (r() < 0.12) { if (held) { g.up(); held = false; } else { g.down(r() * 360, r() * 440); held = true; } }
    if (r() < 0.1) g.key(r() < 0.5 ? 'L' : 'R');
    g.update(1 / 60); if (steps % 30 === 0) g.draw(ctx); steps++;
  }
  assert(g.done, def.name + ' ends'); assert(Number.isFinite(g.score), def.name + ' score');
  console.log(def.name.padEnd(20), 'random play:', String(g.score).padStart(6), def.unit, '-> ' + FT.MEDALS[FT.miniMedal(type, g.score)]);
}

// 2. skilled bots: gold is reachable, so the thresholds are fair
const bots = {
  pour(g) { if (g.state === 'fill') { if (!g.hold && g.fill === 0) g.down(); else if (g.hold && g.fill >= g.target - 0.012) g.up(); } },
  shuttle(g) { const fans = g.objs.filter((o) => o.fan && o.y < 350 && o.y > 120).sort((a, b) => b.y - a.y)[0]; const cone = g.objs.find((o) => !o.fan && o.lane === g.lane && o.y > 250 && o.y < 390); if (cone) g.key(g.lane === 0 ? 'R' : 'L'); else if (fans && fans.lane !== g.lane && !g.objs.some((o) => !o.fan && o.lane === fans.lane && o.y > 250 && o.y < 400)) g.key(fans.lane < g.lane ? 'L' : 'R'); },
  order(g, n) { if (n % 40 === 0) { const i = g.grid.indexOf(g.want); g.down(24 + (i % 3) * 104 + 52, 122 + Math.floor(i / 3) * 100 + 50); } },
  stack(g) { const p = g.floors[g.floors.length - 1]; if (Math.abs(g.cur.x - p.x) < 3) g.down(); },
  signal(g) { if (g.y < g.by) g.down(); else g.up(); },
  kick(g) { if (g.phase === 'aim' && Math.abs(g.a + g.wind * 0.3) < 0.05) g.down(); else if (g.phase === 'power' && g.p > 0.6 && g.p < 0.85) g.down(); },
  dash(g, n) { if (n % 8 === 0) g.key(g.last === 'L' ? 'R' : 'L'); },
  scout(g, n) { if (g.phase === 'show' && g.t > 0.5) g.down(12 + g.best * 112 + 56, 200); },
};
for (const type of FT.TYPES) {
  const def = FT.MINI[type], g = FT.Mini.GAMES[def.game]({ color: '#e4572e', rnd: rng(99) });
  let n = 0; while (!g.done && n < 60 * 90) { bots[def.game](g, n); g.update(1 / 60); n++; }
  assert.strictEqual(FT.miniMedal(type, g.score), 3, def.name + ' gold reachable, got ' + g.score);
  console.log(def.name.padEnd(20), 'skilled play:', String(g.score).padStart(6), def.unit);
}

// 3. rules
const L = FT.demoLeague(1, 9), S = FT.newGame(L, {});
assert.strictEqual(FT.recordMini(S, 'concessions', 99).counted, false, 'no building, no reward');
FT.build(S, '0-1', 'concessions');
const base = FT.effects(S).perCap;
assert.deepStrictEqual([FT.miniMedal('concessions', 7), FT.miniMedal('concessions', 8), FT.miniMedal('concessions', 14), FT.miniMedal('concessions', 50)], [0, 1, 2, 3]);
assert.deepStrictEqual([FT.miniMedal('medical', 11), FT.miniMedal('medical', 9), FT.miniMedal('medical', 5.9)], [0, 1, 3], 'lower is better for the dash');
assert.strictEqual(FT.recordMini(S, 'concessions', 14).boost, 0.07);
assert.strictEqual(FT.recordMini(S, 'concessions', 2).boost, 0.07, 'a worse try never lowers the medal');
assert.strictEqual(FT.recordMini(S, 'concessions', 30).boost, 0.1);
assert.strictEqual(FT.recordMini(S, 'concessions', 30).counted, false, 'three tries a week');
assert(Math.abs(FT.effects(S).perCap / base - 1.1) < 1e-9, 'gold lifts the building 10%');
const rep = FT.playWeek(S, L);
assert.strictEqual(rep.mini.concessions.medal, 3); assert.deepStrictEqual(S.mini, {}, 'medals reset after the game day');
assert(Math.abs(FT.effects(S).perCap - base) < 1e-9);
console.log('mini-games ok');
