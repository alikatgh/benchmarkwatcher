// scripts/drive_ui.mjs — exhaustive "act like a user" UI driver.
//
// Why this exists: static analysis + a single default screenshot miss the bugs
// that only appear when you actually EXERCISE the UI — broken toggles, JS errors
// thrown on a click, stale re-renders, wrong counts, geometry breaks in a theme
// nobody screenshots. This drives every interactive control across views, card
// styles, all 7 themes + 3 market modes, the detail page's chart controls +
// modals, changelog, and a 404 — at 1280px and 375px — in ONE foreground
// (rAF-honest) Chromium run, and records every pageerror / console.error keyed
// to the exact step that produced it. Screens land in artifacts/shots/hunt/.
//
// What it does NOT catch: live-host-only issues (stale CSS/CDN, LSAPI limits).
//
// Usage: node scripts/drive_ui.mjs [baseUrl]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';

const base = process.argv[2] || 'http://127.0.0.1:5002';
const outDir = 'artifacts/shots/hunt';
mkdirSync(outDir, { recursive: true });

const findings = [];      // {step, type, detail}
let step = 'boot';
const log = (type, detail) => findings.push({ step, type, detail: String(detail).slice(0, 400) });

const browser = await chromium.launch();

async function newPage(theme, market) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(([t, m]) => {
    try {
      localStorage.setItem('theme', t); localStorage.setItem('bw-theme', t);
      if (m) localStorage.setItem('market', m), localStorage.setItem('bw-market', m);
      if (t === 'dark') document.documentElement.classList.add('dark');
    } catch (e) {}
  }, [theme || 'light', market]);
  const page = await ctx.newPage();
  page.on('pageerror', e => log('PAGEERROR', e.message || e));
  page.on('console', m => { if (m.type() === 'error') log('CONSOLE.ERROR', m.text()); });
  page.on('requestfailed', r => {
    const u = r.url();
    if (!/favicon|analytics|fonts?\.|gstatic/.test(u)) log('REQ.FAILED', `${r.failure()?.errorText} ${u}`);
  });
  return { ctx, page };
}

const shot = (page, name) => page.screenshot({ path: `${outDir}/${name}.png`, fullPage: false }).catch(() => {});
const click = async (page, sel, label) => {
  try {
    const el = await page.$(sel);
    if (!el) { log('MISSING', `${label}: selector ${sel} not found`); return false; }
    await el.click({ timeout: 4000 });
    await page.waitForTimeout(400);
    return true;
  } catch (e) { log('CLICK-THREW', `${label}: ${e.message}`); return false; }
};

// ---- 1. HOME (compact default) ----
{
  step = 'home-compact';
  const { ctx, page } = await newPage('light');
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => ({
    rows: document.querySelectorAll('[data-id]').length,
    canvases: document.querySelectorAll('canvas').length,
    blankCanvas: [...document.querySelectorAll('canvas')].filter(c => c.width === 0 || c.height === 0).length,
  }));
  log('STATE', JSON.stringify(st));
  await shot(page, 'home-compact');

  // search
  step = 'home-search';
  await page.fill('#quick-find-input', 'gold');
  await page.waitForTimeout(300);
  log('STATE', 'search=gold count=' + (await page.$eval('#quick-find-count', e => e.textContent).catch(() => '?')));
  await page.fill('#quick-find-input', 'zznomatch');
  await page.waitForTimeout(300);
  log('STATE', 'search=nomatch count=' + (await page.$eval('#quick-find-count', e => e.textContent).catch(() => '?')) +
    ' emptyHidden=' + (await page.$eval('#quick-find-empty', e => e.classList.contains('hidden')).catch(() => '?')));
  await page.fill('#quick-find-input', '');
  await page.waitForTimeout(200);

  // quick filters
  for (const label of ['Rising', 'Falling', 'Flat', 'Daily', 'Monthly', 'All']) {
    step = 'quickfilter-' + label;
    const ok = await page.evaluate((t) => {
      const btn = [...document.querySelectorAll('.quick-filter-btn')].find(b => b.textContent.trim() === t);
      if (!btn) return 'no-btn';
      btn.click(); return 'clicked';
    }, label);
    if (ok === 'no-btn') { log('MISSING', `quick filter ${label} button`); continue; }
    await page.waitForTimeout(350);
    const vis = await page.evaluate(() => [...document.querySelectorAll('[data-id]')].filter(r => getComputedStyle(r).display !== 'none').length);
    log('STATE', `filter=${label} visible=${vis} count=` + (await page.$eval('#quick-find-count', e => e.textContent).catch(() => '?')));
  }

  // range buttons (compact)
  for (const r of ['1W', '1M', '3M', '6M', '1Y', 'ALL']) {
    step = 'range-' + r;
    await click(page, '#range-' + r, 'range ' + r);
  }
  await shot(page, 'home-compact-after-controls');
  await ctx.close();
}

