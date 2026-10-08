import {test,expect,type Page,type Locator} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

test.beforeEach(async({context,baseURL})=>{
  await context.route('**/*',route=>new URL(route.request().url()).origin===baseURL ? route.continue() : route.abort());
});

const quickDialog=(page:Page)=>page.getByRole('dialog',{name:'Quick visual',exact:true});
const editorDialog=(page:Page)=>page.getByRole('dialog',{name:'Graphic builder',exact:true});

async function readyTable(page:Page) {
  await expect(page.locator('#table-workspace')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>Boolean((window as any).BW?.TableWorkspace?.ready))).toBe(true);
  await expect.poll(()=>page.evaluate(()=>(window as any).BW?.CompactTable?.sparklineData?.length || 0)).toBeGreaterThan(0);
}

async function showTableControls(page:Page) {
  if(!await page.locator('#tw-controls').isVisible()) await page.locator('#tw-controls-toggle').click();
}

async function customize(page:Page) {
  const quick=quickDialog(page);
  await expect(quick.locator('svg')).toBeVisible();
  await quick.getByRole('button',{name:'Customize graphic',exact:true}).click();
  const editor=editorDialog(page);
  await expect(editor).toBeVisible();
  return editor;
}

async function sourceRows(dialog:Locator) {
  await dialog.getByText('Source details',{exact:true}).click();
  return dialog.locator('tbody tr');
}

test('320px shared header and on-demand visual controls remain reachable',async({page})=>{
  await page.setViewportSize({width:320,height:800});
  for(const path of ['/', '/?view=compact', '/data', '/help']) {
    await page.goto(path);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),path).toBeLessThanOrEqual(1);
    const controls=await page.locator('.bw-header a,.bw-header button').evaluateAll(elements=>elements.map(element=>{
      const rect=element.getBoundingClientRect();
      return {name:element.getAttribute('aria-label'),left:rect.left,right:rect.right};
    }));
    for(const control of controls) {
      expect(control.left,`${path}: ${control.name}`).toBeGreaterThanOrEqual(0);
      expect(control.right,`${path}: ${control.name}`).toBeLessThanOrEqual(320);
    }
    await expect(page.locator('.bw-header [data-open-visual-builder]')).toHaveCount(0);
    await expect(quickDialog(page)).toHaveCount(0);
  }
  await page.goto('/?category=energy&view=compact');
  await readyTable(page);
  const rowTrigger=page.getByRole('button',{name:'Quick visual for Oil',exact:true});
  await rowTrigger.click();
  const quick=quickDialog(page);
  await expect(quick.locator('svg')).toBeVisible();
  expect(await quick.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);
  const bounds=await quick.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(320);
  await page.keyboard.press('Escape');
  await expect(quick).toHaveCount(0);
  await expect(rowTrigger).toBeFocused();
  await page.goto('/data');
  await page.getByRole('button',{name:'Toggle light and dark mode',exact:true}).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  const catalogTrigger=page.getByRole('button',{name:'Visualize this page',exact:true});
  await catalogTrigger.click();
  await expect(quick.locator('svg')).toBeVisible();
  expect(await quick.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);
  const axe=await new AxeBuilder({page}).include('.bw-quick-visual').withTags(['wcag2a','wcag2aa']).analyze();
  expect(axe.violations).toEqual([]);
  await quick.getByRole('button',{name:'Close quick visual',exact:true}).click();
  await expect(quick).toHaveCount(0);
  await expect(catalogTrigger).toBeFocused();
});

test('Energy stays table-first and a row opens a compact D3 visual on demand',async({page},info)=>{
  const requests:string[]=[];
  page.on('request',request=>requests.push(new URL(request.url()).pathname));
  await page.goto('/?category=energy&view=compact');
  await readyTable(page);
  await expect(page.locator('#bw-category-graphic,[data-category-preview]')).toHaveCount(0);
  await expect(quickDialog(page)).toHaveCount(0);
  await expect(editorDialog(page)).toHaveCount(0);
  const oil=page.locator('#table-body tr[data-id="oil"]:visible,#tw-mobile-list [data-mobile-id="oil"]:visible');
  await expect(oil).toContainText('Oil');
  await expect(oil).toContainText('USD');
  const trigger=page.getByRole('button',{name:'Quick visual for Oil',exact:true});
  await trigger.click();
  const quick=quickDialog(page);
  await expect(quick.locator('svg')).toBeVisible();
  await expect(quick.locator('svg path,svg circle')).not.toHaveCount(0);
  await expect(quick).toContainText('Oil');
  await expect(quick).toContainText('Synthetic test data');
  await expect(quick.getByLabel('Headline',{exact:true})).toHaveCount(0);
  await expect(editorDialog(page)).toHaveCount(0);
  expect(await quick.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:info.outputPath('quick-visual-energy.png')});
  await quick.getByRole('button',{name:'Close quick visual',exact:true}).click();
  await expect(quick).toHaveCount(0);
  await expect(oil).toBeVisible();
  await expect(trigger).toBeFocused();
  expect(requests).not.toContain('/api/commodity/oil');
});

