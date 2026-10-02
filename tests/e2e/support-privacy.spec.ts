import { test, expect } from '@playwright/test';

test('support and privacy stay reachable from the public footer on desktop and phone', async ({ page }, testInfo) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.getByRole('contentinfo').getByRole('link', { name: 'Support' }).click();
    await expect(page.getByRole('heading', { name: 'Support', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'benchmarkwatcher@aulenor.com' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`support-${width}.png`), fullPage: true });
    await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' }).click();
    await expect(page.getByRole('heading', { name: 'Privacy', level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`privacy-${width}.png`), fullPage: true });
  }
});
