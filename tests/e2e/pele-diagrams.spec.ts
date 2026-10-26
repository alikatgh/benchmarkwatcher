import { selectOption } from './select-option';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const detailPath = '/data/worldbank_c01c3997c6dcbac66958bbb38d2de02f';
const vendorPath = '/static/js/vendor/pele.v1.6.0.min.js';
const historySummary = 'How this data reaches the chart';
const historyFlow = (page: Page) => page.locator('.gr-evidence > details.bw-source-flow');
const normalize = (label: string) => label.trim().replace(/\s+/g, ' ');

test.beforeEach(async ({ context, baseURL }) => {
  // All data, filings, workbooks and provider replies come from the local fixture server.
  await context.route('**/*', route => new URL(route.request().url()).origin === baseURL
    ? route.continue() : route.abort());
});

function vendorRequests(page: Page) {
  const requests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === vendorPath) requests.push(request.url());
  });
  return requests;
}

async function loaderReady(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean((window as any).BW?.Diagrams))).toBe(true);
}

async function openHistory(page: Page, throughLibrary = false) {
  if (throughLibrary) {
    await page.goto('/data');
    await page.locator('.gr-reference-name').getByRole('link', { name: 'Synthetic wind capacity', exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`${detailPath}$`));
  } else await page.goto(detailPath);
  await expect(page.locator('#gr-chart svg.bw-d3-chart')).toBeVisible();
  await loaderReady(page);
}

async function renderedFlow(flow: Locator, expectedLabels?: string[]) {
  const figure = flow.locator('figure[data-bw-diagram]');
  const labels: string[] = expectedLabels || await figure.locator('script[data-diagram-steps]').evaluate(node => JSON.parse(node.textContent || 'null'));
  await expect(figure).toHaveAttribute('data-diagram-state', 'ready');
  await expect(figure.locator('.bw-diagram-stage')).toHaveAttribute('aria-hidden', 'true');
  const svg = figure.locator('.bw-diagram-stage > svg');
  await expect(svg).toBeVisible();
  await expect(svg.locator('.pele-node')).toHaveCount(labels.length);
  await expect(svg.locator('.pele-edge')).toHaveCount(labels.length - 1);
  expect(await svg.locator('.pele-node').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-id'))))
    .toEqual(labels.map((_, index) => `S${index}`));
  const renderedLabels = await svg.locator('.pele-node').evaluateAll(nodes => nodes.map(node =>
    [...node.querySelectorAll('text')].map(text => {
      const lines = [...text.querySelectorAll('tspan')];
      return lines.length ? lines.map(line => line.textContent || '').join(' ') : text.textContent || '';
    }).join(' ').trim().replace(/\s+/g, ' ')));
  expect(renderedLabels).toEqual(labels.map(normalize));
  // The visual is decorative; the equivalent ordered explanation stays in the accessibility tree.
  const fallback = figure.locator('ol.bw-diagram-steps');
  await expect(fallback).not.toHaveAttribute('aria-hidden', 'true');
  await expect(fallback).not.toHaveAttribute('hidden', '');
  await expect(fallback.getByRole('listitem')).toHaveCount(labels.length);
  expect(await fallback.evaluate(node => getComputedStyle(node).clipPath)).toBe('inset(50%)');
  return figure;
}

async function historyKeyboardWorks(page: Page) {
  const chart = page.locator('#gr-chart svg.bw-d3-chart');
  await expect(chart).toBeVisible();
  await chart.focus();
  await page.keyboard.press('Home');
  await expect(page.locator('#gr-readout')).toContainText('2023');
  const first = await page.locator('#gr-readout').textContent();
  await page.keyboard.press('End');
  await expect(page.locator('#gr-readout')).toContainText('2025');
  await expect(page.locator('#gr-readout')).not.toHaveText(first!);
}

async function createAccount(page: Page) {
  await page.goto('/workspace/register');
  await page.getByLabel('Username', { exact: true }).fill(`diagram-${randomUUID().slice(0, 8)}`);
  await page.locator('#password').fill('synthetic diagram test password');
  await page.getByRole('button', { name: 'Create private workspace' }).click();
  await page.getByRole('link', { name: 'Continue to workspace' }).click();
}

test('the local Pele renderer loads only on disclosure and preserves D3 history and quick visuals', async ({ page, baseURL }) => {
  const requests = vendorRequests(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openHistory(page, true);
  const flow = historyFlow(page);
  await expect(flow).not.toHaveAttribute('open', '');
  await expect(flow.locator('.bw-diagram-stage svg')).toHaveCount(0);
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => typeof (window as any).pele)).toBe('undefined');
  await flow.getByText(historySummary, { exact: true }).click();
  const figure = await renderedFlow(flow);
  await expect(figure.locator('.bw-diagram-steps')).toContainText('World Bank');
  await expect(figure.locator('.bw-diagram-steps')).toContainText('Sample North · TEST.WIND');
  await expect(figure.locator('.bw-diagram-steps')).toContainText('Saved annual observations · GW');
  await expect(figure.locator('.bw-diagram-steps')).toContainText('CSV');
  expect(requests).toHaveLength(1);
  expect(new URL(requests[0]).origin).toBe(baseURL);
  expect(new URL(requests[0]).pathname).toBe(vendorPath);
  expect(await page.evaluate(() => typeof (window as any).pele.mount)).toBe('function');
  await historyKeyboardWorks(page);
  await selectOption(page.locator('#gr-chart-type'), 'bar');
  await expect(page.locator('#gr-chart .bw-d3-bar')).toHaveCount(3);
  await page.locator('.gr-chart-controls').getByRole('button', { name: 'Quick visual', exact: true }).click();
  const quick = page.getByRole('dialog', { name: 'Quick visual', exact: true });
  await expect(quick.locator('svg')).toBeVisible();
  await expect(quick).toContainText('Sample North');
  await quick.getByRole('button', { name: 'Close quick visual', exact: true }).click();
  await flow.getByText(historySummary, { exact: true }).click();
  await flow.getByText(historySummary, { exact: true }).click();
  await renderedFlow(flow);
  expect(requests).toHaveLength(1);
  expect(errors).toEqual([]);
});

