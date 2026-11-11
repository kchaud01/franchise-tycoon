// Plays a mini-game in the real page and checks the medal reaches the franchise. Run: node build.js && node test/mini-browser.js [shotDir]
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
const out = process.argv[2];
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('file://' + path.join(__dirname, '..', 'dist', 'franchise-tycoon.html'));
  await page.click('[data-act="demo"]');
  await page.evaluate(() => { const S = window.FTApp.state; S.cash = 9e7; ['concessions', 'transit', 'retail', 'suites', 'media', 'fanzone', 'medical', 'scouting'].forEach((t, i) => window.FT.build(S, '0-' + i % 5 === '0-' + i ? '0-' + i : '4-' + (i - 5), t)); document.querySelector('#tab-league').click(); document.querySelector('#tab-game').click(); });
  assert.strictEqual(await page.locator('.minis button').count(), 8, 'one mini-game per owned building');
  // every game opens, starts and draws
  for (const t of ['concessions', 'transit', 'retail', 'suites', 'media', 'fanzone', 'medical', 'scouting']) {
    await page.click('.minis [data-v="' + t + '"]');
    await page.click('#mini-start');
    const box = await page.locator('#mini-cv').boundingBox();
    for (let i = 0; i < 6; i++) { await page.mouse.move(box.x + box.width * (0.25 + 0.5 * (i % 2)), box.y + box.height * 0.6); await page.mouse.down(); await page.waitForTimeout(140); await page.mouse.up(); await page.waitForTimeout(120); }
    if (out) await page.locator('#mini-cv').screenshot({ path: path.join(out, 'mini-' + t + '.png') });
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.locator('#mini').count(), 0, 'Esc closes ' + t);
  }
  await page.evaluate(() => { window.FTApp.state.mini = {}; }); // some games can end inside those few taps
  // finish one for real: Field Goal Frenzy, tapping blind
  await page.click('.minis [data-v="fanzone"]'); await page.click('#mini-start');
  const box = await page.locator('#mini-cv').boundingBox();
  for (let i = 0; i < 80 && !(await page.locator('.mini-result').count()); i++) { await page.mouse.click(box.x + 100, box.y + 200); await page.waitForTimeout(250); }
  assert(await page.locator('.mini-result').count(), 'result shown');
  if (out) await page.screenshot({ path: path.join(out, 'mini-result.png') });
  assert.strictEqual(await page.evaluate(() => window.FTApp.state.mini.fanzone.tries), 1, 'a finished game uses one try');
  await page.click('#mini-close');
  assert((await page.textContent('.minis [data-v="fanzone"]')).match(/2 left|Bronze|Silver|Gold/));
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close(); console.log('mini browser ok');
})().catch((e) => { console.error(e); process.exit(1); });
