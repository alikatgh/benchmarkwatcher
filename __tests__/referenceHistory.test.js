/** @jest-environment jsdom */
const fs = require('fs');
const load = path => window.eval(fs.readFileSync('app/static/js/' + path, 'utf8'));
let controller, frames, observers;
const fixture = (count, frequency = 'daily') => ({name:'Saved currency history',unit:'USD per 1 EUR',frequency,
    history:Array.from({length:count},(_,index)=>{const date=new Date(Date.UTC(1999,0,4)+index*86400000).toISOString().slice(0,10);return {date,period:date,price:1+index/10000};})});
const mount = (data,options={}) => controller=BW.ReferenceHistory.mount(document.getElementById('history'),data,{idPrefix:'market',unit:data.unit,sourcePeriods:true,showTable:false,...options});
const range = name => document.querySelector(`[data-detail-range="${name}"]`).click();
const dates = (start,end) => {document.getElementById('market-chart-start').value=start;document.getElementById('market-chart-end').value=end;document.querySelector('.benchmark-detail-date-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));};
beforeEach(()=>{
    localStorage.clear();document.body.innerHTML='<section id="history"></section>';window.BW={};frames=new Map();observers=[];let serial=0;
    window.requestAnimationFrame=jest.fn(callback=>{frames.set(++serial,callback);return serial;});
    window.cancelAnimationFrame=jest.fn(id=>frames.delete(id));
    window.ResizeObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
    load('vendor/d3.v7.9.0.min.js');load('core/visuals.js');load('components/reference_history.js');
});
afterEach(()=>{controller?.destroy();controller=null;jest.restoreAllMocks();});
test('full daily history retains every source observation, range controls, exact endpoints and inspection',()=>{
    const data=fixture(7121), snapshot=JSON.stringify(data),calls=jest.spyOn(BW.Visuals,'timeSeries');
    mount(data);expect(document.querySelectorAll('[data-detail-range]')).toHaveLength(8);
    range('ALL');expect(calls.mock.calls.at(-1)[1][0].points).toHaveLength(7121);
    const input=document.getElementById('market-detail-observation');expect(input.max).toBe('7120');
    input.value='0';input.dispatchEvent(new Event('input'));
    expect(input.getAttribute('aria-valuetext')).toContain(data.history[0].period+' · 1');
    document.querySelector('svg').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));
    expect(input.value).toBe('7120');expect(document.querySelector('.benchmark-detail-readout').textContent).toContain(data.history.at(-1).period);
    expect(JSON.stringify(data)).toBe(snapshot);
});
test('short five-day stock history has observed-day ticks, single-point and empty custom ranges with recovery',()=>{
    const data=fixture(5),calls=jest.spyOn(BW.Visuals,'timeSeries');mount(data);
    expect(calls.mock.calls.at(-1)[2].xValues).toHaveLength(5);
    expect(document.querySelector('.benchmark-detail-chart-extent').textContent).toContain('5 observations');
    dates(data.history[2].date,data.history[2].date);
    expect(document.getElementById('market-detail-observation').disabled).toBe(true);
    expect(document.querySelector('.benchmark-detail-range-change').hidden).toBe(true);
    dates('2026-10-21','2026-10-22');expect(document.querySelector('.benchmark-detail-empty').textContent).toContain('No usable observations');
    expect(document.querySelector('.benchmark-detail-range-handles').hidden).toBe(true);
    range('ALL');expect(document.getElementById('market-detail-observation').max).toBe('4');
});
test('market source precision, periods and flags survive hover, keyboard and slider',()=>{
    const data={name:'Annual source',unit:'USD',frequency:'annual',history:[{date:'2023-01-01',period:'FY2023',price:0},{date:'2024-01-01',period:'FY2024',price:3141592653589793,display_value:'3141592653589793.2384626433832795',status:'E'}]};
    mount(data);range('ALL');const input=document.getElementById('market-detail-observation');
    expect(document.querySelector('.benchmark-detail-readout').textContent).toContain('3141592653589793.2384626433832795');
    expect(document.querySelector('.benchmark-detail-readout-date').textContent).toContain('FY2024 · Source flag E');
    input.value='0';input.dispatchEvent(new Event('input'));expect(input.getAttribute('aria-valuetext')).toContain('FY2023 · 0 USD');
    expect(document.querySelector('.benchmark-detail-range-change').textContent).not.toContain('%');
});
test('custom ranges validate and handles preview without rendering until committed',()=>{
    const calls=jest.spyOn(BW.Visuals,'timeSeries');mount(fixture(249));range('CUSTOM');
    const count=calls.mock.calls.length,start=document.getElementById('market-range-start');start.value='20';start.dispatchEvent(new Event('input'));
    expect(calls).toHaveBeenCalledTimes(count);start.dispatchEvent(new Event('change'));
    expect(calls).toHaveBeenCalledTimes(count+1);expect(document.activeElement.id).toBe('market-range-start');
    const before=controller.getPoints().length;dates('2026-10-22','2026-10-21');
    expect(document.getElementById('market-chart-date-error').hidden).toBe(false);expect(controller.getPoints()).toHaveLength(before);
});
test('unchanged resize does not redraw; destroy cancels a pending resize and disconnects observers',()=>{
    const calls=jest.spyOn(BW.Visuals,'timeSeries');mount(fixture(30));const count=calls.mock.calls.length;
    for(const callback of [...frames.values()])callback();frames.clear();observers[0].callback();
    for(const callback of [...frames.values()])callback();frames.clear();expect(calls).toHaveBeenCalledTimes(count);
    controller.resize();expect(frames.size).toBe(1);const pending=[...frames.values()][0];controller.destroy();
    expect(frames.size).toBe(0);expect(observers[0].disconnected).toBe(true);pending();expect(calls).toHaveBeenCalledTimes(count);
});
test('market adapter offers in-page Quick visual while export remains disabled',()=>{
    const data=fixture(5);data.allowExport=false;
    document.body.innerHTML='<section id="market-reference-history"></section><script id="gr-chart-data" type="application/json"></script><script id="bw-visual-source" type="application/json">{"id":"stock-XNAS-COST","source":"Saved source"}</script>';
    document.getElementById('gr-chart-data').textContent=JSON.stringify(data);BW.QuickVisuals={open:jest.fn()};BW.VisualBuilderSources={reference:jest.fn(),setPage:jest.fn()};
    load('components/global-reference.js');document.querySelector('.bw-create-graphic').click();
    const [spec,options]=BW.QuickVisuals.open.mock.calls[0];expect(spec.series[0].points).toHaveLength(5);expect(options.allowCustomize).toBe(false);
    expect(BW.VisualBuilderSources.reference).not.toHaveBeenCalled();expect(BW.VisualBuilderSources.setPage).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pagehide'));
});

