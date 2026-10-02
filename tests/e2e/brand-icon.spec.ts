import { test, expect } from '@playwright/test';

test('new icon story loads its artwork without overflow at desktop and phone widths', async ({ page }, testInfo) => {
  for (const [label, width, height] of [['desktop', 1440, 900], ['phone', 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    const response = await page.goto('/blog/a-new-mark-for-benchmarkwatcher');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'A new mark for BenchmarkWatcher', level: 1 })).toBeVisible();

    const images = page.locator('.bw-brand-mark img, article figure img');
    await expect(images).toHaveCount(3);
    for (const image of await images.all()) {
      await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`brand-story-${label}.png`), fullPage: true });
  }
});
