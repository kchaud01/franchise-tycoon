/* Franchise Tycoon — mini-games. One short arcade game per building type.
   Each game is a plain object: update(dt), draw(ctx), down(x, y), up(), key('L'|'R'), plus `done` and `score`.
   The rules of what a score is worth (medals, tries, boosts) live in engine.js; this file is only the play. */
(function (root) {
  'use strict';
  const FT = (root.FT = root.FT || {});
  const W = 360, H = 440;
  const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';
  const INK = '#0f1622', TEXT = '#efe8d8', MUTED = '#93a2b5', GOLD = '#ffd685', GOOD = '#63d391', BAD = '#ff8271';
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  function txt(c, s, x, y, size, col, align) {
    c.font = '700 ' + size + 'px ' + FONT; c.fillStyle = col || TEXT; c.textAlign = align || 'center'; c.textBaseline = 'middle'; c.fillText(s, x, y);
  }
  function rect(c, x, y, w, h, fill, r) {
    c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, r || 0); else c.rect(x, y, w, h); c.fillStyle = fill; c.fill();
  }
  function timerBar(c, frac, col) { rect(c, 20, 14, W - 40, 8, '#1e2a3b', 4); rect(c, 20, 14, (W - 40) * clamp(frac, 0, 1), 8, col || GOLD, 4); }

  const GAMES = {
    // ---- Fan Plaza: time the aim, then the power, against the wind -------------------------
    kick(env) {
      const hw = [0.34, 0.3, 0.26, 0.22, 0.18];
      const g = { done: false, score: 0, n: 0, phase: 'aim', a: 0, p: 0, t: 0, wind: 0, fly: 0, end: 0, msg: '', made: false };
      const next = () => { g.phase = 'aim'; g.t = env.rnd() * 6; g.wind = Math.round((env.rnd() * 2 - 1) * 10) / 10; };
      next();
      g.update = (dt) => {
        g.t += dt;
        if (g.phase === 'aim') g.a = Math.sin(g.t * (2.4 + g.n * 0.5));
        else if (g.phase === 'power') g.p = (Math.sin(g.t * (3.2 + g.n * 0.4)) + 1) / 2;
        else if (g.phase === 'fly') { g.fly += dt / 0.9; if (g.fly >= 1) { g.phase = 'show'; g.t = 0; } }
        else if (g.t > 0.8) { g.n++; if (g.n >= 5) { g.n = 4; g.done = true; } else next(); }
      };
      g.down = () => {
        if (g.phase === 'aim') { g.phase = 'power'; g.t = env.rnd() * 6; }
        else if (g.phase === 'power') {
          g.phase = 'fly'; g.fly = 0;
          g.end = g.a + g.wind * 0.3 + (g.p > 0.93 ? (env.rnd() - 0.5) * 0.9 : 0);
          g.made = Math.abs(g.end) < hw[g.n] && g.p >= 0.5;
          if (g.made) g.score++;
          g.msg = g.made ? "IT'S GOOD!" : g.p < 0.5 ? 'SHORT!' : 'NO GOOD';
        }
      };
      g.up = g.key = () => {};
      g.draw = (c) => {
        c.fillStyle = '#2f7a4a'; c.fillRect(0, 0, W, H);
        for (let i = 0; i < 7; i++) { c.fillStyle = i % 2 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.05)'; c.fillRect(0, 150 + i * 34, W, 34); }
        c.fillStyle = '#6fb1e0'; c.fillRect(0, 0, W, 150);
        const pw = hw[g.n] * 150, cx = W / 2;
        c.strokeStyle = '#f2d24a'; c.lineWidth = 5; c.lineCap = 'round';
        c.beginPath(); c.moveTo(cx - pw, 50); c.lineTo(cx - pw, 122); c.lineTo(cx + pw, 122); c.lineTo(cx + pw, 50); c.moveTo(cx, 122); c.lineTo(cx, 152); c.stroke();
        txt(c, 'KICK ' + (g.n + 1) + ' OF 5   ·   MADE ' + g.score, cx, 22, 17, INK);
        const wv = g.wind;
        txt(c, wv === 0 ? 'NO WIND' : 'WIND ' + (wv > 0 ? '→' : '←') + ' ' + Math.abs(wv * 10).toFixed(0), cx, 166, 15, TEXT);
        let bx = cx, by = 356, s = 11;
        if (g.phase === 'fly' || g.phase === 'show') { const f = g.phase === 'show' ? 1 : g.fly; bx = cx + g.end * 150 * f; by = 356 - 250 * f - Math.sin(Math.PI * f) * 46; s = 11 - 6 * f; }
        c.fillStyle = '#7a4a2a'; c.beginPath(); c.ellipse(bx, by, s * 0.7, s, 0, 0, 7); c.fill();
        c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(bx, by - s * 0.5); c.lineTo(bx, by + s * 0.5); c.stroke();
        // aim meter with the zone that will score once the wind is counted
        rect(c, 30, 396, 300, 16, '#1e2a3b', 8);
        const zc = cx - g.wind * 0.3 * 150, zw = hw[g.n] * 150;
        rect(c, clamp(zc - zw, 30, 330), 396, clamp(zc + zw, 30, 330) - clamp(zc - zw, 30, 330), 16, 'rgba(99,211,145,.55)', 8);
        rect(c, cx + g.a * 150 - 3, 390, 6, 28, g.phase === 'aim' ? '#fff' : GOLD, 3);
        rect(c, 334, 190, 14, 190, '#1e2a3b', 7); rect(c, 334, 190 + 190 * 0.07, 14, 190 * 0.43, 'rgba(99,211,145,.55)', 7);
        if (g.phase !== 'aim') rect(c, 330, 380 - g.p * 190 - 3, 22, 6, g.phase === 'power' ? '#fff' : GOLD, 3);
        txt(c, g.phase === 'aim' ? 'TAP TO SET AIM' : g.phase === 'power' ? 'TAP TO SET POWER' : '', cx, 428, 14, TEXT);
        if (g.phase === 'show') txt(c, g.msg, cx, 250, 44, g.made ? GOLD : '#fff');
      };
      return g;
    },

    // ---- Concessions: hold to pour, release on the line ----------------------------------------
    pour(env) {
      const g = { done: false, score: 0, time: 25, fill: 0, hold: false, rate: 1, target: 0.85, state: 'fill', st: 0, msg: '', mcol: TEXT };
      const cup = () => { g.fill = 0; g.rate = 0.75 + env.rnd() * 0.9; g.target = 0.78 + env.rnd() * 0.14; g.state = 'fill'; g.hold = false; };
      const out = (m, col) => { g.msg = m; g.mcol = col; g.state = 'out'; g.st = 0; g.hold = false; };
      cup();
      g.update = (dt) => {
        g.time -= dt; if (g.time <= 0) { g.time = 0; g.done = true; return; }
        if (g.state === 'fill') { if (g.hold) { g.fill += g.rate * dt * (1 + g.fill * 0.6); if (g.fill >= 1.03) out('SPILLED', BAD); } }
        else { g.st += dt; if (g.st > 0.45) cup(); }
      };
      g.down = () => { if (g.state === 'fill') g.hold = true; };
      g.up = () => {
        if (g.state !== 'fill' || !g.hold) return;
        g.hold = false; if (g.fill < 0.05) return;
        const d = Math.abs(g.fill - g.target);
        if (d < 0.025) { g.score += 2; out('PERFECT  +2', GOLD); } else if (d < 0.07) { g.score += 1; out('SERVED  +1', GOOD); } else out(g.fill < g.target ? 'SHORT POUR' : 'ALL FOAM', BAD);
      };
      g.key = () => {};
      g.draw = (c) => {
        c.fillStyle = '#2a211c'; c.fillRect(0, 0, W, H); c.fillStyle = '#4a362c'; c.fillRect(0, 330, W, 110); c.fillStyle = '#6f4e33'; c.fillRect(0, 322, W, 12);
        timerBar(c, g.time / 25); txt(c, 'SERVED ' + g.score, W / 2, 46, 26, GOLD);
        rect(c, 168, 70, 24, 60, '#aab3bf', 4); rect(c, 150, 62, 60, 14, '#d7dbe0', 5); rect(c, 174, 126, 12, 16, '#8a929c', 2);
        const sx = g.state === 'out' ? g.st * 520 : 0, cx = W / 2 + sx, top = 170, bot = 322, tw = 46, bw = 34, ch = bot - top;
        const lvl = clamp(g.fill, 0, 1), y = bot - ch * lvl, wAt = (yy) => bw + (tw - bw) * ((bot - yy) / ch);
        if (g.hold && g.state === 'fill') { c.fillStyle = '#e6a92e'; c.fillRect(W / 2 - 3, 142, 6, y - 142); }
        c.fillStyle = '#e6a92e'; c.beginPath(); c.moveTo(cx - wAt(y), y); c.lineTo(cx + wAt(y), y); c.lineTo(cx + bw, bot); c.lineTo(cx - bw, bot); c.closePath(); c.fill();
        if (lvl > 0.04) { const fh = Math.min(16, 6 + lvl * 12); c.fillStyle = '#fff6e0'; c.beginPath(); c.moveTo(cx - wAt(y - fh), y - fh); c.lineTo(cx + wAt(y - fh), y - fh); c.lineTo(cx + wAt(y), y); c.lineTo(cx - wAt(y), y); c.closePath(); c.fill(); }
        c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 3; c.beginPath(); c.moveTo(cx - tw, top); c.lineTo(cx - bw, bot); c.lineTo(cx + bw, bot); c.lineTo(cx + tw, top); c.stroke();
        const ty = bot - ch * g.target; c.strokeStyle = GOOD; c.lineWidth = 2; c.setLineDash([6, 4]); c.beginPath(); c.moveTo(cx - tw - 14, ty); c.lineTo(cx + tw + 14, ty); c.stroke(); c.setLineDash([]);
        if (g.state === 'out') txt(c, g.msg, W / 2, 380, 30, g.mcol); else txt(c, 'HOLD TO POUR · LET GO ON THE LINE', W / 2, 400, 15, MUTED);
      };
      return g;
    },

    // ---- Performance Center: alternate left and right for 40 yards -----------------------------
    dash(env) {
      const g = { done: false, score: 0, t: 0, yd: 0, last: null, stun: 0, started: false };
      g.update = (dt) => { if (!g.started) return; g.t += dt; g.stun = Math.max(0, g.stun - dt); if (g.t >= 20) { g.done = true; g.score = 20; } };
      g.key = (k) => {
        if (g.done) return; g.started = true; if (g.stun > 0) return;
        if (k === g.last) g.stun = 0.3; else { g.yd++; g.last = k; if (g.yd >= 40) { g.done = true; g.score = Math.round(g.t * 100) / 100; } }
      };
      g.down = (x) => g.key(x < W / 2 ? 'L' : 'R'); g.up = () => {};
      g.draw = (c) => {
        c.fillStyle = '#2f7a4a'; c.fillRect(0, 0, W, H);
        txt(c, g.t.toFixed(2) + 's', W / 2, 44, 40, GOLD); txt(c, g.yd + ' / 40 YARDS', W / 2, 82, 16, TEXT);
        rect(c, 24, 130, 312, 70, '#b5483c', 8);
        c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1;
        for (let i = 0; i <= 4; i++) { const x = 44 + i * 68; c.beginPath(); c.moveTo(x, 130); c.lineTo(x, 200); c.stroke(); txt(c, String(i * 10), x, 214, 12, TEXT); }
        const rx = 44 + (g.yd / 40) * 272, bob = g.yd % 2 ? -3 : 0;
        c.fillStyle = env.color; c.fillRect(rx - 5, 154 + bob, 10, 16); c.fillStyle = '#f1c9a5'; c.beginPath(); c.arc(rx, 148 + bob, 5.5, 0, 7); c.fill();
        c.fillStyle = '#22282f'; c.fillRect(rx - 5, 170 + bob, 4, g.yd % 2 ? 9 : 5); c.fillRect(rx + 1, 170 + bob, 4, g.yd % 2 ? 5 : 9);
        const want = g.last === 'L' ? 'R' : g.last === 'R' ? 'L' : null;
        [['L', 20], ['R', 190]].forEach(([k, x]) => { rect(c, x, 250, 150, 150, g.stun > 0 ? '#5a2a2a' : want === k || !want ? env.color : '#1e2a3b', 14); txt(c, k === 'L' ? 'LEFT' : 'RIGHT', x + 75, 325, 30, '#fff'); });
        txt(c, g.stun > 0 ? 'STUMBLE!' : g.started ? '' : 'TAP LEFT, THEN RIGHT, TO START', W / 2, 422, 15, g.stun > 0 ? BAD : MUTED);
      };
      return g;
    },

    // ---- VIP Suites: drop floors, lose whatever overhangs ------------------------------------------
    stack(env) {
      const g = { done: false, score: 0, floors: [{ x: 90, w: 180 }], cur: { x: 0, w: 180, dir: 1 }, speed: 150, flash: 0 };
      g.update = (dt) => {
        const cu = g.cur; cu.x += cu.dir * g.speed * dt; g.flash = Math.max(0, g.flash - dt);
        if (cu.x < 0) { cu.x = 0; cu.dir = 1; } if (cu.x + cu.w > W) { cu.x = W - cu.w; cu.dir = -1; }
      };
      g.down = () => {
        if (g.done) return;
        const p = g.floors[g.floors.length - 1], cu = g.cur;
        let l = Math.max(cu.x, p.x), r = Math.min(cu.x + cu.w, p.x + p.w);
        if (r - l <= 3) { g.done = true; return; }
        if (Math.abs(cu.x - p.x) < 5) { l = p.x; r = p.x + p.w; g.flash = 0.35; }
        g.floors.push({ x: l, w: r - l }); g.score++; g.speed += 13;
        if (g.score >= 25) { g.done = true; return; }
        g.cur = { x: g.score % 2 ? 0 : W - (r - l), w: r - l, dir: g.score % 2 ? 1 : -1 };
      };
      g.up = g.key = () => {};
      g.draw = (c) => {
        const sky = c.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#111830'); sky.addColorStop(1, '#5e466c'); c.fillStyle = sky; c.fillRect(0, 0, W, H);
        const fh = 22, off = Math.max(0, g.floors.length - 11) * fh, base = 410;
        const floor = (f, i, col) => {
          const y = base - (i + 1) * fh + off; if (y > H || y < -fh) return;
          rect(c, f.x, y, f.w, fh - 2, col, 2);
          c.fillStyle = GOLD; for (let k = 0; k < Math.floor(f.w / 14); k++) if ((k + i) % 3) c.fillRect(f.x + 5 + k * 14, y + 6, 7, 8);
        };
        g.floors.forEach((f, i) => floor(f, i, i === 0 ? '#3b4656' : '#2f6f8a'));
        if (!g.done) floor(g.cur, g.floors.length, env.color);
        rect(c, 0, base + off, W, 40, '#1e2a3b');
        txt(c, g.score + ' FLOORS', W / 2, 36, 30, GOLD);
        if (g.flash > 0) txt(c, 'PERFECT', W / 2, 74, 22, GOOD);
        txt(c, 'TAP TO DROP', W / 2, 426, 14, MUTED);
      };
      return g;
    },

    // ---- Broadcast Center: keep the needle in the moving band -----------------------------------
    signal(env) {
      const g = { done: false, score: 0, time: 20, y: 0.5, v: 0, hold: false, by: 0.5, bh: 0.24, ph: env.rnd() * 6, inT: 0, tot: 0, locked: false };
      g.update = (dt) => {
        g.time -= dt; if (g.time <= 0) { g.time = 0; g.done = true; return; }
        g.v += ((g.hold ? 0.95 : -0.95) - g.v) * Math.min(1, 7 * dt); g.y += g.v * dt; // eases toward a steady climb or fall
        if (g.y < 0) { g.y = 0; g.v = 0; } if (g.y > 1) { g.y = 1; g.v = 0; }
        g.ph += dt; g.by = 0.5 + 0.3 * Math.sin(g.ph * 1.3) + 0.1 * Math.sin(g.ph * 3.7); g.bh = 0.2 + 0.08 * (g.time / 20);
        g.tot += dt; g.locked = Math.abs(g.y - g.by) < g.bh / 2; if (g.locked) g.inT += dt;
        g.score = Math.round((g.inT / g.tot) * 100);
      };
      g.down = () => { g.hold = true; }; g.up = () => { g.hold = false; }; g.key = () => {};
      g.draw = (c) => {
        c.fillStyle = '#0d1620'; c.fillRect(0, 0, W, H); timerBar(c, g.time / 20);
        txt(c, 'SIGNAL ' + g.score + '%', W / 2, 48, 30, g.locked ? GOOD : GOLD);
        // the picture: clean when locked, snow when not
        rect(c, 24, 80, 190, 300, '#17212e', 8);
        c.save(); c.beginPath(); c.rect(28, 84, 182, 292); c.clip();
        c.fillStyle = '#2f7a4a'; c.fillRect(28, 84, 182, 292); c.fillStyle = env.color; c.fillRect(28, 84, 26, 292); c.fillRect(184, 84, 26, 292);
        c.strokeStyle = 'rgba(255,255,255,.6)'; for (let i = 1; i < 8; i++) { c.beginPath(); c.moveTo(28, 84 + i * 36.5); c.lineTo(210, 84 + i * 36.5); c.stroke(); }
        if (!g.locked) { for (let i = 0; i < 520; i++) { c.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.75)' : 'rgba(0,0,0,.75)'; c.fillRect(28 + Math.random() * 182, 84 + Math.random() * 292, 3, 2); } }
        c.restore();
        txt(c, g.locked ? 'ON AIR' : 'NO SIGNAL', 119, 396, 16, g.locked ? GOOD : BAD);
        const gx = 262, top = 84, hh = 292, yOf = (u) => top + hh * (1 - u);
        rect(c, gx, top, 44, hh, '#1e2a3b', 8);
        rect(c, gx, yOf(g.by + g.bh / 2), 44, hh * g.bh, 'rgba(99,211,145,.55)', 6);
        rect(c, gx - 8, yOf(g.y) - 4, 60, 8, '#fff', 4);
        txt(c, 'HOLD TO RAISE · LET GO TO DROP', W / 2, 424, 14, MUTED);
      };
      return g;
    },

    // ---- Transit Hub: three lanes, pick up fans, miss the cones -------------------------------------
    shuttle(env) {
      const g = { done: false, score: 0, time: 25, lane: 1, objs: [], spawn: 0.3, speed: 190, hit: 0, scroll: 0 };
      const LX = [90, 180, 270], BY = 366;
      g.update = (dt) => {
        g.time -= dt; if (g.time <= 0) { g.time = 0; g.done = true; return; }
        g.speed = 190 + (25 - g.time) * 8; g.scroll = (g.scroll + g.speed * dt) % 40; g.hit = Math.max(0, g.hit - dt);
        g.spawn -= dt; if (g.spawn <= 0) { g.spawn = 0.4; g.objs.push({ lane: Math.floor(env.rnd() * 3), y: -20, fan: env.rnd() < 0.62, col: ['#f2b33d', '#4f8fd9', '#eef1f4', '#3aa88f'][Math.floor(env.rnd() * 4)] }); }
        g.objs.forEach((o) => {
          o.y += g.speed * dt;
          if (!o.gone && o.lane === g.lane && Math.abs(o.y - BY) < 22) { o.gone = true; if (o.fan) g.score++; else { g.score = Math.max(0, g.score - 2); g.hit = 0.35; } }
        });
        g.objs = g.objs.filter((o) => !o.gone && o.y < H + 30);
      };
      g.key = (k) => { g.lane = clamp(g.lane + (k === 'L' ? -1 : 1), 0, 2); };
      g.down = (x) => g.key(x < W / 2 ? 'L' : 'R'); g.up = () => {};
      g.draw = (c) => {
        c.fillStyle = '#3f7d5a'; c.fillRect(0, 0, W, H); c.fillStyle = '#2c3440'; c.fillRect(40, 0, 280, H);
        c.strokeStyle = '#c9b458'; c.lineWidth = 3; c.setLineDash([20, 20]); c.lineDashOffset = -g.scroll;
        [135, 225].forEach((x) => { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }); c.setLineDash([]);
        g.objs.forEach((o) => {
          const x = LX[o.lane];
          if (o.fan) { c.fillStyle = o.col; c.fillRect(x - 6, o.y - 4, 12, 16); c.fillStyle = '#f1c9a5'; c.beginPath(); c.arc(x, o.y - 10, 6, 0, 7); c.fill(); }
          else { c.fillStyle = '#f2792e'; c.beginPath(); c.moveTo(x, o.y - 14); c.lineTo(x + 11, o.y + 10); c.lineTo(x - 11, o.y + 10); c.closePath(); c.fill(); c.fillStyle = '#fff'; c.fillRect(x - 6, o.y - 1, 12, 4); }
        });
        const bx = LX[g.lane];
        rect(c, bx - 20, BY - 30, 40, 62, g.hit > 0 ? BAD : env.color, 8); rect(c, bx - 15, BY - 24, 30, 14, '#cfe9ff', 3); rect(c, bx - 15, BY - 4, 30, 22, 'rgba(255,255,255,.25)', 3);
        timerBar(c, g.time / 25); rect(c, 110, 28, 140, 34, 'rgba(15,22,34,.8)', 8); txt(c, 'FANS ' + g.score, W / 2, 46, 24, GOLD);
        txt(c, '← TAP A SIDE TO CHANGE LANES →', W / 2, 426, 14, TEXT);
      };
      return g;
    },

    // ---- Team Store: find the jersey on the order ----------------------------------------------
    order(env) {
      const COLS = [['RED', '#e5484d'], ['BLUE', '#4f8fd9'], ['GOLD', '#e0a82e'], ['GREEN', '#3aa88f']];
      const g = { done: false, score: 0, time: 25, grid: [], want: null, flash: 0, ok: 0 };
      const round = () => {
        const nums = []; while (nums.length < 3) { const n = 1 + Math.floor(env.rnd() * 98); if (nums.indexOf(n) < 0) nums.push(n); }
        const all = []; nums.forEach((n) => COLS.forEach((cl, ci) => all.push({ n, ci })));
        for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(env.rnd() * (i + 1)); const t = all[i]; all[i] = all[j]; all[j] = t; }
        g.grid = all.slice(0, 9); g.want = g.grid[Math.floor(env.rnd() * 9)];
      };
      round();
      g.update = (dt) => { g.time -= dt; g.flash = Math.max(0, g.flash - dt); g.ok = Math.max(0, g.ok - dt); if (g.time <= 0) { g.time = 0; g.done = true; } };
      g.down = (x, y) => {
        const cxi = Math.floor((x - 24) / 104), cyi = Math.floor((y - 122) / 100);
        if (cxi < 0 || cxi > 2 || cyi < 0 || cyi > 2) return;
        if (g.grid[cyi * 3 + cxi] === g.want) { g.score++; g.ok = 0.2; round(); } else { g.time -= 1.5; g.flash = 0.3; }
      };
      g.up = g.key = () => {};
      g.draw = (c) => {
        c.fillStyle = g.flash > 0 ? '#3a1f22' : '#161f2d'; c.fillRect(0, 0, W, H); timerBar(c, g.time / 25, g.flash > 0 ? BAD : GOLD);
        rect(c, 24, 34, 312, 74, '#efe8d8', 8);
        txt(c, 'ORDER', 40, 52, 13, '#5a6470', 'left'); txt(c, 'FILLED ' + g.score, 320, 52, 13, '#5a6470', 'right');
        rect(c, 40, 66, 30, 30, COLS[g.want.ci][1], 6); txt(c, '#' + g.want.n + '  ' + COLS[g.want.ci][0], 84, 82, 30, INK, 'left');
        g.grid.forEach((j, i) => {
          const x = 24 + (i % 3) * 104 + 52, y = 122 + Math.floor(i / 3) * 100 + 50, col = COLS[j.ci][1];
          rect(c, x - 48, y - 46, 96, 92, '#1e2a3b', 8);
          c.fillStyle = col; c.beginPath(); c.moveTo(x - 16, y - 34); c.lineTo(x - 38, y - 22); c.lineTo(x - 30, y - 4); c.lineTo(x - 22, y - 9); c.lineTo(x - 22, y + 36); c.lineTo(x + 22, y + 36); c.lineTo(x + 22, y - 9); c.lineTo(x + 30, y - 4); c.lineTo(x + 38, y - 22); c.lineTo(x + 16, y - 34); c.quadraticCurveTo(x, y - 24, x - 16, y - 34); c.fill();
          txt(c, String(j.n), x, y + 10, 30, '#fff');
        });
      };
      return g;
    },

    // ---- Front Office: spot the best prospect before the clock runs out ---------------------------
    scout(env) {
      const g = { done: false, score: 0, round: 0, cards: [], t: 0, limit: 3, phase: 'show', pick: -1, best: 0 };
      const sum = (cd) => cd[0] + cd[1] + cd[2];
      const deal = () => {
        for (let tries = 0; tries < 50; tries++) {
          g.cards = [0, 1, 2].map(() => [0, 1, 2].map(() => 20 + Math.floor(env.rnd() * 80)));
          const s = g.cards.map(sum), top = Math.max(s[0], s[1], s[2]), rest = s.slice().sort((a, b) => b - a)[1];
          g.best = s.indexOf(top); if (top - rest >= 6) break;
        }
        g.limit = 3 - g.round * 0.19; g.phase = 'show'; g.t = 0; g.pick = -1;
      };
      deal();
      g.update = (dt) => {
        g.t += dt;
        if (g.phase === 'show') { if (g.t > g.limit) { g.phase = 'reveal'; g.t = 0; } }
        else if (g.t > 0.75) { g.round++; if (g.round >= 10) { g.round = 9; g.done = true; } else deal(); }
      };
      g.down = (x, y) => {
        if (g.phase !== 'show' || y < 90 || y > 400) return;
        const i = clamp(Math.floor((x - 12) / 112), 0, 2);
        g.pick = i; if (i === g.best) g.score++; g.phase = 'reveal'; g.t = 0;
      };
      g.up = g.key = () => {};
      g.draw = (c) => {
        c.fillStyle = '#161f2d'; c.fillRect(0, 0, W, H);
        timerBar(c, g.phase === 'show' ? 1 - g.t / g.limit : 0);
        txt(c, 'ROUND ' + (g.round + 1) + ' OF 10   ·   RIGHT ' + g.score, W / 2, 50, 18, GOLD);
        g.cards.forEach((cd, i) => {
          const x = 12 + i * 112, rev = g.phase === 'reveal';
          rect(c, x + 4, 90, 104, 300, rev && i === g.best ? '#1f4a35' : rev && i === g.pick ? '#4a2226' : '#1e2a3b', 10);
          c.fillStyle = env.color; c.fillRect(x + 4, 90, 104, 6);
          c.fillStyle = '#f1c9a5'; c.beginPath(); c.arc(x + 56, 134, 17, 0, 7); c.fill(); rect(c, x + 34, 154, 44, 26, env.color, 8);
          txt(c, 'PROSPECT ' + 'ABC'[i], x + 56, 200, 14, MUTED);
          ['SPD', 'HND', 'PWR'].forEach((lab, k) => {
            const y = 232 + k * 44;
            txt(c, lab, x + 14, y, 12, MUTED, 'left'); txt(c, String(cd[k]), x + 98, y, 16, TEXT, 'right');
            rect(c, x + 14, y + 12, 84, 8, '#0f1622', 4); rect(c, x + 14, y + 12, 84 * (cd[k] / 99), 8, [GOLD, '#7fd4ff', GOOD][k], 4);
          });
          if (rev) txt(c, 'TOTAL ' + sum(cd), x + 56, 372, 15, i === g.best ? GOOD : TEXT);
        });
        txt(c, g.phase === 'show' ? 'TAP THE BEST ALL-ROUND PROSPECT' : g.pick === g.best ? 'GOOD EYE' : g.pick < 0 ? 'TOO SLOW' : 'MISSED HIM', W / 2, 420, 15, g.phase === 'show' ? MUTED : g.pick === g.best ? GOOD : BAD);
      };
      return g;
    },
  };

  /** Open a game in an overlay. opts: { game, title, building, how, color, status(), onFinish(score) -> result or Promise }.
      result: { score text, medal, line, triesLeft }. */
  function open(opts) {
    const doc = root.document;
    const wrap = doc.createElement('div');
    wrap.className = 'modal mini'; wrap.id = 'mini';
    wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', opts.title);
    wrap.innerHTML = '<div class="modal-body mini-body"><div class="kicker">' + opts.building + ' mini-game</div><h2 class="mini-title">' + opts.title + '</h2><p class="fine">' + opts.how + '</p><canvas id="mini-cv" aria-label="' + opts.title + ' play area"></canvas><div id="mini-foot" class="mini-foot"></div></div>';
    doc.querySelector('.app').appendChild(wrap);
    const cv = wrap.querySelector('#mini-cv'), foot = wrap.querySelector('#mini-foot'), ctx = cv.getContext('2d');
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    let g = GAMES[opts.game]({ color: opts.color, rnd: Math.random }), playing = false, raf = 0, last = 0, closed = false;
    const paint = (dim) => { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); g.draw(ctx); if (dim) { ctx.fillStyle = 'rgba(15,22,34,.6)'; ctx.fillRect(0, 0, W, H); } };
    const loop = (now) => {
      if (closed) return;
      const dt = Math.min(0.05, (now - last) / 1000 || 0); last = now;
      if (playing) { g.update(dt); paint(false); if (g.done) return finish(); }
      raf = root.requestAnimationFrame(loop);
    };
    const start = () => { g = GAMES[opts.game]({ color: opts.color, rnd: Math.random }); playing = true; foot.innerHTML = '<p class="fine">Press Esc to quit. Quitting does not use a try.</p>'; last = root.performance.now(); raf = root.requestAnimationFrame(loop); cv.focus(); };
    const idle = () => { paint(true); foot.innerHTML = '<p class="fine">' + opts.status() + '</p><div class="row end"><button class="btn ghost" data-mini="close" id="mini-close">Close</button><button class="btn primary" data-mini="start" id="mini-start">Start</button></div>'; };
    const finish = () => {
      playing = false; paint(true);
      foot.innerHTML = '<p class="fine">Scoring…</p>';
      Promise.resolve(opts.onFinish(g.score)).then((r) => {
        if (closed) return;
        foot.innerHTML = '<div class="mini-result"><b class="' + (r.medal ? 'medal m' + r.medal : '') + '">' + r.score + '</b><span>' + r.line + '</span></div><p class="fine">' + opts.status() + '</p><div class="row end"><button class="btn ghost" data-mini="close" id="mini-close">Done</button><button class="btn primary" data-mini="start" id="mini-start">' + (r.triesLeft > 0 ? 'Try again' : 'Play for fun') + '</button></div>';
      });
    };
    const pos = (e) => { const b = cv.getBoundingClientRect(); return [((e.clientX - b.left) / b.width) * W, ((e.clientY - b.top) / b.height) * H]; };
    cv.addEventListener('pointerdown', (e) => { if (!playing) return; e.preventDefault(); const p = pos(e); g.down(p[0], p[1]); });
    const up = () => { if (playing) g.up(); };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('pointerleave', up);
    const keys = {};
    const kd = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); return close(); }
      if (!playing || keys[e.code]) return;
      const k = e.code === 'ArrowLeft' || e.code === 'KeyA' ? 'L' : e.code === 'ArrowRight' || e.code === 'KeyL' || e.code === 'KeyD' ? 'R' : e.code === 'Space' ? 'S' : null;
      if (!k) return; e.preventDefault(); keys[e.code] = 1;
      if (k === 'S') g.down(W / 2, H / 2); else g.key(k);
    };
    const ku = (e) => { delete keys[e.code]; if (e.code === 'Space' && playing) g.up(); };
    root.addEventListener('keydown', kd, true); root.addEventListener('keyup', ku, true);
    function close() {
      if (closed) return; closed = true; playing = false; root.cancelAnimationFrame(raf);
      root.removeEventListener('keydown', kd, true); root.removeEventListener('keyup', ku, true);
      wrap.remove(); if (opts.onClose) opts.onClose();
    }
    wrap.addEventListener('click', (e) => { const b = e.target.closest('[data-mini]'); if (!b) return; e.stopPropagation(); if (b.dataset.mini === 'start') start(); else close(); });
    cv.tabIndex = 0;
    idle();
    wrap.querySelector('#mini-start').focus();
    return { close };
  }

  FT.Mini = { GAMES, W, H, open };
  if (typeof module !== 'undefined' && module.exports) module.exports = FT;
})(typeof window !== 'undefined' ? window : globalThis);
