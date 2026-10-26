import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const width of [320, 390, 1440]) {
  test(`homepage exposes collections and tools at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    const overview = page.locator('#home-overview');
    await expect(overview).toBeVisible();
    await expect(overview.getByRole('heading', { level: 1 })).toHaveText('Commodities. Countries.Companies.');
    const collections = overview.getByRole('navigation', { name: 'Explore the data collections' });
    await expect(collections.getByRole('link')).toHaveCount(3);
    for (const href of ['/?view=compact', '/data', '/companies']) {
      await expect(collections.locator(`a[href="${href}"]`)).toBeVisible();
    }
    await expect(overview.getByRole('heading', { name: 'Inside the library' })).toBeVisible();
    await expect(overview.getByRole('heading', { name: 'Work with the evidence' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const issues = await new AxeBuilder({ page }).include('#home-overview').analyze();
    expect(issues.violations).toEqual([]);
    await collections.locator('a[href="/?view=compact"]').focus();
    await collections.locator('a[href="/?view=compact"]').press('Enter');
    await expect(page.locator('#home-overview')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Commodity benchmarks', level: 1 })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('saved benchmark range preserves the homepage through reload and workspace navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?view=compact');
  await page.getByRole('button', { name: 'Show 6M observation range', exact: true }).click();
  await expect(page).toHaveURL(/range=6M/);
  await page.getByRole('link', { name: 'BenchmarkWatcher home', exact: true }).click();
  await expect(page.locator('#home-overview')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.reload();
  await expect(page.locator('#home-overview')).toBeVisible();
  await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('link', { name: 'Watchlist', exact: true }).click();
  await expect(page.locator('#home-overview')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Your watchlist', level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page.locator('#home-overview')).toBeVisible();
  await expect(page.locator('#bw-page-title')).toHaveJSProperty('tagName', 'H2');
  await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('link', { name: 'Benchmarks', exact: true }).click();
  await expect(page.locator('#home-overview')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Commodity benchmarks', level: 1 })).toBeVisible();
});