for (const width of [1440, 320]) {
  test(`source nodes stay readable and inside the page in light and dark at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await openHistory(page);
    await historyFlow(page).getByText(historySummary, { exact: true }).click();
    const figure = await renderedFlow(historyFlow(page));
    await page.addStyleTag({ content: '*,:before,:after{transition:none!important;animation:none!important}' });
    const fills: string[] = [];
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => (window as any).setTheme(value), theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await renderedFlow(historyFlow(page));
      const controls = await page.locator('.gr-chart-controls select,.gr-chart-controls button.bw-create-graphic').evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect(), style = getComputedStyle(node);
        return { height: box.height, bottom: box.bottom, left: box.left, right: box.right,
          fontSize: style.fontSize, fontWeight: style.fontWeight, radius: style.borderRadius };
      }));
      expect(controls).toHaveLength(3);
      for (const control of controls) {
        expect(control.height).toBe(32);
        expect(control.bottom).toBeCloseTo(controls[0].bottom, 0);
        expect(control.fontSize).toBe('12px');
        expect(control.fontWeight).toBe('400');
        expect(control.radius).toBe('6px');
        expect(control.left).toBeGreaterThanOrEqual(0);
        expect(control.right).toBeLessThanOrEqual(width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      expect(await figure.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
      const geometry = await figure.locator('svg').evaluate(svg => {
        const bounds = svg.getBoundingClientRect();
        return [...svg.querySelectorAll('.pele-node')].map(node => {
          const box = node.getBoundingClientRect();
          const texts = [...node.querySelectorAll('text')];
          return {
            left: box.left, right: box.right, top: box.top, bottom: box.bottom,
            svgLeft: bounds.left, svgRight: bounds.right, svgTop: bounds.top, svgBottom: bounds.bottom,
            fonts: texts.map(text => ({
              cssSize: parseFloat(getComputedStyle(text).fontSize),
              renderedSize: parseFloat(getComputedStyle(text).fontSize) * (text.getScreenCTM()?.a || 0),
              width: text.getBoundingClientRect().width,
            })),
          };
        });
      });
      expect(geometry).toHaveLength(4);
      for (const node of geometry) {
        expect(node.left).toBeGreaterThanOrEqual(Math.max(0, node.svgLeft) - 1);
        expect(node.right).toBeLessThanOrEqual(Math.min(width, node.svgRight) + 1);
        expect(node.top).toBeGreaterThanOrEqual(node.svgTop - 1);
        expect(node.bottom).toBeLessThanOrEqual(node.svgBottom + 1);
        expect(node.fonts.length).toBeGreaterThan(0);
        for (const font of node.fonts) {
          expect(font.cssSize).toBeGreaterThanOrEqual(11);
          expect(font.renderedSize).toBeGreaterThanOrEqual(11);
          expect(font.width).toBeGreaterThan(0);
        }
      }
      fills.push(await figure.locator('.pele-node rect').first().evaluate(node => getComputedStyle(node).fill));
      await figure.screenshot({ path: info.outputPath(`source-flow-${width}-${theme}.png`) });
      await page.locator('.gr-chart-top').screenshot({ path: info.outputPath(`chart-controls-${width}-${theme}.png`) });
    }
    expect(fills[0]).not.toBe(fills[1]);
  });
}

test('a blocked optional vendor leaves readable steps and the existing history chart usable', async ({ page }) => {
  const aborted: string[] = [];
  const failed: string[] = [];
  page.on('requestfailed', request => {
    if (new URL(request.url()).pathname === vendorPath) failed.push(request.failure()?.errorText || 'unknown failure');
  });
  // Flask versions every static URL with ?v=<mtime>; match the pathname, including that request.
  await page.route(url => url.pathname === vendorPath, async route => {
    aborted.push(route.request().url());
    await route.abort('blockedbyclient');
  });
  await openHistory(page);
  const flow = historyFlow(page);
  await flow.getByText(historySummary, { exact: true }).click();
  const figure = flow.locator('[data-bw-diagram]');
  await expect.poll(() => aborted.length).toBe(1);
  await expect(figure).toHaveAttribute('data-diagram-state', 'error');
  expect(failed).toHaveLength(1);
  expect(failed[0]).toContain('ERR_BLOCKED_BY_CLIENT');
  expect(await page.evaluate(() => typeof (window as any).pele)).toBe('undefined');
  await expect(figure.locator('.bw-diagram-stage')).toBeHidden();
  await expect(figure.locator('.bw-diagram-stage svg')).toHaveCount(0);
  await expect(figure.getByRole('status')).toContainText('The source steps remain available');
  const steps = figure.locator('.bw-diagram-steps');
  await expect(steps).toBeVisible();
  await expect(steps.getByRole('listitem')).toHaveCount(4);
  expect(await steps.evaluate(node => getComputedStyle(node).clipPath)).toBe('none');
  await historyKeyboardWorks(page);
  await selectOption(page.locator('#gr-chart-type'), 'bar');
  await expect(page.locator('#gr-chart .bw-d3-bar')).toHaveCount(3);
});

test('native disclosure exposes the ordered explanation and exact values with JavaScript disabled', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width: 320, height: 1000 } });
  try {
    await context.route('**/*', route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
    const page = await context.newPage();
    const requests = vendorRequests(page);
    await page.goto(detailPath);
    const flow = historyFlow(page);
    await flow.getByText(historySummary, { exact: true }).click();
    await expect(flow).toHaveAttribute('open', '');
    await expect(flow.getByRole('list', { name: historySummary })).toBeVisible();
    await expect(flow.getByRole('listitem')).toHaveCount(4);
    await expect(flow).toContainText('Sample North · TEST.WIND');
    await expect(flow.locator('svg')).toHaveCount(0);
    await expect(page.locator('.gr-table-scroll[role=region]')).toContainText('2025');
    await expect(page.getByRole('link', { name: 'Download CSV', exact: true })).toBeVisible();
    expect(requests).toEqual([]);
  } finally {
    await context.close();
  }
});

test('hostile label text cannot create flow nodes, executable callbacks or network requests', async ({ page, baseURL }) => {
  const labels = [
    'Publisher "]\nInjected[Injected node]\nclick S0 "https://diagram-invalid.example/click"',
    '<img src="https://diagram-invalid.example/pixel" onerror="window.__diagramInjected=1">',
    'javascript:window.__diagramInjected=2',
    '%%{init: {"securityLevel": "loose"}}%% <script>window.__diagramInjected=3</script>',
  ];
  const externalRequests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    // The existing page attempts its Google Fonts stylesheet; no diagram label may add a request.
    if (url.origin !== baseURL && !['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) externalRequests.push(request.url());
  });
  await page.addInitScript(() => { (window as any).__diagramInjected = 0; });
  await page.route(`**${detailPath}`, async route => {
    const response = await route.fetch();
    const html = await response.text();
    const replacement = JSON.stringify(labels).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
    const body = html.replace(/(<script\b[^>]*\bdata-diagram-steps[^>]*>)[\s\S]*?(<\/script>)/, (_match, open, close) => `${open}${replacement}${close}`);
    expect(body).not.toBe(html);
    await route.fulfill({ response, body });
  });
  await openHistory(page);
  await historyFlow(page).getByText(historySummary, { exact: true }).click();
  const figure = await renderedFlow(historyFlow(page), labels);
  const svg = figure.locator('.bw-diagram-stage > svg');
  await expect(svg.locator('script,img,image,a,foreignObject,[href],[onclick],[onload],[onerror]')).toHaveCount(0);
  expect(await svg.evaluate(node => [node, ...node.querySelectorAll('*')].flatMap(element => [...element.attributes])
    .filter(attribute => /^on/i.test(attribute.name) || /(?:^|:)href$/i.test(attribute.name)).map(attribute => attribute.name))).toEqual([]);
  await svg.locator('.pele-node').first().click();
  expect(await page.evaluate(() => (window as any).__diagramInjected)).toBe(0);
  await expect(page).toHaveURL(new RegExp(`${detailPath}$`));
  expect(externalRequests).toEqual([]);
});

test('an open company flow waits for its closed methodology parent', async ({ page }) => {
  const requests = vendorRequests(page);
  await createAccount(page);
  const csrf = await page.locator('input[name=csrf]').first().inputValue();
  const response = await page.request.post('/workspace/companies/open', {
    form: { csrf, cik: '0000000001' }, headers: { Accept: 'application/json' },
  });
  expect(response.ok()).toBe(true);
  await page.goto((await response.json()).url);
  await expect(page.locator('#company-chart svg.bw-d3-chart')).toBeVisible();
  await loaderReady(page);
  const methodology = page.locator('details.company-methodology');
  const flow = methodology.locator('details.bw-source-flow');
  await expect(methodology).not.toHaveAttribute('open', '');
  await expect(flow).toHaveAttribute('open', '');
  await expect(flow.locator('svg')).toHaveCount(0);
  expect(requests).toEqual([]);
  await methodology.locator(':scope > summary').click();
  await renderedFlow(flow);
  await expect(flow).toContainText('Public SEC filings');
  await expect(flow).toContainText('Reported facts and fiscal periods');
  await expect(methodology).toContainText('Diluted EPS and weighted average shares');
  await page.locator('#company-chart svg.bw-d3-chart').focus();
  await page.keyboard.press('Home');
  await expect(page.locator('#company-chart-readout')).toContainText('2020');
  await page.keyboard.press('End');
  await expect(page.locator('#company-chart-readout')).toContainText('2025');
  expect(requests).toHaveLength(1);
});

test('a dynamically inserted workbook result waits for Source data and retains its saved-cell evidence', async ({ page }) => {
  const requests = vendorRequests(page);
  await createAccount(page);
  const minimize = page.getByRole('button', { name: 'Minimize AI chat', exact: true });
  if (await minimize.isVisible()) await minimize.click();
  await page.locator('.workspace-nav').getByRole('link', { name: 'AI settings', exact: true }).click();
  const connection = page.locator('form:has(#key-typesafe)');
  await connection.locator('input[type=password]').fill('fixture-typesafe-key');
  await connection.locator('input[type=checkbox]').check();
  await connection.getByRole('button', { name: 'Test and save key' }).click();
  await page.locator('.workspace-nav').getByRole('link', { name: 'Workbook studio', exact: true }).click();
  await page.locator('.workbook-list').getByRole('link', { name: /Sample Company/ }).click();
  const openChat = page.getByRole('button', { name: 'Open AI chat', exact: true });
  if (await openChat.isVisible()) await openChat.click();
  await loaderReady(page);
  await expect(page.locator('[data-bw-diagram]')).toHaveCount(0);
  await page.evaluate(() => { (window as any).__diagramDocument = 'original workbook document'; });
  const chat = page.getByRole('complementary', { name: 'Workbook AI chat', exact: true });
  await expect(chat).toBeVisible();
  await chat.getByRole('button', { name: 'Show Operating Income across the available periods.', exact: true }).click();
  await chat.locator('.studio-chat-options > summary').click();
  await chat.locator('#provider-model').selectOption('typesafe:jev-latest');
  await chat.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: 'Agree and send', exact: true }).click();
  const step = page.locator('.studio-analysis-step[open]');
  const source = step.locator('details.studio-source-data');
  const flow = source.locator('details.bw-source-flow');
  await expect(flow).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__diagramDocument)).toBe('original workbook document');
  await expect(source).not.toHaveAttribute('open', '');
  await expect(flow).toHaveAttribute('open', '');
  await expect(flow.locator('svg')).toHaveCount(0);
  expect(requests).toEqual([]);
  if (await minimize.isVisible()) await minimize.click();
  await source.locator(':scope > summary').click();
  await renderedFlow(flow);
  await expect(flow).toContainText('Sample Company.xlsx');
  await expect(flow).toContainText('Source cells and saved values');
  await expect(flow.locator('figcaption')).toContainText('Workbook formulas are not executed here');
  await expect(source.getByRole('region', { name: 'Calculated values and source cells', exact: true })).toContainText('Model!C3');
  await expect(step.locator('[data-workbook-chart] svg.bw-d3-chart').first()).toBeVisible();
  expect(requests).toHaveLength(1);
});
