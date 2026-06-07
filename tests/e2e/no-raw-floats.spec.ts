import { test, expect } from '@playwright/test';

// Regression guard for the raw-float bug that recurred and was twice
// mis-reported as fixed (e.g. compact "Chg" showed +33.667699999999996 even
// though the server returned +33.668 and unit tests were green). Root cause:
// the CLIENT re-render (compact_table.js applyVisualSettings) rebuilt the cell
// from the raw `data-value` attr, overwriting the rounded initial render.
//
// We scan the RENDERED DOM (not the server response, not unit tests — those
// both lied) for float noise. Every displayed number is rounded for display:
// change <=4 decimals, percent <=2, price <=4. So any run of 5+ digits after a
// decimal point is floating-point noise that should never reach the screen.
const RAW_FLOAT = /\d+\.\d{5,}/g;

function noise(text: string): string[] {
    return text.match(RAW_FLOAT) ?? [];
}

test.describe('No raw floating-point noise in rendered numbers', () => {
    test('compact table — including after the applyVisualSettings re-render', async ({ page }) => {
        const response = await page.goto('/?view=compact');
        expect(response?.ok()).toBeTruthy();
        await expect(page.locator('#table-body')).toBeVisible();

        // Initial server render.
        const initial = await page.locator('#table-body').innerText();
        expect(noise(initial), `raw floats on initial compact render: ${noise(initial)}`).toEqual([]);

        // Range change re-fetches and re-runs applyVisualSettings — the exact
        // path that previously reintroduced raw floats from data-value.
        await page.locator('#range-1M').click();
        await expect(page.locator('#market-pulse-range')).toHaveText('Recent observations');
        await expect(page.locator('#table-body')).toBeVisible();

        const refreshed = await page.locator('#table-body').innerText();
        expect(noise(refreshed), `raw floats after compact range refresh: ${noise(refreshed)}`).toEqual([]);
    });

    test('grid cards — initial render and after the client range re-render', async ({ page }) => {
        const response = await page.goto('/?view=grid');
        expect(response?.ok()).toBeTruthy();
        await expect(page.locator('#grid-cards-container')).toBeVisible();

        const initial = await page.locator('#grid-cards-container').innerText();
        expect(noise(initial), `raw floats on initial grid render: ${noise(initial)}`).toEqual([]);

        // Range change re-fetches and re-renders the cards client-side — the
        // path symmetric to the compact-table bug.
        await page.locator('#grid-range-1M').click();
        await expect(page.locator('#market-pulse-range')).toHaveText('Recent observations');
        await expect(page.locator('#grid-cards-container')).toBeVisible();

        const refreshed = await page.locator('#grid-cards-container').innerText();
        expect(noise(refreshed), `raw floats after grid range refresh: ${noise(refreshed)}`).toEqual([]);
    });

    test('homepage Market Pulse leaderboard is float-clean', async ({ page }) => {
        const response = await page.goto('/?view=grid');
        expect(response?.ok()).toBeTruthy();
        await expect(page.locator('#market-pulse')).toBeVisible();

        const pulse = await page.locator('#market-pulse').innerText();
        expect(noise(pulse), `raw floats in Market Pulse: ${noise(pulse)}`).toEqual([]);
    });
});
