// scripts/shoot.mjs — reusable Playwright screenshotter for the web UI.
//
// Why this exists: UI work on this project MUST be verified against the real
// rendered DOM. The Claude Preview tab runs backgrounded (document.hidden), which
// throttles requestAnimationFrame, so the rAF-gated sparkline canvases render
// BLANK there — making the preview lie about the dense table. A real headless
// Chromium (foreground) paints them. This harness shoots the key views/themes/
// breakpoints in one run so a redesign can be checked for real, not eyeballed.
//
// What it does NOT catch: anything that only breaks on the live host (stale CSS,
// LSAPI limits) — for that, curl the production headers.
//
// Usage: node scripts/shoot.mjs [baseUrl] [outDir]
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const baseUrl = process.argv[2] || 'http://127.0.0.1:5793';
const outDir = process.argv[3] || 'artifacts/shots';
mkdirSync(outDir, { recursive: true });

const shots = [
  { name: 'grid-1y',     path: '/?view=grid',            theme: 'light', w: 1280, h: 1600 },
  { name: 'compact-1y',  path: '/?view=compact',         theme: 'light', w: 1280, h: 1600 },
  { name: 'compact-dark',path: '/?view=compact',         theme: 'dark',  w: 1280, h: 1600 },
  { name: 'compact-mob', path: '/?view=compact',         theme: 'light', w: 390,  h: 1800 },
];

const browser = await chromium.launch();
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2 });
  // Set both common theme hooks before any app JS runs, so dark shots are honest.
  await ctx.addInitScript((theme) => {
    try {
      localStorage.setItem('theme', theme);
      localStorage.setItem('bw-theme', theme);
      if (theme === 'dark') document.documentElement.classList.add('dark');
    } catch (e) {}
  }, s.theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(baseUrl + s.path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400); // let Chart.js sparklines paint
  await page.screenshot({ path: `${outDir}/${s.name}.png`, fullPage: false });
  console.log(`shot ${s.name.padEnd(14)} ${errors.length ? 'JS-ERR: ' + errors[0] : 'ok'}`);
  await ctx.close();
}
await browser.close();
