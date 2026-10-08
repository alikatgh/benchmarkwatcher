/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const load = file => window.eval(fs.readFileSync(path.join(__dirname, '../app/static/js', file), 'utf8'));
const input = overrides => ({ id: 'oil', title: 'Energy reference prices', subtitle: 'Annual source observations', unit: 'USD / barrel', source: 'Public reference', notes: 'Historical benchmark data.', frequency: 'annual',
  series: [{id:'oil',name:'Crude oil',unit:'USD / barrel',source:'Source series',sourceUrl:'https://example.org/oil',points:[
    {date:'2022-01-01',period:'2022',value:0}, {date:'2023-01-01',period:'2023',value:5,status:'estimated',footnote:'Source estimate.'},
    {date:'2024-01-01',period:'2024',value:null,status:'unavailable'}, {date:'2025-01-01',period:'2025',value:8,planned:true}
  ]}], ...overrides });
beforeEach(() => {
  window.BW = {}; localStorage.clear(); document.body.innerHTML = '<button id="opener">Build graphic</button><div id="chart"></div>';
  load('vendor/d3.v7.9.0.min.js'); load('core/visuals.js'); load('components/visual_builder.js');
});
afterEach(() => BW.VisualBuilder.close());
const host = () => document.getElementById('chart');
const field = key => document.querySelector(`[data-vb-field="${key}"]`);
const action = key => document.querySelector(`[data-vb-action="${key}"]`);
function change(key, value, event = 'input') { field(key).value = value; field(key).dispatchEvent(new Event(event, { bubbles: true })); }

test('CSV and TSV parse real zeros, unavailable values, quoted labels and original periods', () => {
  const result = BW.VisualBuilder.parseData('date,value,unit,source,source_url,status,footnote\n2023,0,USD,Reference,https://example.org,observed,"Zero is real, not missing"\n2024,,USD,Reference,https://example.org,unavailable,');
  expect(result.ok).toBe(true); expect(result.count).toBe(2);
  expect(result.spec.series[0].points[0]).toMatchObject({date:'2023-01-01',period:'2023',value:0,footnote:'Zero is real, not missing',sourceUrl:'https://example.org'});
  expect(result.spec.series[0].points[1].value).toBeNull();
  const ranked = BW.VisualBuilder.parseData('label\tvalue\tunit\tperiod\n"North, region"\t-2.25\ttonnes\t2025\nSouth\t0\ttonnes\t2025');
  expect(ranked.ok).toBe(true); expect(ranked.spec.type).toBe('horizontal');
  expect(ranked.spec.rows.map(row => [row.label,row.value,row.period])).toEqual([['North, region',-2.25,'2025'],['South',0,'2025']]);
});

test.each([
  ['date,value\n2025-02-30,4', 'date'], ['date,value\n2025-01-01,Infinity', 'finite'],
  ['date,value\n2025-01-01,NaN', 'finite'], ['date,value\n2025-01-01,true', 'finite'],
  ['label,value\n"North,3', 'quotation'], ['label,value\nNorth,3,4', 'fields'],
  ['label,value,value\nNorth,3,4','unique'], ['date,value\n2025-13,3','date'], ['label,value\n,2','label']
])('invalid pasted data is rejected: %s', (data, message) => {
  const result = BW.VisualBuilder.parseData(data);
  expect(result.ok).toBe(false); expect(result.errors.join(' ')).toContain(message); expect(result.spec).toBeUndefined();
});

test('parsing preserves duplicate observations without averaging and rejects malformed quotes', () => {
  const result = BW.VisualBuilder.parseData('date,value,series\n2025,1,Oil\n2025,9,Oil');
  expect(result.ok).toBe(true); expect(result.spec.series[0].points.map(point => point.value)).toEqual([1,9]); expect(result.warnings[0]).toContain('retained');
  expect(BW.VisualBuilder.parseData('label,value\n"North"extra,3').ok).toBe(false);
  expect(BW.VisualBuilder.parseData('label,value\nN"orth,3').ok).toBe(false);
});

