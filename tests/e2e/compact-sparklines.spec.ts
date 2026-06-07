import { test, expect } from '@playwright/test';

// The compact-view trend sparklines are Chart.js charts created inside
// initSparklines, which wraps its whole render in requestAnimationFrame. In the
// backgrounded Claude Preview tab (document.hidden), rAF is throttled and never
// fires, so they LOOK blank there — but they must render in a real foreground
// browser. Playwright actually renders, so this is the right place to verify
// (and it guards the PERF-1 defer change too).
test('compact view sparklines actually draw (rAF fires in a real browser)', async ({ page }) => {
    const response = await page.goto('/?view=compact');
    expect(response?.ok()).toBeTruthy();

    await page.waitForSelector('#table-body canvas', { state: 'visible', timeout: 8000 });

    // At least one sparkline canvas should have non-blank pixels once the
    // async data fetch + rAF render complete.
    await expect.poll(async () => {
        return await page.evaluate(() => {
            const canvases = [...document.querySelectorAll('#table-body canvas')] as HTMLCanvasElement[];
            for (const c of canvases) {
                try {
                    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
                    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
                } catch { /* tainted/none */ }
            }
            return false;
        });
    }, { timeout: 10000, intervals: [250, 500, 1000] }).toBe(true);
});
