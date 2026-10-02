import { test, expect } from '@playwright/test';

test('workspace controls, panels and dialogs use brief motion', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?view=compact');
  const filter = page.locator('#tw-filter-button');
  await expect(filter).toHaveCSS('transition-property', /background-color/);
  await filter.click();
  await expect(page.locator('#tw-filters')).toBeVisible();
  await expect(page.locator('#tw-filters')).toHaveCSS('animation-name', 'bw-content-in');

  await page.locator('#tw-new-view').click();
  await expect(page.locator('#tw-view-menu')).toBeVisible();
  await expect(page.locator('#tw-view-menu')).toHaveCSS('animation-name', 'bw-dialog-in');
  await page.locator('#tw-view-close').click();

  await page.locator('#table-body a[data-benchmark-id]').first().click();
  await expect(page.locator('#benchmark-detail')).toBeVisible();
  await expect(page.locator('#benchmark-detail')).toHaveCSS('animation-name', 'bw-drawer-in');
  await expect(page.locator('.benchmark-detail-chart-surface')).toHaveCSS('animation-name', 'bw-content-in');
  await page.locator('#benchmark-detail').evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
  await page.screenshot({ path: testInfo.outputPath('workspace-detail-motion.png') });
  await page.locator('#benchmark-detail [data-detail-action="close"]').click();

  await page.locator('#settings-button').click();
  await expect(page.locator('#settings-modal')).toBeVisible();
  await expect(page.locator('#settings-modal > .bw-popup-surface')).toHaveCSS('animation-name', 'bw-dialog-in');
  await page.locator('#settings-modal > .bw-popup-surface').evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
  await page.screenshot({ path: testInfo.outputPath('settings-dialog-motion.png') });
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.locator('#settings-button')).toBeFocused();

  await page.locator('[data-workspace="research"]').first().click();
  await page.locator('[data-rw-action="new"]').first().click();
  await expect(page.locator('#rw-editor')).toBeVisible();
  await expect(page.locator('#rw-editor')).toHaveCSS('animation-name', 'bw-dialog-in');
});

test('reduced motion leaves controls and panels immediately usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?view=compact');
  await page.locator('#tw-filter-button').click();
  await expect(page.locator('#tw-filters')).toBeVisible();
  await expect(page.locator('#tw-filters')).toHaveCSS('animation-name', 'none');
  await page.locator('#table-body a[data-benchmark-id]').first().click();
  await expect(page.locator('#benchmark-detail')).toBeVisible();
  await expect(page.locator('#benchmark-detail')).toHaveCSS('animation-name', 'none');
  await page.locator('#benchmark-detail [data-detail-action="close"]').click();
  await page.locator('#settings-button').click();
  await expect(page.locator('#settings-modal > .bw-popup-surface')).toHaveCSS('animation-name', 'none');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.locator('#settings-button')).toBeFocused();
});

test('mobile detail keeps its full viewport width during entry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?view=compact');
  await page.locator('#table-body a[data-benchmark-id]').first().click();
  const detail = page.locator('#benchmark-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toHaveCSS('animation-name', 'bw-fade-in');
  const bounds = await detail.boundingBox();
  expect(bounds?.x).toBe(0);
  expect(bounds?.width).toBe(390);
});