test('normalization retains invalid observations and metadata across repeated render normalization', () => {
  const spec = input({series:[{name:'Source',unit:'USD',points:[{date:'2025-02-30',value:4,status:'revised',footnote:'Retained date'},{date:'2025-03-01',value:'bad'}, {date:'2025-03-02',value:0}]}],unit:'USD'});
  const normalized = BW.VisualBuilder.normalize(BW.VisualBuilder.normalize(spec));
  expect(normalized.series[0].points).toHaveLength(3); expect(normalized.series[0].points[0].invalidDate).toBe(true);
  expect(normalized.series[0].points[1]).toMatchObject({value:null,rawValue:'bad',invalidValue:true});
  const chart = BW.VisualBuilder.render(host(),normalized);
  expect(chart.svg.querySelectorAll('.bw-vb-mark')).toHaveLength(1);
  expect(chart.svg.textContent).toContain('without a valid date'); expect(chart.svg.outerHTML).not.toMatch(/NaN|Infinity/);
});

test.each(['line','area','bar','scatter'])('%s keeps real zeros, annual gaps and finite geometry', type => {
  const chart = BW.VisualBuilder.render(host(),input({type}));
  expect(chart.svg.querySelectorAll('.bw-vb-mark')).toHaveLength(3);
  expect([...chart.svg.querySelectorAll('.bw-vb-mark')].map(mark => mark.dataset.period)).toEqual(['2022','2023','2025']);
  expect(chart.svg.outerHTML).not.toMatch(/NaN|Infinity/);
  if (['line','area'].includes(type)) expect(chart.svg.querySelectorAll('.bw-vb-line')).toHaveLength(2);
  if (['area','bar'].includes(type)) expect(chart.svg.querySelector('.bw-vb-zero')).toBeTruthy();
  if (type === 'area') {
    const baseline = Number(chart.svg.querySelector('.bw-vb-zero').getAttribute('y1'));
    expect(chart.svg.querySelector('.bw-vb-area').getAttribute('d')).toContain(String(baseline));
  }
});

test('different units are isolated, omitted observations declared, all metadata preserved', () => {
  const chart = BW.VisualBuilder.render(host(),input({series:[
    {id:'oil',name:'Oil',unit:'USD / barrel',points:[{date:'2025-01-01',value:5}]},
    {id:'gas',name:'Gas',unit:'USD / MMBtu',points:[{date:'2025-01-01',value:3}]} ]}));
  expect(chart.svg.querySelectorAll('.bw-vb-mark')).toHaveLength(1);
  expect(chart.svg.textContent).toContain('other units excluded');
  expect(JSON.parse(chart.svg.querySelector('metadata').textContent).series).toHaveLength(2);
  const other = BW.VisualBuilder.render(host(),{...chart.spec,unit:'USD / MMBtu'});
  expect(other.svg.querySelector('.bw-vb-mark title').textContent).toContain('Gas');
});

test('explicit blank units remain unknown rather than inheriting a known CSV unit', () => {
  const parsed = BW.VisualBuilder.parseData('date,value,series,unit,source\n2025,4,Known,GW,Agency\n2025,999,Unknown,,Unknown source');
  expect(parsed.ok).toBe(true);
  const spec = BW.VisualBuilder.normalize(parsed.spec);
  expect(spec.series.map(series => series.unit)).toEqual(['GW','']);
  expect(spec.series[1].points[0].unit).toBe(''); expect(spec.units).toContain('');
  const chart = BW.VisualBuilder.render(host(),parsed.spec);
  expect(chart.svg.querySelectorAll('.bw-vb-mark')).toHaveLength(1); expect(chart.svg.querySelector('.bw-vb-mark title').textContent).toContain('Known');
  expect(chart.svg.textContent).toContain('other units excluded');
  const inherited = BW.VisualBuilder.normalize({unit:'GW',series:[{points:[{date:'2025',value:1},{date:'2025',value:2,unit:''}]}],rows:[{label:'Inherited',value:3},{label:'Unknown',value:4,unit:''}]});
  expect(inherited.series[0].points.map(point => point.unit)).toEqual(['GW','']); expect(inherited.rows.map(row => row.unit)).toEqual(['GW','']);
});

