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
  let TRIM = '#eef1f4'; // the city's secondary colour: awning stripes, tent panels, flags, half the crowd
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
    const h = { suites: [26, 62, 118], media: [40, 80, 112], scouting: [30, 48, 98], medical: [20, 38, 74], retail: [28, 42, 72], concessions: [18, 24, 54], transit: [16, 30, 40], fanzone: [24, 40, 64] };
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
    for (let i = 0; i < n; i++) box(ctx, x + (w * i) / n, y, w / n, d, z, 2.5, i % 2 ? (colB === C.white ? TRIM : colB) : colA);
  }
  function umbrella(ctx, x, y, col, z) {
    const [px, py] = P(x, y, z || 0);
    ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - 11); ctx.stroke();
    poly(ctx, [[px - 8, py - 9], [px, py - 15], [px + 8, py - 9], [px, py - 6]], col);
    poly(ctx, [[px, py - 15], [px + 8, py - 9], [px, py - 6]], shade(col, -0.25));
  }

  // ---- shapes used by the higher tiers ---------------------------------------------------
  /** A barrel-vaulted roof running along x. R = height of the arch in px. */
  function vault(ctx, x, y, w, d, z, R, col, ribs) {
    const n = 9, pt = (xx, th) => P(xx, y + d / 2 - (d / 2) * Math.cos(th), z + R * Math.sin(th));
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * i) / n, b = (Math.PI * (i + 1)) / n;
      poly(ctx, [pt(x, a), pt(x + w, a), pt(x + w, b), pt(x, b)], shade(col, 0.3 - 0.55 * (i / n)));
    }
    const cap = [];
    for (let i = 0; i <= n; i++) cap.push(pt(x + w, (Math.PI * i) / n));
    poly(ctx, cap, shade(col, -0.35));
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 0.8;
    for (let k = 0; k <= (ribs || 4); k++) {
      const xx = x + (w * k) / (ribs || 4);
      ctx.beginPath();
      for (let i = 0; i <= n; i++) { const p = pt(xx, (Math.PI * i) / n); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
      ctx.stroke();
    }
  }
  /** An upright cylinder standing at a grid point. rx = radius in px. */
  function cyl(ctx, x, y, rx, z, h, col) {
    const c = P(x, y, z), ry = rx / 2;
    ctx.beginPath(); ctx.moveTo(c[0] - rx, c[1] - h); ctx.lineTo(c[0] - rx, c[1]);
    ctx.ellipse(c[0], c[1], rx, ry, 0, Math.PI, 0, true); ctx.lineTo(c[0] + rx, c[1] - h); ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
    ctx.beginPath(); ctx.moveTo(c[0], c[1] - h); ctx.lineTo(c[0], c[1] + ry); ctx.ellipse(c[0], c[1], rx, ry, 0, Math.PI / 2, 0, true); ctx.lineTo(c[0] + rx, c[1] - h); ctx.closePath();
    ctx.fillStyle = shade(col, -0.22); ctx.fill();
    ellipse(ctx, c[0], c[1] - h, rx, ry, shade(col, 0.22));
  }
  /** A tent roof: a four-sided pyramid over a rectangle. */
  function tent(ctx, x, y, w, d, z, h, colA, colB) {
    if (colB === C.white) colB = TRIM;
    const top = P(x + w / 2, y + d / 2, z + h);
    poly(ctx, [P(x, y, z), P(x + w, y, z), top], shade(colA, -0.4));
    poly(ctx, [P(x, y + d, z), P(x + w, y + d, z), top], colA);
    poly(ctx, [P(x + w, y + d, z), P(x + w, y, z), top], colB);
  }
  function post(ctx, x, y, z0, z1, col, lw) {
    const a = P(x, y, z0), b = P(x, y, z1);
    ctx.strokeStyle = col || '#aab3bf'; ctx.lineWidth = lw || 1.2; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    return b;
  }
  function flag(ctx, x, y, z, col, t, len) {
    const p = post(ctx, x, y, z, z + (len || 20), '#d7dbe0'), wv = Math.sin(t * 0.25 + x * 9) * 1.5;
    poly(ctx, [[p[0], p[1]], [p[0] + 12, p[1] + 2 + wv], [p[0] + 12, p[1] + 9 + wv], [p[0], p[1] + 7]], col);
  }
  function stringLights(ctx, ax, ay, bx, by, z, colA, colB) {
    const a = P(ax, ay, z), b = P(bx, by, z);
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 9, b[0], b[1]); ctx.stroke();
    for (let i = 1; i < 8; i++) { const f = i / 8; ellipse(ctx, a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f + Math.sin(f * Math.PI) * 4.5, 1.6, 1.6, i % 2 ? colA : colB); }
  }
  function picnic(ctx, x, y) {
    box(ctx, x, y - 0.035, 0.14, 0.03, 2, 2, '#6f4e33'); box(ctx, x, y + 0.075, 0.14, 0.03, 2, 2, '#6f4e33');
    box(ctx, x, y, 0.14, 0.07, 2, 4, C.wood);
  }
  /** Glass curtain wall: lit panes on both visible faces with thin mullions. */
  function curtain(ctx, x, y, w, d, z, h, rows, cols, seed, lit, rate) {
    windows(ctx, x, y, w, d, z, h, { rows, cols, seed, base: 2, cap: 2, litRate: rate == null ? 0.8 : rate, lit: lit || '#cfe9ff' });
  }

  // ---- buildings -----------------------------------------------------------------------
  // Each takes the lot's back corner (gx = column, gy = row) and draws inside the unit tile.
  // Every level is a different kind of place, so an upgrade reads at a glance.
  const DRAW = {
    // hot dog cart -> food court -> full-service restaurant
    concessions(ctx, gx, gy, lv, S) {
      const team = S.color;
      if (lv === 1) {
        picnic(ctx, gx + 0.2, gy + 0.3); picnic(ctx, gx + 0.62, gy + 0.24);
        cyl(ctx, gx + 0.82, gy + 0.72, 3, 2, 6, '#5a6470');
        box(ctx, gx + 0.36, gy + 0.56, 0.26, 0.14, 4, 7, '#dfe3e8');
        wallRect(ctx, 'L', gx + 0.36, gy + 0.56, 0.26, 0.14, 4, 0, 1, 0, 2.5, C.red);
        ellipse(ctx, P(gx + 0.42, gy + 0.7, 2)[0], P(gx + 0.42, gy + 0.7, 2)[1] - 1, 2.6, 2.6, '#22282f'); ellipse(ctx, P(gx + 0.58, gy + 0.7, 2)[0], P(gx + 0.58, gy + 0.7, 2)[1] - 1, 2.6, 2.6, '#22282f');
        umbrella(ctx, gx + 0.49, gy + 0.63, team, 9);
        box(ctx, gx + 0.2, gy + 0.72, 0.06, 0.02, 2, 8, '#2b333d'); wallText(ctx, 'L', gx + 0.2, gy + 0.745, 5, 'DOGS', 4.5, C.lit);
        return;
      }
      if (lv === 2) {
        [[0.1, 0.56], [0.4, 0.56], [0.7, 0.56]].forEach(([x, y], i) => {
          box(ctx, gx + x, gy + y, 0.22, 0.24, 2, 12, i % 2 ? '#e9dcc0' : C.cream);
          wallRect(ctx, 'L', gx + x, gy + y, 0.22, 0.24, 2, 0.12, 0.88, 4, 10, C.lit);
          awning(ctx, gx + x - 0.03, gy + y - 0.02, 0.28, 0.34, 14, i % 2 ? '#f2b33d' : team, C.white, 4);
        });
        box(ctx, gx + 0.14, gy + 0.12, 0.3, 0.2, 2, 11, '#d9d2c2'); wallRect(ctx, 'L', gx + 0.14, gy + 0.12, 0.3, 0.2, 2, 0.1, 0.9, 3, 9, C.lit);
        awning(ctx, gx + 0.11, gy + 0.1, 0.36, 0.28, 13, '#3aa88f', C.white, 4);
        umbrella(ctx, gx + 0.62, gy + 0.3, team); umbrella(ctx, gx + 0.84, gy + 0.36, '#f2b33d');
        picnic(ctx, gx + 0.56, gy + 0.4);
        stringLights(ctx, gx + 0.08, gy + 0.5, gx + 0.94, gy + 0.5, 22, C.lit, team);
        return;
      }
      // fine dining: timber and glass ground floor, set-back upper room, roof terrace
      const x = gx + 0.1, y = gy + 0.12, w = 0.8, d = 0.66;
      box(ctx, x, y, w, d, 2, 20, '#4a362c');
      ['L', 'R'].forEach((s) => {
        wallRect(ctx, s, x, y, w, d, 2, 0.05, 0.95, 3, 17, s === 'L' ? C.lit : shade(C.lit, -0.18));
        for (let c = 1; c < 6; c++) wallRect(ctx, s, x, y, w, d, 2, c / 6 - 0.012, c / 6 + 0.012, 3, 17, s === 'L' ? '#4a362c' : shade('#4a362c', -0.28));
      });
      wallRect(ctx, 'L', x, y, w, d, 2, 0.42, 0.58, 0, 15, '#2a1d17');
      box(ctx, x - 0.02, y - 0.02, w + 0.04, d + 0.04, 22, 2, '#d8b45a');
      box(ctx, x + 0.06, y + 0.06, 0.5, 0.4, 24, 16, '#efe6d2');
      windows(ctx, x + 0.06, y + 0.06, 0.5, 0.4, 24, 16, { rows: 1, cols: 4, seed: 7, base: 3, cap: 3, litRate: 1 });
      box(ctx, x + 0.04, y + 0.04, 0.54, 0.44, 40, 2, '#d8b45a');
      box(ctx, x + 0.12, y + 0.24, 0.38, 0.04, 42, 10, '#1d1512'); wallText(ctx, 'L', x + 0.15, y + 0.28, 44, 'GRILL', 8, C.lit);
      umbrella(ctx, x + 0.68, y + 0.2, team, 24); umbrella(ctx, x + 0.68, y + 0.5, C.white, 24); umbrella(ctx, x + 0.3, y + 0.56, team, 24);
      stringLights(ctx, x, y + d, x + w, y + d, 36, C.lit, '#fff1c2');
      box(ctx, x + 0.3, y + d, 0.2, 0.12, 15, 2, team); post(ctx, x + 0.32, y + d + 0.11, 2, 15, '#d8b45a'); post(ctx, x + 0.48, y + d + 0.11, 2, 15, '#d8b45a');
      tree(ctx, gx + 0.1, gy + 0.9, 0.45); tree(ctx, gx + 0.9, gy + 0.9, 0.45);
    },

    // surface lot -> parking garage with bus bays -> high-speed rail station
    transit(ctx, gx, gy, lv, S, t) {
      const cols = ['#d9534f', '#e8e2d0', '#4f8fd9', '#f2b33d', '#7a8794', '#3aa88f'];
      const cars = (x0, y0, nx, ny, z, seed) => {
        for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
          if (hash(seed + i, j + gx * 3 + gy) < 0.25) continue;
          box(ctx, gx + x0 + i * 0.17, gy + y0 + j * 0.3, 0.1, 0.18, z, 4, cols[Math.floor(hash(i + seed, j + gy) * cols.length)]);
        }
      };
      if (lv === 1) {
        box(ctx, gx + 0.08, gy + 0.08, 0.84, 0.84, 2, 1.5, '#3a424e');
        ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) { const a = P(gx + 0.15 + i * 0.17, gy + 0.16, 3.5), b = P(gx + 0.15 + i * 0.17, gy + 0.74, 3.5); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
        cars(0.17, 0.18, 4, 2, 3.5, 1);
        box(ctx, gx + 0.1, gy + 0.8, 0.12, 0.1, 3.5, 9, '#e9dcc0'); box(ctx, gx + 0.09, gy + 0.79, 0.14, 0.12, 12.5, 1.5, C.red);
        post(ctx, gx + 0.88, gy + 0.88, 3, 16, '#7d8896'); wallText(ctx, 'L', gx + 0.8, gy + 0.9, 12, 'P', 8, '#9fd8ff');
        return;
      }
      if (lv === 2) {
        for (let i = 0; i < 2; i++) {
          const z = 2 + i * 11, x = gx + 0.08, y = gy + 0.08, w = 0.84, d = 0.56;
          box(ctx, x, y, w, d, z, 11, C.concrete);
          ['L', 'R'].forEach((s) => { wallRect(ctx, s, x, y, w, d, z, 0.04, 0.96, 2, 8, s === 'L' ? '#1f2731' : '#171d25'); for (let c = 1; c < 5; c++) wallRect(ctx, s, x, y, w, d, z, c / 5 - 0.012, c / 5 + 0.012, 2, 8, s === 'L' ? C.concrete : shade(C.concrete, -0.28)); });
        }
        cars(0.14, 0.14, 4, 2, 24, 2);
        cyl(ctx, gx + 0.84, gy + 0.56, 6, 2, 28, '#8a929c');
        // bus bay along the street
        box(ctx, gx + 0.14, gy + 0.76, 0.4, 0.12, 2, 9, S.color);
        wallRect(ctx, 'L', gx + 0.14, gy + 0.76, 0.4, 0.12, 2, 0.05, 0.95, 4, 8, C.lit); wallRect(ctx, 'R', gx + 0.14, gy + 0.76, 0.4, 0.12, 2, 0.1, 0.9, 4, 8, shade(C.lit, -0.18));
        box(ctx, gx + 0.64, gy + 0.78, 0.24, 0.08, 12, 1.5, '#4f8fd9'); post(ctx, gx + 0.66, gy + 0.85, 2, 12); post(ctx, gx + 0.86, gy + 0.85, 2, 12);
        return;
      }
      // rail terminal: glass concourse under a vaulted roof, viaduct and a streamlined train
      const x = gx + 0.08, y = gy + 0.08, w = 0.84, d = 0.54;
      box(ctx, x, y, w, d, 2, 13, '#35607a');
      curtain(ctx, x, y, w, d, 2, 13, 1, 7, 31, '#cfe9ff', 1);
      wallRect(ctx, 'L', x, y, w, d, 2, 0.42, 0.58, 0, 10, '#17242f');
      vault(ctx, x - 0.02, y - 0.02, w + 0.04, d + 0.04, 15, 21, '#8fc7dd', 6);
      box(ctx, x + 0.3, y + d, 0.24, 0.05, 15, 8, '#12202b'); wallText(ctx, 'L', x + 0.325, y + d + 0.05, 17, 'RAIL', 7, '#9fd8ff');
      [0.12, 0.5, 0.88].forEach((u) => box(ctx, gx + u - 0.025, gy + 0.8, 0.05, 0.06, 2, 9, '#8a929c'));
      box(ctx, gx + 0.02, gy + 0.76, 0.96, 0.15, 11, 2.5, '#aeb5bd');
      const s = ((t * 0.012) % 2) - 0.6, a = Math.max(0.03, s), b = Math.min(0.97, s + 0.56);
      if (b - a > 0.04) {
        box(ctx, gx + a, gy + 0.79, b - a, 0.09, 13.5, 7, '#f1f4f7');
        wallRect(ctx, 'L', gx + a, gy + 0.79, b - a, 0.09, 13.5, 0, 1, 1, 2.6, S.color);
        wallRect(ctx, 'L', gx + a, gy + 0.79, b - a, 0.09, 13.5, 0.03, 0.97, 3.6, 5.8, '#9fd8ff');
        if (b < 0.96) poly(ctx, [P(gx + b, gy + 0.88, 13.5), P(gx + b + 0.07, gy + 0.86, 13.5), P(gx + b + 0.07, gy + 0.81, 13.5), P(gx + b, gy + 0.79, 13.5), P(gx + b, gy + 0.79, 20.5), P(gx + b, gy + 0.88, 20.5)], '#d9dfe6');
      }
    },

    // merchandise tent -> team shop -> flagship megastore
    retail(ctx, gx, gy, lv, S) {
      const team = S.color;
      if (lv === 1) {
        box(ctx, gx + 0.56, gy + 0.2, 0.3, 0.16, 3, 9, '#eef1f4'); wallRect(ctx, 'L', gx + 0.56, gy + 0.2, 0.3, 0.16, 3, 0, 1, 2.5, 4.5, team);
        box(ctx, gx + 0.22, gy + 0.46, 0.42, 0.12, 2, 5, '#e9dcc0');
        ['#f1ede3', team, '#22303d', team].forEach((c, i) => wallRect(ctx, 'L', gx + 0.22, gy + 0.46, 0.42, 0.12, 2, 0.06 + i * 0.235, 0.24 + i * 0.235, 5.5, 10.5, c));
        [[0.16, 0.38], [0.7, 0.38], [0.16, 0.7], [0.7, 0.7]].forEach(([a, b]) => post(ctx, gx + a, gy + b, 2, 15));
        tent(ctx, gx + 0.12, gy + 0.34, 0.62, 0.4, 15, 11, team, C.white);
        return;
      }
      if (lv === 2) {
        const h = 26, x = gx + 0.16, y = gy + 0.18, w = 0.68, d = 0.62;
        box(ctx, x, y, w, d, 2, h, '#d9d2c2');
        wallRect(ctx, 'L', x, y, w, d, 2, 0.06, 0.94, 2, 13, C.lit); wallRect(ctx, 'R', x, y, w, d, 2, 0.06, 0.94, 2, 13, shade(C.lit, -0.2));
        wallRect(ctx, 'L', x, y, w, d, 2, 0.44, 0.56, 2, 13, '#7a5a3a');
        box(ctx, x - 0.02, y + d, w + 0.04, 0.08, 15, 2.5, team); box(ctx, x + w, y - 0.02, 0.08, d + 0.04, 15, 2.5, shade(team, -0.2));
        box(ctx, x + 0.1, y + 0.28, w - 0.2, 0.05, h + 2, 12, team); wallText(ctx, 'L', x + 0.15, y + 0.33, h + 5, 'TEAM STORE', 7.5, C.white);
        return;
      }
      // flagship: three glass storeys, a colour fin, banners and a rooftop video board
      const x = gx + 0.12, y = gy + 0.14, w = 0.76, d = 0.7, h = 46;
      box(ctx, x, y, w, d, 2, h, '#2f5d74', { top: '#22303d' });
      curtain(ctx, x, y, w, d, 2, h, 4, 6, 53, C.lit, 0.9);
      wallRect(ctx, 'L', x, y, w, d, 2, 0.4, 0.6, 0, 11, '#12202b');
      [0.2, 0.5, 0.8].forEach((u) => wallRect(ctx, 'R', x, y, w, d, 2, u - 0.06, u + 0.06, 14, 42, shade(team, -0.15)));
      box(ctx, x + 0.26, y + d, 0.28, 0.12, 13, 2, team);
      box(ctx, x - 0.03, y + d - 0.1, 0.07, 0.11, 2, 60, team);
      box(ctx, x + 0.14, y + 0.3, 0.5, 0.05, h + 2, 20, '#10171f');
      wallRect(ctx, 'L', x + 0.14, y + 0.3, 0.5, 0.05, h + 2, 0.04, 0.96, 2, 18, team);
      wallText(ctx, 'L', x + 0.2, y + 0.35, h + 7, 'FLAGSHIP', 8.5, C.white);
      glow(ctx, P(x + 0.4, y + 0.4, h + 12)[0], P(x + 0.4, y + 0.4, h + 12)[1], 30, team, 0.4);
    },

    // members' clubhouse -> glass hospitality tower -> luxury skyscraper with a rooftop pool
    suites(ctx, gx, gy, lv, S) {
      if (lv === 1) {
        const x = gx + 0.16, y = gy + 0.2, w = 0.66, d = 0.56;
        box(ctx, x, y, w, d, 2, 20, C.brick);
        windows(ctx, x, y, w, d, 2, 20, { rows: 2, cols: 4, seed: gx * 3 + gy * 11, base: 3, cap: 3, lit: '#ffe2a6' });
        wallRect(ctx, 'L', x, y, w, d, 2, 0.42, 0.58, 0, 9, '#3d2a22');
        box(ctx, x - 0.02, y - 0.02, w + 0.04, d + 0.04, 22, 2, '#c9c2b2');
        awning(ctx, x + 0.2, y + d, 0.26, 0.1, 11, '#7a2f3a', '#d8b45a', 4);
        tree(ctx, gx + 0.12, gy + 0.88, 0.4); tree(ctx, gx + 0.9, gy + 0.86, 0.4);
        return;
      }
      if (lv === 2) {
        const h = 50, x = gx + 0.22, y = gy + 0.22, w = 0.56;
        box(ctx, gx + 0.14, gy + 0.14, 0.72, 0.72, 2, 7, '#3b4656');
        box(ctx, x, y, w, w, 9, h, '#3f7f98', { top: '#2a3a4a' });
        windows(ctx, x, y, w, w, 9, h, { rows: 6, cols: 4, seed: gx * 3 + gy * 11, base: 3, cap: 3, lit: '#ffe2a6', litRate: 0.7 });
        box(ctx, x - 0.02, y - 0.02, w + 0.04, w + 0.04, 9 + h, 3, '#d8b45a');
        return;
      }
      // skyscraper: stepped setbacks, a pool deck on the first one, gilded crown and spire
      box(ctx, gx + 0.1, gy + 0.1, 0.8, 0.8, 2, 9, '#2f3948');
      wallRect(ctx, 'L', gx + 0.1, gy + 0.1, 0.8, 0.8, 2, 0.08, 0.92, 2, 7, '#ffe2a6'); wallRect(ctx, 'R', gx + 0.1, gy + 0.1, 0.8, 0.8, 2, 0.08, 0.92, 2, 7, shade('#ffe2a6', -0.18));
      box(ctx, gx + 0.18, gy + 0.18, 0.64, 0.64, 11, 46, '#2f6f8a', { top: '#cdbf9f' });
      curtain(ctx, gx + 0.18, gy + 0.18, 0.64, 0.64, 11, 46, 6, 5, 91, '#ffe2a6', 0.72);
      poly(ctx, [P(gx + 0.24, gy + 0.68, 57.3), P(gx + 0.76, gy + 0.68, 57.3), P(gx + 0.76, gy + 0.78, 57.3), P(gx + 0.24, gy + 0.78, 57.3)], '#9fd8ff');
      umbrella(ctx, gx + 0.74, gy + 0.3, S.color, 57);
      box(ctx, gx + 0.26, gy + 0.24, 0.44, 0.42, 57, 30, '#3f8aa6', { top: '#2a3a4a' });
      curtain(ctx, gx + 0.26, gy + 0.24, 0.44, 0.42, 57, 30, 4, 4, 17, '#ffe2a6', 0.75);
      box(ctx, gx + 0.24, gy + 0.22, 0.48, 0.46, 87, 2.5, '#d8b45a');
      box(ctx, gx + 0.34, gy + 0.3, 0.28, 0.28, 89.5, 12, '#d8b45a', { top: '#f0d58a' });
      const p = post(ctx, gx + 0.48, gy + 0.44, 101, 116, '#f0d58a', 1.6);
      glow(ctx, p[0], p[1], 9, '#ffd685', 0.9);
    },

    // clinic with an ambulance -> medical centre -> hospital and sports-science campus
    medical(ctx, gx, gy, lv) {
      const cross = (cx, cy, z, s) => {
        poly(ctx, [P(cx - 0.16 * s, cy - 0.05 * s, z), P(cx + 0.16 * s, cy - 0.05 * s, z), P(cx + 0.16 * s, cy + 0.05 * s, z), P(cx - 0.16 * s, cy + 0.05 * s, z)], C.red);
        poly(ctx, [P(cx - 0.05 * s, cy - 0.16 * s, z), P(cx + 0.05 * s, cy - 0.16 * s, z), P(cx + 0.05 * s, cy + 0.16 * s, z), P(cx - 0.05 * s, cy + 0.16 * s, z)], C.red);
      };
      if (lv === 1) {
        const x = gx + 0.16, y = gy + 0.16, w = 0.5, d = 0.36;
        box(ctx, x, y, w, d, 2, 13, C.white);
        windows(ctx, x, y, w, d, 2, 13, { rows: 1, cols: 3, seed: 3, base: 4, cap: 3, lit: '#bfe9ff', litRate: 1 });
        wallRect(ctx, 'L', x, y, w, d, 2, 0.42, 0.6, 0, 9, '#4a6a85');
        box(ctx, x - 0.02, y - 0.02, w + 0.04, d + 0.04, 15, 1.5, '#cfd6dd');
        cross(x + w / 2, y + d / 2, 16.8, 0.7);
        box(ctx, gx + 0.5, gy + 0.68, 0.26, 0.13, 2, 8, C.white);
        wallRect(ctx, 'L', gx + 0.5, gy + 0.68, 0.26, 0.13, 2, 0, 1, 2.5, 4.5, C.red); wallRect(ctx, 'L', gx + 0.5, gy + 0.68, 0.26, 0.13, 2, 0.62, 0.95, 5, 7.5, '#bfe9ff');
        box(ctx, gx + 0.6, gy + 0.72, 0.05, 0.05, 10, 1.5, '#4f8fd9');
        tree(ctx, gx + 0.84, gy + 0.3, 0.55);
        return;
      }
      if (lv === 2) {
        const h = 34, x = gx + 0.14, y = gy + 0.18, w = 0.7, d = 0.5;
        box(ctx, gx + 0.56, gy + 0.56, 0.32, 0.32, 2, 16, '#dfe5ea'); windows(ctx, gx + 0.56, gy + 0.56, 0.32, 0.32, 2, 16, { rows: 1, cols: 2, seed: 5, lit: '#bfe9ff' });
        box(ctx, x, y, w, d, 2, h, C.white);
        windows(ctx, x, y, w, d, 2, h, { rows: 3, cols: 5, seed: gx * 7 + gy, lit: '#bfe9ff', litRate: 0.75 });
        wallRect(ctx, 'L', x, y, w, d, 2, 0.4, 0.6, 0, 9, '#4a6a85');
        cross(x + w / 2, y + d / 2, h + 2.3, 1);
        box(ctx, x + 0.04, y + d, 0.14, 0.02, 14, 8, C.red);
        return;
      }
      // hospital tower with a helipad, linked by a skybridge to a sports-science wing with a rooftop track
      const x = gx + 0.08, y = gy + 0.1, w = 0.46, d = 0.52, h = 62;
      box(ctx, x, y, w, d, 2, h, C.white, { top: '#3d4957' });
      for (let r = 0; r < 7; r++) { wallRect(ctx, 'L', x, y, w, d, 2, 0.05, 0.95, 5 + r * 8, 10.5 + r * 8, r % 3 === 1 ? '#5fb0c9' : '#bfe9ff'); wallRect(ctx, 'R', x, y, w, d, 2, 0.05, 0.95, 5 + r * 8, 10.5 + r * 8, shade('#bfe9ff', -0.2)); }
      wallRect(ctx, 'L', x, y, w, d, 2, 0.36, 0.64, 44, 50, C.red); wallRect(ctx, 'L', x, y, w, d, 2, 0.45, 0.55, 38, 56, C.red);
      const hp = P(x + w / 2, y + d / 2, h + 2);
      ellipse(ctx, hp[0], hp[1], 19, 9.5, '#3d4957', '#f2b33d', 1.5);
      ctx.save(); ctx.font = '700 10px "Barlow Condensed", sans-serif'; ctx.fillStyle = C.white; ctx.textAlign = 'center'; ctx.fillText('H', hp[0], hp[1] + 3.5); ctx.restore();
      box(ctx, x + w, y + 0.22, 0.1, 0.1, 14, 6, '#5fb0c9');
      const wx = gx + 0.6, wy = gy + 0.26, ww = 0.32, wd = 0.62;
      box(ctx, wx, wy, ww, wd, 2, 22, '#3f8aa6', { top: '#3f9a5c' });
      curtain(ctx, wx, wy, ww, wd, 2, 22, 2, 2, 23, '#cfe9ff', 0.85);
      const tc = P(wx + ww / 2, wy + wd / 2, 24);
      ctx.save(); ctx.translate(tc[0], tc[1]); ctx.transform(1, 0.5, -1, 0.5, 0, 0);
      ctx.strokeStyle = '#d9634a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, 0, 6, 13, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      box(ctx, x + 0.12, y + d, 0.22, 0.1, 12, 2, C.red);
    },

    // site-office trailer -> brick front office -> glass headquarters
    scouting(ctx, gx, gy, lv, S, t) {
      if (lv === 1) {
        box(ctx, gx + 0.2, gy + 0.3, 0.5, 0.2, 4, 11, '#e9dcc0');
        wallRect(ctx, 'L', gx + 0.2, gy + 0.3, 0.5, 0.2, 4, 0, 1, 0, 2.5, '#8a95a3');
        [0.08, 0.34, 0.74].forEach((u) => wallRect(ctx, 'L', gx + 0.2, gy + 0.3, 0.5, 0.2, 4, u, u + 0.18, 4.5, 9, C.lit));
        wallRect(ctx, 'L', gx + 0.2, gy + 0.3, 0.5, 0.2, 4, 0.56, 0.68, 0, 9, '#5a4030');
        box(ctx, gx + 0.46, gy + 0.5, 0.1, 0.06, 2, 2, '#8a95a3');
        box(ctx, gx + 0.19, gy + 0.29, 0.52, 0.22, 15, 1.5, '#b9b3a6');
        car(ctx, gx + 0.34, gy + 0.76, 'x', '#4f8fd9');
        flag(ctx, gx + 0.82, gy + 0.3, 2, S.color, t, 26);
        tree(ctx, gx + 0.84, gy + 0.74, 0.5);
        return;
      }
      if (lv === 2) {
        const h = 40, x = gx + 0.18, y = gy + 0.2, w = 0.64, d = 0.56;
        box(ctx, x - 0.03, y - 0.03, w + 0.06, d + 0.06, 2, 5, '#c9c2b2');
        box(ctx, x, y, w, d, 7, h - 5, C.brick);
        windows(ctx, x, y, w, d, 7, h - 5, { rows: 3, cols: 4, seed: gx + gy * 13, base: 4, cap: 4 });
        box(ctx, x - 0.02, y - 0.02, w + 0.04, d + 0.04, h + 2, 2.5, '#c9c2b2');
        wallRect(ctx, 'L', x, y, w, d, 2, 0.42, 0.58, 0, 10, '#3d2a22');
        flag(ctx, x + 0.12, y + 0.12, h + 4.5, S.color, t);
        return;
      }
      // headquarters: stone podium, glass tower with a team-colour spine, logo cube, flag court
      const x = gx + 0.18, y = gy + 0.16, w = 0.62, d = 0.58, h = 70;
      box(ctx, gx + 0.1, gy + 0.1, 0.8, 0.74, 2, 8, '#cfc8b8');
      wallRect(ctx, 'L', gx + 0.1, gy + 0.1, 0.8, 0.74, 2, 0.3, 0.7, 1, 7, C.lit);
      box(ctx, x, y, w, d, 10, h, '#2d5a73', { top: '#22303d' });
      curtain(ctx, x, y, w, d, 10, h, 8, 5, 77, '#cfe9ff', 0.7);
      wallRect(ctx, 'L', x, y, w, d, 10, 0.44, 0.56, 0, h, S.color); wallRect(ctx, 'R', x, y, w, d, 10, 0.44, 0.56, 0, h, shade(S.color, -0.25));
      box(ctx, x - 0.02, y - 0.02, w + 0.04, d + 0.04, 10 + h, 2, '#aeb5bd');
      box(ctx, x + 0.18, y + 0.16, 0.26, 0.26, 12 + h, 14, S.color);
      wallText(ctx, 'L', x + 0.22, y + 0.42, 15 + h, 'HQ', 10, C.white);
      const dsh = P(x + 0.5, y + 0.14, 12 + h); ellipse(ctx, dsh[0], dsh[1] - 4, 7, 5, '#dfe5ea', '#8a95a3', 1);
      [0.14, 0.26, 0.38].forEach((u, i) => flag(ctx, gx + u, gy + 0.92, 2, i === 1 ? S.color : TRIM, t + i * 7, 22));
    },

    // radio shack -> television studio -> broadcast headquarters with a video wall
    media(ctx, gx, gy, lv, S, t) {
      const mast = (bx, by, z0, th) => {
        const base = [P(bx - 0.1, by - 0.04, z0), P(bx + 0.1, by - 0.04, z0), P(bx, by + 0.1, z0)], tip = P(bx, by, z0 + th);
        ctx.strokeStyle = '#c5ccd6'; ctx.lineWidth = 1.2;
        base.forEach((b) => { ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(tip[0], tip[1]); ctx.stroke(); });
        ctx.lineWidth = 0.8;
        for (let i = 1; i < 7; i++) { const f = i / 7, q = base.map((b) => [b[0] + (tip[0] - b[0]) * f, b[1] + (tip[1] - b[1]) * f]); ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); ctx.lineTo(q[1][0], q[1][1]); ctx.lineTo(q[2][0], q[2][1]); ctx.closePath(); ctx.stroke(); }
        if (Math.floor(t / 10) % 2) glow(ctx, tip[0], tip[1], 9, '#ff5a5a', 1);
        ellipse(ctx, tip[0], tip[1], 1.6, 1.6, '#ff5a5a');
      };
      const dish = (x, y, z, r) => { const p = P(x, y, z); post(ctx, x, y, z, z + r * 0.7, '#8a95a3'); ellipse(ctx, p[0] + r * 0.2, p[1] - r * 0.9, r, r * 0.72, '#dfe5ea', '#8a95a3', 1); ellipse(ctx, p[0] + r * 0.2, p[1] - r * 0.9, r * 0.25, r * 0.2, '#8a95a3'); };
      if (lv === 1) {
        const x = gx + 0.3, y = gy + 0.42, w = 0.4, d = 0.32;
        box(ctx, x, y, w, d, 2, 12, '#7d6a58');
        wallRect(ctx, 'L', x, y, w, d, 2, 0.12, 0.5, 4, 9, C.lit); wallRect(ctx, 'L', x, y, w, d, 2, 0.64, 0.86, 0, 9, '#3d2a22');
        wallRect(ctx, 'R', x, y, w, d, 2, 0.25, 0.75, 4, 9, shade(C.lit, -0.18));
        box(ctx, x - 0.02, y - 0.02, w + 0.04, d + 0.04, 14, 1.5, '#55606f');
        box(ctx, x + 0.04, y + d, 0.16, 0.02, 9.5, 4, C.red);
        mast(gx + 0.28, gy + 0.3, 2, 36);
        dish(x + 0.3, y + 0.1, 15.5, 4.5);
        return;
      }
      if (lv === 2) {
        const x = gx + 0.14, y = gy + 0.3, w = 0.72, d = 0.52, h = 22;
        box(ctx, x, y, w, d, 2, h, '#55606f');
        windows(ctx, x, y, w, d, 2, h, { rows: 1, cols: 5, seed: gx * 5 + gy * 3, base: 5, cap: 8, lit: '#9fd8ff' });
        wallRect(ctx, 'R', x, y, w, d, 2, 0.15, 0.85, 4, 17, '#0d1620'); wallRect(ctx, 'R', x, y, w, d, 2, 0.19, 0.81, 6, 15, Math.floor(t / 14) % 2 ? S.color : '#3fa7d6');
        dish(gx + 0.7, gy + 0.56, h + 2, 7);
        mast(gx + 0.34, gy + 0.42, h + 2, 54);
        return;
      }
      // headquarters: dish farm on the annex, glass studio tower, full-height video wall, tall mast
      box(ctx, gx + 0.6, gy + 0.3, 0.3, 0.56, 2, 16, '#55606f');
      windows(ctx, gx + 0.6, gy + 0.3, 0.3, 0.56, 2, 16, { rows: 1, cols: 2, seed: 9, base: 4, cap: 4, lit: '#9fd8ff' });
      dish(gx + 0.72, gy + 0.42, 18, 9); dish(gx + 0.78, gy + 0.7, 18, 7);
      const x = gx + 0.1, y = gy + 0.26, w = 0.46, d = 0.56, h = 54;
      box(ctx, x, y, w, d, 2, h, '#2d4f66', { top: '#22303d' });
      curtain(ctx, x, y, w, d, 2, h, 6, 4, 41, '#9fd8ff', 0.75);
      wallRect(ctx, 'L', x, y, w, d, 2, 0.06, 0.94, 22, 50, '#0d1620');
      const ph = Math.floor(t / 12) % 3;
      [0, 1, 2].forEach((i) => wallRect(ctx, 'L', x, y, w, d, 2, 0.1 + i * 0.28, 0.34 + i * 0.28, 25, 47, i === ph ? S.color : i === (ph + 1) % 3 ? '#3fa7d6' : '#f2b33d'));
      glow(ctx, P(x + 0.23, y + d, 38)[0], P(x + 0.23, y + d, 38)[1], 28, S.color, 0.4);
      mast(x + 0.23, y + 0.26, h + 2, 54);
    },

    // tailgate lawn -> paved plaza with a big screen -> festival grounds with a Ferris wheel
    fanzone(ctx, gx, gy, lv, S, t, R) {
      if (lv === 1) {
        box(ctx, gx + 0.08, gy + 0.08, 0.84, 0.84, 2, 0.8, '#5c9a6c');
        tree(ctx, gx + 0.22, gy + 0.2, 0.75);
        picnic(ctx, gx + 0.5, gy + 0.3); picnic(ctx, gx + 0.26, gy + 0.56); picnic(ctx, gx + 0.62, gy + 0.62);
        cyl(ctx, gx + 0.82, gy + 0.4, 3.5, 2, 5, '#2b333d');
        flag(ctx, gx + 0.84, gy + 0.84, 2, S.color, t, 24);
        tree(ctx, gx + 0.2, gy + 0.84, 0.6);
        return;
      }
      box(ctx, gx + 0.06, gy + 0.06, 0.88, 0.88, 2, 1, '#cbbfa6');
      if (lv === 2) {
        tree(ctx, gx + 0.2, gy + 0.22, 0.8);
        box(ctx, gx + 0.3, gy + 0.14, 0.5, 0.05, 3, 30, '#1a222c');
        wallRect(ctx, 'L', gx + 0.3, gy + 0.14, 0.5, 0.05, 3, 0.05, 0.95, 8, 28, S.color);
        if (R.score) wallText(ctx, 'L', gx + 0.36, gy + 0.19, 14, R.score, 10, C.white);
        glow(ctx, P(gx + 0.55, gy + 0.3, 20)[0], P(gx + 0.55, gy + 0.3, 20)[1], 26, S.color, 0.35);
        const c = P(gx + 0.56, gy + 0.6, 3);
        ellipse(ctx, c[0], c[1], 13, 6.5, '#8fa3ad'); ellipse(ctx, c[0], c[1], 10.5, 5.2, '#4fb4d8'); ellipse(ctx, c[0], c[1] - 1.5, 3.5, 1.8, '#d5f1fb');
        bench(ctx, gx + 0.3, gy + 0.5); tree(ctx, gx + 0.2, gy + 0.78, 0.8);
        return;
      }
      // festival grounds: Ferris wheel, giant screen, covered stage, food tents, lights overhead
      const hub = P(gx + 0.28, gy + 0.3, 34), rad = 26;
      [[-0.1, 0.1], [0.1, -0.1]].forEach(([a, b]) => { const q = P(gx + 0.28 + a, gy + 0.3 + b, 3); ctx.strokeStyle = '#aab3bf'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(hub[0], hub[1]); ctx.stroke(); });
      ellipse(ctx, hub[0], hub[1], rad, rad, null, '#e6e9ee', 2); ellipse(ctx, hub[0], hub[1], rad - 5, rad - 5, null, 'rgba(230,233,238,.5)', 1);
      for (let i = 0; i < 10; i++) {
        const an = t * 0.02 + (i * Math.PI) / 5, ex = hub[0] + Math.cos(an) * rad, ey = hub[1] + Math.sin(an) * rad;
        ctx.strokeStyle = 'rgba(230,233,238,.7)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(hub[0], hub[1]); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.fillStyle = [S.color, '#f2b33d', '#4f8fd9', '#eef1f4'][i % 4]; ctx.fillRect(ex - 2.5, ey, 5, 4.5);
      }
      ellipse(ctx, hub[0], hub[1], 3, 3, S.color);
      box(ctx, gx + 0.5, gy + 0.1, 0.42, 0.05, 3, 36, '#1a222c');
      wallRect(ctx, 'L', gx + 0.5, gy + 0.1, 0.42, 0.05, 3, 0.05, 0.95, 10, 34, S.color);
      if (R.score) wallText(ctx, 'L', gx + 0.55, gy + 0.15, 17, R.score, 11, C.white);
      glow(ctx, P(gx + 0.7, gy + 0.3, 24)[0], P(gx + 0.7, gy + 0.3, 24)[1], 30, S.color, 0.4);
      box(ctx, gx + 0.52, gy + 0.5, 0.36, 0.22, 2, 4, '#3d4957');
      [[0.53, 0.51], [0.87, 0.51], [0.53, 0.71], [0.87, 0.71]].forEach(([a, b]) => post(ctx, gx + a, gy + b, 6, 24, '#c5ccd6', 1.4));
      box(ctx, gx + 0.5, gy + 0.48, 0.4, 0.26, 24, 2.5, '#22303d');
      [0.58, 0.7, 0.82].forEach((u, i) => { const q = P(gx + u, gy + 0.74, 23); ellipse(ctx, q[0], q[1], 1.8, 1.8, '#fff1c2'); glow(ctx, q[0], q[1], 8, i % 2 ? S.color : '#fff1c2', 0.8); });
      box(ctx, gx + 0.12, gy + 0.7, 0.16, 0.14, 3, 7, C.white); tent(ctx, gx + 0.1, gy + 0.68, 0.2, 0.18, 10, 7, S.color, C.white);
      box(ctx, gx + 0.34, gy + 0.76, 0.14, 0.12, 3, 7, C.white); tent(ctx, gx + 0.32, gy + 0.74, 0.18, 0.16, 10, 7, '#f2b33d', C.white);
      stringLights(ctx, gx + 0.06, gy + 0.94, gx + 0.94, gy + 0.94, 26, C.lit, S.color);
      post(ctx, gx + 0.06, gy + 0.94, 2, 26, '#8a95a3'); post(ctx, gx + 0.94, gy + 0.94, 2, 26, '#8a95a3');
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

  // Five different venues: grass-berm field, concrete bowl, double-deck stadium with a canopy,
  // roofed arena with a glass facade, and a fully enclosed dome.
  const TIERS = [{ a: 66, b: 27, H: 8 }, { a: 84, b: 34.5, H: 14 }, { a: 99, b: 40.5, H: 21 }, { a: 99, b: 40.5, H: 26 }, { a: 99, b: 40.5, H: 28 }];
  R.drawStadium = function (ctx) {
    const S = this.state, lv = S.stadium, t = this.t, T = TIERS[lv - 1];
    const [cx, cy] = P(2, 2, 3);
    const a = T.a, b = T.b, H = T.H, ai = a * 0.66, bi = b * 0.62, ry = cy - H;
    const sel = this.selected === 'stadium' || this.hover === 'stadium';
    poly(ctx, [P(1.04, 1.04, 2), P(2.96, 1.04, 2), P(2.96, 2.96, 2), P(1.04, 2.96, 2)], lv === 1 ? (sel ? '#6fae7f' : '#5c9a6c') : sel ? '#c9c4b8' : '#aaa598');
    ellipse(ctx, cx, cy + 4, a + 5, b + 4, 'rgba(0,0,0,.25)');
    const tower = (dx, dy, tall) => {
      const x = cx + dx, y = cy + dy, top = y - H - tall;
      ctx.strokeStyle = '#aab3bf'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y - H + 4); ctx.lineTo(x, top); ctx.stroke();
      ctx.fillStyle = '#e9edf2'; ctx.fillRect(x - 8, top - 6, 16, 8);
      ctx.fillStyle = '#fff6d6'; for (let i = 0; i < 4; i++) ctx.fillRect(x - 7 + i * 4, top - 5, 3, 6);
      glow(ctx, x, top - 2, 22, '#fff1c2', 0.4);
    };
    if (lv === 2 || lv === 3) [[-a * 0.72, -b * 0.62], [a * 0.72, -b * 0.62]].forEach((p) => tower(p[0], p[1], lv === 2 ? 40 : 52));

    if (lv < 5) {
      // seating bowl seen through the rim
      ctx.save();
      ctx.beginPath(); ctx.ellipse(cx, ry, a, b, 0, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = lv === 1 ? '#7d8791' : '#39465a'; ctx.fillRect(cx - a, ry - b, a * 2, b * 2 + H);
      const rings = lv === 1 ? 3 : 6;
      for (let i = 0; i <= rings; i++) {
        const f = i / rings;
        ellipse(ctx, cx, ry + (cy - 2 - ry) * f, a + (ai - a) * f, b + (bi - b) * f, lv === 1 ? (i % 2 ? '#8b959f' : '#79838d') : i % 2 ? '#445369' : '#3b485c');
      }
      if (lv >= 3) ellipse(ctx, cx, ry + (cy - 2 - ry) * 0.42, a + (ai - a) * 0.42, b + (bi - b) * 0.42, null, S.color, 1.5); // upper-deck fascia
      const dots = Math.round(a * 7), fillTo = this.fill;
      for (let i = 0; i < dots; i++) {
        if (hash(i, 3) > fillTo) continue;
        const f = 0.06 + hash(i, 1) * 0.86, th = hash(i, 2) * Math.PI * 2;
        const ex = cx + Math.cos(th) * (a + (ai - a) * f), ey = ry + (cy - 2 - ry) * f + Math.sin(th) * (b + (bi - b) * f);
        const pick = hash(i, 5);
        ctx.fillStyle = pick < 0.5 ? S.color : pick < 0.8 ? TRIM : '#1d2632';
        ctx.fillRect(ex - 1, ey - 1 + (this.gameDay ? Math.sin(t * 0.5 + i) * 0.7 : 0), 2, 2);
      }
      ellipse(ctx, cx, cy - 2, ai, bi, lv === 1 ? '#4c8a5c' : '#2c5d43');
      const fw = ai * 0.75, fh = bi * 0.48, fy = cy - 2, ez = fw * 0.18, yd = (fw * 2 - ez * 2) / 10;
      ctx.fillStyle = '#3f9a5c'; ctx.fillRect(cx - fw, fy - fh, fw * 2, fh * 2);
      for (let i = 0; i < 10; i++) if (i % 2) { ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fillRect(cx - fw + ez + i * yd, fy - fh, yd, fh * 2); }
      ctx.fillStyle = S.color; ctx.fillRect(cx - fw, fy - fh, ez, fh * 2); ctx.fillRect(cx + fw - ez, fy - fh, ez, fh * 2);
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 0.8; ctx.strokeRect(cx - fw, fy - fh, fw * 2, fh * 2);
      for (let i = 1; i < 10; i++) { ctx.beginPath(); ctx.moveTo(cx - fw + ez + i * yd, fy - fh); ctx.lineTo(cx - fw + ez + i * yd, fy + fh); ctx.globalAlpha = i === 5 ? 0.9 : 0.4; ctx.stroke(); }
      ctx.globalAlpha = 1;
      ellipse(ctx, cx, fy, 4, 2, null, 'rgba(255,255,255,.8)', 0.8);
      ctx.restore();
    }

    // near-side outer wall: grass berm, bare concrete, lit concourse, then glass
    const wallPath = () => { ctx.beginPath(); ctx.ellipse(cx, ry, a, b, 0, 0, Math.PI, false); ctx.ellipse(cx, cy, a, b, 0, Math.PI, 0, true); ctx.closePath(); };
    const wall = ctx.createLinearGradient(cx - a, 0, cx + a, 0);
    const stops = lv === 1 ? ['#6fae7f', '#56935f', '#3f7350'] : lv <= 3 ? ['#c7ccd3', '#9aa1ab', '#646c78'] : ['#7fc0d8', '#4f93ad', '#2f6078'];
    stops.forEach((c, i) => wall.addColorStop(i / 2, tone(c)));
    wallPath(); ctx.fillStyle = wall; ctx.fill();
    ctx.save(); wallPath(); ctx.clip();
    if (lv === 3) { ctx.setLineDash([5, 4]); ellipse(ctx, cx, ry + H * 0.55, a - 0.5, b - 0.5, null, 'rgba(255,214,133,.9)', Math.max(3, H * 0.28)); ctx.setLineDash([]); }
    if (lv === 2) { ctx.setLineDash([2, 9]); ellipse(ctx, cx, ry + H * 0.5, a - 0.5, b - 0.5, null, '#59616c', H * 0.5); ctx.setLineDash([]); }
    if (lv >= 4) {
      ctx.setLineDash([1.2, 5]); ellipse(ctx, cx, ry + H * 0.5, a - 0.5, b - 0.5, null, 'rgba(255,255,255,.55)', H);
      ctx.setLineDash([9, 3]); ellipse(ctx, cx, ry + H * 0.3, a - 0.5, b - 0.5, null, '#cfe9ff', H * 0.22);
      ctx.setLineDash([]); ellipse(ctx, cx, ry + H * 0.72, a - 0.5, b - 0.5, null, S.color, H * 0.2);
    }
    if (lv > 1) ellipse(ctx, cx, cy - 1.5, a, b, null, S.color, 3);
    ctx.restore();
    if (lv < 5) ellipse(ctx, cx, ry, a, b, null, lv === 1 ? '#aab3bf' : '#e6e9ee', lv === 1 ? 1.5 : 2.5);

    if (lv === 3) {
      ctx.beginPath(); ctx.ellipse(cx, ry - 9, a + 4, b + 3, 0, Math.PI * 1.04, Math.PI * 1.96, false);
      ctx.ellipse(cx, ry - 4, a - 20, b - 12, 0, Math.PI * 1.96, Math.PI * 1.04, true); ctx.closePath();
      ctx.fillStyle = 'rgba(222,228,235,.9)'; ctx.fill(); ctx.strokeStyle = S.color; ctx.lineWidth = 1.5; ctx.stroke();
      [[-a * 0.86, b * 0.3], [a * 0.86, b * 0.3]].forEach((p) => tower(p[0], p[1] + H, 44));
    }
    if (lv === 4) {
      // a ring roof all the way round, open over the pitch
      const ox = cx, oy = ry - 7, hx = cx, hy = cy - H * 0.42, hrx = a * 0.6, hry = b * 0.55;
      ctx.beginPath(); ctx.ellipse(ox, oy, a + 6, b + 4, 0, 0, Math.PI * 2); ctx.ellipse(hx, hy, hrx, hry, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#e6ebf0'; ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(110,125,140,.55)'; ctx.lineWidth = 0.8;
      for (let i = 0; i < 28; i++) { const an = (i / 28) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(hx + Math.cos(an) * hrx, hy + Math.sin(an) * hry); ctx.lineTo(ox + Math.cos(an) * (a + 6), oy + Math.sin(an) * (b + 4)); ctx.stroke(); }
      ellipse(ctx, ox, oy, a + 6, b + 4, null, S.color, 2.5); ellipse(ctx, hx, hy, hrx, hry, null, '#ffffff', 1.5);
      ctx.setLineDash([2, 7]); ellipse(ctx, hx, hy, hrx + 3, hry + 2, null, '#fff6d6', 2.5); ctx.setLineDash([]);
      glow(ctx, hx, hy, 60, '#fff1c2', 0.3);
    }
    if (lv === 5) {
      // enclosed dome: a ribbed translucent shell with a glowing oculus
      const Hd = 54, base = ry + 1;
      const shell = ctx.createLinearGradient(0, base - Hd, 0, base + b);
      shell.addColorStop(0, tone('#fbfdff')); shell.addColorStop(0.6, tone('#d3dde7')); shell.addColorStop(1, tone('#a9b8c8'));
      ctx.beginPath(); ctx.ellipse(cx, base, a + 3, b + 1.5, 0, 0, Math.PI, false); ctx.ellipse(cx, base, a + 3, Hd, 0, Math.PI, Math.PI * 2, false); ctx.closePath();
      ctx.fillStyle = shell; ctx.fill();
      ctx.save(); ctx.clip();
      const side = ctx.createLinearGradient(cx - a, 0, cx + a, 0);
      side.addColorStop(0, 'rgba(255,255,255,.25)'); side.addColorStop(0.55, 'rgba(255,255,255,0)'); side.addColorStop(1, 'rgba(40,60,90,.3)');
      ctx.fillStyle = side; ctx.fillRect(cx - a - 4, base - Hd, a * 2 + 8, Hd + b + 4);
      ctx.strokeStyle = 'rgba(105,125,150,.55)'; ctx.lineWidth = 0.9;
      [0.2, 0.4, 0.6, 0.8, 1].forEach((u) => { ctx.beginPath(); ctx.ellipse(cx, base, (a + 3) * u, Hd, 0, Math.PI, Math.PI * 2, false); ctx.stroke(); });
      [0.8, 0.58, 0.36].forEach((g) => { const lift = (Hd - b * 0.5) * Math.sqrt(1 - g * g); ctx.beginPath(); ctx.ellipse(cx, base - lift, (a + 3) * g, (b + 1.5) * g, 0, 0, Math.PI, false); ctx.stroke(); });
      ctx.restore();
      ctx.beginPath(); ctx.ellipse(cx, base, a + 3, b + 1.5, 0, 0, Math.PI, false); ctx.strokeStyle = S.color; ctx.lineWidth = 3; ctx.stroke();
      ellipse(ctx, cx, base - Hd + b * 0.36, a * 0.17, b * 0.17, '#cfe9ff', '#ffffff', 1.5);
      glow(ctx, cx, base - Hd + b * 0.36, 26, '#cfe9ff', 0.7);
      glow(ctx, cx, base - 12, 120, '#dfeeff', 0.22);
      // score on a marquee above the main entrance
      const my = ry + b + H * 0.42;
      ctx.fillStyle = '#10171f'; ctx.fillRect(cx - 30, my - 7, 60, 14);
      ctx.strokeStyle = '#8a95a3'; ctx.lineWidth = 1; ctx.strokeRect(cx - 30, my - 7, 60, 14);
      ctx.font = '700 11px "Barlow Condensed", "Arial Narrow", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd685'; ctx.fillText(this.score || 'KICKOFF', cx, my + 0.5);
      return;
    }
    // scoreboard at the far end: a small manual board at the first field, a video board after that
    const sx = cx, sy = ry - b - (lv === 1 ? 8 : 12) - (lv >= 3 ? 8 : 0), bw = lv === 1 ? 19 : 27;
    ctx.fillStyle = lv === 1 ? '#6f4e33' : '#7a8491'; ctx.fillRect(sx - bw + 7, sy + 10, 2, 12); ctx.fillRect(sx + bw - 9, sy + 10, 2, 12);
    ctx.fillStyle = lv === 1 ? '#2f4a3a' : '#10171f'; ctx.fillRect(sx - bw, sy - 4, bw * 2, lv === 1 ? 14 : 18);
    ctx.strokeStyle = lv === 1 ? '#e9dcc0' : '#8a95a3'; ctx.lineWidth = 1; ctx.strokeRect(sx - bw, sy - 4, bw * 2, lv === 1 ? 14 : 18);
    ctx.font = '700 ' + (lv === 1 ? 9 : 12) + 'px "Barlow Condensed", "Arial Narrow", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = lv === 1 ? '#f1ede3' : '#ffd685'; ctx.fillText(this.score || 'KICKOFF', sx, sy + (lv === 1 ? 3.5 : 5.5));
    if (lv > 1) glow(ctx, cx, cy - 6, 95, '#fff1c2', 0.16 + lv * 0.03);
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
    cityhall(ctx, gx, gy, v, S, t, face, tier) {
      const domeCol = tier >= 5 ? '#d8b45a' : '#6fae9a', domeTop = tier >= 5 ? '#f0d58a' : '#7dbba7';
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
      ctx.beginPath(); ctx.ellipse(c[0], c[1] - 9, 14, 15, 0, Math.PI, 0); ctx.closePath(); ctx.fillStyle = domeCol; ctx.fill();
      ctx.beginPath(); ctx.ellipse(c[0] + 4, c[1] - 9, 10, 15, 0, Math.PI * 1.5, 0); ctx.lineTo(c[0] + 4, c[1] - 9); ctx.closePath(); ctx.fillStyle = 'rgba(0,0,0,.16)'; ctx.fill();
      ellipse(ctx, c[0], c[1] - 9, 14, 7, domeTop);
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
  // ---- scenery that only appears at some town tiers ----------------------------------------
  Object.assign(TOWN, {
    field(ctx, gx, gy, v) {
      const cols = v % 3 === 0 ? ['#b59a55', '#a48a48'] : v % 3 === 1 ? ['#5f9a52', '#528a47'] : ['#8a6a48', '#7a5c3e'];
      for (let i = 0; i < 9; i++) poly(ctx, [P(gx + 0.06 + i * 0.098, gy + 0.06, 2), P(gx + 0.06 + (i + 1) * 0.098, gy + 0.06, 2), P(gx + 0.06 + (i + 1) * 0.098, gy + 0.94, 2), P(gx + 0.06 + i * 0.098, gy + 0.94, 2)], cols[i % 2]);
      if (v % 3 === 0) [[0.3, 0.3], [0.62, 0.5], [0.34, 0.74]].forEach(([a, b]) => cyl(ctx, gx + a, gy + b, 4, 2, 5, '#d8c27a'));
      if (v % 2) { post(ctx, gx + 0.7, gy + 0.3, 2, 13, '#6f4e33', 1.4); box(ctx, gx + 0.66, gy + 0.29, 0.08, 0.02, 9, 1.2, '#6f4e33'); ellipse(ctx, P(gx + 0.7, gy + 0.3, 15)[0], P(gx + 0.7, gy + 0.3, 15)[1], 2, 2, '#d8c27a'); }
      for (let i = 0; i < 5; i++) post(ctx, gx + 0.06 + i * 0.22, gy + 0.96, 2, 6, '#6f4e33', 1);
    },
    barn(ctx, gx, gy) {
      cyl(ctx, gx + 0.26, gy + 0.3, 8, 2, 26, '#aeb5bd'); ellipse(ctx, P(gx + 0.26, gy + 0.3, 28)[0], P(gx + 0.26, gy + 0.3, 28)[1] - 2, 8, 6, '#8a929c');
      const x = gx + 0.36, y = gy + 0.3, w = 0.5, d = 0.42;
      box(ctx, x, y, w, d, 2, 15, '#a8483c');
      wallRect(ctx, 'L', x, y, w, d, 2, 0.34, 0.66, 0, 11, '#efe6d2'); wallRect(ctx, 'L', x, y, w, d, 2, 0.37, 0.63, 0.8, 10.2, '#8a3a30');
      wallRect(ctx, 'R', x, y, w, d, 2, 0.4, 0.6, 9, 13, '#3d2a22');
      gable(ctx, x - 0.02, y - 0.02, w + 0.04, d + 0.04, 17, 11, '#5a4a44', '#a8483c');
      for (let i = 0; i < 6; i++) post(ctx, gx + 0.08 + i * 0.17, gy + 0.9, 2, 6, '#efe6d2', 1);
      tree(ctx, gx + 0.14, gy + 0.74, 0.6);
    },
    woods(ctx, gx, gy, v) {
      [[0.2, 0.18, 0.9], [0.56, 0.14, 0.7], [0.82, 0.3, 0.85], [0.36, 0.44, 1], [0.68, 0.58, 0.8], [0.18, 0.72, 0.75], [0.48, 0.82, 0.9], [0.84, 0.84, 0.65]]
        .forEach(([a, b, s], i) => { if (hash(i, v) > 0.18) tree(ctx, gx + a, gy + b, s); });
    },
    store(ctx, gx, gy, v, S, t, face) {
      const x = gx + 0.2, y = gy + 0.22, w = 0.58, d = 0.42;
      box(ctx, x, y, w, d, 2, 15, '#a07a52');
      wallRect(ctx, 'L', x, y, w, d, 2, 0.08, 0.38, 4, 11, C.lit); wallRect(ctx, 'L', x, y, w, d, 2, 0.44, 0.58, 0, 11, '#3d2a22'); wallRect(ctx, 'L', x, y, w, d, 2, 0.64, 0.92, 4, 11, C.lit);
      box(ctx, x - 0.02, y + d, w + 0.04, 0.12, 13, 1.5, '#6f4e33'); post(ctx, x, y + d + 0.11, 2, 13, '#6f4e33'); post(ctx, x + w, y + d + 0.11, 2, 13, '#6f4e33');
      box(ctx, x - 0.02, y - 0.02, w + 0.04, d + 0.04, 17, 1.5, '#6f4e33');
      box(ctx, x + 0.08, y + 0.26, w - 0.16, 0.04, 18.5, 8, '#efe6d2'); wallText(ctx, 'L', x + 0.11, y + 0.3, 20, 'GENERAL', 6.5, '#3d2a22');
      cyl(ctx, gx + 0.84, gy + 0.74, 3, 2, 5, '#6f4e33'); cyl(ctx, gx + 0.9, gy + 0.64, 3, 2, 5, '#8a6240');
    },
    skyscraper(ctx, gx, gy, v) {
      const col = ['#3f7f98', '#55608f', '#2f8a84', '#6a7f96'][v % 4], h = 84 + ((v * 5) % 4) * 12, lit = v % 2 ? '#ffe2a6' : '#cfe9ff';
      box(ctx, gx + 0.08, gy + 0.08, 0.84, 0.84, 2, 10, '#2f3948');
      wallRect(ctx, 'L', gx + 0.08, gy + 0.08, 0.84, 0.84, 2, 0.06, 0.94, 2, 8, lit); wallRect(ctx, 'R', gx + 0.08, gy + 0.08, 0.84, 0.84, 2, 0.06, 0.94, 2, 8, shade(lit, -0.18));
      box(ctx, gx + 0.16, gy + 0.16, 0.68, 0.68, 12, h * 0.62, col, { top: '#22303d' });
      curtain(ctx, gx + 0.16, gy + 0.16, 0.68, 0.68, 12, h * 0.62, Math.round(h * 0.62 / 7), 6, v * 19 + 5, lit, 0.62);
      box(ctx, gx + 0.26, gy + 0.26, 0.48, 0.48, 12 + h * 0.62, h * 0.38, shade(col, 0.12), { top: '#22303d' });
      curtain(ctx, gx + 0.26, gy + 0.26, 0.48, 0.48, 12 + h * 0.62, h * 0.38, Math.round(h * 0.38 / 7), 4, v * 23 + 9, lit, 0.66);
      box(ctx, gx + 0.25, gy + 0.25, 0.5, 0.5, 12 + h, 2.5, v % 2 ? '#d8b45a' : '#aeb5bd');
      const p = post(ctx, gx + 0.5, gy + 0.5, 14 + h, 30 + h, '#c5ccd6', 1.4);
      ellipse(ctx, p[0], p[1], 1.5, 1.5, '#ff5a5a');
    },
    condo(ctx, gx, gy, v) {
      const x = gx + 0.16, y = gy + 0.18, w = 0.68, d = 0.62, h = 62 + (v % 2) * 10;
      box(ctx, gx + 0.1, gy + 0.12, 0.8, 0.74, 2, 6, '#cfc8b8');
      box(ctx, x, y, w, d, 8, h, '#eef1f4', { top: '#4c8a5c' });
      for (let r = 0; r < Math.round(h / 9); r++) {
        wallRect(ctx, 'L', x, y, w, d, 8, 0.04, 0.96, 3 + r * 9, 8 + r * 9, hash(r, v) < 0.7 ? '#ffe2a6' : '#5fb0c9');
        wallRect(ctx, 'R', x, y, w, d, 8, 0.04, 0.96, 3 + r * 9, 8 + r * 9, hash(r, v + 3) < 0.6 ? shade('#ffe2a6', -0.18) : shade('#5fb0c9', -0.2));
      }
      [[0.22, 0.2], [0.5, 0.36]].forEach(([a, b]) => { const p = P(x + a, y + b, 8 + h); ellipse(ctx, p[0], p[1] - 4, 5, 5, '#3f8f5d'); });
    },
    museum(ctx, gx, gy, v, S) {
      box(ctx, gx + 0.04, gy + 0.08, 0.92, 0.88, 2, 2.5, '#e6e9ee');
      const x = gx + 0.1, y = gy + 0.14, w = 0.8, d = 0.6;
      box(ctx, x, y, w, d, 4.5, 16, '#f4f6f8');
      wallRect(ctx, 'L', x, y, w, d, 4.5, 0.06, 0.94, 2, 13, '#cfe9ff'); for (let c = 1; c < 8; c++) wallRect(ctx, 'L', x, y, w, d, 4.5, c / 8 - 0.01, c / 8 + 0.01, 2, 13, '#f4f6f8');
      wallRect(ctx, 'R', x, y, w, d, 4.5, 0.1, 0.9, 2, 13, shade('#cfe9ff', -0.2));
      vault(ctx, x + 0.04, y + 0.04, w - 0.08, d - 0.08, 20.5, 13, '#dfe6ee', 5);
      wallRect(ctx, 'L', x, y, w, d, 4.5, 0.02, 0.1, 0, 16, S.color);
    },
    mall(ctx, gx, gy, v, S, t, face) {
      const x = gx + 0.08, y = gy + 0.14, w = 0.84, d = 0.64;
      box(ctx, x, y, w, d, 2, 15, '#d9d2c2');
      ['L', 'R'].forEach((s) => wallRect(ctx, s, x, y, w, d, 2, 0.05, 0.95, 2, 11, s === 'L' ? C.lit : shade(C.lit, -0.18)));
      for (let c = 1; c < 7; c++) wallRect(ctx, 'L', x, y, w, d, 2, c / 7 - 0.012, c / 7 + 0.012, 2, 11, '#d9d2c2');
      box(ctx, x - 0.02, y - 0.02, w + 0.04, d + 0.04, 17, 1.5, '#aeb5bd');
      vault(ctx, x + 0.1, y + 0.18, w - 0.2, d - 0.36, 18.5, 9, '#8fc7dd', 5);
      box(ctx, x + 0.28, y + d, 0.28, 0.04, 12, 7, S.color); wallText(ctx, 'L', x + 0.31, y + d + 0.04, 13.5, 'GALLERIA', 5.5, C.white);
    },
    townhouses(ctx, gx, gy, v) {
      const cols = ['#e9dcc0', '#9aa7b4', '#c98f6a', '#dfe5ea'];
      [0, 1, 2].forEach((i) => {
        const x = gx + 0.1 + i * 0.27, y = gy + 0.24, w = 0.25, d = 0.48, h = 22 + ((i + v) % 2) * 4;
        box(ctx, x, y, w, d, 2, h, cols[(i + v) % 4], { top: '#3d4957' });
        for (let r = 0; r < 3; r++) wallRect(ctx, 'L', x, y, w, d, 2, 0.16, 0.84, 9 + r * 6.5 - (r === 0 ? 5 : 0), 13.5 + r * 6.5, r === 0 ? '#3d2a22' : hash(i + v, r) < 0.75 ? C.lit : C.dim);
        if (i === 2) for (let c = 0; c < 2; c++) for (let r = 0; r < 2; r++) wallRect(ctx, 'R', x, y, w, d, 2, 0.14 + c * 0.44, 0.42 + c * 0.44, 8 + r * 7, 13 + r * 7, shade(C.lit, -0.18));
      });
      tree(ctx, gx + 0.2, gy + 0.88, 0.45); tree(ctx, gx + 0.8, gy + 0.88, 0.45);
    },
  });
  // ---- city settings: scenery that replaces part of the town --------------------------------
  function pine(ctx, x, y, s) {
    s = s || 1;
    const [px, py] = P(x, y, 0);
    ellipse(ctx, px + 2, py + 1, 7 * s, 3.5 * s, 'rgba(0,0,0,.22)');
    ctx.fillStyle = '#5a4030'; ctx.fillRect(px - 1.2 * s, py - 6 * s, 2.4 * s, 7 * s);
    [[10, 6, 16], [8, 12, 12], [6, 18, 10]].forEach(([w, up, h], i) => poly(ctx, [[px - w * s, py - up * s], [px + w * s, py - up * s], [px, py - (up + h) * s]], i % 2 ? '#2f6f4c' : '#25583d'));
  }
  function palm(ctx, x, y, s) {
    s = s || 1;
    const [px, py] = P(x, y, 0), tx = px + 5 * s, ty = py - 24 * s;
    ellipse(ctx, px + 3, py + 1, 8 * s, 3.5 * s, 'rgba(0,0,0,.18)');
    ctx.strokeStyle = '#8a6240'; ctx.lineWidth = 2.4 * s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px - 2 * s, py - 14 * s, tx, ty); ctx.stroke();
    ctx.lineWidth = 2.2 * s;
    [[-13, -3], [-9, 6], [12, -4], [10, 6], [0, -11], [-5, -9], [7, -9]].forEach(([dx, dy], i) => { ctx.strokeStyle = i % 2 ? '#3f8f5d' : '#2f7a4a'; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(tx + dx * 0.6 * s, ty + (dy - 6) * s, tx + dx * s, ty + dy * s); ctx.stroke(); });
    ctx.lineCap = 'butt';
  }
  Object.assign(TOWN, {
    peak(ctx, gx, gy, v) {
      const h = 78 + ((v * 13) % 5) * 9, ax = gx + 0.44 + ((v * 7) % 3) * 0.06, ay = gy + 0.5, top = P(ax, ay, h);
      const L0 = P(gx - 0.08, gy + 1.02, 0), M = P(gx + 1.06, gy + 1.02, 0), R0 = P(gx + 1.06, gy - 0.06, 0), B0 = P(gx - 0.08, gy - 0.06, 0);
      poly(ctx, [B0, L0, top], '#59616c'); poly(ctx, [L0, M, top], '#7d8794'); poly(ctx, [M, R0, top], '#4f5762');
      const at = (p, f) => [top[0] + (p[0] - top[0]) * f, top[1] + (p[1] - top[1]) * f];
      const f = 0.36, l = at(L0, f), m = at(M, f), r = at(R0, f);
      poly(ctx, [l, at(L0, f + 0.07).map((q, i) => q + (i ? 0 : 5)), at(M, f - 0.05), m, top], '#f4f7fa');
      poly(ctx, [m, at(R0, f + 0.06), r, top], '#c9d3df');
      pine(ctx, gx + 0.2, gy + 0.96, 0.7); pine(ctx, gx + 0.62, gy + 1.0, 0.6);
    },
    pines(ctx, gx, gy, v) {
      [[0.2, 0.2, 1], [0.56, 0.12, 0.8], [0.82, 0.32, 0.95], [0.38, 0.46, 1.1], [0.7, 0.6, 0.9], [0.18, 0.7, 0.85], [0.5, 0.84, 1], [0.86, 0.86, 0.75]]
        .forEach(([a, b, s], i) => { if (hash(i, v + 3) > 0.15) pine(ctx, gx + a, gy + b, s); });
    },
    lodge(ctx, gx, gy, v, S, t, face, tier) {
      const big = tier >= 4, h = big ? 26 : 16, x = gx + 0.14, y = gy + 0.24, w = 0.72, d = 0.5;
      pine(ctx, gx + 0.12, gy + 0.12, 0.9); pine(ctx, gx + 0.9, gy + 0.14, 0.8);
      box(ctx, x, y, w, d, 2, h, '#8a5a3a');
      windows(ctx, x, y, w, d, 2, h, { rows: big ? 3 : 2, cols: 5, seed: 61, base: 3, cap: 2, litRate: 0.85 });
      wallRect(ctx, 'L', x, y, w, d, 2, 0.43, 0.57, 0, 9, '#3d2a22');
      gable(ctx, x - 0.04, y - 0.04, w + 0.08, d + 0.08, h + 2, 15, tier >= 2 ? '#f4f7fa' : '#5a4a44', '#8a5a3a');
      box(ctx, x + 0.56, y + 0.14, 0.07, 0.07, h + 8, 12, '#7a6a5e');
      if (tier >= 3) flag(ctx, x + 0.06, y + d, 2, S.color, t, 24);
      pine(ctx, gx + 0.1, gy + 0.9, 0.7);
    },
    boat(ctx, gx, gy, v, S, t) {
      const drift = ((t * 0.004 + v * 0.37) % 1.6) - 0.3, x = gx + drift, y = gy + 0.42 + (v % 2) * 0.16;
      poly(ctx, [P(x - 0.04, y, 1), P(x + 0.3, y, 1), P(x + 0.36, y + 0.07, 1), P(x + 0.3, y + 0.14, 1), P(x - 0.04, y + 0.14, 1)], '#eef1f4');
      box(ctx, x, y + 0.01, 0.28, 0.12, 1, 3, v % 2 ? S.color : '#eef1f4');
      box(ctx, x + 0.06, y + 0.03, 0.12, 0.08, 4, 4, '#dfe5ea'); wallRect(ctx, 'L', x + 0.06, y + 0.03, 0.12, 0.08, 4, 0.1, 0.9, 1, 3, '#9fd8ff');
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1;
      const a = P(x - 0.06, y + 0.03, 1), b = P(x - 0.3, y - 0.02, 1), c = P(x - 0.3, y + 0.16, 1), d = P(x - 0.06, y + 0.11, 1);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.moveTo(d[0], d[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
    },
    beach(ctx, gx, gy, v, S, t, face, tier) {
      // the sea is on the outer edge of the tile: local y for the front row, local x for the front column
      const o = (a, b) => (face === 'L' ? [gx + a, gy + b] : [gx + b, gy + a]);
      const um = (a, b, col) => { const q = o(a, b); umbrella(ctx, q[0], q[1], col); const p = P(q[0] + 0.07, q[1] + 0.05, 0.4); ctx.fillStyle = col; ctx.fillRect(p[0] - 5, p[1] - 1, 10, 3); };
      const k = v % 4;
      if (k === 0) { um(0.2, 0.3, S.color); um(0.5, 0.5, '#f2b33d'); um(0.8, 0.28, '#4f8fd9'); um(0.34, 0.66, TRIM); }
      else if (k === 1) {
        const q = o(0.22, 0.2); palm(ctx, q[0], q[1], 1); const q2 = o(0.78, 0.36); palm(ctx, q2[0], q2[1], 0.85);
        const l = o(0.5, 0.56); [[-0.05, -0.05], [0.05, -0.05], [-0.05, 0.05], [0.05, 0.05]].forEach(([a, b]) => post(ctx, l[0] + a, l[1] + b, 0, 12, '#efe6d2', 1.2));
        box(ctx, l[0] - 0.07, l[1] - 0.07, 0.14, 0.14, 12, 6, '#efe6d2'); box(ctx, l[0] - 0.09, l[1] - 0.09, 0.18, 0.18, 18, 1.5, C.red);
      } else if (k === 2) {
        const q = o(0.3, 0.24); box(ctx, q[0], q[1], 0.34, 0.22, 0, 9, '#a07a52'); wallRect(ctx, 'L', q[0], q[1], 0.34, 0.22, 0, 0.1, 0.9, 4, 8, C.lit);
        tent(ctx, q[0] - 0.05, q[1] - 0.05, 0.44, 0.32, 9, 10, '#c9a25a', '#a8843f');
        um(0.2, 0.62, S.color); um(0.72, 0.6, TRIM);
        if (tier >= 3) { const p2 = o(0.86, 0.16); palm(ctx, p2[0], p2[1], 0.8); }
      } else {
        const a = o(0.26, 0.5), b = o(0.7, 0.5), pa = post(ctx, a[0], a[1], 0, 13, '#efe6d2', 1.4), pb = post(ctx, b[0], b[1], 0, 13, '#efe6d2', 1.4);
        ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.moveTo(pa[0], pa[1] + 5); ctx.lineTo(pb[0], pb[1] + 5); ctx.stroke();
        const q = o(0.14, 0.18); palm(ctx, q[0], q[1], 0.95); um(0.84, 0.3, '#f2b33d');
      }
      if (tier >= 4) { const q = o(0.52, 0.1); box(ctx, q[0], q[1], 0.16, 0.12, 0, 7, '#eef1f4'); tent(ctx, q[0] - 0.02, q[1] - 0.02, 0.2, 0.16, 7, 6, TRIM, S.color); }
    },
  });
  const NO_SLAB = { peak: 1, pines: 1, boat: 1, beach: 1 };
  /** What a scenery lot shows once the city's setting is taken into account. Null = leave it to the terrain. */
  function sceneryKind(env, i, j, kind) {
    if (env === 'mountain' && (i === 0 || j === 0)) return i === 0 && j === 4 ? 'lodge' : (i + j) % 3 === 2 ? 'pines' : 'peak';
    if (env === 'river' && i === 8) return j % 3 === 1 ? 'boat' : null;
    if (env === 'beach' && (i === 8 || j === 8)) return 'beach';
    return kind;
  }
  // What stands on each scenery lot at each town tier. [row, col, [village, small town, town, city, metropolis], variant]
  const TOWN_PLAN = [
    [0, 0, ['woods', 'houses', 'office', 'office', 'skyscraper'], 0], [0, 1, ['field', 'houses', 'apartments', 'apartments', 'skyscraper'], 1],
    [0, 2, ['barn', 'store', 'library', 'library', 'museum'], 0], [0, 3, ['field', 'houses', 'office', 'skyscraper', 'skyscraper'], 2],
    [0, 4, ['store', 'cityhall', 'cityhall', 'cityhall', 'cityhall'], 0], [0, 5, ['field', 'houses', 'office', 'office', 'skyscraper'], 3],
    [0, 6, ['woods', 'diner', 'diner', 'office', 'skyscraper'], 4], [0, 7, ['field', 'houses', 'apartments', 'apartments', 'condo'], 1], [0, 8, ['woods', 'park', 'park', 'park', 'park'], 0],
    [1, 0, ['field', 'houses', 'office', 'skyscraper', 'skyscraper'], 5], [2, 0, ['woods', 'firehouse', 'firehouse', 'firehouse', 'firehouse'], 0],
    [3, 0, ['barn', 'houses', 'apartments', 'apartments', 'condo'], 2], [4, 0, ['field', 'school', 'school', 'school', 'museum'], 4],
    [5, 0, ['woods', 'houses', 'office', 'office', 'skyscraper'], 6], [6, 0, ['houses', 'cafe', 'cafe', 'cafe', 'mall'], 0],
    [7, 0, ['field', 'houses', 'houses', 'apartments', 'condo'], 0], [8, 0, ['woods', 'woods', 'park', 'park', 'park'], 1],
    [8, 1, ['field', 'houses', 'houses', 'houses', 'townhouses'], 1], [8, 2, ['woods', 'park', 'park', 'park', 'park'], 2],
    [8, 3, ['houses', 'diner', 'diner', 'diner', 'mall'], 1], [8, 4, ['field', 'houses', 'houses', 'townhouses', 'townhouses'], 2],
    [8, 5, ['woods', 'market', 'market', 'market', 'market'], 0], [8, 6, ['houses', 'houses', 'cafe', 'cafe', 'cafe'], 1],
    [8, 7, ['field', 'houses', 'houses', 'houses', 'townhouses'], 3], [8, 8, ['woods', 'woods', 'park', 'park', 'park'], 3],
    [1, 8, ['field', 'houses', 'cafe', 'cafe', 'mall'], 2], [2, 8, ['houses', 'houses', 'houses', 'townhouses', 'townhouses'], 5],
    [3, 8, ['woods', 'park', 'park', 'park', 'park'], 6], [4, 8, ['field', 'market', 'market', 'market', 'market'], 1],
    [5, 8, ['houses', 'houses', 'houses', 'houses', 'townhouses'], 6], [6, 8, ['woods', 'diner', 'diner', 'diner', 'diner'], 2], [7, 8, ['field', 'woods', 'park', 'park', 'park'], 5],
  ].sort((a, b) => a[0] + a[1] - b[0] - b[1]);
  const GREEN = { park: 1, houses: 1, woods: 1, barn: 1, field: 1, townhouses: 1 };
  // how busy the streets are at each tier: [cars, walkers, lamps per side]
  const BUSY = [[2, 8, 0], [4, 20, 2], [9, 44, 5], [12, 60, 7], [15, 78, 8]];

  R.drawTown = function (ctx, back) {
    const tier = this.state.stadium;
    TOWN_PLAN.forEach(([i, j, kinds, v]) => {
      if ((i === 0 || j === 0) !== back) return;
      const kind = sceneryKind(this.state.setting, i, j, kinds[tier - 1]), gx = j - 2, gy = i - 2, green = GREEN[kind];
      if (!kind) return;
      if (!NO_SLAB[kind]) box(ctx, gx + 0.04, gy + 0.04, 0.92, 0.92, 0, 2, green ? '#4a8a62' : C.walk, green ? { top: '#4a8a62', left: '#3a7350', right: '#2c5a40' } : null);
      TOWN[kind](ctx, gx, gy, v, this.state, this.t, i === 0 || i === 8 ? 'L' : 'R', tier);
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
    const env = this.state.setting || 'metro', beach = env === 'beach';
    poly(ctx, [D, Cc, [Cc[0], Cc[1] + 5], [D[0], D[1] + 5]], beach ? '#3f9fc4' : '#356b4d');
    poly(ctx, [Cc, B, [B[0], B[1] + 5], [Cc[0], Cc[1] + 5]], beach ? '#2f86a8' : '#28543c');
    poly(ctx, [A, B, Cc, D], env === 'mountain' ? '#3a7058' : C.grass);
    const sq = (a, b, fill, stroke) => poly(ctx, [P(a, a), P(b, a), P(b, b), P(a, b)], fill, stroke);
    const tier = this.state.stadium;         // the town grows up with the stadium
    sq(-2.04, G + 2.04, env === 'mountain' ? '#356652' : '#39745a');   // town blocks sit on slightly darker turf
    const band = (x0, y0, x1, y1, fill) => poly(ctx, [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], fill);
    const wave = Math.sin(this.t * 0.08) * 0.02;
    if (env === 'river') {
      band(lo, G + 0.98, hi, G + 2.04, '#c9bd94');                    // banks
      band(lo, G + 1.04, hi, G + 1.98, '#3f8fc0');
      band(lo, G + 1.04, hi, G + 1.2, '#5aa6d1');
      ctx.save(); ctx.setLineDash([10, 16]); ctx.lineDashOffset = -this.t * 0.4; ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
      [1.35, 1.6, 1.82].forEach((o) => { const a = P(lo, G + o), b = P(hi, G + o); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); });
      ctx.restore();
    }
    if (beach) {
      band(lo, G + 0.98, hi, hi, '#e6d3a3'); band(G + 0.98, lo, hi, hi, '#dcc892');   // sand on the two front sides
      band(lo, G + 1.9, hi, hi, '#3f9fc4'); band(G + 1.9, lo, hi, hi, '#3690b6');      // shallows
      band(lo, G + 1.86 + wave, hi, G + 1.92 + wave, '#f4fbff'); band(G + 1.86 + wave, lo, G + 1.92 + wave, G + 1.9, '#e6f4fb');
      band(lo, G + 2.1 - wave, hi, G + 2.13 - wave, 'rgba(255,255,255,.5)'); band(G + 2.1 - wave, lo, G + 2.13 - wave, G + 2.1, 'rgba(255,255,255,.45)');
    }
    sq(-1.0, G + 1.0, tier === 1 ? '#6f9a62' : tier >= 4 ? '#c9c4b8' : C.walk);   // verge, then sidewalk, then paving
    sq(-0.84, G + 0.84, tier === 1 ? '#9a8562' : C.asphalt);                      // dirt road, then asphalt
    sq(-0.2, G + 0.2, C.walk);               // district sidewalk
    sq(-0.07, G + 0.07, '#262d38');          // district streets
    if (tier >= 2) { ctx.save(); ctx.setLineDash([7, 7]); ctx.globalAlpha = 0.7; sq(-0.52, G + 0.52, null, tier >= 4 ? '#e9edf2' : C.line); ctx.restore(); }
    if (tier < 3) return; // crosswalks arrive with the town
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

  /** A trade this week: a welcome banner and a jersey crowd, or fans with placards outside the stadium. */
  R.drawMood = function (ctx) {
    const S = this.state, up = this.mood.up, t = this.t, y = G + 0.13, x0 = 1.55, x1 = 3.45;
    for (let i = 0; i < 16; i++) {
      const x = x0 + 0.05 + (i / 15) * (x1 - x0 - 0.1), yy = y + 0.02 + (i % 3) * 0.035, p = P(x, yy, 0), hop = up ? Math.max(0, Math.sin(t * 0.45 + i)) * 2.5 : 0;
      ctx.fillStyle = '#27303c'; ctx.fillRect(p[0] - 1.3, p[1] - 3 - hop, 1.1, 3); ctx.fillRect(p[0] + 0.2, p[1] - 3 - hop, 1.1, 3);
      ctx.fillStyle = up ? (i % 3 ? S.color : TRIM) : ['#7a8794', '#55606f', '#8a6a58'][i % 3]; ctx.fillRect(p[0] - 1.5, p[1] - 7.4 - hop, 3, 4.6);
      ellipse(ctx, p[0], p[1] - 8.8 - hop, 1.5, 1.5, SKIN[i % SKIN.length]);
      if (!up && i % 2 === 0) { // placards
        const bob = Math.sin(t * 0.3 + i) * 1;
        ctx.strokeStyle = '#8a6240'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(p[0] + 1.5, p[1] - 8); ctx.lineTo(p[0] + 1.5, p[1] - 15 + bob); ctx.stroke();
        ctx.fillStyle = '#f4f1ea'; ctx.fillRect(p[0] - 3, p[1] - 21 + bob, 9, 6);
        ctx.strokeStyle = C.red; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p[0] - 1, p[1] - 20 + bob); ctx.lineTo(p[0] + 4, p[1] - 16 + bob); ctx.moveTo(p[0] + 4, p[1] - 20 + bob); ctx.lineTo(p[0] - 1, p[1] - 16 + bob); ctx.stroke();
      }
    }
    const zt = up ? 26 : 18, zb = up ? 16 : 11;
    post(ctx, x0, y, 0, zt, '#8a95a3', 1.4); post(ctx, x1, y, 0, zt, '#8a95a3', 1.4);
    poly(ctx, [P(x0, y, zb), P(x1, y, zb), P(x1, y, zt), P(x0, y, zt)], up ? S.color : '#efe9dc');
    const label = (up ? 'WELCOME ' : 'COME BACK ') + (this.mood.name || '').toUpperCase();
    wallText(ctx, 'L', x0 + 0.12, y, zb + 2.5, label.slice(0, 22), 7.5, up ? '#ffffff' : C.red);
  };
  /** An elevated line leaving town toward a linked city, with a train shuttling along it. */
  R.drawRail = function (ctx, name, k) {
    const S = this.state, y = [2.42, 1.15, 3.7][k] || 2.42, xa = G + 0.86, xb = G + E - 0.04, z = 30;
    for (let x = xa + 0.15; x < xb; x += 0.55) box(ctx, x, y + 0.02, 0.06, 0.06, 0, z, '#9aa1ab');
    box(ctx, xa, y - 0.04, xb - xa, 0.14, z, 3, '#c5ccd6');
    const f = ((this.t * 0.006 + k * 0.33) % 1), len = 0.7, tx = xa + f * (xb - xa - len);
    box(ctx, tx, y - 0.02, len, 0.1, z + 3, 6, '#f1f4f7');
    wallRect(ctx, 'L', tx, y - 0.02, len, 0.1, z + 3, 0, 1, 0.5, 1.8, S.color);
    wallRect(ctx, 'L', tx, y - 0.02, len, 0.1, z + 3, 0.04, 0.96, 2.6, 4.6, '#9fd8ff');
    wallText(ctx, 'L', xb - 0.95, y + 0.1, z + 3.5, 'TO ' + String(name).toUpperCase().slice(0, 18), 5.5, '#f4f1ea');
  };

  // ---- travelling between cities -------------------------------------------------------------
  /** A copy of the current frame, used as one end of a trip. */
  R.snapshot = function () {
    this.draw();
    const c = root.document.createElement('canvas');
    c.width = this.canvas.width; c.height = this.canvas.height;
    c.getContext('2d').drawImage(this.canvas, 0, 0);
    return c;
  };
  /** Fly (or ride the train) from one city frame to another: zoom out, cross the map, zoom in.
      opts: {fromName, toName, rail, color, dur}. While a trip runs, draw() shows it instead of the city. */
  R.travel = function (a, b, opts) { this.trip = Object.assign({ a, b, t0: root.performance.now(), dur: 2300 }, opts); };
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  R.drawTrip = function () {
    const tr = this.trip, t = (root.performance.now() - tr.t0) / tr.dur;
    if (t >= 1) { this.trip = null; return false; }
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height, k = this.dpr, small = 0.3;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
    const D = W * 0.78, cy = H * 0.52;
    let s, ax, bx, u = 0;
    if (t < 0.3) { s = 1 - (1 - small) * ease(t / 0.3); ax = W / 2; }
    else if (t < 0.72) { s = small; u = ease((t - 0.3) / 0.42); ax = W / 2 - u * D; }
    else { s = small + (1 - small) * ease((t - 0.72) / 0.28); ax = W / 2 - D; }
    bx = ax + D;
    // clouds drift past faster than the islands, which sells the distance
    ctx.save(); ctx.globalAlpha = 0.5 * Math.min(1, (1 - s) / (1 - small));
    for (let i = 0; i < 9; i++) {
      const x = ((hash(i, 21) * 1.6 * W - u * W * 1.3) % (1.6 * W) + 1.6 * W) % (1.6 * W) - 0.3 * W, y = H * (0.12 + hash(i, 22) * 0.76), r = (30 + hash(i, 23) * 40) * k;
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(x, y, r * 1.8, r * 0.55, 0, 0, Math.PI * 2); ctx.ellipse(x + r * 0.7, y - r * 0.25, r, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    const img = (c, x, sc) => ctx.drawImage(c, x - (W * sc) / 2, cy - (H * sc) / 2 - (1 - sc) * H * 0.02, W * sc, H * sc);
    const label = (txt, x) => { ctx.font = '700 ' + 15 * k + 'px "Barlow Condensed", "Arial Narrow", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineWidth = 4 * k; ctx.strokeStyle = 'rgba(15,22,34,.75)'; ctx.strokeText(txt.toUpperCase(), x, cy + H * small * 0.42); ctx.fillStyle = '#f4f1ea'; ctx.fillText(txt.toUpperCase(), x, cy + H * small * 0.42); };
    if (t < 0.3) { img(tr.a, ax, s); return true; }
    if (t >= 0.72) { img(tr.b, bx, s); return true; }
    // the crossing: both islands, the route between them, and the vehicle on it
    const mx = (ax + bx) / 2, my = cy - H * 0.2, bez = (p) => [(1 - p) * (1 - p) * ax + 2 * (1 - p) * p * mx + p * p * bx, (1 - p) * (1 - p) * cy + 2 * (1 - p) * p * my + p * p * cy];
    ctx.save(); ctx.lineCap = 'round';
    if (tr.rail) { ctx.strokeStyle = 'rgba(200,206,214,.95)'; ctx.lineWidth = 5 * k; ctx.setLineDash([]); }
    else { ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2.5 * k; ctx.setLineDash([3 * k, 9 * k]); }
    ctx.beginPath(); ctx.moveTo(ax, cy); ctx.quadraticCurveTo(mx, my, bx, cy); ctx.stroke();
    if (tr.rail) { ctx.strokeStyle = 'rgba(80,90,104,.9)'; ctx.lineWidth = 1.2 * k; ctx.setLineDash([2 * k, 6 * k]); ctx.beginPath(); ctx.moveTo(ax, cy); ctx.quadraticCurveTo(mx, my, bx, cy); ctx.stroke(); }
    ctx.restore();
    img(tr.a, ax, s); img(tr.b, bx, s);
    label(tr.fromName || '', ax); label(tr.toName || '', bx);
    const p = 0.12 + u * 0.76, [vx, vy] = bez(p), [nx, ny] = bez(Math.min(1, p + 0.01)), ang = Math.atan2(ny - vy, nx - vx);
    ctx.save(); ctx.translate(vx, vy); ctx.rotate(ang); ctx.scale(k, k);
    if (tr.rail) {
      ctx.fillStyle = '#f1f4f7'; ctx.beginPath(); ctx.moveTo(-34, -6); ctx.lineTo(18, -6); ctx.quadraticCurveTo(30, -6, 34, 0); ctx.quadraticCurveTo(30, 6, 18, 6); ctx.lineTo(-34, 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = tr.color || '#e4572e'; ctx.fillRect(-34, 2.5, 60, 2.5);
      ctx.fillStyle = '#5fb0c9'; for (let i = 0; i < 6; i++) ctx.fillRect(-30 + i * 8, -3.5, 5, 4);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(4, 22, 16, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f4f6f8';
      ctx.beginPath(); ctx.ellipse(0, 0, 20, 4.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(-10, -17); ctx.lineTo(-5, -17); ctx.lineTo(8, 0); ctx.lineTo(-5, 17); ctx.lineTo(-10, 17); ctx.closePath(); ctx.fill();
      ctx.fillStyle = tr.color || '#e4572e'; ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-21, -8); ctx.lineTo(-17, -8); ctx.lineTo(-11, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#5fb0c9'; ctx.beginPath(); ctx.ellipse(15, -1, 3.5, 1.8, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    return true;
  };

  R.draw = function () {
    if (this.trip && this.drawTrip()) return;
    const ctx = this.ctx, S = this.state, t = this.t;
    NIGHT = !!this.night; FLOOD = false; TRIM = S && S.color2 ? S.color2 : '#eef1f4';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!S) return;
    ctx.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, this.dpr * this.ox, this.dpr * this.oy);
    this.drawGround(ctx);
    // moving things, each tagged with the layer it belongs to
    const cars = [], palette = ['#e4572e', '#f2b33d', '#e8e2d0', '#4f8fd9', '#3aa88f', '#b06ab3'];
    const busy = BUSY[S.stadium - 1];
    for (let i = 0; i < busy[0]; i++) cars.push(Object.assign(loopPos((i * 0.447 + t * (0.004 + (i % 3) * 0.0012)) % 4, -0.52), { col: palette[i % palette.length] }));
    const walkers = [];
    for (let i = 0; i < busy[1]; i++) {
      const outer = i % 3 !== 0, dir = i % 2 ? 1 : -1, sp = 0.0009 + hash(i, 7) * 0.0009;
      const u = (((hash(i, 3) * 4 + dir * t * sp) % 4) + 4) % 4;
      const lane = outer ? -0.92 + (i % 4) * 0.02 - 0.03 : -0.135 + (i % 2) * 0.03;
      walkers.push(Object.assign(loopPos(u, lane), { i, outer }));
    }
    const lamps = [];
    for (let s = 0; s < 4; s++) for (let k = 0; k < busy[2]; k++) lamps.push(loopPos(s + (k + 0.5) / busy[2], -0.97));
    const rim = [];
    for (let i = 0; i < 40; i++) {
      const side = i % 4, f = hash(i, 9) * (G + 2 * E - 0.3) - E + 0.15, off = E - 0.11;
      const p = side === 0 ? [f, -off] : side === 1 ? [G + off, f] : side === 2 ? [f, G + off] : [-off, f];
      rim.push({ x: p[0], y: p[1], s: 0.45 + hash(i, 2) * 0.3, back: side === 0 || side === 3 });
    }
    rim.sort((p, q) => p.x + p.y - q.x - q.y);
    const byDepth = (p, q) => p.x + p.y - q.x - q.y;

    const env = S.setting || 'metro';
    const rimTree = (p) => { if (env === 'mountain') pine(ctx, p.x, p.y, p.s * 1.5); else if (env === 'beach' && !p.back) return; else tree(ctx, p.x, p.y, p.s); };
    rim.filter((p) => p.back).forEach(rimTree);
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
    if (this.mood) this.drawMood(ctx);
    (this.rails || []).forEach((name, k) => this.drawRail(ctx, name, k));
    rim.filter((p) => !p.back).forEach(rimTree);
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
  FT.drawPreview = function (canvas, type, level, color, night, look) {
    look = look || {};
    if (type === 'town') {
      const r = canvas.townRenderer || (canvas.townRenderer = new Renderer(canvas));
      canvas.toneHooked = true;
      r.state = { color, color2: look.color2, setting: look.setting, stadium: level, grid: {} }; r.night = !!night; r.fill = 0.85; r.t = 67; r.score = '27-24';
      r.resize(); r.zoom = 1.12; r.applyView(); r.draw();
      return;
    }
    const dpr = Math.min(2, root.devicePixelRatio || 1), w = canvas.clientWidth || 220, h = canvas.clientHeight || 180;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!canvas.toneHooked) { hookTone(ctx); canvas.toneHooked = true; }
    NIGHT = !!night; FLOOD = false; TRIM = look.color2 || '#eef1f4';
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    const S = { color, stadium: level, grid: {} }, fake = { state: S, t: 67, fill: 0.85, score: '27-24', selected: null, hover: null, gameDay: false };
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
