/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const script = fs.readFileSync(path.join(__dirname,'../app/static/js/components/visual_builder_sources.js'),'utf8');
beforeEach(()=>{
    document.body.innerHTML = '';
    window.BW = {VisualBuilder:{open:jest.fn()},QuickVisuals:{open:jest.fn()}};
    window.eval(script);
});
test('catalog comparisons separate units, periods, publishers and measures',()=>{
    const base={measure:'Wind capacity',unit:'GW',period:'2025',source:'Publisher',value:12};
    const records=[{...base,id:'a',label:'A',status:'Estimate',sourceUrl:'https://example.com/a'},
        {...base,id:'b',label:'B',value:0},
        {...base,id:'c',label:'C',unit:'MW'},
        {...base,id:'d',label:'D',period:'2024'},
        {...base,id:'e',label:'E',source:'Another publisher'},
        {...base,id:'f',label:'F',measure:'Generation'}];
    const specs=BW.VisualBuilderSources.catalogSpecs(records);
    expect(specs).toHaveLength(5);
    expect(specs[0].rows).toHaveLength(2);
    expect(specs[0].rows[1].value).toBe(0);
    expect(specs[0].rows[0]).toMatchObject({status:'Estimate',period:'2025',source:'Publisher · https://example.com/a'});
    expect(specs[0].notes).toContain('results page only');
});
test('repeated chart rendering updates one action and opens the latest selection',async()=>{
    const host=document.createElement('div');document.body.append(host);
    BW.VisualBuilderSources.attach(host,{title:'Old range'});
    BW.VisualBuilderSources.attach(host,()=>({title:'Selected range'}));
    expect(host.querySelectorAll('button')).toHaveLength(1);
    host.querySelector('button').click(); await Promise.resolve();await Promise.resolve();
    expect(BW.QuickVisuals.open).toHaveBeenCalledWith({title:'Selected range'}, {trigger:host.querySelector('button')});
    expect(BW.VisualBuilder.open).not.toHaveBeenCalled();
});
test('failed history load is recoverable and never opens stale data',async()=>{
    const host=document.createElement('div');document.body.append(host);
    const button=BW.VisualBuilderSources.attach(host,async()=>{throw new Error('offline');});
    button.click();await Promise.resolve();await Promise.resolve();
    expect(BW.QuickVisuals.open).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
    expect(host.querySelector('[role=status]').textContent).toContain('Try again');
});
test('reference and benchmark adapters retain source periods, flags and cadence',()=>{
    const points=[{date:'2025-01-01',period:'2025',price:0,status:'Provisional',footnote:'Original note'}];
    const spec=BW.VisualBuilderSources.reference({name:'Capacity',unit:'GW',frequency:'annual',history:points},{source:'Agency',sourceUrl:'https://example.com'});
    expect(spec.series[0]).toMatchObject({points,gapDays:400,source:'Agency',sourceUrl:'https://example.com'});
    const benchmark=BW.VisualBuilderSources.benchmark({id:'oil',name:'Oil',currency:'USD',unit:'barrel',frequency:'daily',source_name:'Agency',source_url:'https://example.com',history:points});
    expect(benchmark.unit).toBe('USD / barrel');
    expect(benchmark.series[0].gapDays).toBe(7);
    expect(benchmark.source).toContain('https://example.com');
});

test('row quick visuals use cached current-range observations without fetching',()=>{
    document.body.innerHTML='<span id="date-range-display">Last month</span><table id="data-table"><tbody id="table-body"><tr data-id="oil"></tr><tr data-id="gold" hidden></tr></tbody></table>';
    const points=[{date:'2026-09-01',price:0,status:'Estimated'},{date:'2026-09-02',price:12}];
    BW.CompactTable={sparklineData:[{id:'oil',name:'Oil',unit:'barrel',currency:'USD',source_name:'Source',history:points,price:12,date:'2026-09-02'},
        {id:'gold',name:'Gold',unit:'ounce',currency:'USD',history:[{date:'2026-09-02',price:2000}],price:2000,date:'2026-09-02'}]};
    window.fetch=jest.fn();
    const spec=BW.VisualBuilderSources.tableSpec('row','oil');
    expect(spec.series).toHaveLength(1);
    expect(spec.series[0].points).toBe(points);
    expect(spec.notes).toContain('Last month');
    expect(BW.VisualBuilderSources.tableSpec('filtered').rows.map(row=>row.label)).toEqual(['Oil']);
    expect(window.fetch).not.toHaveBeenCalled();
});
test('empty filters and an updating table cannot fall back to unrelated observations',()=>{
    document.body.innerHTML='<table id="data-table"><tbody id="table-body"><tr data-id="oil" hidden></tr></tbody></table>';
    BW.CompactTable={sparklineData:[{id:'oil',name:'Oil',history:[]}]};
    expect(()=>BW.VisualBuilderSources.tableSpec('filtered')).toThrow('No matching observations');
    document.getElementById('data-table').setAttribute('aria-busy','true');
    expect(()=>BW.VisualBuilderSources.tableSpec('row','oil')).toThrow('Observations are updating');
});
test('explicit selections retain selected rows outside filters and separate units',()=>{
    document.body.innerHTML='<table><tbody id="table-body"><tr data-id="oil"></tr><tr data-id="gold" hidden></tr></tbody></table>';
    BW.TableWorkspace={getSelectedIds:()=>['oil','gold']};
    BW.CompactTable={sparklineData:[{id:'oil',name:'Oil',unit:'barrel',currency:'USD',history:[]},{id:'gold',name:'Gold',unit:'ounce',currency:'USD',history:[]}]};
    const spec=BW.VisualBuilderSources.tableSpec();
    expect(spec.series.map(series=>series.unit)).toEqual(['USD / barrel','USD / ounce']);
    expect(spec.datasets).toHaveLength(3);
});
