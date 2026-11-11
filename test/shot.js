// Drives the built game in headless Chromium and saves screenshots. Run: node test/shot.js [outDir]
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2] || path.join(__dirname, '..', 'shots');
require('fs').mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 820 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'dist', 'franchise-tycoon.html'));
  await page.screenshot({ path: path.join(out, '1-setup.png') });
  await page.click('[data-act="demo"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, '2-start.png') });
  // a developed district: every building type at mixed levels
  await page.evaluate(() => {
    const S = window.FTApp.state; S.cash = 5e7;
    const plan = { '0-0': ['medical', 3], '0-1': ['concessions', 3], '0-2': ['media', 3], '0-3': ['suites', 3], '0-4': ['scouting', 3], '1-0': ['media', 1], '1-3': ['concessions', 2], '1-4': ['medical', 1],
      '2-0': ['suites', 1], '2-3': ['suites', 2], '2-4': ['scouting', 1], '3-0': ['transit', 3], '3-1': ['concessions', 1], '3-2': ['retail', 2], '3-3': ['fanzone', 3], '3-4': ['retail', 3],
      '4-0': ['transit', 1], '4-1': ['transit', 2], '4-2': ['retail', 1], '4-3': ['fanzone', 1], '4-4': ['fanzone', 2] };
    for (const k in plan) { window.FT.build(S, k, plan[k][0]); for (let i = 1; i < plan[k][1]; i++) window.FT.upgrade(S, k); }
    for (let i = 0; i < 4; i++) window.FT.upgradeStadium(S);
    document.querySelector('[data-v="league"]').click();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, '3-built.png') });
  await page.evaluate(() => { window.FTApp.renderer.night = !window.FTApp.renderer.night; document.querySelector('.board').classList.toggle('day'); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, '3b-other.png') });
  await page.click('[data-v="game"]');
  await page.click('[data-act="play"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, '4-report.png') });
  await page.click('[data-act="close"]');
  const box = await page.locator('#city').boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.86);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, '5-build.png') });
  await page.setViewportSize({ width: 400, height: 800 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, '6-phone.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log('errors:', errors.length ? errors : 'none', '| phone overflow px:', overflow);
  await browser.close();
})();
