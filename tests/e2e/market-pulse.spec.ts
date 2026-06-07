import { test, expect } from '@playwright/test';

test.describe('Market Pulse', () => {
    test('updates summary when the grid range changes', async ({ page }) => {
        const response = await page.goto('/?view=grid');
        expect(response?.ok()).toBeTruthy();

        await expect(page.locator('#market-pulse')).toBeVisible();
        await expect(page.locator('#quick-find')).toBeVisible();
        await expect(page.locator('#grid-cards-container')).toBeVisible();
        await expect(page.locator('#market-pulse-categories a').first()).toBeVisible();

        const initialTotal = Number(await page.locator('#market-pulse-total').innerText());
        expect(initialTotal).toBeGreaterThan(0);

        await page.locator('#grid-range-1M').click();

        await expect(page.locator('#market-pulse-range')).toHaveText('Recent observations');
        await expect(page.locator('#grid-range-1M')).toHaveAttribute('aria-checked', 'true');

        const refreshedTotal = Number(await page.locator('#market-pulse-total').innerText());
        expect(refreshedTotal).toBeGreaterThan(0);

        const riseHref = await page.locator('#market-pulse-rise-link').getAttribute('href');
        expect(riseHref === null || riseHref?.startsWith('/commodity/')).toBeTruthy();

        const categoryHref = await page.locator('#market-pulse-categories a').first().getAttribute('href');
        expect(categoryHref).toContain('category=');
        expect(categoryHref).toContain('range=1M');
        expect(categoryHref).toContain('view=grid');
    });

    test('quick find filters and resets grid cards', async ({ page }) => {
        const response = await page.goto('/?view=grid');
        expect(response?.ok()).toBeTruthy();

        const cards = page.locator('#grid-cards-container > a');
        const initialCount = await cards.count();
        expect(initialCount).toBeGreaterThan(0);

        await page.locator('#quick-find-input').fill('no-such-benchmark');

        await expect(page.locator('#quick-find-empty')).toBeVisible();
        await expect(page.locator('#quick-find-count')).toHaveText(`0/${initialCount} shown`);
        await expect(page.locator('#quick-find-export')).toBeDisabled();

        await page.locator('#quick-find-reset').click();

        await expect(page.locator('#quick-find-empty')).toBeHidden();
        await expect(page.locator('#quick-find-count')).toHaveText(`${initialCount} shown`);
        await expect(page.locator('#quick-find-export')).toBeEnabled();
        await expect(page.locator('#quick-find-summary')).toBeVisible();
        await expect(cards.first()).toBeVisible();
    });

    test('updates summary when the compact table range changes', async ({ page }) => {
        const response = await page.goto('/?view=compact');
        expect(response?.ok()).toBeTruthy();

        await expect(page.locator('#market-pulse')).toBeVisible();
        await expect(page.locator('#table-body')).toBeVisible();

        const initialTotal = Number(await page.locator('#market-pulse-total').innerText());
        expect(initialTotal).toBeGreaterThan(0);

        await page.locator('#range-1M').click();

        await expect(page.locator('#market-pulse-range')).toHaveText('Recent observations');
        await expect(page.locator('#range-1M')).toHaveClass(/theme-surface/);
        await expect(page.locator('#date-range-display')).toContainText('Last month');

        const refreshedTotal = Number(await page.locator('#market-pulse-total').innerText());
        expect(refreshedTotal).toBeGreaterThan(0);

        const categoryHref = await page.locator('#market-pulse-categories a').first().getAttribute('href');
        expect(categoryHref).toContain('category=');
        expect(categoryHref).toContain('range=1M');
        expect(categoryHref).toContain('view=compact');
    });

    test('quick find filters compact table rows after range refresh', async ({ page }) => {
        const response = await page.goto('/?view=compact');
        expect(response?.ok()).toBeTruthy();

        await page.locator('#range-1M').click();
        await expect(page.locator('#market-pulse-range')).toHaveText('Recent observations');

        const rows = page.locator('#table-body > tr');
        const rowCount = await rows.count();
        expect(rowCount).toBeGreaterThan(0);

        await page.locator('[data-quick-filter="down"]').click();
        await expect(page.locator('[data-quick-filter="down"]')).toHaveAttribute('aria-pressed', 'true');

        await page.locator('#quick-find-input').fill('no-such-benchmark');
        await expect(page.locator('#quick-find-empty')).toBeVisible();
        await expect(page.locator('#quick-find-count')).toHaveText(`0/${rowCount} shown`);
        await expect(page.locator('#quick-find-export')).toBeDisabled();

        await page.locator('#quick-find-reset').click();
        await expect(page.locator('#quick-find-empty')).toBeHidden();
        await expect(page.locator('#quick-find-export')).toBeEnabled();
        await expect(rows.first()).toBeVisible();
    });

    test('fits without page-level horizontal overflow on desktop and mobile', async ({ page }) => {
        for (const viewport of [
            { width: 1280, height: 900 },
            { width: 390, height: 844 },
        ]) {
            await page.setViewportSize(viewport);

            const response = await page.goto('/?view=grid');
            expect(response?.ok()).toBeTruthy();

            await expect(page.locator('#market-pulse')).toBeVisible();
            await expect(page.locator('#market-pulse-headline')).toBeVisible();
            await expect(page.locator('#market-pulse-rise-link')).toBeVisible();
            await expect(page.locator('#market-pulse-drop-link')).toBeVisible();
            await expect(page.locator('#market-pulse-categories')).toBeVisible();

            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            expect(overflow).toBeLessThanOrEqual(1);

            const box = await page.locator('#market-pulse').boundingBox();
            expect(box).not.toBeNull();
            expect(box!.x).toBeGreaterThanOrEqual(0);
            expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
        }
    });
});
