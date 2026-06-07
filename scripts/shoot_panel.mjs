// scripts/shoot_panel.mjs — screenshot the Chart Settings panel OPEN (light + dark).
// Verifies the detail-page settings redesign against the real rendered DOM (the
// sliders/toggles are CSS pseudo-elements that only a real browser paints).
// Usage: node scripts/shoot_panel.mjs [baseUrl] [commodityId]
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const base = process.argv[2] || 'http://127.0.0.1:5793';
const id = process.argv[3] || 'brent_oil';
mkdirSync('artifacts/shots', { recursive: true });

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('theme', t);
      localStorage.setItem('bw-theme', t);
      if (t === 'dark') document.documentElement.classList.add('dark');
    } catch (e) {}
  }, theme);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${base}/commodity/${id}`, { waitUntil: 'networkidle' });
  await page.click('#chart-settings-btn');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `artifacts/shots/panel-${theme}.png` });
  console.log(`panel-${theme}: ${errs.length ? 'JS-ERR ' + errs[0] : 'ok'}`);
  await ctx.close();
}
await browser.close();