test('optional customization saves an attributed export on desktop and mobile',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?category=energy&view=compact');
  await readyTable(page);
  const trigger=page.getByRole('button',{name:'Quick visual for Oil',exact:true});
  await trigger.click();
  const dialog=await customize(page);
  await dialog.getByLabel('Headline',{exact:true}).fill('Energy reference history');
  await dialog.getByLabel('Subtitle',{exact:true}).fill('Saved observations · synthetic test fixture');
  await dialog.getByLabel('Graphic',{exact:true}).selectOption('line');
  await expect(dialog.locator('svg')).toContainText('Energy reference history');
  if(info.project.name === 'mobile') {
    await dialog.getByRole('button',{name:'Preview',exact:true}).click();
    await expect(dialog.locator('.bw-vb-preview')).toBeInViewport();
    await dialog.getByRole('button',{name:'Edit',exact:true}).click();
    await expect(dialog.getByLabel('Graphic',{exact:true})).toBeFocused();
    await dialog.getByRole('button',{name:'Preview',exact:true}).click();
  }
  await dialog.getByRole('button',{name:'Save draft',exact:true}).click();
  await expect(dialog.getByRole('status')).toContainText(/saved/i);
  const svgDownload=page.waitForEvent('download');
  await dialog.getByRole('button',{name:'Export SVG',exact:true}).click();
  const xml=await readFile((await (await svgDownload).path())!,'utf8');
  expect(xml).toContain('Energy reference history');
  expect(xml).toContain('Synthetic test data');
  expect(xml).toContain('USD / test unit');
  expect(xml).not.toMatch(/NaN|Infinity/);
  const pngDownload=page.waitForEvent('download');
  await dialog.getByRole('button',{name:'Export PNG',exact:true}).click();
  const png=await readFile((await (await pngDownload).path())!);
  expect(png.subarray(1,4).toString()).toBe('PNG');
  const axe=await new AxeBuilder({page}).include('.bw-visual-builder').withTags(['wcag2a','wcag2aa']).analyze();
  expect(axe.violations).toEqual([]);
  expect(await dialog.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:info.outputPath('visual-builder-energy.png')});
  await dialog.getByRole('button',{name:'Close graphic builder'}).click();
  await trigger.click();
  await customize(page);
  await dialog.getByRole('button',{name:'Restore saved draft'}).click();
  await expect(dialog.getByLabel('Headline',{exact:true})).toHaveValue('Energy reference history');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});

