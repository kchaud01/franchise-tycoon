/* Franchise Tycoon — isometric city renderer. Everything is drawn in code on one canvas; there are no image assets. */
(function (root) {
  'use strict';
  const FT = (root.FT = root.FT || {});
  const HW = 60, HH = 30;                 // half tile width / height: a strict 2:1 isometric tile
  const G = 5;
  const VIEW = { x0: -485, x1: 485, y0: -232, y1: 486 };
  const E = 2.25;                         // the island reaches this far beyond the 5x5 district
  const P = (x, y, z) => [(x - y) * HW, (x + y) * HH - (z || 0)];

  // ---- colour helpers ----------------------------------------------------------------
  const cache = {};
  function shade(hex, amt) {
    const k = hex + amt;
    if (cache[k]) return cache[k];
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt));
    const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
    return (cache[k] = 'rgb(' + r + ',' + g + ',' + b + ')');
  }
  function hash(a, b) { let x = Math.imul(a + 1, 374761393) ^ Math.imul(b + 1, 668265263); x = Math.imul(x ^ (x >>> 13), 1274126177); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; }

  // ---- day and night ------------------------------------------------------------------
  // Every fill and stroke colour passes through tone(). At night, surfaces are darkened and cooled while light
  // sources keep their colour; by day, the same light sources read as plain glass.
  let NIGHT = false, FLOOD = false;
  const EMIT = {}, KEEP = { '#ff5a5a': 1, '#ff8a8a': 1 };
  ['#ffd685', '#ffe2a6', '#cfe9ff', '#bfe9ff', '#9fd8ff', '#fff0c4', '#fff6d6', '#fff1c2', '#ffdf9a'].forEach((h) => {
    EMIT[h] = 1; [-0.18, -0.2, -0.25].forEach((a) => (EMIT[shade(h, a)] = 2));
  });
  const toned = {};
  function tone(v) {
    if (typeof v !== 'string' || KEEP[v]) return v;
    if (EMIT[v]) return NIGHT ? v : EMIT[v] === 1 ? '#b4d6e6' : '#8fb4c8';
    if (!NIGHT || FLOOD) return v;
    if (toned[v]) return toned[v];
    let r, g, b, a = 1;
    if (v.charAt(0) === '#' && v.length === 7) { const n = parseInt(v.slice(1), 16); r = n >> 16; g = (n >> 8) & 255; b = n & 255; }
    else { const m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(v); if (!m) return v; r = +m[1]; g = +m[2]; b = +m[3]; if (m[4] != null) a = +m[4]; }
    return (toned[v] = 'rgba(' + Math.round(r * 0.36 + 5) + ',' + Math.round(g * 0.43 + 9) + ',' + Math.round(b * 0.66 + 20) + ',' + a + ')');
  }
  function hookTone(ctx) {
    ['fillStyle', 'strokeStyle'].forEach((prop) => {
      const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ctx), prop);
      if (!d || !d.set) return;
      Object.defineProperty(ctx, prop, { get() { return d.get.call(ctx); }, set(v) { d.set.call(ctx, tone(v)); } });
    });
  }

  const C = {
    grass: '#3f7d5a', grassDark: '#2f6349', earth: '#6b4a3a', asphalt: '#2c3440', line: '#c9b458',
    walk: '#b9b3a6', lot: '#4a8a62', concrete: '#9aa0a8', glass: '#5fb0c9', lit: '#ffd685', dim: '#31425c',
    cream: '#efe6d2', brick: '#a65f48', white: '#eef1f4', steel: '#6d7887', red: '#e5484d', wood: '#8a6240',
  };

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    hookTone(this.ctx);
    this.night = false;
    this.state = null;
    this.hover = null;
    this.selected = null;
    this.t = 0;
    this.particles = [];
    this.score = null;
    this.fill = 0.6;
    this.resize();
  }
  const R = Renderer.prototype;

  R.resize = function () {
    const c = this.canvas, dpr = Math.min(2, root.devicePixelRatio || 1);
    const w = c.clientWidth || 800, h = c.clientHeight || 560;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    this.w = w; this.h = h; this.dpr = dpr;
    this.base = Math.min(w / (VIEW.x1 - VIEW.x0), h / (VIEW.y1 - VIEW.y0));
    if (this.zoom == null) this.resetView(); else this.applyView();
  };
  R.resetView = function () { this.zoom = 1; this.cx = (VIEW.x0 + VIEW.x1) / 2; this.cy = (VIEW.y0 + VIEW.y1) / 2; this.applyView(); };
  R.applyView = function () {
    this.zoom = FT.clamp(this.zoom, 0.8, 3.2);
    this.cx = FT.clamp(this.cx, -560, 560); this.cy = FT.clamp(this.cy, -230, 470);
    this.scale = this.base * this.zoom;
    this.ox = this.w / 2 - this.cx * this.scale; this.oy = this.h / 2 - this.cy * this.scale;
  };
  /** Zoom by a factor, keeping the canvas point (px, py) fixed when given. */
  R.zoomBy = function (f, px, py) {
    const sx = px == null ? this.cx : (px - this.ox) / this.scale, sy = py == null ? this.cy : (py - this.oy) / this.scale;
    const z0 = this.zoom; this.zoom = FT.clamp(z0 * f, 0.8, 3.2);
    const k = this.zoom / z0;
    this.cx = sx - (sx - this.cx) / k; this.cy = sy - (sy - this.cy) / k;
    this.applyView();
  };
  R.panBy = function (dx, dy) { this.cx -= dx / this.scale; this.cy -= dy / this.scale; this.applyView(); };

  /** Canvas client coordinates -> lot key ('r-c'), 'stadium', or null. Tall buildings are hit by their silhouette. */
  R.pick = function (cx, cy) {
    const sx = (cx - this.ox) / this.scale, sy = (cy - this.oy) / this.scale;
    const cell = (y) => { const a = sx / HW, b = y / HH; return [Math.floor((b - a) / 2), Math.floor((a + b) / 2)]; };
    let best = null;
    for (let z = 0; z <= 120; z += 6) {
      const [r, c] = cell(sy + z);
      if (r < 0 || c < 0 || r >= G || c >= G) continue;
      const k = r + '-' + c;
      const h = FT.isStadium(k) ? 14 : this.state && this.state.grid[k] ? heightOf(this.state.grid[k]) : 0;
      if (z <= h && (!best || r + c > best.d)) best = { k: FT.isStadium(k) ? 'stadium' : k, d: r + c };
    }
    return best ? best.k : null;
  };
  function heightOf(b) {
    const h = { suites: [56, 74, 94], media: [58, 76, 96], scouting: [36, 48, 62], medical: [30, 38, 50], retail: [28, 36, 46], concessions: [20, 22, 32], transit: [8, 22, 36], fanzone: [24, 40, 48] };
    return h[b.type][b.level - 1];
  }

  // ---- drawing primitives ---------------------------------------------------------------
  function poly(ctx, pts, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }
  /** A cuboid on the ground plane. x,y = back corner (grid units), w,d = footprint, z = base height, h = height (px). */
  function box(ctx, x, y, w, d, z, h, col, o) {
    o = o || {};
    const top = o.top || shade(col, 0.2), left = o.left || col, right = o.right || shade(col, -0.28);
    poly(ctx, [P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)], left);
    poly(ctx, [P(x + w, y + d, z), P(x + w, y, z), P(x + w, y, z + h), P(x + w, y + d, z + h)], right);
    poly(ctx, [P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)], top);
  }
  /** A rectangle on the left (L) or right (R) visible wall of a box. u0..u1 across the wall (0..1), v0..v1 px above the base. */
  function wallRect(ctx, side, x, y, w, d, z, u0, u1, v0, v1, fill) {
    const q = side === 'L'
      ? [P(x + w * u0, y + d, z + v0), P(x + w * u1, y + d, z + v0), P(x + w * u1, y + d, z + v1), P(x + w * u0, y + d, z + v1)]
      : [P(x + w, y + d * (1 - u0), z + v0), P(x + w, y + d * (1 - u1), z + v0), P(x + w, y + d * (1 - u1), z + v1), P(x + w, y + d * (1 - u0), z + v1)];
    poly(ctx, q, fill);
  }
  /** Rows of windows on both visible walls. Lit windows are chosen by a stable hash so they do not flicker. */
  function windows(ctx, x, y, w, d, z, h, o) {
    const rows = o.rows, cols = o.cols, seed = o.seed || 1;
    const v0 = o.base == null ? 5 : o.base, vh = (h - v0 - (o.cap == null ? 4 : o.cap)) / rows;
    ['L', 'R'].forEach((side, si) => {
      const n = side === 'L' ? cols : Math.max(1, Math.round((cols * d) / w));
      for (let r = 0; r < rows; r++) for (let c = 0; c < n; c++) {
        const lit = hash(seed * 31 + si * 7 + r, c) < (o.litRate == null ? 0.62 : o.litRate);
        const u0 = (c + 0.2) / n, u1 = (c + 0.8) / n;
        wallRect(ctx, side, x, y, w, d, z, u0, u1, v0 + r * vh + vh * 0.2, v0 + r * vh + vh * 0.8,
          lit ? (side === 'L' ? o.lit || C.lit : shade(o.lit || C.lit, -0.18)) : (side === 'L' ? C.dim : shade(C.dim, -0.2)));
      }
    });
  }
  /** Text painted flat on a wall: skewed to follow the isometric edge. */
  function wallText(ctx, side, x, y, z, text, size, fill) {
    const [px, py] = side === 'L' ? P(x, y, z) : P(x, y, z);
    ctx.save();
    ctx.transform(1, side === 'L' ? 0.5 : -0.5, 0, 1, px, py);
    ctx.font = '700 ' + size + 'px "Barlow Condensed", "Arial Narrow", sans-serif';
    ctx.fillStyle = fill; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  function ellipse(ctx, x, y, rx, ry, fill, stroke, lw) {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
  }
  function glow(ctx, x, y, r, col, a) {
    if (!NIGHT) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save(); ctx.globalAlpha = a == null ? 0.6 : a; ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore();
  }
  function tree(ctx, x, y, s) {
    s = s || 1;
    const [px, py] = P(x, y, 0);
    ellipse(ctx, px + 2, py + 1, 8 * s, 4 * s, 'rgba(0,0,0,.22)');
    ctx.fillStyle = '#5a4030'; ctx.fillRect(px - 1.5 * s, py - 9 * s, 3 * s, 10 * s);
    ellipse(ctx, px, py - 14 * s, 9 * s, 10 * s, '#2c6b48');
    ellipse(ctx, px - 2 * s, py - 18 * s, 6.5 * s, 7 * s, '#3f8f5d');
    ellipse(ctx, px - 3.5 * s, py - 21 * s, 3 * s, 3 * s, '#62ad74');
  }
  function car(ctx, x, y, along, col) {
    const w = along === 'x' ? 0.2 : 0.1, d = along === 'x' ? 0.1 : 0.2;
    box(ctx, x - w / 2, y - d / 2, w, d, 1, 4, col);
    box(ctx, x - w / 4, y - d / 4, w / 2, d / 2, 5, 3, '#23303f');
  }
  function awning(ctx, x, y, w, d, z, colA, colB, n) {
    for (let i = 0; i < n; i++) box(ctx, x + (w * i) / n, y, w / n, d, z, 2.5, i % 2 ? colB : colA);
  }
  function umbrella(ctx, x, y, col) {
    const [px, py] = P(x, y, 0);
    ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - 11); ctx.stroke();
    poly(ctx, [[px - 8, py - 9], [px, py - 15], [px + 8, py - 9], [px, py - 6]], col);
    poly(ctx, [[px, py - 15], [px + 8, py - 9], [px, py - 6]], shade(col, -0.25));
  }

  // ---- buildings -----------------------------------------------------------------------
  // Each takes the lot's back corner (gx = column, gy = row) and draws inside the unit tile.
  const DRAW = {
    concessions(ctx, gx, gy, lv, S) {
      const team = S.color, stalls = lv === 1 ? [[0.14, 0.5], [0.54, 0.5]] : [[0.1, 0.56], [0.4, 0.56], [0.7, 0.56]];
      if (lv === 3) {
        box(ctx, gx + 0.14, gy + 0.12, 0.72, 0.4, 2, 24, C.cream);
        windows(ctx, gx + 0.14, gy + 0.12, 0.72, 0.4, 2, 24, { rows: 1, cols: 5, seed: gx * 9 + gy, base: 6, cap: 8, litRate: 1 });
        awning(ctx, gx + 0.1, gy + 0.08, 0.8, 0.5, 26, team, C.white, 8);
        box(ctx, gx + 0.3, gy + 0.26, 0.4, 0.04, 28.5, 10, '#22303d');
        wallText(ctx, 'L', gx + 0.33, gy + 0.3, 30, 'EATS', 9, C.lit);
      }
      stalls.forEach(([x, y], i) => {
        const w = lv === 1 ? 0.3 : 0.22;
        box(ctx, gx + x, gy + y, w, 0.24, 2, 12, i % 2 ? '#e9dcc0' : C.cream);
        wallRect(ctx, 'L', gx + x, gy + y, w, 0.24, 2, 0.12, 0.88, 4, 10, C.lit);
        awning(ctx, gx + x - 0.03, gy + y - 0.02, w + 0.06, 0.34, 14, i % 2 ? '#f2b33d' : team, C.white, 4);
      });
      if (lv >= 2) { umbrella(ctx, gx + 0.2, gy + 0.3, team); umbrella(ctx, gx + 0.82, gy + 0.36, '#f2b33d'); }
      if (lv === 1) umbrella(ctx, gx + 0.5, gy + 0.26, '#f2b33d');
    },
    transit(ctx, gx, gy, lv, S, t) {
      const cols = ['#d9534f', '#e8e2d0', '#4f8fd9', '#f2b33d', '#7a8794', '#3aa88f'];
      const cars = (z, seed) => {
        for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
          if (hash(seed + i, j + gx * 3 + gy) < 0.25) continue;
          const col = cols[Math.floor(hash(i + seed, j + gy) * cols.length)];
          box(ctx, gx + 0.17 + i * 0.17, gy + 0.2 + j * 0.34, 0.1, 0.18, z, 4, col);
        }
      };
      if (lv === 1) {
        box(ctx, gx + 0.1, gy + 0.1, 0.8, 0.8, 2, 1.5, '#343d4a');
        ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) { const a = P(gx + 0.15 + i * 0.17, gy + 0.18, 3.5), b = P(gx + 0.15 + i * 0.17, gy + 0.74, 3.5); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
        cars(3.5, 1);
        box(ctx, gx + 0.12, gy + 0.8, 0.26, 0.08, 3.5, 9, '#4f8fd9');
      } else {
        const decks = lv === 2 ? 2 : 3;
        for (let i = 0; i < decks; i++) {
          const z = 2 + i * 10;
          box(ctx, gx + 0.1, gy + 0.1, 0.8, 0.8, z, 10, C.concrete);
          wallRect(ctx, 'L', gx + 0.1, gy + 0.1, 0.8, 0.8, z, 0.04, 0.96, 2, 7, '#1f2731');
          wallRect(ctx, 'R', gx + 0.1, gy + 0.1, 0.8, 0.8, z, 0.04, 0.96, 2, 7, '#171d25');
          for (let c = 1; c < 5; c++) { wallRect(ctx, 'L', gx + 0.1, gy + 0.1, 0.8, 0.8, z, c / 5 - 0.012, c / 5 + 0.012, 2, 7, C.concrete); wallRect(ctx, 'R', gx + 0.1, gy + 0.1, 0.8, 0.8, z, c / 5 - 0.012, c / 5 + 0.012, 2, 7, shade(C.concrete, -0.28)); }
        }
        cars(2 + decks * 10, lv);
        if (lv === 3) {
          box(ctx, gx + 0.1, gy + 0.1, 0.3, 0.3, 32, 9, '#4f8fd9');
          wallText(ctx, 'L', gx + 0.14, gy + 0.4, 33, 'RAIL', 8, C.white);
          const slide = ((t * 0.05) % 1.6) - 0.3;
          if (slide > 0 && slide < 0.62) { box(ctx, gx + slide, gy + 0.93, 0.34, 0.07, 2, 8, S.color); wallRect(ctx, 'L', gx + slide, gy + 0.93, 0.34, 0.07, 2, 0.06, 0.94, 3.5, 6.5, C.lit); }
        }
      }
    },
    retail(ctx, gx, gy, lv, S) {
      const h = [26, 34, 44][lv - 1], x = gx + 0.16, y = gy + 0.18, w = 0.68, d = 0.62;
      box(ctx, x, y, w, d, 2, h, '#d9d2c2');
      wallRect(ctx, 'L', x, y, w, d, 2, 0.06, 0.94, 2, 13, C.lit);
      wallRect(ctx, 'R', x, y, w, d, 2, 0.06, 0.94, 2, 13, shade(C.lit, -0.2));
      wallRect(ctx, 'L', x, y, w, d, 2, 0.44, 0.56, 2, 13, '#7a5a3a');
      if (lv > 1) windows(ctx, x, y, w, d, 2, h, { rows: lv - 1, cols: 4, seed: gx + gy * 5, base: 19, cap: 4 });
      box(ctx, x - 0.02, y + d, w + 0.04, 0.08, 15, 2.5, S.color);
      box(ctx, x + w, y - 0.02, 0.08, d + 0.04, 15, 2.5, shade(S.color, -0.2));
      box(ctx, x + 0.1, y + 0.28, w - 0.2, 0.05, h + 2, 12, S.color);
      wallText(ctx, 'L', x + 0.15, y + 0.33, h + 5, 'TEAM STORE', 7.5, C.white);
    },
    suites(ctx, gx, gy, lv, S) {
      const h = [44, 62, 80][lv - 1], x = gx + 0.22, y = gy + 0.22, w = 0.56;
      box(ctx, gx + 0.14, gy + 0.14, 0.72, 0.72, 2, 7, '#3b4656');
      box(ctx, x, y, w, w, 9, h, '#3f7f98', { top: '#2a3a4a' });
      windows(ctx, x, y, w, w, 9, h, { rows: Math.round(h / 9), cols: 4, seed: gx * 3 + gy * 11, base: 3, cap: 3, lit: '#ffe2a6', litRate: 0.7 });
      box(ctx, x - 0.02, y - 0.02, w + 0.04, w + 0.04, 9 + h, 3, '#d8b45a');
      if (lv >= 2) box(ctx, x + 0.16, y + 0.16, 0.24, 0.24, 12 + h, 6, '#2a3a4a');
      if (lv === 3) { const a = P(x + 0.28, y + 0.28, 18 + h); ctx.strokeStyle = '#d8b45a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0], a[1] - 16); ctx.stroke(); glow(ctx, a[0], a[1] - 16, 7, '#ffd685', 0.9); }
    },
    medical(ctx, gx, gy, lv) {
      const h = [26, 34, 46][lv - 1], x = gx + 0.16, y = gy + 0.2, w = 0.68, d = 0.5;
      if (lv >= 2) { box(ctx, gx + 0.56, gy + 0.56, 0.3, 0.32, 2, 16, '#dfe5ea'); windows(ctx, gx + 0.56, gy + 0.56, 0.3, 0.32, 2, 16, { rows: 1, cols: 2, seed: 5, lit: '#bfe9ff' }); }
      box(ctx, x, y, w, d, 2, h, C.white);
      windows(ctx, x, y, w, d, 2, h, { rows: lv + 1, cols: 5, seed: gx * 7 + gy, lit: '#bfe9ff', litRate: 0.75 });
      wallRect(ctx, 'L', x, y, w, d, 2, 0.4, 0.6, 0, 9, '#4a6a85');
      const cx = x + w / 2, cy = y + d / 2, z = h + 2.3;
      if (lv === 3) {
        const c = P(cx, cy, z); ellipse(ctx, c[0], c[1], 17, 8.5, '#3d4957', '#f2b33d', 1.5);
        ctx.save(); ctx.font = '700 10px "Barlow Condensed", sans-serif'; ctx.fillStyle = C.white; ctx.textAlign = 'center'; ctx.fillText('H', c[0], c[1] + 3.5); ctx.restore();
      } else {
        poly(ctx, [P(cx - 0.16, cy - 0.05, z), P(cx + 0.16, cy - 0.05, z), P(cx + 0.16, cy + 0.05, z), P(cx - 0.16, cy + 0.05, z)], C.red);
        poly(ctx, [P(cx - 0.05, cy - 0.16, z), P(cx + 0.05, cy - 0.16, z), P(cx + 0.05, cy + 0.16, z), P(cx - 0.05, cy + 0.16, z)], C.red);
      }
      box(ctx, x + 0.04, y + d, 0.14, 0.02, 14, 8, C.red);
    },
    scouting(ctx, gx, gy, lv, S, t) {
      const h = [32, 44, 58][lv - 1], x = gx + 0.18, y = gy + 0.2, w = 0.64, d = 0.56;
      box(ctx, x - 0.03, y - 0.03, w + 0.06, d + 0.06, 2, 5, '#c9c2b2');
      box(ctx, x, y, w, d, 7, h - 5, C.brick);
      windows(ctx, x, y, w, d, 7, h - 5, { rows: lv + 1, cols: 4, seed: gx + gy * 13, base: 4, cap: 4 });
      box(ctx, x - 0.02, y - 0.02, w + 0.04, d + 0.04, h + 2, 2.5, '#c9c2b2');
      wallRect(ctx, 'L', x, y, w, d, 2, 0.42, 0.58, 0, 10, '#3d2a22');
      const p = P(x + 0.12, y + 0.12, h + 4.5);
      ctx.strokeStyle = '#d7dbe0'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0], p[1] - 20); ctx.stroke();
      const wv = Math.sin(t * 0.25) * 1.5;
      poly(ctx, [[p[0], p[1] - 20], [p[0] + 12, p[1] - 18 + wv], [p[0] + 12, p[1] - 11 + wv], [p[0], p[1] - 13]], S.color);
      if (lv === 3) { const c = P(x + w / 2, y + d, h - 6); ellipse(ctx, c[0], c[1] + 0, 5, 5, C.cream, '#3d2a22', 1); }
    },
    media(ctx, gx, gy, lv, S, t) {
      const th = [56, 74, 94][lv - 1];
      box(ctx, gx + 0.14, gy + 0.3, 0.72, 0.52, 2, 16 + lv * 3, '#55606f');
      windows(ctx, gx + 0.14, gy + 0.3, 0.72, 0.52, 2, 16 + lv * 3, { rows: 1, cols: 5, seed: gx * 5 + gy * 3, base: 5, cap: 5, lit: '#9fd8ff' });
      if (lv >= 2) { wallRect(ctx, 'R', gx + 0.14, gy + 0.3, 0.72, 0.52, 2, 0.15, 0.85, 4, 17, '#0d1620'); wallRect(ctx, 'R', gx + 0.14, gy + 0.3, 0.72, 0.52, 2, 0.19, 0.81, 6, 15, Math.floor(t / 14) % 2 ? S.color : '#3fa7d6'); }
      const d = P(gx + 0.7, gy + 0.62, 20 + lv * 3);
      ellipse(ctx, d[0], d[1] - 3, 7, 5, '#dfe5ea', '#8a95a3', 1);
      // lattice mast
      const base = [P(gx + 0.24, gy + 0.36, 0), P(gx + 0.44, gy + 0.36, 0), P(gx + 0.34, gy + 0.5, 0)];
      const tip = P(gx + 0.34, gy + 0.42, th);
      ctx.strokeStyle = '#c5ccd6'; ctx.lineWidth = 1.2;
      base.forEach((b) => { ctx.beginPath(); ctx.moveTo(b[0], b[1] - 18); ctx.lineTo(tip[0], tip[1]); ctx.stroke(); });
      ctx.lineWidth = 0.8;
      for (let i = 1; i < 7; i++) {
        const f = i / 7, q = base.map((b) => [b[0] + (tip[0] - b[0]) * f, b[1] - 18 + (tip[1] - b[1] + 18) * f]);
        ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); ctx.lineTo(q[1][0], q[1][1]); ctx.lineTo(q[2][0], q[2][1]); ctx.closePath(); ctx.stroke();
      }
      if (Math.floor(t / 10) % 2) glow(ctx, tip[0], tip[1], 9, '#ff5a5a', 1);
      ellipse(ctx, tip[0], tip[1], 1.6, 1.6, '#ff5a5a');
    },
    fanzone(ctx, gx, gy, lv, S, t, R) {
      box(ctx, gx + 0.08, gy + 0.08, 0.84, 0.84, 2, 1, '#cbbfa6');
      const c = P(gx + 0.56, gy + 0.6, 3);
      ellipse(ctx, c[0], c[1], 13, 6.5, '#8fa3ad'); ellipse(ctx, c[0], c[1], 10.5, 5.2, '#4fb4d8'); ellipse(ctx, c[0], c[1] - 1.5, 3.5, 1.8, '#d5f1fb');
      tree(ctx, gx + 0.2, gy + 0.22, 0.8);
      if (lv >= 2) {
        box(ctx, gx + 0.3, gy + 0.14, 0.5, 0.05, 3, 30, '#1a222c');
        wallRect(ctx, 'L', gx + 0.3, gy + 0.14, 0.5, 0.05, 3, 0.05, 0.95, 8, 28, S.color);
        if (R.score) wallText(ctx, 'L', gx + 0.36, gy + 0.19, 14, R.score, 10, C.white);
        glow(ctx, P(gx + 0.55, gy + 0.3, 20)[0], P(gx + 0.55, gy + 0.3, 20)[1], 26, S.color, 0.35);
      }
      tree(ctx, gx + 0.2, gy + 0.78, 0.8);
      if (lv === 3) {
        box(ctx, gx + 0.66, gy + 0.72, 0.2, 0.16, 3, 9, C.white); awning(ctx, gx + 0.63, gy + 0.69, 0.26, 0.22, 12, S.color, C.white, 4);
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 0.8;
        const a = P(gx + 0.1, gy + 0.9, 26), b = P(gx + 0.9, gy + 0.9, 26);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 10, b[0], b[1]); ctx.stroke();
        for (let i = 1; i < 8; i++) { const f = i / 8, x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f + Math.sin(f * Math.PI) * 5; ellipse(ctx, x, y, 1.6, 1.6, i % 2 ? '#ffd685' : S.color); }
        [a, b].forEach((q) => { ctx.strokeStyle = '#8a95a3'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(q[0], q[1] + 24); ctx.stroke(); });
      }
    },
  };

  R.drawLot = function (ctx, r, c) {
    const k = r + '-' + c, b = this.state.grid[k], gx = c, gy = r, m = 0.06;
    const isSel = this.selected === k, isHov = this.hover === k;
    box(ctx, gx + m, gy + m, 1 - 2 * m, 1 - 2 * m, 0, 2, b ? C.walk : C.lot, b ? null : { top: isHov || isSel ? '#62ad7a' : C.lot, left: '#3a7350', right: '#2c5a40' });
    if (!b) {
      const q = [P(gx + 0.16, gy + 0.16, 2), P(gx + 0.84, gy + 0.16, 2), P(gx + 0.84, gy + 0.84, 2), P(gx + 0.16, gy + 0.84, 2)];
      ctx.save(); ctx.setLineDash([4, 4]); poly(ctx, q, null, isSel ? '#fff' : 'rgba(255,255,255,.28)'); ctx.restore();
      if (hash(r, c) < 0.4) tree(ctx, gx + 0.3, gy + 0.3, 0.55);
    } else {
      DRAW[b.type](ctx, gx, gy, b.level, this.state, this.t, this);
    }
    if (isSel || isHov) {
      const q = [P(gx + m, gy + m, 2), P(gx + 1 - m, gy + m, 2), P(gx + 1 - m, gy + 1 - m, 2), P(gx + m, gy + 1 - m, 2)];
      ctx.save(); ctx.lineWidth = 2; ctx.globalAlpha = isSel ? 1 : 0.55;
      ctx.beginPath(); q.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath();
      ctx.strokeStyle = '#fff'; ctx.stroke();
      if (b) { ctx.globalAlpha = 0.12; ctx.fillStyle = '#fff'; ctx.fill(); }
      ctx.restore();
    }
  };

  R.drawStadium = function (ctx) {
    const S = this.state, lv = S.stadium, t = this.t;
    const [cx, cy] = P(2, 2, 3);
    const a = 99, b = 40.5, H = [15, 19, 23, 27, 31][lv - 1], ai = 65, bi = 25;
    const sel = this.selected === 'stadium' || this.hover === 'stadium';
    // plaza
    poly(ctx, [P(1.04, 1.04, 2), P(2.96, 1.04, 2), P(2.96, 2.96, 2), P(1.04, 2.96, 2)], sel ? '#c9c4b8' : '#aaa598');
    ellipse(ctx, cx, cy + 4, a + 5, b + 4, 'rgba(0,0,0,.25)');
    // far-side light towers and roof go behind the bowl
    const towers = lv >= 2 ? [[-a * 0.72, -b * 0.62], [a * 0.72, -b * 0.62]] : [];
    const tower = (dx, dy) => {
      const x = cx + dx, y = cy + dy, top = y - H - 46 - lv * 3;
      ctx.strokeStyle = '#aab3bf'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y - H + 4); ctx.lineTo(x, top); ctx.stroke();
      ctx.fillStyle = '#e9edf2'; ctx.fillRect(x - 8, top - 6, 16, 8);
      ctx.fillStyle = '#fff6d6'; for (let i = 0; i < 4; i++) ctx.fillRect(x - 7 + i * 4, top - 5, 3, 6);
      glow(ctx, x, top - 2, 22, '#fff1c2', 0.4);
    };
    towers.forEach((p) => tower(p[0], p[1]));
    // seating bowl seen through the rim
    const ry = cy - H;
    ctx.save();
    ctx.beginPath(); ctx.ellipse(cx, ry, a, b, 0, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#39465a'; ctx.fillRect(cx - a, ry - b, a * 2, b * 2 + H);
    for (let i = 0; i <= 6; i++) {
      const f = i / 6;
      ellipse(ctx, cx, ry + (cy - 2 - ry) * f, a + (ai - a) * f, b + (bi - b) * f, i % 2 ? '#445369' : '#3b485c');
    }
    // the crowd: one dot per seat block, filled by attendance
    const dots = 700, fillTo = this.fill;
    for (let i = 0; i < dots; i++) {
      if (hash(i, 3) > fillTo) continue;
      const f = 0.06 + hash(i, 1) * 0.86, th = hash(i, 2) * Math.PI * 2;
      const ex = cx + Math.cos(th) * (a + (ai - a) * f), ey = ry + (cy - 2 - ry) * f + Math.sin(th) * (b + (bi - b) * f);
      const pick = hash(i, 5);
      ctx.fillStyle = pick < 0.5 ? S.color : pick < 0.8 ? '#f1ede3' : '#1d2632';
      const bob = this.gameDay ? Math.sin(t * 0.5 + i) * 0.7 : 0;
      ctx.fillRect(ex - 1, ey - 1 + bob, 2, 2);
    }
    // field
    ellipse(ctx, cx, cy - 2, ai, bi, '#2c5d43');
    const fw = 49, fh = 12, fy = cy - 2;
    ctx.fillStyle = '#3f9a5c'; ctx.fillRect(cx - fw, fy - fh, fw * 2, fh * 2);
    for (let i = 0; i < 10; i++) { if (i % 2) { ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fillRect(cx - fw + 9 + i * 8, fy - fh, 8, fh * 2); } }
    ctx.fillStyle = S.color; ctx.fillRect(cx - fw, fy - fh, 9, fh * 2); ctx.fillRect(cx + fw - 9, fy - fh, 9, fh * 2);
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 0.8; ctx.strokeRect(cx - fw, fy - fh, fw * 2, fh * 2);
    for (let i = 1; i < 10; i++) { ctx.beginPath(); ctx.moveTo(cx - fw + 9 + i * 8, fy - fh); ctx.lineTo(cx - fw + 9 + i * 8, fy + fh); ctx.globalAlpha = i === 5 ? 0.9 : 0.4; ctx.stroke(); }
    ctx.globalAlpha = 1;
    ellipse(ctx, cx, fy, 4, 2, null, 'rgba(255,255,255,.8)', 0.8);
    ctx.restore();
    // near-side outer wall (a half cylinder from the rim down to the plaza)
    const wall = ctx.createLinearGradient(cx - a, 0, cx + a, 0);
    wall.addColorStop(0, '#c7ccd3'); wall.addColorStop(0.5, '#9aa1ab'); wall.addColorStop(1, '#646c78');
    ctx.beginPath(); ctx.ellipse(cx, ry, a, b, 0, 0, Math.PI, false); ctx.ellipse(cx, cy, a, b, 0, Math.PI, 0, true); ctx.closePath();
    ctx.fillStyle = wall; ctx.fill();
    // concourse lights and pillars
    ctx.save();
    ctx.beginPath(); ctx.ellipse(cx, ry, a, b, 0, 0, Math.PI, false); ctx.ellipse(cx, cy, a, b, 0, Math.PI, 0, true); ctx.closePath(); ctx.clip();
    ctx.setLineDash([5, 4]); ctx.lineWidth = Math.max(3, H * 0.28);
    ellipse(ctx, cx, ry + H * 0.55, a - 0.5, b - 0.5, null, 'rgba(255,214,133,.9)', ctx.lineWidth);
    ctx.setLineDash([]);
    ctx.lineWidth = 3; ellipse(ctx, cx, cy - 1.5, a, b, null, S.color, 3);
    ctx.restore();
    // rim
    ellipse(ctx, cx, ry, a, b, null, '#e6e9ee', 2.5);
    if (lv >= 3) {
      // canopy over the far stands
      ctx.beginPath(); ctx.ellipse(cx, ry - 9, a + 4, b + 3, 0, Math.PI * 1.04, Math.PI * 1.96, false);
      ctx.ellipse(cx, ry - 4, a - 14 - lv * 3, b - 8 - lv * 2, 0, Math.PI * 1.96, Math.PI * 1.04, true); ctx.closePath();
      ctx.fillStyle = lv >= 5 ? 'rgba(238,241,244,.92)' : 'rgba(215,221,229,.85)'; ctx.fill();
      ctx.strokeStyle = S.color; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // scoreboard at the far end
    const sx = cx, sy = ry - b - 12 - (lv >= 3 ? 6 : 0);
    ctx.fillStyle = '#7a8491'; ctx.fillRect(sx - 20, sy + 12, 2, 12); ctx.fillRect(sx + 18, sy + 12, 2, 12);
    ctx.fillStyle = '#10171f'; ctx.fillRect(sx - 27, sy - 4, 54, 18);
    ctx.strokeStyle = '#8a95a3'; ctx.lineWidth = 1; ctx.strokeRect(sx - 27, sy - 4, 54, 18);
    ctx.font = '700 12px "Barlow Condensed", "Arial Narrow", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd685'; ctx.fillText(this.score || 'KICKOFF', sx, sy + 5.5);
    // near-side towers stand in front of the bowl
    if (lv >= 4) [[-a * 0.86, b * 0.3], [a * 0.86, b * 0.3]].forEach((p) => tower(p[0], p[1] + H));
    if (lv === 1) glow(ctx, cx, cy - 10, 70, '#fff1c2', 0.12); else glow(ctx, cx, cy - 6, 95, '#fff1c2', 0.16 + lv * 0.03);
  };

  // ---- the town around the district (scenery only) -----------------------------------------
  function gable(ctx, x, y, w, d, z, h, roof, wall) {
    poly(ctx, [P(x, y, z), P(x + w, y, z), P(x + w, y + d / 2, z + h), P(x, y + d / 2, z + h)], shade(roof, -0.4));
    poly(ctx, [P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d / 2, z + h), P(x, y + d / 2, z + h)], roof);
    poly(ctx, [P(x + w, y + d, z), P(x + w, y, z), P(x + w, y + d / 2, z + h)], shade(wall, -0.28));
  }
  function house(ctx, x, y, wall, roof, seed) {
    const w = 0.26, d = 0.24;
    box(ctx, x, y, w, d, 2, 10, wall);
    wallRect(ctx, 'L', x, y, w, d, 2, 0.12, 0.42, 3, 8, hash(seed, 1) < 0.7 ? C.lit : C.dim);
    wallRect(ctx, 'L', x, y, w, d, 2, 0.6, 0.82, 0, 7, '#5a4030');
    wallRect(ctx, 'R', x, y, w, d, 2, 0.3, 0.7, 3, 8, hash(seed, 2) < 0.6 ? shade(C.lit, -0.18) : shade(C.dim, -0.2));
    gable(ctx, x - 0.02, y - 0.02, w + 0.04, d + 0.04, 12, 8, roof, wall);
  }
  function bench(ctx, x, y) { box(ctx, x, y, 0.1, 0.04, 2, 2.5, C.wood); }
  function lamp(ctx, x, y) {
    const p = P(x, y, 0);
    ctx.strokeStyle = '#7d8896'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0], p[1] - 15); ctx.stroke();
    ellipse(ctx, p[0], p[1] - 15.5, 1.7, 1.7, '#fff1c2');
    glow(ctx, p[0], p[1] - 14, 11, '#ffdf9a', 0.5);
  }
  const SKIN = ['#f1c9a5', '#c68e62', '#8d5a3b', '#e0ac7e'];
  const SHIRT = ['#e4572e', '#f2b33d', '#4f8fd9', '#3aa88f', '#e8e2d0', '#b06ab3', '#d9436b', '#7fb8e6'];
  function person(ctx, x, y, i, t) {
    const p = P(x, y, 0), step = Math.sin(t * 0.6 + i * 2.1) > 0 ? 1 : 0;
    ctx.fillStyle = '#27303c'; ctx.fillRect(p[0] - 1.3, p[1] - 3, 1.1, 3 - step * 0.8); ctx.fillRect(p[0] + 0.2, p[1] - 3, 1.1, 2.2 + step * 0.8);
    ctx.fillStyle = SHIRT[i % SHIRT.length]; ctx.fillRect(p[0] - 1.5, p[1] - 7.4, 3, 4.6);
    ellipse(ctx, p[0], p[1] - 8.8, 1.5, 1.5, SKIN[i % SKIN.length]);
  }

  const TOWN = {
    office(ctx, gx, gy, v) {
      const col = ['#4a7f99', '#6c7396', '#8b7d70', '#3f8f8a'][v % 4], h = 54 + ((v * 7) % 4) * 11;
      box(ctx, gx + 0.1, gy + 0.1, 0.8, 0.8, 2, 8, '#3b4656');
      wallRect(ctx, 'L', gx + 0.1, gy + 0.1, 0.8, 0.8, 2, 0.1, 0.9, 1.5, 6.5, C.lit);
      box(ctx, gx + 0.18, gy + 0.18, 0.64, 0.64, 10, h, col, { top: '#2a3a4a' });
      windows(ctx, gx + 0.18, gy + 0.18, 0.64, 0.64, 10, h, { rows: Math.round(h / 8), cols: 5, seed: v * 13 + 3, base: 3, cap: 3, litRate: 0.5, lit: v % 2 ? '#ffe2a6' : '#cfe9ff' });
      box(ctx, gx + 0.36, gy + 0.36, 0.26, 0.26, 10 + h, 5, '#55606f');
      if (v % 2) { const a = P(gx + 0.5, gy + 0.5, 15 + h); ctx.strokeStyle = '#c5ccd6'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0], a[1] - 12); ctx.stroke(); }
    },
    apartments(ctx, gx, gy, v) {
      const col = ['#b98a6a', '#9c8f86', '#c2a07a'][v % 3], h = 38 + (v % 2) * 12, x = gx + 0.14, y = gy + 0.18, w = 0.72, d = 0.62;
      box(ctx, x, y, w, d, 2, h, col);
      windows(ctx, x, y, w, d, 2, h, { rows: Math.round(h / 10), cols: 4, seed: v * 5 + 11, base: 9, cap: 3, litRate: 0.6 });
      wallRect(ctx, 'L', x, y, w, d, 2, 0.42, 0.58, 0, 7, '#3d2a22');
      box(ctx, x - 0.02, y - 0.02, w + 0.04, d + 0.04, h + 2, 2, shade(col, 0.25));
      box(ctx, x + 0.14, y + 0.16, 0.14, 0.14, h + 4, 9, '#7a5a3a');
    },
    cityhall(ctx, gx, gy, v, S, t) {
      box(ctx, gx + 0.04, gy + 0.08, 0.92, 0.88, 2, 2.5, '#d9d3c4');
      box(ctx, gx + 0.09, gy + 0.11, 0.82, 0.78, 4.5, 2.5, '#cfc8b8');
      const x = gx + 0.14, y = gy + 0.14, w = 0.72, d = 0.62, z = 7, h = 26;
      box(ctx, x, y, w, d, z, h, '#e6dfcc');
      wallRect(ctx, 'L', x, y, w, d, z, 0.05, 0.95, 1, 21, '#7f7765');
      for (let c = 0; c < 7; c++) wallRect(ctx, 'L', x, y, w, d, z, (c + 0.2) / 7, (c + 0.62) / 7, 1, 21, '#f8f3e4');
      wallRect(ctx, 'L', x, y, w, d, z, 0.44, 0.56, 1, 13, '#5a4030');
      for (let c = 0; c < 4; c++) for (let r = 0; r < 2; r++) wallRect(ctx, 'R', x, y, w, d, z, (c + 0.25) / 4, (c + 0.75) / 4, 4 + r * 10, 10 + r * 10, shade(C.lit, -0.18));
      box(ctx, x - 0.02, y - 0.02, w + 0.04, d + 0.04, z + h, 2.5, '#cfc8b8');
      poly(ctx, [P(x, y + d + 0.02, z + h + 2.5), P(x + w, y + d + 0.02, z + h + 2.5), P(x + w / 2, y + d + 0.02, z + h + 14)], '#f1ecdc', '#a59d8a');
      const c = P(x + w / 2, y + d / 2 - 0.04, z + h + 2.5);
      ctx.fillStyle = '#d9d3c4'; ctx.fillRect(c[0] - 14, c[1] - 9, 28, 9); ellipse(ctx, c[0], c[1], 14, 7, '#c9c2b2');
      ctx.beginPath(); ctx.ellipse(c[0], c[1] - 9, 14, 15, 0, Math.PI, 0); ctx.closePath(); ctx.fillStyle = '#6fae9a'; ctx.fill();
      ctx.beginPath(); ctx.ellipse(c[0] + 4, c[1] - 9, 10, 15, 0, Math.PI * 1.5, 0); ctx.lineTo(c[0] + 4, c[1] - 9); ctx.closePath(); ctx.fillStyle = 'rgba(0,0,0,.16)'; ctx.fill();
      ellipse(ctx, c[0], c[1] - 9, 14, 7, '#7dbba7');
      ctx.fillStyle = '#e6dfcc'; ctx.fillRect(c[0] - 2, c[1] - 30, 4, 7);
      ellipse(ctx, c[0], c[1] - 31, 2.2, 2.2, '#ffd685'); glow(ctx, c[0], c[1] - 31, 9, '#ffd685', 0.7);
      const f = P(x + 0.08, y + d - 0.06, z + h + 2.5), wv = Math.sin(t * 0.25 + 1) * 1.4;
      ctx.strokeStyle = '#d7dbe0'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(f[0], f[1]); ctx.lineTo(f[0], f[1] - 20); ctx.stroke();
      poly(ctx, [[f[0], f[1] - 20], [f[0] + 11, f[1] - 18 + wv], [f[0] + 11, f[1] - 12 + wv], [f[0], f[1] - 13]], S.color);
    },
    library(ctx, gx, gy) {
      const x = gx + 0.12, y = gy + 0.2, w = 0.76, d = 0.56, z = 5;
      box(ctx, gx + 0.08, gy + 0.16, 0.84, 0.72, 2, 3, '#cfc8b8');
      box(ctx, x, y, w, d, z, 22, '#9e5f4b');
      for (let c = 0; c < 5; c++) wallRect(ctx, 'L', x, y, w, d, z, (c + 0.34) / 5, (c + 0.66) / 5, 0, 20, c === 2 ? '#3d2a22' : '#f1ecdc');
      for (let c = 0; c < 4; c++) wallRect(ctx, 'L', x, y, w, d, z, c < 2 ? (c + 0.72) / 5 : (c + 1.72) / 5, c < 2 ? (c + 1.28) / 5 : (c + 2.28) / 5, 5, 16, C.lit);
      for (let c = 0; c < 3; c++) wallRect(ctx, 'R', x, y, w, d, z, (c + 0.25) / 3, (c + 0.75) / 3, 5, 16, shade(C.lit, -0.18));
      gable(ctx, x - 0.03, y - 0.03, w + 0.06, d + 0.06, z + 22, 13, '#55606f', '#9e5f4b');
      wallText(ctx, 'L', x + 0.2, y + d + 0.02, z + 22.5, 'LIBRARY', 6.5, '#f1ecdc');
    },
    diner(ctx, gx, gy, v, S, t, face) {
      const x = gx + 0.16, y = gy + 0.22, w = 0.62, d = 0.44;
      box(ctx, x, y, w, d, 2, 14, '#d5dbe2');
      ['L', 'R'].forEach((s) => { wallRect(ctx, s, x, y, w, d, 2, 0, 1, 2, 4.5, s === 'L' ? C.red : shade(C.red, -0.25)); wallRect(ctx, s, x, y, w, d, 2, 0.06, 0.94, 6, 12, s === 'L' ? C.lit : shade(C.lit, -0.18)); });
      box(ctx, x - 0.02, y - 0.02, w + 0.04, d + 0.04, 16, 2, C.red);
      if (face === 'R') { box(ctx, x + 0.5, y + 0.06, 0.05, 0.32, 18, 9, '#22303d'); wallText(ctx, 'R', x + 0.55, y + 0.36, 20, 'DINER', 7, Math.floor(t / 16) % 2 ? '#ff8a8a' : '#ffd685'); }
      else { box(ctx, x + 0.1, y + 0.3, 0.42, 0.05, 18, 9, '#22303d'); wallText(ctx, 'L', x + 0.13, y + 0.35, 20, 'DINER', 7, Math.floor(t / 16) % 2 ? '#ff8a8a' : '#ffd685'); }
      umbrella(ctx, gx + 0.22, gy + 0.84, C.red); umbrella(ctx, gx + 0.86, gy + 0.5, '#f2b33d');
    },
    cafe(ctx, gx, gy, v, S) {
      const col = ['#3d8f86', '#c2703d', '#7a5ea8'][v % 3], x = gx + 0.2, y = gy + 0.2, w = 0.5, d = 0.46;
      box(ctx, x, y, w, d, 2, 18, col);
      wallRect(ctx, 'L', x, y, w, d, 2, 0.08, 0.6, 2, 11, C.lit); wallRect(ctx, 'L', x, y, w, d, 2, 0.7, 0.92, 0, 11, '#3d2a22');
      wallRect(ctx, 'R', x, y, w, d, 2, 0.1, 0.9, 2, 11, shade(C.lit, -0.18));
      awning(ctx, x - 0.02, y + d, w + 0.04, 0.1, 13, C.white, col, 5);
      box(ctx, x - 0.02, y - 0.02, w + 0.04, d + 0.04, 20, 2, shade(col, 0.3));
      umbrella(ctx, gx + 0.3, gy + 0.86, col); umbrella(ctx, gx + 0.62, gy + 0.86, '#f2b33d'); umbrella(ctx, gx + 0.86, gy + 0.6, C.white);
      tree(ctx, gx + 0.86, gy + 0.2, 0.6);
    },
    houses(ctx, gx, gy, v) {
      const walls = ['#e9dcc0', '#c9d6df', '#e3b9a0', '#d7dfc3'], roofs = ['#8a4b3a', '#4f5d6e', '#6b4a3a', '#7a4f6a'];
      tree(ctx, gx + 0.2, gy + 0.18, 0.55);
      house(ctx, gx + 0.56, gy + 0.12, walls[v % 4], roofs[v % 4], v);
      house(ctx, gx + 0.12, gy + 0.5, walls[(v + 1) % 4], roofs[(v + 2) % 4], v + 5);
      house(ctx, gx + 0.56, gy + 0.6, walls[(v + 2) % 4], roofs[(v + 1) % 4], v + 9);
    },
    park(ctx, gx, gy, v, S, t) {
      poly(ctx, [P(gx + 0.44, gy + 0.04, 2), P(gx + 0.56, gy + 0.04, 2), P(gx + 0.56, gy + 0.96, 2), P(gx + 0.44, gy + 0.96, 2)], '#cdbf9f');
      poly(ctx, [P(gx + 0.04, gy + 0.44, 2), P(gx + 0.96, gy + 0.44, 2), P(gx + 0.96, gy + 0.56, 2), P(gx + 0.04, gy + 0.56, 2)], '#cdbf9f');
      tree(ctx, gx + 0.2, gy + 0.2, 0.8); tree(ctx, gx + 0.8, gy + 0.22, 0.7);
      const c = P(gx + 0.5, gy + 0.5, 2);
      if (v % 4 === 0) { ellipse(ctx, c[0], c[1], 17, 8.5, '#8fa3ad'); ellipse(ctx, c[0], c[1], 14.5, 7.2, '#4fb4d8'); ellipse(ctx, c[0] - 4, c[1] - 2, 4, 1.6, '#bfe8f7'); }
      else if (v % 4 === 1) { ellipse(ctx, c[0], c[1], 13, 6.5, '#cdbf9f'); box(ctx, gx + 0.44, gy + 0.44, 0.12, 0.12, 2, 9, '#d9d3c4'); ellipse(ctx, c[0], c[1] - 12, 5, 5, '#6fae9a'); }
      else if (v % 4 === 2) {
        ellipse(ctx, c[0], c[1], 15, 7.5, '#d8c79a');
        ctx.strokeStyle = '#e4572e'; ctx.lineWidth = 1.3; const a = P(gx + 0.4, gy + 0.5, 2), b = P(gx + 0.6, gy + 0.5, 2);
        ctx.beginPath(); ctx.moveTo(a[0] - 3, a[1]); ctx.lineTo(a[0], a[1] - 13); ctx.lineTo(b[0], b[1] - 13); ctx.lineTo(b[0] + 3, b[1]); ctx.stroke();
        const sw = Math.sin(t * 0.3) * 2; ctx.strokeStyle = '#d7dbe0'; ctx.lineWidth = 0.8;
        [0.35, 0.65].forEach((f) => { const sx = a[0] + (b[0] - a[0]) * f, sy = a[1] + (b[1] - a[1]) * f - 13; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + sw, sy + 9); ctx.stroke(); ctx.fillStyle = '#f2b33d'; ctx.fillRect(sx + sw - 1.5, sy + 9, 3, 1.5); });
      } else { ellipse(ctx, c[0], c[1], 12, 6, '#8fa3ad'); ellipse(ctx, c[0], c[1], 9.5, 4.8, '#4fb4d8'); ctx.fillStyle = '#d5f1fb'; ctx.fillRect(c[0] - 0.8, c[1] - 9 - Math.abs(Math.sin(t * 0.3)) * 2, 1.6, 9); }
      bench(ctx, gx + 0.3, gy + 0.6); bench(ctx, gx + 0.62, gy + 0.36);
      tree(ctx, gx + 0.2, gy + 0.82, 0.75); tree(ctx, gx + 0.82, gy + 0.8, 0.85);
    },
    firehouse(ctx, gx, gy, v, S, t, face) {
      const x = gx + 0.16, y = gy + 0.2, w = 0.66, d = 0.58;
      box(ctx, x, y, w, d, 2, 24, '#b5483c');
      [0.08, 0.54].forEach((u) => { wallRect(ctx, face, x, y, w, d, 2, u, u + 0.38, 0, 13, face === 'L' ? '#eef1f4' : '#c9ced6'); for (let r = 1; r < 4; r++) wallRect(ctx, face, x, y, w, d, 2, u, u + 0.38, r * 3.2, r * 3.2 + 0.6, '#8a95a3'); });
      const other = face === 'L' ? 'R' : 'L';
      for (let c = 0; c < 3; c++) wallRect(ctx, other, x, y, w, d, 2, (c + 0.25) / 3, (c + 0.75) / 3, 15, 21, other === 'L' ? C.lit : shade(C.lit, -0.18));
      for (let c = 0; c < 3; c++) wallRect(ctx, face, x, y, w, d, 2, (c + 0.25) / 3, (c + 0.75) / 3, 16, 21, face === 'L' ? C.lit : shade(C.lit, -0.18));
      box(ctx, x - 0.02, y - 0.02, w + 0.04, d + 0.04, 26, 2, '#e6dfcc');
      box(ctx, x + 0.06, y + 0.06, 0.16, 0.16, 28, 14, '#b5483c'); box(ctx, x + 0.04, y + 0.04, 0.2, 0.2, 42, 2, '#e6dfcc');
    },
    school(ctx, gx, gy, v, S, t, face) {
      const x = gx + 0.1, y = gy + 0.24, w = 0.8, d = 0.5;
      box(ctx, x, y, w, d, 2, 19, '#d9b56a');
      windows(ctx, x, y, w, d, 2, 19, { rows: 2, cols: 6, seed: 77, base: 3, cap: 3, litRate: 0.45, lit: '#fff0c4' });
      wallRect(ctx, face, x, y, w, d, 2, 0.43, 0.57, 0, 9, '#5a4030');
      box(ctx, x - 0.02, y - 0.02, w + 0.04, d + 0.04, 21, 2, '#8a4b3a');
      box(ctx, x + 0.34, y + 0.18, 0.12, 0.12, 23, 8, '#e6dfcc'); gable(ctx, x + 0.32, y + 0.16, 0.16, 0.16, 31, 5, '#8a4b3a', '#e6dfcc');
      tree(ctx, gx + 0.14, gy + 0.9, 0.6); tree(ctx, gx + 0.9, gy + 0.14, 0.6);
    },
    market(ctx, gx, gy, v, S) {
      box(ctx, gx + 0.06, gy + 0.06, 0.88, 0.88, 2, 0.8, '#cbbfa6');
      [[0.12, 0.14, S.color], [0.56, 0.14, '#f2b33d'], [0.12, 0.6, '#3aa88f'], [0.56, 0.6, '#4f8fd9']].forEach(([a, b, col]) => {
        box(ctx, gx + a, gy + b, 0.3, 0.2, 3, 8, '#e9dcc0'); awning(ctx, gx + a - 0.03, gy + b - 0.02, 0.36, 0.3, 11, col, C.white, 4);
      });
      tree(ctx, gx + 0.5, gy + 0.5, 0.6);
    },
  };
  // Scenery layout on the border of a 9x9 block around the district. [row, col, kind, variant]; back rows carry the skyline.
  const TOWN_PLAN = [
    [0, 0, 'office', 0], [0, 1, 'apartments', 0], [0, 2, 'library', 0], [0, 3, 'office', 1], [0, 4, 'cityhall', 0], [0, 5, 'office', 2], [0, 6, 'diner', 0], [0, 7, 'apartments', 1], [0, 8, 'park', 0],
    [1, 0, 'office', 3], [2, 0, 'firehouse', 0], [3, 0, 'apartments', 2], [4, 0, 'school', 0], [5, 0, 'office', 5], [6, 0, 'cafe', 0], [7, 0, 'houses', 0], [8, 0, 'park', 1],
    [8, 1, 'houses', 1], [8, 2, 'park', 2], [8, 3, 'diner', 1], [8, 4, 'houses', 2], [8, 5, 'market', 0], [8, 6, 'cafe', 1], [8, 7, 'houses', 3], [8, 8, 'park', 3],
    [1, 8, 'cafe', 2], [2, 8, 'houses', 5], [3, 8, 'park', 6], [4, 8, 'market', 1], [5, 8, 'houses', 6], [6, 8, 'diner', 2], [7, 8, 'park', 5],
  ].sort((a, b) => a[0] + a[1] - b[0] - b[1]);

  R.drawTown = function (ctx, back) {
    TOWN_PLAN.forEach(([i, j, kind, v]) => {
      if ((i === 0 || j === 0) !== back) return;
      const gx = j - 2, gy = i - 2, green = kind === 'park' || kind === 'houses';
      box(ctx, gx + 0.04, gy + 0.04, 0.92, 0.92, 0, 2, green ? '#4a8a62' : C.walk, green ? { top: '#4a8a62', left: '#3a7350', right: '#2c5a40' } : null);
      TOWN[kind](ctx, gx, gy, v, this.state, this.t, i === 0 || i === 8 ? 'L' : 'R');
    });
  };

  R.drawGround = function (ctx) {
    const lo = -E, hi = G + E, depth = 46;
    const A = P(lo, lo), B = P(hi, lo), Cc = P(hi, hi), D = P(lo, hi);
    const gl = ctx.createLinearGradient(0, D[1], 0, Cc[1] + depth);
    gl.addColorStop(0, tone('#7a5642')); gl.addColorStop(1, tone('#3d2a22'));
    poly(ctx, [D, Cc, [Cc[0], Cc[1] + depth], [D[0], D[1] + depth]], gl);
    const gr = ctx.createLinearGradient(0, B[1], 0, Cc[1] + depth);
    gr.addColorStop(0, tone('#5d4032')); gr.addColorStop(1, tone('#2b1d18'));
    poly(ctx, [Cc, B, [B[0], B[1] + depth], [Cc[0], Cc[1] + depth]], gr);
    poly(ctx, [D, Cc, [Cc[0], Cc[1] + 5], [D[0], D[1] + 5]], '#356b4d');
    poly(ctx, [Cc, B, [B[0], B[1] + 5], [Cc[0], Cc[1] + 5]], '#28543c');
    poly(ctx, [A, B, Cc, D], C.grass);
    const sq = (a, b, fill, stroke) => poly(ctx, [P(a, a), P(b, a), P(b, b), P(a, b)], fill, stroke);
    sq(-2.04, G + 2.04, '#39745a');          // town blocks sit on slightly darker turf
    sq(-1.0, G + 1.0, C.walk);               // outer sidewalk
    sq(-0.84, G + 0.84, C.asphalt);          // ring road
    sq(-0.2, G + 0.2, C.walk);               // district sidewalk
    sq(-0.07, G + 0.07, '#262d38');          // district streets
    ctx.save(); ctx.setLineDash([7, 7]); ctx.globalAlpha = 0.7;
    sq(-0.52, G + 0.52, null, C.line);
    ctx.restore();
    // crosswalks at the middle of each side
    const zebra = 'rgba(238,241,244,.8)';
    for (let k = 0; k < 5; k++) {
      const a = 2.28 + k * 0.1;
      poly(ctx, [P(a, -0.82), P(a + 0.05, -0.82), P(a + 0.05, -0.22), P(a, -0.22)], zebra);
      poly(ctx, [P(a, G + 0.22), P(a + 0.05, G + 0.22), P(a + 0.05, G + 0.82), P(a, G + 0.82)], zebra);
      poly(ctx, [P(-0.82, a), P(-0.22, a), P(-0.22, a + 0.05), P(-0.82, a + 0.05)], zebra);
      poly(ctx, [P(G + 0.22, a), P(G + 0.82, a), P(G + 0.82, a + 0.05), P(G + 0.22, a + 0.05)], zebra);
    }
  };

  /** A point on a square loop around the district. m0 = offset of the back edge, u in [0,4): one unit per side. */
  function loopPos(u, m0) {
    const L = G - 2 * m0, s = Math.floor(u) % 4, f = u - Math.floor(u);
    if (s === 0) return { x: m0 + f * L, y: m0, along: 'x', back: true };
    if (s === 1) return { x: m0 + L, y: m0 + f * L, along: 'y', back: false };
    if (s === 2) return { x: m0 + L - f * L, y: m0 + L, along: 'x', back: false };
    return { x: m0, y: m0 + L - f * L, along: 'y', back: true };
  }

  R.draw = function () {
    const ctx = this.ctx, S = this.state, t = this.t;
    NIGHT = !!this.night; FLOOD = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!S) return;
    ctx.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, this.dpr * this.ox, this.dpr * this.oy);
    this.drawGround(ctx);
    // moving things, each tagged with the layer it belongs to
    const cars = [], palette = ['#e4572e', '#f2b33d', '#e8e2d0', '#4f8fd9', '#3aa88f', '#b06ab3'];
    for (let i = 0; i < 9; i++) cars.push(Object.assign(loopPos((i * 0.447 + t * (0.004 + (i % 3) * 0.0012)) % 4, -0.52), { col: palette[i % palette.length] }));
    const walkers = [];
    for (let i = 0; i < 44; i++) {
      const outer = i % 3 !== 0, dir = i % 2 ? 1 : -1, sp = 0.0009 + hash(i, 7) * 0.0009;
      const u = (((hash(i, 3) * 4 + dir * t * sp) % 4) + 4) % 4;
      const lane = outer ? -0.92 + (i % 4) * 0.02 - 0.03 : -0.135 + (i % 2) * 0.03;
      walkers.push(Object.assign(loopPos(u, lane), { i, outer }));
    }
    const lamps = [];
    for (let s = 0; s < 4; s++) for (let k = 0; k < 5; k++) lamps.push(loopPos(s + (k + 0.5) / 5, -0.97));
    const rim = [];
    for (let i = 0; i < 40; i++) {
      const side = i % 4, f = hash(i, 9) * (G + 2 * E - 0.3) - E + 0.15, off = E - 0.11;
      const p = side === 0 ? [f, -off] : side === 1 ? [G + off, f] : side === 2 ? [f, G + off] : [-off, f];
      rim.push({ x: p[0], y: p[1], s: 0.45 + hash(i, 2) * 0.3, back: side === 0 || side === 3 });
    }
    rim.sort((p, q) => p.x + p.y - q.x - q.y);
    const byDepth = (p, q) => p.x + p.y - q.x - q.y;

    rim.filter((p) => p.back).forEach((p) => tree(ctx, p.x, p.y, p.s));
    this.drawTown(ctx, true);
    lamps.filter((p) => p.back).forEach((p) => lamp(ctx, p.x, p.y));
    walkers.filter((p) => p.back).sort(byDepth).forEach((p) => person(ctx, p.x, p.y, p.i, t));
    cars.filter((c) => c.back).forEach((c) => car(ctx, c.x, c.y, c.along, c.col));
    // lots back to front; the stadium sits at depth 4, in front of the back rows and behind the front rows
    const order = [];
    for (let r = 0; r < G; r++) for (let c = 0; c < G; c++) if (!FT.isStadium(r + '-' + c)) order.push([r, c]);
    order.sort((p, q) => p[0] + p[1] - q[0] - q[1] || p[1] - q[1]);
    let stadiumDone = false;
    order.forEach(([r, c]) => {
      if (!stadiumDone && r + c > 3) { FLOOD = NIGHT; this.drawStadium(ctx); FLOOD = false; stadiumDone = true; } // floodlit at night
      this.drawLot(ctx, r, c);
    });
    walkers.filter((p) => !p.back && !p.outer).sort(byDepth).forEach((p) => person(ctx, p.x, p.y, p.i, t));
    cars.filter((c) => !c.back).forEach((c) => car(ctx, c.x, c.y, c.along, c.col));
    walkers.filter((p) => !p.back && p.outer).sort(byDepth).forEach((p) => person(ctx, p.x, p.y, p.i, t));
    lamps.filter((p) => !p.back).forEach((p) => lamp(ctx, p.x, p.y));
    this.drawTown(ctx, false);
    rim.filter((p) => !p.back).forEach((p) => tree(ctx, p.x, p.y, p.s));
    // fireworks
    this.particles = this.particles.filter((p) => p.life > 0);
    FLOOD = true;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    this.particles.forEach((p) => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.life -= 1;
      ctx.globalAlpha = Math.max(0, p.life / 40); ctx.fillStyle = p.col; ctx.fillRect(p.x - 1.2, p.y - 1.2, 2.4, 2.4);
    });
    ctx.restore();
  };

  R.fireworks = function (n) {
    const cols = [this.state.color, '#ffd685', '#ffffff', '#7fd4ff'];
    for (let b = 0; b < (n || 5); b++) {
      const x = -220 + Math.random() * 440, y = -150 + Math.random() * 110, col = cols[b % cols.length];
      setTimeout(() => {
        for (let i = 0; i < 46; i++) { const an = Math.random() * 6.283, sp = 0.6 + Math.random() * 2.6; this.particles.push({ x, y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - 0.6, life: 30 + Math.random() * 22, col }); }
      }, b * 260);
    }
  };

  R.start = function () {
    const still = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let last = 0;
    const loop = (now) => {
      this.raf = root.requestAnimationFrame(loop);
      if (now - last < (still ? 400 : 40)) return;
      last = now;
      if (!still) this.t += 1;
      this.draw();
    };
    this.raf = root.requestAnimationFrame(loop);
  };

  /** Draw one building (or the stadium, type 'stadium') on its own canvas. Used by the gallery page. */
  FT.drawPreview = function (canvas, type, level, color, night) {
    const dpr = Math.min(2, root.devicePixelRatio || 1), w = canvas.clientWidth || 220, h = canvas.clientHeight || 180;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!canvas.toneHooked) { hookTone(ctx); canvas.toneHooked = true; }
    NIGHT = !!night; FLOOD = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    const S = { color, stadium: level, grid: {} }, fake = { state: S, t: 12, fill: 0.85, score: '27-24', selected: null, hover: null, gameDay: false };
    if (type === 'stadium') {
      const sc = Math.min(w / 250, h / 190);
      ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * w / 2, dpr * (h / 2 - 96 * sc));
      FLOOD = NIGHT;
      R.drawStadium.call(fake, ctx);
    } else {
      const tall = heightOf({ type, level });
      const sc = Math.min(2.1, w / 135, (h - 16) / (tall + 72));
      ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * w / 2, dpr * (h - 8 - 62 * sc));
      box(ctx, 0.06, 0.06, 0.88, 0.88, 0, 2, C.walk);
      DRAW[type](ctx, 0, 0, level, S, fake.t, fake);
    }
    FLOOD = false;
  };

  FT.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
