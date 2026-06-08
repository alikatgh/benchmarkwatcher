// scripts/shoot_grid_styles.mjs — screenshot the grid in each card style
// (card / minimal / dense) to reproduce the card-overlap bug on the real DOM.
// Usage: node scripts/shoot_grid_styles.mjs [baseUrl]
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const base = process.argv[2] || 'http://127.0.0.1:5793';
mkdirSync('artifacts/shots', { recursive: true });

const browser = await chromium.launch();
for (const style of ['card', 'minimal', 'dense']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${base}/?range=1M&view=grid`, { waitUntil: 'networkidle' });
  await page.evaluate((s) => {
    const sel = document.getElementById('grid-card-style');
    if (sel) sel.value = s;
    if (typeof window.updateGridSettings === 'function') window.updateGridSettings();
  }, style);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `artifacts/shots/grid-${style}-1m.png` });
  console.log(`grid-${style}: ${errs.length ? 'JS-ERR ' + errs[0] : 'ok'}`);
  await ctx.close();
}
await browser.close();
