// scripts/shoot_ralph.mjs — parameterized screenshotter for /ralph-redesign loops.
//
// Built for the ralph loop (docs/RALPH_TASK_TEMPLATE.md): one screen, shot at
// 375px (primary) + 1280px (secondary), light + dark, in one run. Same rationale
// as shoot.mjs: the Claude Preview tab runs backgrounded (document.hidden) which
// throttles rAF, so canvas sparklines/charts render blank there — headless
// foreground Chromium paints them honestly.
//
// Does NOT catch: live-host-only issues (stale CSS, LSAPI limits) — curl prod
// headers for that. Mobile (Expo web) can be shot by passing its baseUrl.
//
// Usage: node scripts/shoot_ralph.mjs <path> <name> [baseUrl] [outDir]
//   e.g. node scripts/shoot_ralph.mjs '/?view=grid' home-i1 http://127.0.0.1:5002
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const path = process.argv[2] || '/';
const name = process.argv[3] || 'screen';
const baseUrl = process.argv[4] || 'http://127.0.0.1:5002';
const outDir = process.argv[5] || 'artifacts/shots/ralph';
mkdirSync(outDir, { recursive: true });

const variants = [
  { suffix: '375-light',  theme: 'light', w: 375,  h: 1400 },
  { suffix: '375-dark',   theme: 'dark',  w: 375,  h: 1400 },
  { suffix: '1280-light', theme: 'light', w: 1280, h: 1600 },
  { suffix: '1280-dark',  theme: 'dark',  w: 1280, h: 1600 },
];

const browser = await chromium.launch();
for (const v of variants) {
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 2 });
  await ctx.addInitScript((theme) => {
    try {
      localStorage.setItem('theme', theme);
      localStorage.setItem('bw-theme', theme);
      if (theme === 'dark') document.documentElement.classList.add('dark');
    } catch (e) {}
  }, v.theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(baseUrl + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400); // let Chart.js / sparklines paint
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  await page.screenshot({ path: `${outDir}/${name}-${v.suffix}.png`, fullPage: false });
  console.log(`shot ${name}-${v.suffix.padEnd(11)} ${errors.length ? 'JS-ERR: ' + errors[0] : 'ok'}${overflow ? '  H-OVERFLOW' : ''}`);
  await ctx.close();
}
await browser.close();
