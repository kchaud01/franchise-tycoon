/* Franchise Tycoon — gallery page. Lists every building level with the game's own art and numbers. */
(function () {
  'use strict';
  const FT = window.FT;
  const COLORS = ['#e4572e', '#f2b33d', '#3aa88f', '#4f8fd9', '#b06ab3', '#d9436b', '#5aa845', '#d8d2c2'];
  let color = COLORS[0], color2 = '#eef1f4', night = false, pixel = false;
  const money = (n) => '$' + (n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 2 : 0) + 'M' : Math.round(n / 1e3) + 'k');
  const card = (type, lv, title, lines, wide) => '<div class="lv' + (wide ? ' wide' : '') + '"><canvas data-type="' + type + '" data-lv="' + lv + '" role="img" aria-label="' + title + '"></canvas><div><b>' + title + '</b>' + lines.map((l, i) => (i ? '<span>' : '<em>') + l + (i ? '</span>' : '</em>')).join('') + '</div></div>';

  let h = '<section><h2>Stadium</h2><p>The centre of the district. It grows from a grass-banked community field into a concrete bowl, a double-deck stadium with a canopy, a roofed arena behind glass, and finally a fully enclosed dome.</p><div class="levels">';
  FT.STADIUM.name.forEach((name, i) => { h += card('stadium', i + 1, 'Level ' + (i + 1) + ' · ' + name, [i ? money(FT.STADIUM.cost[i]) + ' to expand' : 'Where you start', FT.STADIUM.cap[i].toLocaleString() + ' seats'], true); });
  h += '</div></section>';
  const TOWNS = ['Farm village', 'Small town', 'Town', 'City', 'Metropolis'];
  const TOWN_NOTES = ['Fields, barns, a general store and a dirt road.', 'Houses, a diner, a school and a town hall on a paved road.', 'Offices, apartments, a library, street lamps and crosswalks.', 'Towers on the skyline, townhouses and busier streets.', 'Glass skyscrapers, condos, a museum, a galleria and a gilded city hall.'];
  h += '<section><h2>The town around you</h2><p>The scenery outside your district is tied to the stadium. Each expansion brings a bigger, busier and richer town.</p><div class="levels towns">';
  TOWNS.forEach((name, i) => { h += card('town', i + 1, name, ['With the level ' + (i + 1) + ' stadium', TOWN_NOTES[i]], true); });
  h += '</div></section>';
  const LOOKS = [['metro', 'Metro', 'Downtown on every side, growing into a skyline.'], ['mountain', 'Mountain', 'Snow-capped peaks and pine forest behind the stadium, with a lodge.'], ['river', 'Riverside', 'A river with boats along the front of town.'], ['beach', 'Beachfront', 'Sand, palms and surf on two sides.']];
  h += '<section><h2>City settings</h2><p>Each owner picks a setting and two team colours. Shown here around a level 3 stadium; every setting still grows through the five town tiers.</p><div class="levels towns">';
  LOOKS.forEach((x) => { h += card('town', 3, x[1], ['Setting', x[2]], true).replace('data-lv="3"', 'data-lv="3" data-setting="' + x[0] + '"'); });
  h += '</div></section>';
  FT.TYPES.forEach((t) => {
    const b = FT.BUILDINGS[t];
    h += '<section><h2>' + b.name + '</h2><p>' + b.blurb + '</p><p class="linkline">' + b.link + '</p><div class="levels">';
    b.cost.forEach((c, i) => { h += card(t, i + 1, 'Level ' + (i + 1), [money(c) + (i ? ' to upgrade' : ' to build'), b.unit(b.v[i]), i === 0 ? b.synergy : '']); });
    h += '</div></section>';
  });
  document.getElementById('sections').innerHTML = h;
  document.getElementById('sections').style.cssText = 'display:flex;flex-direction:column;gap:30px';
  document.getElementById('colors').innerHTML = COLORS.map((c) => '<button class="swatch" style="background:' + c + '" data-color="' + c + '" aria-label="Team colour ' + c + '"></button>').join('');

  function paint() {
    document.getElementById('gal').classList.toggle('night', night);
    document.documentElement.style.setProperty('--team', color);
    document.getElementById('t-day').classList.toggle('on', !night);
    document.getElementById('t-night').classList.toggle('on', night);
    document.getElementById('t-smooth').classList.toggle('on', !pixel); document.getElementById('t-pixel').classList.toggle('on', pixel);
    document.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('on', s.dataset.color === color));
    document.querySelectorAll('canvas[data-type]').forEach((c) => FT.drawPreview(c, c.dataset.type, +c.dataset.lv, color, night, { setting: c.dataset.setting, color2, pixel: pixel ? (c.dataset.type === 'town' ? 2 : 2) : 0 }));
  }
  document.addEventListener('click', (e) => {
    const n = e.target.closest('[data-night]'), c = e.target.closest('[data-color]'), px = e.target.closest('[data-pixel]');
    if (px) { pixel = px.dataset.pixel === '1'; paint(); }
    if (n) night = n.dataset.night === '1';
    if (c) color = c.dataset.color;
    if (n || c) paint();
  });
  window.addEventListener('resize', paint);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(paint);
  paint();
})();
