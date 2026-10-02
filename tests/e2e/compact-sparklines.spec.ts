import {test,expect} from '@playwright/test';
test('compact D3 sparklines have visible, finite paths', async({page}) => {
  await page.goto('/?view=compact');
  const plots=page.locator('#table-body svg[id^="sparkline-"]');
  await expect(plots.first()).toBeVisible();
  await expect.poll(()=>plots.locator('path').count()).toBeGreaterThan(0);
  const paths=await plots.locator('path').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('d')));
  expect(paths.every(path=>path && !/NaN|Infinity/.test(path))).toBe(true);
});
