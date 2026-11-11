// Click-through test of the real page: build on a lot, upgrade, play a home game, reload and keep the save.
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 820 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const url = 'file://' + path.join(__dirname, '..', 'dist', 'franchise-tycoon.html');
  await page.goto(url);
  await page.click('[data-act="demo"]');
  const lot = async (r, c) => {
    const p = await page.evaluate(([r, c]) => { const R = window.FTApp.renderer, b = document.querySelector('#city').getBoundingClientRect(); return [b.left + R.ox + (c - r) * 60 * R.scale, b.top + R.oy + (c + r + 1) * 30 * R.scale]; }, [r, c]);
    await page.mouse.click(p[0], p[1]);
  };
  await lot(0, 1);
  assert(await page.locator('.options').count(), 'empty lot shows build options');
  await page.click('[data-act="build"][data-v="concessions"]');
  assert.strictEqual(await page.evaluate(() => window.FTApp.state.grid['0-1'].type), 'concessions');
  assert((await page.textContent('#panel')).includes('+20% bonus active'), 'stadium adjacency shown');
  await lot(4, 2); await page.click('[data-act="build"][data-v="retail"]');
  await lot(2, 2);
  assert((await page.textContent('#panel')).includes('Municipal Field'), 'stadium selectable');
  await page.click('#tab-game');
  assert((await page.textContent('#panel')).includes('Home game'), 'week 1 is a home game');
  await page.click('[data-act="price"][data-v="0"]');
  await page.click('[data-act="play"]');
  const report = await page.textContent('#modal-body');
  assert(report.includes('Tickets') && report.includes('Concessions') && report.includes('Merchandise'), 'report lines');
  await page.click('[data-act="close"]');
  const cash = await page.evaluate(() => window.FTApp.state.cash);
  await page.reload();
  assert.strictEqual(await page.evaluate(() => window.FTApp.state.cash), cash, 'save survives reload');
  for (let i = 0; i < 8; i++) { await page.click('[data-act="play"]'); await page.click('[data-act="close"]'); }
  assert((await page.textContent('#panel')).includes('Waiting on the final whistle'));
  await page.click('[data-act="skip"]');
  assert(await page.locator('[data-act="play"]').count(), 'skipping a demo week opens the next game day');
  await page.click('#tab-ledger');
  assert.strictEqual(await page.locator('.histrow').count(), 9);
  // solo play: visit a rival's city from the League tab
  await page.click('#tab-league'); await page.click('.linkbtn >> nth=0');
  assert(await page.locator('#visit:not([hidden])').count(), 'visiting banner shows');
  await page.click('[data-act="gohome"]');
  // Sleeper path: an unknown username gives a readable error (needs network)
  await page.click('#btn-menu'); await page.click('#btn-switch');
  await page.fill('#username', 'zz_no_such_user_zz_9182'); await page.click('#connect button');
  await page.waitForSelector('.error', { timeout: 15000 });
  console.log('sleeper lookup message:', await page.textContent('.error'));
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close();
  console.log('flow ok');
})().catch((e) => { console.error(e); process.exit(1); });