test('row, selection and filtered visuals use the current table observations',async({page})=>{
  await page.goto('/?view=compact&range=ALL');
  await readyTable(page);
  await showTableControls(page);
  if(await page.locator('#tw-range-select').isVisible()) await page.locator('#tw-range-select').selectOption('1M');
  else await page.locator('#range-1M').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).BW?.CompactTable?.loadedRange)).toBe('1M');
  const histories=await page.evaluate(()=>(window as any).BW.CompactTable.sparklineData
    .filter((record:any)=>['oil','gold'].includes(record.id))
    .map((record:any)=>({name:record.name,points:record.history.map((point:any)=>({date:point.date,value:point.price}))})));
  expect(histories).toHaveLength(2);
  for(const history of histories) expect(history.points).toHaveLength(31);
  const oil=histories.find((history:any)=>history.name==='Oil')!;
  const requests:string[]=[];
  page.on('request',request=>requests.push(new URL(request.url()).pathname));
  const rowTrigger=page.getByRole('button',{name:'Quick visual for Oil',exact:true});
  await rowTrigger.click();
  const quick=quickDialog(page);
  await expect(quick.locator('svg')).toBeVisible();
  const rowData=await sourceRows(quick);
  await expect(rowData).toHaveCount(31);
  const shownRow=await rowData.evaluateAll(rows=>rows.map(row=>{
    const cells=row.querySelectorAll('td');
    return {date:cells[1].textContent,value:Number(cells[2].textContent)};
  }));
  expect(shownRow).toEqual(oil.points);
  await expect(quick.locator('tbody')).toContainText('USD / test unit');
  await expect(quick.locator('tbody')).toContainText('Synthetic test data');
  await page.keyboard.press('Escape');
  await expect(rowTrigger).toBeFocused();
  for(const name of ['Gold','Oil']) {
    await page.locator(`#table-body input[aria-label="Select ${name}"]:visible,#tw-mobile-list input[aria-label="Select ${name}"]:visible`).check();
  }
  const selectionTrigger=page.locator('#tw-selection').getByRole('button',{name:'Quick visual',exact:true});
  await selectionTrigger.click();
  await expect(quick.locator('svg')).toBeVisible();
  const selectedData=await sourceRows(quick);
  await expect(selectedData).toHaveCount(62);
  const selected=await selectedData.evaluateAll(rows=>rows.map(row=>{
    const cells=row.querySelectorAll('td');
    return `${cells[0].textContent}|${cells[1].textContent}|${Number(cells[2].textContent)}`;
  }));
  const expected=histories.flatMap((history:any)=>history.points.map((point:any)=>`${history.name}|${point.date}|${point.value}`));
  expect(selected.sort()).toEqual(expected.sort());
  await page.keyboard.press('Escape');
  await expect(selectionTrigger).toBeFocused();
  await showTableControls(page);
  await page.locator('#tw-query').fill('Oil');
  await expect(page.locator('#tw-result-count')).toHaveText('1 of 3 benchmarks');
  // The filtered action follows the visible rows even while Gold is selected outside the filter.
  const filteredTrigger=page.getByRole('button',{name:'Visualize filtered',exact:true});
  await filteredTrigger.click();
  await expect(quick.locator('svg')).toBeVisible();
  const filteredData=await sourceRows(quick);
  await expect(filteredData).toHaveCount(1);
  await expect(quick.locator('tbody')).toContainText('Oil');
  await expect(quick.locator('tbody')).not.toContainText('Gold');
  await expect(quick.locator('tbody')).toContainText(oil.points.at(-1).date);
  await expect(quick.locator('tbody')).toContainText(String(oil.points.at(-1).value));
  await quick.getByRole('button',{name:'Close quick visual',exact:true}).click();
  await expect(filteredTrigger).toBeFocused();
  expect(requests).not.toContain('/api/commodity/oil');
  expect(requests).not.toContain('/api/commodity/gold');
});

test('country ranking and history preserve source flags and the selected period',async({page},info)=>{
  await page.goto('/data');
  await page.getByRole('button',{name:'Visualize this page',exact:true}).click();
  const quick=quickDialog(page);
  await expect(quick.locator('svg')).toBeVisible();
  await expect(quick).toContainText('Synthetic wind capacity');
  await expect(quick).toContainText('2025');
  const rankingRows=await sourceRows(quick);
  await expect(rankingRows).toHaveCount(2);
  await expect(quick.locator('tbody')).toContainText('Sample North');
  await expect(quick.locator('tbody')).toContainText('Sample South');
  await expect(quick.locator('tbody')).toContainText('E');
  const dialog=await customize(page);
  await expect(dialog.locator('.bw-vb-preview svg')).toContainText('Synthetic wind capacity');
  await expect(dialog.locator('.bw-vb-preview svg')).toContainText('Sample North');
  await expect(dialog.locator('.bw-vb-preview svg')).toContainText('Sample South');
  await expect(dialog.locator('.bw-vb-preview svg')).toContainText('2025');
  await dialog.locator('.bw-vb-data>summary').click();
  await expect(dialog.locator('tbody')).toContainText('E');
  await page.screenshot({path:info.outputPath('visual-builder-ranking.png')});
  await dialog.getByRole('button',{name:'Close graphic builder'}).click();
  await page.getByRole('button',{name:'Quick visual for Sample North Synthetic wind capacity',exact:true}).click();
  await expect(quick).toContainText('Sample North');
  await expect(quick).not.toContainText('Sample South');
  await customize(page);
  await expect(dialog.getByLabel('Headline',{exact:true})).toHaveValue('Sample North · Synthetic wind capacity');
  await expect(dialog.locator('.bw-vb-preview svg')).toContainText('Original reporting periods');
  await dialog.getByRole('button',{name:'Close graphic builder'}).click();
  await page.locator('.gr-reference-name a').first().click();
  await page.locator('#gr-range').selectOption('1');
  await page.locator('.gr-chart-controls').getByRole('button',{name:'Quick visual',exact:true}).click();
  await expect(await sourceRows(quick)).toHaveCount(2);
  await expect(quick.locator('tbody')).toContainText('2024');
  await expect(quick.locator('tbody')).toContainText('2025');
  await expect(quick.locator('tbody')).not.toContainText('2023');
  await customize(page);
  await dialog.locator('.bw-vb-data>summary').click();
  await expect(dialog.locator('tbody tr')).toHaveCount(2);
});

