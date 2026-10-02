import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('all D3 explorer views, keyboard inspection, range, export and responsive layout', async({page}, testInfo) => {
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  const scripts:string[]=[];page.on('request',r=>{if(r.resourceType()==='script') scripts.push(r.url());});
  await page.goto('/commodity/gold');
  await expect(page.locator('#chart-skeleton')).toHaveCount(0);
  await expect(page.locator('#priceChart svg')).toBeVisible();
  await page.locator('#priceChart svg').press('Home');
  await expect(page.locator('#crosshair-price')).toContainText('2,000');
  await page.getByRole('button',{name:'1M',exact:true}).click();
  await expect(page.locator('#stat-points')).not.toHaveText('120');
  const lab=page.getByRole('region',{name:'Visual explorer'});
  for(const type of ['line','area','step','bar','scatter','change','histogram','cumulative','box','monthly','heatmap','coverage']) {
    await lab.getByLabel('Visualization',{exact:true}).selectOption(type);
    await expect(lab.locator('svg')).toBeVisible();
    expect(await lab.locator('svg').innerHTML()).not.toMatch(/NaN|Infinity/);
    await expect(lab.locator('table')).toHaveCount(1);
  }
  const download=page.waitForEvent('download');await lab.getByRole('button',{name:'Download PNG'}).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  await page.screenshot({path:testInfo.outputPath('d3-detail.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  const axe=await new AxeBuilder({page}).include('.bw-visual-lab').analyze();expect(axe.violations).toEqual([]);
  expect(scripts.some(s=>/chart\.umd|chartjs/.test(s))).toBe(false);
  expect(errors).toEqual([]);
});
test('dashboard D3 sparklines, explorer fetch, comparison and themes',async({page},testInfo)=>{
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?view=compact');
  await expect(page.locator('#sparkline-gold path').first()).toBeAttached();
  await page.locator('#bw-visual-explorer>summary').click();
  const lab=page.getByRole('region',{name:'Visual explorer'});
  await expect(lab.locator('.bw-visual-note')).toContainText('120 usable');
  await lab.getByLabel('Benchmark',{exact:true}).selectOption('oil');
  await expect(lab.locator('.bw-visual-note')).toContainText('USD / test unit');
  await lab.getByLabel('Visualization',{exact:true}).selectOption('monthly');
  await expect(lab.locator('.bw-d3-bar')).toHaveCount(5);
  await lab.getByLabel('Benchmark',{exact:true}).selectOption('__catalog__');
  await expect(lab.locator('.bw-visual-note')).toContainText('3 benchmarks');
  for (const type of ['ranking','map','categories','dates']) {
    await lab.getByLabel('Visualization',{exact:true}).selectOption(type);
    await expect(lab.locator('svg')).toBeVisible();
    expect(await lab.locator('svg').innerHTML()).not.toMatch(/NaN|Infinity/);
  }
  await page.getByRole('button',{name:'Toggle light and dark mode'}).click();
  await expect(lab.locator('svg')).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('d3-dashboard-dark.png'),fullPage:true});
  await page.locator('#table-body').getByRole('link',{name:'Gold',exact:true}).click();
  await expect(page.locator('.benchmark-detail-plot')).toBeVisible();
  expect(errors).toEqual([]);
});