test.each(['line','area','bar','scatter'])('ordinal %s uses source periods and null gaps without inventing dates', type => {
  const spec = {ordinal:true,type,title:'Workbook values',unit:'USD',source:'Workbook source',series:[{name:'Revenue',points:[
    {period:'Q124',value:0},{period:'Q1 2024',value:2,status:'estimated'},{period:'Q2 2024',value:null},{period:'FY25',value:5}]}]};
  const chart = BW.VisualBuilder.render(host(),spec);
  expect(chart.svg.querySelectorAll('.bw-vb-mark')).toHaveLength(3);
  expect(chart.svg.textContent).toContain('Q124'); expect(chart.svg.textContent).toContain('Q1 2024'); expect(chart.svg.textContent).toContain('FY25');
  expect(chart.svg.textContent).toContain('do not represent elapsed time');
  expect(chart.svg.outerHTML).not.toMatch(/NaN|Infinity/); expect(chart.svg.textContent).not.toContain('without a valid date');
  const metadata = JSON.parse(chart.svg.querySelector('metadata').textContent);
  expect(metadata.series[0].points.map(point => point.date)).toEqual(['','','','']);
  expect(metadata.series[0].points.map(point => point.period)).toEqual(['Q124','Q1 2024','Q2 2024','FY25']);
  if (['line','area'].includes(type)) expect(chart.svg.querySelectorAll('.bw-vb-line')).toHaveLength(2);
  const marks = [...chart.svg.querySelectorAll('.bw-vb-mark')];
  const x = marks.map(mark => Number(mark.getAttribute(type === 'bar' ? 'x' : 'cx')));
  expect(x[1] - x[0]).toBeCloseTo((x[2] - x[1]) / 2, 1);
});

test('ordinal year and month source labels are not converted into invented calendar dates', () => {
  const spec = BW.VisualBuilder.normalize({ordinal:true,series:[{points:[{period:'2024',value:1},{period:'2025-03',value:2},{date:'2025-04-15',period:'April observation',value:3}]}]});
  expect(spec.series[0].points.map(point => point.date)).toEqual(['','','2025-04-15']);
  expect(spec.series[0].points.map(point => point.time)).toEqual([null,null,Date.parse('2025-04-15T00:00:00Z')]);
});

test('switching unit clears a highlight that is not present in the selected compatible group', () => {
  const controller = BW.VisualBuilder.open(input({highlight:'oil',series:[
    {id:'oil',name:'Oil',unit:'USD / barrel',points:[{date:'2025-01-01',value:5}]},
    {id:'gas',name:'Gas',unit:'USD / MMBtu',points:[{date:'2025-01-01',value:3}]} ]}));
  change('unit','USD / MMBtu','change');
  expect(controller.getSpec().highlight).toBe(''); expect(field('highlight').value).toBe('');
  expect(document.querySelector('.bw-vb-mark').getAttribute('fill')).not.toBe('#adb7b9');
});

test('horizontal rankings only use compatible values and retain negative, zero and missing rows', () => {
  const chart = BW.VisualBuilder.render(host(),{type:'horizontal',unit:'tonnes',rows:[
    {label:'Negative',value:-3,unit:'tonnes',period:'2024',source:'Reported'}, {label:'Zero',value:0,unit:'tonnes',period:'2025'},
    {label:'Unavailable',value:null,unit:'tonnes'}, {label:'Other unit',value:999,unit:'USD'}]});
  expect(chart.svg.querySelectorAll('.bw-vb-mark')).toHaveLength(2);
  expect(chart.svg.querySelectorAll('.bw-vb-mark')[0].querySelector('title').textContent).toContain('Zero');
  expect(chart.svg.outerHTML).not.toMatch(/NaN|Infinity/);
  expect(chart.svg.textContent).toContain('other units excluded');
  expect(JSON.parse(chart.svg.querySelector('metadata').textContent).rows).toHaveLength(4);
});

