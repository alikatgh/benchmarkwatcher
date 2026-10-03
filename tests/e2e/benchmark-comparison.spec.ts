import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const samples = {
  gold: {name:'Gold', unit:'troy oz', values:[100,110,107], change:7},
  oil: {name:'Oil', unit:'barrel', values:[50,52,60], change:20},
  copper: {name:'Copper', unit:'metric ton', values:[200,null,180], change:-10}
};
const dates = ['2026-09-01','2026-09-15','2026-09-30'];

for (const width of [1440,390]) {
  test(`workspace compares three actual histories with named percentage tooltips at ${width}px`, async ({page},testInfo) => {
    await page.setViewportSize({width,height:900});
    const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/commodity/*',route=>{
      const id = route.request().url().split('/').pop()! as keyof typeof samples;
      const sample = samples[id];
      return route.fulfill({json:{data:{id,name:sample.name,currency:'USD',unit:sample.unit,
        category:'Reference',is_daily:false,source_name:'Synthetic comparison fixture',
        history:sample.values.map((price,i)=>({date:dates[i],price}))}}});
    });
    await page.goto('/?range=ALL');
    for (const name of ['Gold','Oil','Copper']) await page.getByRole('checkbox',{name:`Select ${name}`,exact:true}).check();
    const trigger = page.locator('#tw-compare-selected'); await trigger.click();
    const pane = page.locator('#benchmark-detail'), chart = pane.locator('.benchmark-detail-plot');
    await expect(pane.locator('[data-detail-mode="percent"]')).toHaveAttribute('aria-pressed','true');
    await expect(chart.locator('.bw-d3-line')).toHaveCount(3);
    await expect(pane.locator('.benchmark-comparison-keys>span')).toHaveCount(3);
    await expect(pane.locator('[data-detail-mode="absolute"]')).toBeDisabled();
    await chart.press('End');
    const firstName = (await pane.locator('.benchmark-comparison-keys>span').first().innerText()).trim();
    const first = Object.values(samples).find(item=>item.name===firstName)!;
    await expect(chart.locator('[role="tooltip"]')).toHaveAttribute('visibility','visible');
    await expect(chart.locator('[role="tooltip"]')).toHaveAttribute('aria-label', new RegExp(`Sep 30, 2026.*${firstName}: ${first.change}%`));
    const before = await chart.locator('[role="tooltip"]').getAttribute('aria-label');
    await chart.press('ArrowDown');
    expect(await chart.locator('[role="tooltip"]').getAttribute('aria-label')).not.toBe(before);
    await expect(chart.locator('.bw-d3-axis').first()).toContainText('%');
    expect(await pane.evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);
    await pane.screenshot({path:testInfo.outputPath(`three-line-comparison-${width}.png`)});
    const axe = await new AxeBuilder({page}).include('#benchmark-detail-body').analyze();
    expect(axe.violations).toEqual([]);
    await pane.locator('[data-detail-mode="indexed"]').click();
    await expect(chart.locator('.point-0').first()).toHaveAttribute('cy',/./);
    await pane.locator('[data-detail-action="close"]').click(); await expect(trigger).toBeFocused();
    await expect(page.locator('#tw-selection-count')).toContainText('3');
    expect(errors).toEqual([]);
  });

  test(`commodity picker adds and removes lines, retains baselines and returns focus at ${width}px`, async ({page},testInfo) => {
    await page.setViewportSize({width,height:900});
    await page.goto('/commodity/gold');
    const button = page.locator('#compare-menu-btn');
    await expect(button).toBeInViewport(); await button.click();
    const picker = page.locator('#compare-menu');
    for (const name of ['Oil','Copper']) {
      await picker.getByLabel('Search comparisons').fill(name);
      await picker.getByRole('button',{name:new RegExp(`\\+ ${name}`)}).click();
      await expect(picker.getByRole('button',{name:new RegExp(`✓ ${name}`)})).toHaveAttribute('aria-pressed','true');
    }
    await picker.getByRole('button',{name:'Done',exact:true}).click(); await expect(button).toBeFocused();
    const chart = page.locator('#priceChart svg');
    await expect(chart.locator('.bw-d3-line')).toHaveCount(3);
    await expect(page.locator('.commodity-compare-key')).toHaveCount(3);
    await expect(page.locator('#comparison-line-keys>span')).toHaveCount(3);
    await expect(page.locator('#compare-tags')).toContainText('Gold');
    await expect(page.locator('#compare-tags')).toContainText('Baseline');
    await expect(page.getByRole('radio',{name:'% change',exact:true})).toBeChecked();
    await chart.press('End'); await expect(chart.locator('[role="tooltip"]')).toHaveAttribute('visibility','visible');
    await chart.press('ArrowDown'); await expect(page.locator('#crosshair-date')).toContainText('Oil');
    await expect(chart.locator('[role="tooltip"]')).toHaveAttribute('aria-label',/Oil: .*%/);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
    await page.locator('.chart-panel').screenshot({path:testInfo.outputPath(`commodity-comparison-${width}.png`)});
    await page.getByRole('button',{name:'Remove Oil from comparison',exact:true}).click();
    await expect(chart.locator('.bw-d3-line')).toHaveCount(2);
    await button.click(); await picker.getByLabel('Search comparisons').press('Escape'); await expect(button).toBeFocused();
    await expect(picker).toBeHidden();
  });
}
