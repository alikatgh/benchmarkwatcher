import { test, expect } from '@playwright/test';

// Smoke coverage for the commodity detail page — the app's most complex view
// (Chart.js + the Chart Settings modal). It had ZERO e2e coverage while its
// settings tabs were being restructured, so a JS error or a broken tab would
// ship invisibly. This guards the load path, the chart render, freedom from
// uncaught exceptions, and that the restructured tabs switch panels.

test.describe('Commodity detail page', () => {
    test('loads with the chart, no JS errors, and Chart Settings tabs switch', async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));

        // Resolve a real commodity URL from the grid (no hardcoded id).
        await page.goto('/?view=grid');
        const href = await page.locator('#grid-cards-container > a').first().getAttribute('href');
        expect(href).toMatch(/^\/commodity\//);

        const response = await page.goto(href!);
        expect(response?.ok()).toBeTruthy();

        // The Chart.js canvas renders.
        await expect(page.locator('#priceChart')).toBeVisible();

        // Chart Settings modal opens and the restructured tabs swap panels.
        await page.locator('#chart-settings-btn').click();
        await expect(page.locator('#chart-settings-modal')).toBeVisible();
        await expect(page.locator('#content-appearance')).toBeVisible(); // default tab (Style)

        await page.locator('#tab-scales').click(); // Axes
        await expect(page.locator('#content-scales')).toBeVisible();
        await expect(page.locator('#content-appearance')).toBeHidden();

        await page.locator('#tab-tooltip').click(); // Tooltip
        await expect(page.locator('#content-tooltip')).toBeVisible();
        await expect(page.locator('#content-scales')).toBeHidden();

        // No uncaught JS errors anywhere in that flow.
        expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([]);
    });
});
