import { test, expect } from '@playwright/test';

test('shared workspace remains usable in every appearance and at narrow widths', async ({page}, testInfo) => {
  test.setTimeout(120000);
  await page.setViewportSize({width:1440,height:960});
  await page.goto('/?view=compact');
  await expect(page.locator('#tw-result-count')).toContainText('benchmarks');
  for (const theme of ['light','dark','mono-light','mono-dark','bloomberg','ft']) {
    await page.locator('#settings-button').click();
    await page.locator('#theme-'+theme).click();
    await page.getByRole('button',{name:'Close settings',exact:true}).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    await expect(page.locator('#table-body tr').first()).toBeVisible();
    await page.screenshot({path:testInfo.outputPath(theme+'-desktop.png')});
  }
  await page.locator('#settings-button').click();
  await page.locator('#theme-light').click();
  await page.getByRole('button',{name:'Close settings',exact:true}).click();
  for (const width of [720,390,320]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);
    await expect(page.locator('#tw-filter-button')).toBeVisible();
    await expect(page.locator('[data-workspace="research"]')).toBeInViewport();
    await page.screenshot({path:testInfo.outputPath('light-'+width+'.png')});
  }
});
