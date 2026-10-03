import { test, expect, type Page } from '@playwright/test';

async function localOnly(page: Page) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort();
  });
}

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const issues = await page.locator('.gr-workspace input, .gr-workspace select, .gr-workspace button, .gr-action').evaluateAll(elements => elements
    .filter(el => el.getClientRects().length)
    .filter(el => {
      const box = el.getBoundingClientRect();
      return box.left < -1 || box.right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 1;
    }).map(el => el.outerHTML));
  expect(issues).toEqual([]);
}

async function axesFit(page: Page) {
  const svg = await page.locator('#gr-chart svg').boundingBox();
  const labels = await page.locator('#gr-chart .bw-d3-axis text').evaluateAll(elements => elements.map(el => {
    const box = el.getBoundingClientRect(); return { left: box.left, right: box.right };
  }));
  expect(labels.every(box => box.left >= svg!.x - 1 && box.right <= svg!.x + svg!.width + 1)).toBe(true);
}

for (const width of [390, 1440]) {
  test(`saved global references and D3 evidence remain usable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    await localOnly(page);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/references');
    await expect(page.getByRole('heading', { name: 'Global references', exact: true })).toBeVisible();
    await expect(page.locator('.gr-context')).toContainText('1,256 saved histories');
    await expect(page.locator('.gr-reference-row')).toHaveCount(30);
    await fits(page);
    await page.locator('.gr-workspace').screenshot({ path: testInfo.outputPath(`references-${width}.png`) });
    await page.getByLabel('Reference type', { exact: true }).selectOption('consumer_inflation');
    await page.getByLabel('Search references').fill('Germany');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.locator('.gr-reference-row')).toHaveCount(2);
    await page.locator('a[href="/reference/de_hicp_annual_change"]').click();
    await expect(page.locator('#gr-chart')).toHaveAttribute('data-rendered', 'true');
    await expect(page.locator('#gr-chart svg.bw-d3-chart')).toBeVisible();
    await expect(page.locator('.gr-change')).toContainText('percentage points');
    const originalReadout = await page.locator('#gr-readout span').textContent();
    await page.locator('#gr-chart svg').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#gr-readout span')).not.toHaveText(originalReadout!);
    await page.getByLabel('Range', { exact: true }).selectOption('1');
    await expect(page.locator('#gr-range-caption')).not.toContainText('120 saved observations');
    await page.getByLabel('Chart', { exact: true }).selectOption('bar');
    await expect.poll(() => page.locator('#gr-chart .bw-d3-bar').count()).toBeGreaterThan(0);
    await fits(page);
    await page.locator('.gr-workspace').screenshot({ path: testInfo.outputPath(`reference-detail-${width}.png`) });
    await page.locator('.gr-pagination').getByRole('link', { name: 'Next', exact: true }).click();
    await expect(page.locator('.gr-pagination')).toContainText('31–60 of 120');
    await page.goto('/reference/my_diesel_east');
    await expect(page.locator('.gr-evidence')).toContainText('Administered retail fuel prices');
    await expect(page.locator('#gr-readout')).toContainText('MYR / litre');
    await fits(page);
    await page.goto('/sources');
    await expect(page.locator('.gr-context')).toContainText('31 publishers catalogued');
    await page.getByLabel('Readiness', { exact: true }).selectOption('needs_registration');
    await page.getByRole('button', { name: 'Filter', exact: true }).click();
    await expect(page.locator('#source-ecb')).toHaveCount(0);
    await page.locator('.gr-provider summary').first().click();
    await expect(page.locator('.gr-provider[open] .gr-provider-content')).toBeVisible();
    await fits(page);
    await page.locator('.gr-workspace').screenshot({ path: testInfo.outputPath(`source-directory-${width}.png`) });
    await page.goto('/sources#gr-catalog-heading');
    await page.locator('.gr-pagination').getByRole('link', { name: 'Next', exact: true }).click();
    await expect(page.locator('.gr-pagination')).toContainText('31–60 of 1498');
    await page.getByLabel('Search the catalog').fill('NV.AGR.TOTL.ZS');
    await page.locator('.gr-catalog').getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.locator('.gr-catalog-list>li')).toHaveCount(1);
    await expect(page.locator('.gr-catalog-list')).toContainText('205 saved economy histories');
    await page.getByLabel('Browse', { exact: true }).selectOption('economies');
    await page.getByLabel('Search the catalog').fill('Japan');
    await page.locator('.gr-catalog').getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.locator('.gr-catalog-list')).toContainText('JPN · JP');
    await fits(page);
    expect(errors).toEqual([]);
  });

  test(`loaded country histories search, paginate and open D3 at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    await localOnly(page);
    await page.goto('/references');
    await expect(page.locator('.gr-footnote')).toContainText('1,248 nonempty country histories');
    await page.getByRole('navigation', { name: 'Reference pages' }).getByRole('link', { name: 'Next', exact: true }).click();
    await expect(page.locator('.gr-pagination')).toContainText('31–60 of 1256');
    await page.getByLabel('Country / economy', { exact: true }).selectOption('JP');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    // The country filter includes Japan's EUR/JPY reference as well as six WDI measures.
    await expect(page.locator('.gr-reference-row')).toHaveCount(7);
    await fits(page);
    await page.locator('.gr-workspace').screenshot({ path: testInfo.outputPath(`country-japan-${width}.png`) });
    await page.getByLabel('Country measure', { exact: true }).selectOption('SP.POP.TOTL');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.locator('.gr-reference-row')).toHaveCount(1);
    await page.locator('.gr-reference-name a').click();
    await expect(page.locator('#gr-chart')).toHaveAttribute('data-rendered', 'true');
    await expect(page.locator('#gr-readout')).toContainText('people');
    await expect(page.locator('#gr-chart .bw-d3-axis').first()).toContainText('M');
    await axesFit(page);
    await expect(page.locator('#gr-chart .bw-d3-tooltip')).toHaveAttribute('visibility', 'hidden');
    await page.locator('#gr-chart svg').focus();
    await page.keyboard.press('Home');
    await expect(page.locator('#gr-chart .bw-d3-tooltip')).toHaveAttribute('visibility', 'visible');
    await expect(page.locator('#gr-chart .bw-d3-tooltip')).toContainText('2000');
    await expect(page.locator('#gr-chart .bw-d3-tooltip')).not.toContainText('Jan 1');
    await expect(page.locator('.gr-evidence')).toContainText('CC BY-4.0');
    await expect(page.locator('.gr-evidence')).not.toContainText('Values are percentages');
    await fits(page);
    await page.locator('.gr-workspace').screenshot({ path: testInfo.outputPath(`country-population-${width}.png`) });
    await page.goto('/reference/wb_jpn_gdp_constant');
    await expect(page.locator('#gr-chart')).toHaveAttribute('data-rendered', 'true');
    await expect(page.locator('#gr-readout')).toContainText('constant 2015 US$');
    await axesFit(page);
    await expect(page.locator('.gr-evidence')).not.toContainText('Values are percentages');
    await fits(page);
    await page.goto('/sources?catalog=economies&q=Japan');
    await page.locator('.gr-catalog-list').getByRole('link', { name: '6 saved histories', exact: false }).click();
    await expect(page.locator('.gr-reference-row')).toHaveCount(6);
    await fits(page);
  });
}