test('paste validation keeps the last valid graphic and GeoJSON produces a real map',async({page})=>{
  await page.goto('/data');
  await page.getByRole('button',{name:'Visualize this page',exact:true}).click();
  const dialog=await customize(page);
  await dialog.locator('.bw-vb-paste>summary').click();
  await dialog.getByLabel('Source data',{exact:true}).fill('label,value,unit,period,status,source\nNorth,24,GW,2025,Estimated,Synthetic source\nSouth,12,GW,2025,Observed,Synthetic source');
  await dialog.getByRole('button',{name:'Validate and apply data'}).click();
  await dialog.getByLabel('Graphic',{exact:true}).selectOption('horizontal');
  await expect(dialog.locator('.bw-vb-preview svg')).toContainText('North');
  await dialog.getByLabel('Source data',{exact:true}).fill('label,value\nNorth,not-a-number');
  await dialog.getByRole('button',{name:'Validate and apply data'}).click();
  await expect(dialog.getByRole('status')).toContainText('Data was not applied');
  await expect(dialog.locator('.bw-vb-preview svg')).toContainText('North');
  await dialog.getByLabel('Graphic',{exact:true}).selectOption('map');
  await expect(dialog.locator('.bw-vb-preview svg')).toContainText(/GeoJSON/);
  const geo={type:'FeatureCollection',features:[
    {type:'Feature',properties:{name:'North'},geometry:{type:'Polygon',coordinates:[[[0,0],[0,5],[5,5],[5,0],[0,0]]]}},
    {type:'Feature',properties:{name:'South'},geometry:{type:'Polygon',coordinates:[[[0,-5],[0,0],[5,0],[5,-5],[0,-5]]]}}
  ]};
  await dialog.getByLabel('GeoJSON geography',{exact:true}).setInputFiles({name:'synthetic.geojson',mimeType:'application/geo+json',buffer:Buffer.from(JSON.stringify(geo))});
  await expect(dialog.locator('.bw-vb-preview svg path')).toHaveCount(2);
  expect(await dialog.locator('svg').innerHTML()).not.toMatch(/NaN|Infinity/);
});