test('categorical bars and dots do not invent dates or interpolate between entries', () => {
  for (const type of ['bar','scatter']) {
    const chart = BW.VisualBuilder.render(host(),{type,unit:'units',rows:[{label:'First',value:2,period:'2023',unit:'units'},{label:'Second',value:0,period:'2025',unit:'units'},{label:'Missing',value:null,unit:'units'}]});
    expect(chart.svg.querySelectorAll('.bw-vb-mark')).toHaveLength(2); expect(chart.svg.querySelectorAll('.bw-vb-line')).toHaveLength(0);
    expect(chart.svg.querySelector('.bw-vb-mark title').textContent).toContain('2023');
  }
});

test('SVG export has independent paper styles, headline, unit, source URL, flags and footnotes', () => {
  const chart = BW.VisualBuilder.render(host(),input({type:'area'}));
  const exported = BW.VisualBuilder.serializeSVG(chart.svg);
  expect(exported).toContain('Energy reference prices'); expect(exported).toContain('USD / barrel');
  expect(exported).toContain('https://example.org/oil'); expect(exported).toContain('Source estimate.');
  expect(exported).toContain('estimated (1)'); expect(exported).toContain('planned (1)');
  expect(exported).toContain('font-family="Georgia, Times New Roman, serif"'); expect(exported).toContain('fill="#fff1e5"');
  expect(exported).not.toMatch(/var\(--|currentColor/); expect(exported).toContain('width="960"');
  const metadata = JSON.parse(chart.svg.querySelector('metadata').textContent);
  expect(metadata.series[0].points[2]).toMatchObject({period:'2024',value:null,status:'unavailable'});
});

test('dense area histories suppress ordinary dots while isolated observations and exact keyboard inspection remain available', () => {
  const points = Array.from({length:30},(_,index) => ({date:new Date(Date.UTC(2024,0,index+1)).toISOString().slice(0,10),value:index === 0 ? 0 : index / 7}));
  points.push({date:'2025-01-01',value:123.1234567890123,period:'2025',footnote:'Exact source precision'});
  const chart = BW.VisualBuilder.render(host(),{type:'area',title:'Dense history',unit:'USD',series:[{name:'Reference',unit:'USD',points}]});
  const marks = [...chart.svg.querySelectorAll('.bw-vb-mark')];
  expect(marks.slice(0,30).every(mark => mark.getAttribute('fill') === 'transparent')).toBe(true);
  expect(marks[30].getAttribute('fill')).not.toBe('transparent');
  chart.svg.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));
  expect(chart.svg.querySelector('.bw-vb-inspection').getAttribute('visibility')).toBe('visible');
  expect(chart.svg.querySelector('.bw-vb-inspection').textContent).toContain('123.1234567890123');
  const exportSVG = BW.VisualBuilder.serializeSVG(chart.svg);
  expect(exportSVG).not.toContain('class="bw-vb-inspection"'); expect(exportSVG).not.toContain('arrow keys');
  chart.svg.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));
  expect(chart.svg.querySelector('.bw-vb-inspection').textContent).toContain('0 USD');
});

test('attribution does not repeat a source URL already included in the supplied credit', () => {
  const credit = 'Source series · https://example.org/oil';
  const chart = BW.VisualBuilder.render(host(),input({source:credit,series:[{name:'Oil',unit:'USD / barrel',source:credit,sourceUrl:'https://example.org/oil',points:[{date:'2025-01-01',value:2}]}]}));
  const footerSources = [...chart.svg.querySelectorAll('text')].filter(node => node.textContent.includes('https://example.org/oil'));
  expect(footerSources).toHaveLength(1); expect(footerSources[0].textContent.split('https://example.org/oil')).toHaveLength(2);
});

