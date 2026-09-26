import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('workspace navigation preserves browser back and category links', async ({page}) => {
  await page.goto('/?view=compact');
  await page.locator('[data-workspace-category="energy"]').click();
  await expect(page).toHaveURL(/category=energy/);
  await expect(page.locator('#tw-category')).toHaveValue('energy');
  await page.locator('[data-workspace="research"]').click();
  await expect(page.locator('#research-workspace')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#benchmark-workspace')).toBeVisible();
  await expect(page.locator('#tw-category')).toHaveValue('energy');
});

test('command search opens reference details with keyboard and restores focus', async ({page}) => {
  await page.goto('/?view=compact');
  await page.locator('#bw-search-trigger').click();
  await page.locator('#bw-global-query').fill('gold');
  const result = page.locator('#bw-search-results a').filter({hasText:'Gold'}).first();
  await expect(result).toBeVisible();
  await page.locator('#bw-global-query').press('ArrowDown');
  await expect(result).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#bw-search-dialog')).toBeHidden();
  await expect(page.locator('#benchmark-detail')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#bw-search-trigger')).toBeFocused();
});

test('command search finds local research and opens its editor', async ({page}) => {
  await page.goto('/?workspace=research&view=compact');
  await page.locator('[data-rw-action="new"]').first().click();
  await page.locator('#rw-editor [name="title"]').fill('Copper supply context');
  await page.locator('#rw-editor').getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.locator('#rw-save-state')).toHaveText('Saved in this browser');
  await page.locator('[data-workspace="benchmarks"]').click();
  await page.locator('#bw-search-trigger').click();
  await page.locator('#bw-global-query').fill('Copper supply');
  await page.locator('#bw-search-results button').filter({hasText:'Copper supply context'}).click();
  await expect(page.locator('#research-workspace')).toBeVisible();
  await expect(page.locator('#rw-editor [name="title"]')).toHaveValue('Copper supply context');
  await expect(page.locator('#rw-editor :focus')).toHaveCount(1);
});

test('homepage light and dark surfaces meet serious WCAG checks', async ({page}) => {
  test.setTimeout(90000);
  await page.goto('/?view=compact');
  for (let i=0;i<2;i++) {
    const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
    const issues=result.violations.filter(v=>['critical','serious'].includes(v.impact || ''));
    expect(issues.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
    await page.locator('#quick-theme-toggle').click();
  }
});


test('browser back restores observations and retains the working table filters', async ({page}) => {
  await page.goto('/?view=compact&range=1Y');
  await page.locator('#tw-query').fill('gold');
  await page.locator('#range-1M').click();
  await expect(page.locator('#data-table')).toHaveAttribute('aria-busy','false');
  await page.locator('[data-workspace="research"]').click();
  await page.goBack();
  await expect(page.locator('#tw-query')).toHaveValue('gold');
  await page.goBack();
  await expect(page).toHaveURL(/range=1Y/);
  await expect(page.locator('#range-1Y')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#data-table')).toHaveAttribute('aria-busy','false');
  await expect(page.locator('#tw-query')).toHaveValue('gold');
});

test('settings is removed from keyboard order while closed and restores focus', async ({page}) => {
  await page.goto('/?view=compact');
  await expect(page.locator('#settings-modal')).toBeHidden();
  await page.locator('#settings-button').click();
  await expect(page.locator('#settings-modal')).toBeVisible();
  await page.getByRole('button',{name:'Close settings',exact:true}).click();
  await expect(page.locator('#settings-modal')).toBeHidden();
  await expect(page.locator('#settings-button')).toBeFocused();
});


test('Back while editing Research closes its modal and keeps the draft', async ({page}) => {
  await page.goto('/?view=compact');
  await page.locator('[data-workspace="research"]').click();
  await page.locator('[data-rw-action="new"]').first().click();
  await page.locator('#rw-editor [name="title"]').fill('Retain the navigation draft');
  await page.goBack();
  await expect(page.locator('#benchmark-workspace')).toBeVisible();
  await expect(page.locator('#rw-editor')).not.toHaveAttribute('open','');
  await page.locator('[data-workspace="research"]').click();
  await expect(page.locator('#rw-table-body')).toContainText('Retain the navigation draft');
});