test('benchmark pane and Research open quick visuals without losing modal keyboard focus',async({page})=>{
  await page.goto('/?view=compact');
  await page.locator('#table-body a[data-benchmark-id="gold"]:visible, #tw-mobile-list a[data-benchmark-id="gold"]:visible').click();
  const pane=page.locator('#benchmark-detail');
  const trigger=pane.getByRole('button',{name:'Quick visual',exact:true});
  await trigger.click();
  const dialog=quickDialog(page);
  await expect(dialog).toContainText('Gold over time');
  await expect(dialog.locator('svg')).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate(element=>element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(pane).toBeVisible();
  await expect(trigger).toBeFocused();
  await pane.getByRole('button',{name:'Close benchmark details'}).click();
  await page.locator('#table-body input[type=checkbox][aria-label="Select Gold"]:visible, #tw-mobile-list input[aria-label="Select Gold"]:visible').check();
  await page.getByRole('button',{name:'Add to research',exact:true}).click();
  await page.locator('#rw-editor').getByRole('button',{name:'Close entry',exact:true}).click();
  await page.locator('#research-workspace').getByRole('button',{name:'Quick visual',exact:true}).click();
  await expect(dialog.locator('svg')).toBeVisible();
  await expect(dialog).toContainText('Gold');
});

test('failed or empty filtered results cannot reopen a stale graphic',async({page})=>{
  await page.goto('/?category=energy&view=compact');
  await readyTable(page);
  await page.getByRole('button',{name:'Quick visual for Oil',exact:true}).click();
  await expect(quickDialog(page).locator('svg')).toBeVisible();
  await page.keyboard.press('Escape');
  await showTableControls(page);
  await page.locator('#tw-query').fill('No matching benchmark 987654');
  await expect(page.locator('#tw-empty')).toBeVisible();
  await page.getByRole('button',{name:'Visualize filtered',exact:true}).click();
  await expect(page.locator('#table-workspace [role=status]').filter({hasText:'No matching observations to visualize'})).toBeVisible();
  await expect(quickDialog(page)).toHaveCount(0);
  await expect(editorDialog(page)).toHaveCount(0);
  await page.locator('#bw-visual-explorer>summary').click();
  const lab=page.getByRole('region',{name:'Visual explorer'});
  await expect(lab.getByRole('button',{name:'Quick visual',exact:true})).toBeEnabled();
  await page.route('**/api/commodity/oil',route=>route.fulfill({status:503,json:{error:'Synthetic outage'}}));
  await lab.getByLabel('Benchmark',{exact:true}).selectOption('oil');
  await expect(lab.locator('.bw-visual-note')).toContainText('Could not load');
  await expect(lab.getByRole('button',{name:'Quick visual',exact:true})).toBeDisabled();
});

test('workbook periods and company fiscal selections open with their own evidence',async({page})=>{
  await page.goto('/workspace/register');
  await page.getByLabel('Username',{exact:true}).fill('graphic-'+randomUUID().slice(0,8));
  await page.locator('#password').fill('synthetic graphics test password');
  await page.getByRole('button',{name:'Create private workspace'}).click();
  await page.getByRole('link',{name:'Continue to workspace'}).click();
  await page.getByRole('button',{name:'Minimize AI chat'}).click();
  await page.locator('.workspace-nav').getByRole('link',{name:'AI settings'}).click();
  const connection=page.locator('form:has(#key-typesafe)');
  await connection.locator('input[type=password]').fill('fixture-typesafe-key');
  await connection.locator('input[type=checkbox]').check();
  await connection.getByRole('button',{name:'Test and save key'}).click();
  await page.locator('.workspace-nav').getByRole('link',{name:'Workbook studio'}).click();
  await page.locator('.workbook-list').getByRole('link',{name:/Sample Company/}).click();
  await page.getByRole('button',{name:'Open AI chat'}).click();
  const chat=page.getByRole('complementary',{name:'Workbook AI chat'});
  await chat.getByRole('button',{name:'Show Operating Income across the available periods.',exact:true}).click();
  await chat.locator('.studio-chat-options>summary').click();
  await chat.locator('#provider-model').selectOption('typesafe:jev-latest');
  await chat.getByRole('button',{name:'Send message'}).click();
  await page.getByRole('button',{name:'Agree and send'}).click();
  await expect(chat.getByLabel('AI response',{exact:true})).toBeVisible();
  await chat.getByRole('link',{name:'View analysis'}).click();
  if(await page.getByRole('button',{name:'Minimize AI chat'}).isVisible()) await page.getByRole('button',{name:'Minimize AI chat'}).click();
  await page.locator('.studio-analysis-step[open]').getByRole('button',{name:'Quick visual',exact:true}).first().click();
  await expect(quickDialog(page).locator('svg')).toBeVisible();
  await expect(quickDialog(page)).toContainText('Sample Company.xlsx');
  const dialog=await customize(page);
  await expect(dialog.locator('.bw-vb-preview svg')).toContainText('Q124');
  await expect(dialog.locator('.bw-vb-preview svg')).toContainText('Sample Company.xlsx');
  await expect(dialog.locator('.bw-vb-preview svg')).toContainText(/source order|elapsed time/i);
  await dialog.getByRole('button',{name:'Close graphic builder'}).click();
  // Open a synthetic SEC report through the existing authenticated route.
  const csrf=await page.locator('input[name=csrf]').first().inputValue();
  const response=await page.request.post('/workspace/companies/open',{form:{csrf,cik:'0000000001'},headers:{Accept:'application/json'}});
  expect(response.ok()).toBe(true);
  await page.goto((await response.json()).url);
  await page.getByRole('button',{name:'Quarterly',exact:true}).click();
  await page.locator('.company-chart-toolbar').getByRole('button',{name:'Quick visual',exact:true}).click();
  const quick=quickDialog(page);
  await expect(quick.locator('svg')).toBeVisible();
  await expect(await sourceRows(quick)).toHaveCount(12);
  await expect(quick.locator('tbody')).toContainText('Q4 2025');
  await expect(quick.locator('tbody')).toContainText('sec.gov');
  await customize(page);
  await dialog.locator('.bw-vb-data>summary').click();
  await expect(dialog.locator('tbody tr')).toHaveCount(12);
  await expect(dialog.locator('tbody')).toContainText('Q4 2025');
  await expect(dialog.locator('tbody')).toContainText('sec.gov');
});