test('saved drafts are explicit and opening fresh data neither applies nor overwrites a saved draft', () => {
  const controller = BW.VisualBuilder.open(input()); change('title','Saved headline'); action('save').click();
  expect(BW.VisualBuilder.readDraft({id:'oil'}).spec.title).toBe('Saved headline'); controller.close();
  const reopened = BW.VisualBuilder.open(input({title:'Fresh source headline'}));
  expect(reopened.getSpec().title).toBe('Fresh source headline'); expect(field('title').value).toBe('Fresh source headline');
  expect(BW.VisualBuilder.readDraft({id:'oil'}).spec.title).toBe('Saved headline'); action('restore').click();
  expect(reopened.getSpec().title).toBe('Saved headline'); expect(field('title').value).toBe('Saved headline');
});

test('nonfinite source values stay invalid after draft serialization rather than becoming valid or missing', () => {
  const spec = BW.VisualBuilder.normalize({id:'invalid',unit:'USD',series:[{points:[{date:'2025-01-01',value:Infinity}]}]});
  BW.VisualBuilder.saveDraft(spec);
  const restored = BW.VisualBuilder.normalize(BW.VisualBuilder.readDraft(spec).spec);
  expect(restored.series[0].points[0]).toMatchObject({value:null,rawValue:'Infinity',invalidValue:true});
});

test('failed paste preserves chart and edits, successful apply retains zero, units and metadata', () => {
  const controller = BW.VisualBuilder.open(input()); change('title','My headline');
  const before = document.querySelector('.bw-vb-preview').innerHTML;
  field('paste').value = 'date,value\n2025-02-30,5'; action('paste').click();
  expect(document.querySelector('.bw-vb-preview').innerHTML).toBe(before); expect(controller.getSpec().title).toBe('My headline');
  expect(field('paste').getAttribute('aria-invalid')).toBe('true'); expect(document.querySelector('[role=status]').textContent).toContain('not applied');
  field('paste').value = 'date,value,unit,source,footnote\n2025,0,USD,Pasted source,Actual zero'; action('paste').click();
  expect(controller.getSpec().title).toBe('My headline'); expect(controller.getSpec().series[0].points[0].value).toBe(0);
  expect(document.querySelector('.bw-vb-preview svg').textContent).toContain('Pasted source'); expect(field('paste').hasAttribute('aria-invalid')).toBe(false);
});

test('pasting new data replaces old source provenance, notes and inherited context metadata', () => {
  const controller = BW.VisualBuilder.open(input({id:'sec-calendar',title:'SEC filing dates',subtitle:'EDGAR filing calendar',source:'SEC EDGAR',notes:'Filing dates from SEC',sourceUrl:'https://www.sec.gov',ordinal:true,geoSource:'SEC mapping',geojson:geography}));
  change('title','My energy graphic'); change('type','area','change');
  field('paste').value = 'date,value,unit,source,source_url,footnote\n2025,3,GW,Energy agency,https://example.org/energy,Generation source note'; action('paste').click();
  const imported = controller.getSpec();
  expect(imported.title).toBe('My energy graphic'); expect(imported.type).toBe('area'); expect(imported.ordinal).toBe(false);
  expect(imported.source).toBe('Imported user data'); expect(imported.notes).toBe(''); expect(imported.subtitle).toBe(''); expect(imported.sourceUrl).toBeUndefined(); expect(imported.geojson).toBeUndefined();
  const exported = BW.VisualBuilder.serializeSVG(document.querySelector('.bw-vb-preview svg'));
  expect(exported).toContain('Imported user data'); expect(exported).toContain('Energy agency'); expect(exported).toContain('Generation source note'); expect(exported).not.toContain('SEC EDGAR'); expect(exported).not.toContain('Filing dates from SEC');
});

