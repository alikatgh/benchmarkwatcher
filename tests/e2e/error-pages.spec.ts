import { test, expect } from '@playwright/test';

// The 404 page was the last unbranded surface and had ZERO e2e coverage.
// Guards: a bad URL renders the branded 404 (not a host stack-trace or blank),
// the forward actions work, and there are no uncaught JS errors on the page.
test.describe('Error pages', () => {
    test('a bad URL renders the branded 404 with working forward actions', async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));

        const resp = await page.goto('/no-such-page-xyz');
        expect(resp?.status()).toBe(404);

        // Branded content + the UX-improvement actions (not a dead-end).
        await expect(page.getByText('Page not found')).toBeVisible();
        const home = page.getByRole('link', { name: 'Back to dashboard' });
        const browse = page.getByRole('link', { name: 'Browse all benchmarks' });
        await expect(home).toBeVisible();
        await expect(browse).toBeVisible();
        expect(await browse.getAttribute('href')).toBe('/?view=compact');

        // The page itself must not throw.
        expect(errors).toEqual([]);

        // "Back to dashboard" actually goes home.
        await home.click();
        await expect(page).toHaveURL(/\/$/);
    });
});
