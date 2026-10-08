import { test, expect } from '@playwright/test';

for (const width of [320, 390, 1440]) {
  test(`homepage opens and filters saved country histories at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/?view=compact');
    const datasets = page.getByRole('navigation', { name: 'Homepage datasets' });
    await expect(datasets.getByRole('link', { name: /Commodities/ })).toHaveAttribute('aria-current', 'page');
    await datasets.getByRole('link', { name: /Country highlights/ }).click();
    await expect(page).toHaveURL(/dataset=countries/);
    await expect(page.getByRole('heading', { name: 'Country data', exact: true })).toBeVisible();
    await expect(page.locator('.gr-reference-row')).toHaveCount(30);
    await expect(page.locator('.gr-context')).toContainText('1,248 saved histories');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#home-country-page').screenshot({ path: testInfo.outputPath(`country-home-${width}.png`) });
    await page.getByLabel('Country / economy', { exact: true }).selectOption('JP');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.locator('.gr-reference-row')).toHaveCount(6);
    await page.getByLabel('Country measure', { exact: true }).selectOption('SP.POP.TOTL');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.locator('.gr-reference-row')).toHaveCount(1);
    await expect(page.locator('.gr-reference-row')).toContainText('people');
    await page.locator('.gr-reference-name a').click();
    await expect(page.locator('#gr-chart')).toHaveAttribute('data-rendered', 'true');
    await page.goBack();
    await expect(page.getByLabel('Country measure', { exact: true })).toHaveValue('SP.POP.TOTL');
    await datasets.getByRole('link', { name: /Commodities/ }).click();
    await expect.poll(() => page.evaluate(() => Boolean((window as any).BW?.TableWorkspace?.ready))).toBe(true);
    expect(errors).toEqual([]);
  });
}