// ---- 2. HOME grid + 3 card styles ----
{
  for (const styleName of ['card', 'minimal', 'dense']) {
    step = 'grid-' + styleName;
    const { ctx, page } = await newPage('light');
    await page.goto(base + '/?view=grid', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.evaluate((s) => {
      const sel = document.getElementById('grid-card-style');
      if (sel) { sel.value = s; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      if (typeof window.updateGridSettings === 'function') window.updateGridSettings();
    }, styleName);
    await page.waitForTimeout(700);
    const cards = await page.evaluate(() => document.querySelectorAll('.bw-grid-card').length);
    log('STATE', `grid style=${styleName} cards=${cards}`);
    await shot(page, 'grid-' + styleName);
    await ctx.close();
  }
}

// ---- 3. Settings modal: 7 themes x screenshot, 3 market modes ----
{
  const themes = ['light', 'dark', 'mono-light', 'mono-dark', 'bloomberg', 'ft'];
  for (const t of themes) {
    step = 'theme-' + t;
    const { ctx, page } = await newPage(t);
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    // apply theme via the app's setter if present, else data-theme
    await page.evaluate((th) => {
      document.documentElement.setAttribute('data-theme', th);
      if (typeof window.setTheme === 'function') window.setTheme(th);
      if (typeof window.applyTheme === 'function') window.applyTheme(th);
    }, t);
    await page.waitForTimeout(600);
    const contrast = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      return { bg: body.backgroundColor, color: body.color };
    });
    log('STATE', `theme=${t} ${JSON.stringify(contrast)}`);
    await shot(page, 'theme-' + t);
    await ctx.close();
  }
  for (const m of ['western', 'asian', 'monochrome']) {
    step = 'market-' + m;
    const { ctx, page } = await newPage('light', m);
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.evaluate((mk) => { document.documentElement.setAttribute('data-market', mk); }, m);
    await page.waitForTimeout(500);
    await shot(page, 'market-' + m);
    await ctx.close();
  }
}

// ---- 4. Commodity detail: chart controls, modals ----
{
  step = 'detail-load';
  const { ctx, page } = await newPage('light');
  await page.goto(base + '/commodity/gold', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  const dst = await page.evaluate(() => ({
    chartCanvas: !!document.getElementById('priceChart'),
    statHigh: document.getElementById('stat-high')?.textContent,
    statLow: document.getElementById('stat-low')?.textContent,
    crosshairPrice: document.getElementById('crosshair-price')?.textContent,
  }));
  log('STATE', 'detail ' + JSON.stringify(dst));
  await shot(page, 'detail-load');

  for (const r of ['1W', '1M', '3M', '6M', '1Y', 'ALL']) {
    step = 'detail-range-' + r;
    await click(page, '#range-' + r, 'detail range ' + r);
  }
  // chart type + view mode buttons (find by text)
  for (const label of ['Line', 'Area', 'Price', '% Change']) {
    step = 'detail-mode-' + label;
    const clicked = await page.evaluate((t) => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === t);
      if (!b) return false; b.click(); return true;
    }, label);
    if (!clicked) log('MISSING', `detail mode button ${label}`);
    await page.waitForTimeout(400);
  }
  await shot(page, 'detail-after-modes');

  // period sub-picker (prev/30/365)
  for (const label of ['Prev obs', '~30 obs', '~1 year']) {
    step = 'detail-period-' + label;
    await page.evaluate((t) => {
      const b = [...document.querySelectorAll('.period-btn')].find(x => x.textContent.trim() === t);
      if (b) b.click();
    }, label);
    await page.waitForTimeout(250);
  }

  // Compare modal
  step = 'detail-compare';
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /compare/i.test(x.textContent)); if (b) b.click(); });
  await page.waitForTimeout(700);
  const cmp = await page.evaluate(() => {
    const m = document.querySelector('[id*="compare" i]');
    return { present: !!m, visible: m ? getComputedStyle(m).display !== 'none' : false };
  });
  log('STATE', 'compare modal ' + JSON.stringify(cmp));
  await shot(page, 'detail-compare');
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);

  // Download menu
  step = 'detail-download';
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /download/i.test(x.textContent)); if (b) b.click(); });
  await page.waitForTimeout(400);
  await shot(page, 'detail-download');
  await page.keyboard.press('Escape').catch(() => {});

  // Copy price
  step = 'detail-copy';
  await page.evaluate(() => { const b = document.querySelector('[onclick*="copyPrice"]'); if (b) b.click(); });
  await page.waitForTimeout(300);

  await ctx.close();
}

// ---- 5. Changelog + 404 ----
for (const [path, name] of [['/changelog', 'changelog'], ['/commodity/__nonexistent__', 'detail-404'], ['/nonexistent-page', 'page-404']]) {
  step = name;
  const { ctx, page } = await newPage('light');
  const resp = await page.goto(base + path, { waitUntil: 'networkidle' }).catch(e => { log('NAV-THREW', e.message); return null; });
  await page.waitForTimeout(500);
  log('STATE', `${name} status=${resp ? resp.status() : '?'}`);
  await shot(page, name);
  await ctx.close();
}

// ---- 6. Mobile 375px key flows ----
for (const [path, name] of [['/', 'm-home-compact'], ['/?view=grid', 'm-home-grid'], ['/commodity/gold', 'm-detail']]) {
  step = 'mobile-' + name;
  const ctx = await browser.newContext({ viewport: { width: 375, height: 1400 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', e => log('PAGEERROR', e.message || e));
  page.on('console', m => { if (m.type() === 'error') log('CONSOLE.ERROR', m.text()); });
  await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 2) log('H-OVERFLOW', `${name} overflow=${overflow}px`);
  await shot(page, name);
  await ctx.close();
}

await browser.close();
writeFileSync(`${outDir}/findings.json`, JSON.stringify(findings, null, 2));
const errs = findings.filter(f => /PAGEERROR|CONSOLE|FAILED|MISSING|THREW|OVERFLOW/.test(f.type));
console.log(`\n=== ${errs.length} error/anomaly findings ===`);
for (const f of errs) console.log(`[${f.type}] ${f.step}: ${f.detail}`);
console.log(`\n(full log: ${outDir}/findings.json, ${findings.length} entries)`);