test('market chart settings reuse browser preferences and remain usable when storage is blocked',()=>{
    const data=fixture(249);mount(data,{preferenceKey:'bw.detail.chart.v1'});
    const style=document.getElementById('market-chart-style');style.value='area';style.dispatchEvent(new Event('change'));
    expect(JSON.parse(localStorage.getItem('bw.detail.chart.v1'))).toEqual({version:1,style:'area',dots:false});
    controller.destroy();mount(data,{preferenceKey:'bw.detail.chart.v1'});expect(document.getElementById('market-chart-style').value).toBe('area');
    jest.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('blocked');});
    const dots=document.getElementById('market-chart-dots');dots.checked=true;expect(()=>dots.dispatchEvent(new Event('change'))).not.toThrow();
    expect(document.getElementById('market-chart-dots').checked).toBe(true);
});


test('derived market percentages use two decimals while source values keep their precision',()=>{
    const data={name:'Saved stock',unit:'USD per share',frequency:'daily',history:[{date:'2026-10-19',period:'2026-10-19',price:927.12},{date:'2026-10-23',period:'2026-10-23',price:939.81}]};
    mount(data,{format:value=>Number(value).toLocaleString(undefined,{maximumSignificantDigits:8})});
    expect(document.querySelector('.benchmark-detail-range-change').textContent).toContain('(+1.37%)');
    expect(document.querySelector('.benchmark-detail-readout-value strong').textContent).toBe('939.81');
});
