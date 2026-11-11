// Browser run of league mode against a local demo server. Run: node build.js && node test/league-browser.js [shotDir]
const { chromium } = require('playwright');
const http = require('http');
const path = require('path');
const assert = require('assert');
const { createApp } = require('../server.js');
const out = process.argv[2];
(async () => {
  const srv = http.createServer(createApp({ demo: true }).handle).listen(0);
  const base = 'http://localhost:' + srv.address().port + '/';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base);
  await page.click('[data-act="lgdemo"]');
  await page.waitForSelector('#tab-admin:not([hidden])');
  assert((await page.textContent('#panel')).includes('League settings'), 'commissioner lands on the Admin screen');
  await page.fill('#set-cap', '7.5'); // range input
  assert.strictEqual(await page.textContent('#set-cap-out'), '7.5');
  await page.selectOption('#set-payout', 'half');
  await page.click('[data-act="savesettings"]');
  await page.waitForFunction(() => document.querySelector('#panel').textContent.includes('Settings saved'));
  if (out) await page.screenshot({ path: path.join(out, 'lg-1-admin.png') });
  const link = await page.inputValue('.invite:nth-child(2) input');
  // commissioner builds, then the week locks
  await page.click('#tab-build');
  const p = await page.evaluate(() => { const R = window.FTApp.renderer, b = document.querySelector('#city').getBoundingClientRect(); return [b.left + R.ox + 60 * R.scale, b.top + R.oy + 60 * R.scale]; });
  await page.mouse.click(p[0], p[1]);
  await page.click('[data-act="build"][data-v="concessions"]');
  await page.waitForFunction(() => window.FTApp.state.grid['0-1']);
  await page.click('#tab-game');
  assert((await page.textContent('#panel')).includes('Decisions lock'));
  if (out) await page.screenshot({ path: path.join(out, 'lg-2-open.png') });
  await page.click('#tab-admin'); await page.click('[data-act="demolock"]');
  await page.waitForFunction(() => !document.querySelector('[data-act="demolock"]'));
  await page.click('#tab-build');
  assert((await page.textContent('#panel')).includes('Locked until Week 10 settles'));
  // a second owner on their own link, in a separate browser profile
  const ctx2 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const p2 = await ctx2.newPage();
  await p2.goto(link);
  await p2.waitForSelector('#tab-bonus:not([hidden])');
  assert(await p2.locator('#tab-admin[hidden]').count(), 'owners have no Admin tab');
  assert((await p2.textContent('#panel')).includes('Locked in'));
  assert(!p2.url().includes('#'), 'the token is removed from the address bar');
  // finish the week
  await page.click('#tab-admin'); await page.click('[data-act="demofinish"]');
  await page.waitForSelector('#modal:not([hidden])');
  assert((await page.textContent('#modal-body')).includes('Owner edge'));
  if (out) await page.screenshot({ path: path.join(out, 'lg-3-report.png') });
  await page.click('[data-act="close"]');
  await page.click('#tab-bonus');
  assert((await page.textContent('#panel')).includes('Season ledger'), 'sim standings shown');
  assert.strictEqual(await page.locator('#panel table').nth(1).locator('tbody tr').count(), 10);
  // the commissioner edits one adjustment on the score sheet
  await page.click('#tab-admin');
  assert(await page.locator('input.ov').count() === 10, 'score sheet has an input per team');
  const rid = await page.locator('input.ov').first().getAttribute('data-rid');
  await page.fill('#ov-' + rid, '3.3'); await page.click('[data-act="saveov"]');
  await page.waitForFunction(() => document.querySelector('#panel').textContent.includes('Adjustments saved'));
  assert.strictEqual(await page.inputValue('#ov-' + rid), '3.3');
  if (out) await page.screenshot({ path: path.join(out, 'lg-6-sheet.png'), fullPage: false });
  await page.click('#tab-bonus');
  assert((await page.textContent('#panel')).includes('commissioner edit'));
  assert((await page.textContent('#panel')).includes('7.5'));
  // the second owner visits the commissioner's city and sees the building there
  await p2.reload(); await p2.waitForSelector('#modal:not([hidden])'); await p2.click('[data-act="close"]');
  await p2.click('#tab-league');
  await p2.click('.linkbtn:has-text("Harbor City Herons")');
  assert((await p2.textContent('#visit')).includes('Harbor City Herons'));
  assert.strictEqual(await p2.evaluate(() => window.FTApp.renderer.state.grid['0-1'].type), 'concessions');
  await p2.waitForTimeout(300);
  if (out) await p2.screenshot({ path: path.join(out, 'lg-5-visit.png') });
  await p2.click('[data-act="visitstep"][data-v="1"]');
  await p2.click('[data-act="gohome"]');
  assert(await p2.locator('#visit[hidden]').count());
  await page.click('#tab-admin'); await page.click('[data-act="demolock"]');
  await page.waitForFunction(() => !document.querySelector('[data-act="demolock"]'));
  await page.click('#tab-bonus');
  if (out) await page.screenshot({ path: path.join(out, 'lg-4-bonus.png'), fullPage: true });
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close(); srv.close();
  console.log('league browser flow ok');
})().catch((e) => { console.error(e); process.exit(1); });