test('dataset choices update data and provenance while retaining unsaved edits within the editor', () => {
  const first = input(), second = {id:'population',name:'Population',title:'Population by place',unit:'people',type:'horizontal',source:'Census',rows:[{label:'Region',value:500,unit:'people'}]};
  const controller = BW.VisualBuilder.open({...first,datasets:[{...first,name:'Oil'},second]});
  change('title','My oil graphic'); change('dataset','population','change');
  expect(controller.getSpec().title).toBe('Population by place'); expect(field('unit').value).toBe('people');
  expect(document.querySelector('.bw-vb-preview svg').textContent).toContain('Census');
  change('dataset','oil','change'); expect(controller.getSpec().title).toBe('My oil graphic');
});

test('empty global editor is safe, Escape closes and focus returns to its opener', () => {
  document.getElementById('opener').focus(); const controller = BW.VisualBuilder.open();
  expect(controller.dialog.open).toBe(true); expect(document.activeElement).toBe(field('title'));
  expect(document.querySelector('.bw-vb-preview').textContent).toContain('No dated observations');
  controller.dialog.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  expect(document.querySelector('.bw-visual-builder')).toBeNull(); expect(document.activeElement.id).toBe('opener');
});

test('storage failure gives recovery feedback without clearing editor data', () => {
  const controller = BW.VisualBuilder.open(input());
  const spy = jest.spyOn(Storage.prototype,'setItem').mockImplementation(() => { throw new Error('Quota'); });
  action('save').click(); expect(document.querySelector('[role=status]').textContent).toContain('could not be saved'); expect(controller.getSpec().series[0].points).toHaveLength(4); spy.mockRestore();
});

const geography = {type:'FeatureCollection',features:[
  {type:'Feature',id:'A',properties:{name:'North'},geometry:{type:'Polygon',coordinates:[[[10,10],[20,10],[20,20],[10,20],[10,10]]]}},
  {type:'Feature',id:'B',properties:{name:'South'},geometry:{type:'Polygon',coordinates:[[[10,-10],[20,-10],[20,0],[10,0],[10,-10]]]}}
]};
test('geographic maps require actual geography and match exact compatible labels', () => {
  const spec = {type:'map',unit:'people',geoSource:'Public boundaries',rows:[{label:'North',value:0,unit:'people',period:'2025',source:'Census'}]};
  const empty = BW.VisualBuilder.render(host(),spec); expect(empty.svg.querySelectorAll('.bw-vb-geography')).toHaveLength(0); expect(empty.svg.textContent).toContain('GeoJSON');
  const chart = BW.VisualBuilder.render(host(),{...spec,geojson:geography});
  expect(chart.svg.querySelectorAll('.bw-vb-geography')).toHaveLength(2); expect(chart.svg.textContent).toContain('1 of 2');
  expect(chart.svg.textContent).toContain('Public boundaries'); expect(chart.svg.outerHTML).not.toMatch(/NaN|Infinity/);
  expect(chart.svg.querySelector('.bw-vb-geography title').textContent).toContain('0 people');
  expect(BW.VisualBuilder.validateGeoJSON(geography)).toBe(geography);
  expect(() => BW.VisualBuilder.validateGeoJSON({type:'Feature',geometry:{type:'Point',coordinates:[null,20]}})).toThrow();
});

test('duplicate geographic matches are left unfilled and noted rather than silently combined', () => {
  const chart = BW.VisualBuilder.render(host(),{type:'map',unit:'people',geojson:geography,rows:[{label:'North',value:1,unit:'people'},{label:'North',value:3,unit:'people'}]});
  expect(chart.svg.textContent).toContain('0 of 2'); expect(chart.svg.textContent).toContain('Repeated geographic labels');
});

test('single geographic points have finite projected geometry', () => {
  const chart = BW.VisualBuilder.render(host(),{type:'map',geojson:{type:'Feature',properties:{name:'Origin'},geometry:{type:'Point',coordinates:[0,0]}},rows:[{label:'Origin',value:0}]});
  expect(chart.svg.querySelector('.bw-vb-geography')).toBeTruthy(); expect(chart.svg.outerHTML).not.toMatch(/NaN|Infinity/);
});
