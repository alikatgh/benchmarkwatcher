import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const width of [320, 390, 1440]) {
  test(`homepage reaches searchable benchmarks before the library at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    const overview = page.locator('#home-overview');
    const library = page.locator('#home-library-details');
    await expect(overview).toBeVisible();
    await expect(overview.getByRole('heading', { level: 1 })).toHaveText('Commodities. Countries.Companies.');
    const collections = overview.getByRole('navigation', { name: 'Explore the data collections' });
    await expect(collections.getByRole('link')).toHaveCount(3);
    for (const href of ['/?view=compact', '/data', '/companies']) {
      await expect(collections.locator(`a[href="${href}"]`)).toBeVisible();
    }
    await expect(library.getByRole('heading', { name: 'Inside the library' })).toBeVisible();
    await expect(library.getByRole('heading', { name: 'Work with the evidence' })).toBeVisible();
    expect(await page.evaluate(() => {
      const landmarks = ['home-title', 'tw-query', 'data-table', 'home-catalog-title', 'home-tools-title']
        .map(id => document.getElementById(id)!);
      return landmarks.every((element, index) => index === 0 || Boolean(
        landmarks[index - 1].compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING
      ));
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const issues = await new AxeBuilder({ page }).include('#home-overview').include('#home-library-details').analyze();
    expect(issues.violations).toEqual([]);
    const benchmarkShortcut = overview.getByRole('link', { name: 'Explore benchmarks', exact: true });
    await benchmarkShortcut.focus();
    await benchmarkShortcut.press('Enter');
    await expect(page.locator('#bw-table-heading')).toBeFocused();
    await expect(page.locator('#bw-table-heading')).toBeInViewport();
    const search = page.getByRole('searchbox', { name: 'Search this view', exact: true });
    await expect(search).toBeInViewport();
    await search.fill('Gold');
    const benchmarkRows = page.locator(width <= 540 ? '#tw-mobile-list .tw-mobile-row' : '#table-body tr[data-id]:visible');
    await expect(benchmarkRows).not.toHaveCount(0);
    expect(await benchmarkRows.allTextContents()).toEqual(expect.arrayContaining([expect.stringMatching(/Gold/i)]));
    expect(await benchmarkRows.evaluateAll(rows => rows.every(row => /Gold/i.test(row.textContent || '')))).toBe(true);
    await search.fill('');
    const libraryShortcut = overview.getByRole('link', { name: 'Browse the library', exact: true });
    await libraryShortcut.focus();
    await libraryShortcut.press('Enter');
    await expect(page.locator('#home-catalog-title')).toBeFocused();
    await expect(page.locator('#home-catalog-title')).toBeInViewport();
    await collections.locator('a[href="/?view=compact"]').focus();
    await collections.locator('a[href="/?view=compact"]').press('Enter');
    await expect(page.locator('#home-overview')).toHaveCount(0);
    await expect(page.locator('#home-library-details')).toHaveCount(0);
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
  const library = page.locator('#home-library-details');
  await expect(library).toBeVisible();
  await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('link', { name: 'Watchlist', exact: true }).click();
  await expect(page.locator('#home-overview')).toBeHidden();
  await expect(library).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Inside the library', exact: true })).toHaveCount(0);
  const hiddenLibraryLink = library.locator('a').first();
  await hiddenLibraryLink.evaluate(link => (link as HTMLElement).focus());
  await expect(hiddenLibraryLink).not.toBeFocused();
  await expect(page.getByRole('heading', { name: 'Your watchlist', level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page.locator('#home-overview')).toBeVisible();
  await expect(library).toBeVisible();
  await expect(page.locator('#bw-page-title')).toHaveJSProperty('tagName', 'H2');
  await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('link', { name: 'Research', exact: true }).click();
  await expect(page.locator('#home-overview')).toBeHidden();
  await expect(library).toBeHidden();
  await expect(page.locator('#research-workspace')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#home-overview')).toBeVisible();
  await expect(library).toBeVisible();
  await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('link', { name: 'Benchmarks', exact: true }).click();
  await expect(page.locator('#home-overview')).toBeHidden();
  await expect(library).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Commodity benchmarks', level: 1 })).toBeVisible();
});
