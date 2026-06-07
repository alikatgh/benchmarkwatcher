import { test, expect } from '@playwright/test';

// The /changelog page had ZERO browser coverage — a Jinja error or a broken
// base-template inheritance would ship invisibly. This is a structure-agnostic
// smoke test (robust to content/version churn): it guards that the route serves
// 200, renders its heading + at least one version entry, sits inside the real
// app chrome, and throws no uncaught JS errors.
test.describe('Changelog page', () => {
    test('renders inside the app chrome with version entries and no JS errors', async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));

        const resp = await page.goto('/changelog');
        expect(resp?.status()).toBe(200);

        await expect(page.getByRole('heading', { name: 'Changelog', level: 1 })).toBeVisible();

        // At least one release entry is present (e.g. "v1.3.0 — …").
        await expect(page.getByText(/v\d+\.\d+\.\d+/).first()).toBeVisible();

        // It extends base.html — the shared nav is present.
        await expect(page.getByRole('link', { name: 'BenchmarkWatcher' }).first()).toBeVisible();

        expect(errors).toEqual([]);
    });
});
