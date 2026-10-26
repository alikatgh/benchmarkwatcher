// Targeted, dependency-free contract check for the reference chart adapter.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync('app/static/js/components/global-reference.js', 'utf8');

test('consecutive 53-week annual reports remain connected and source decimals survive inspection', () => {
    const value = {textContent: ''}, period = {textContent: ''};
    const listeners = {};
    const history = [
        {date: '2015-12-26', period: '2015-12-26', value: 12},
        {date: '2016-12-31', period: '2016-12-31', value: 13},
        {date: '2018-12-29', period: '2018-12-29', value: 14},
    ];
    const elements = {
        'gr-chart': {clientWidth: 800, clientHeight: 320, dataset: {}},
        'gr-chart-data': {textContent: JSON.stringify({name: 'Assets', unit: 'USD', frequency: 'annual', history})},
        'gr-readout': {querySelector: key => key === 'strong' ? value : period},
        'gr-range': {value: 'all', addEventListener: (event, callback) => {listeners.range = callback;}},
        'gr-chart-type': {value: 'line', addEventListener() {}},
        'gr-range-caption': {textContent: ''},
    };
    let series, options, destroyed=0, disconnected=0;
    const BW = {Visuals: {timeSeries: (target, input, config) => {
        series = input[0]; options = config; return {destroy() {destroyed++;}};
    }}};
    class Observer {observe() {} disconnect() {disconnected++;}}
    vm.runInNewContext(code, {
        window: {BW, addEventListener: (event, callback) => {listeners[event] = callback;}}, BW,
        document: {getElementById: id => elements[id], documentElement: {}},
        ResizeObserver: Observer, MutationObserver: Observer,
        requestAnimationFrame: callback => {callback(); return 1;}, cancelAnimationFrame() {},
    });
    const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
    assert.ok(days(history[0].date, history[1].date) <= series.gapDays);
    assert.ok(days(history[1].date, history[2].date) > series.gapDays);
    options.onInspect({value: 3141592653589793, display_value: '3141592653589793.2384626433832795', period: '2024', status: 'E'});
    assert.equal(value.textContent, '3141592653589793.2384626433832795');
    assert.equal(period.textContent, 'USD · Period 2024 · Source flag E');
    options.onInspect({value: 0, period: '2023'});
    assert.equal(value.textContent, '0');
    listeners.pagehide({persisted: true});
    assert.equal(destroyed, 0, 'Back cache must retain chart interactions');
    assert.equal(disconnected, 0, 'Back cache must retain resize and theme observers');
    elements['gr-range'].value = '1';
    listeners.range();
    assert.equal(series.points.length, 1);
    listeners.pagehide({persisted: false});
    assert.equal(destroyed, 2); // Range redraw discarded the first chart.
    assert.equal(disconnected, 2);
});


test('reference-only daily charts retain rendering and controls without attaching exports', () => {
    for (const allowExport of [false, undefined]) {
        const value = {textContent: ''}, period = {textContent: ''};
        const listeners = {}, exports = [];
        const history = [
            {date: '2026-10-21', period: '2026-10-21', price: 0.91},
            {date: '2026-10-22', period: '2026-10-22', price: 0.92},
        ];
        const elements = {
            'gr-chart': {clientWidth: 800, clientHeight: 320, dataset: {}},
            'gr-chart-data': {textContent: JSON.stringify({name:'Currency',unit:'EUR per USD',frequency:'daily',history,allowExport})},
            'gr-readout': {querySelector: key => key === 'strong' ? value : period},
            'gr-range': {value: 'all', addEventListener: (event,callback) => {listeners.range=callback;}},
            'gr-chart-type': {value: 'line', addEventListener: (event,callback) => {listeners.type=callback;}},
            'gr-range-caption': {textContent: ''},
        };
        let options, renders=0;
        const BW = {
            Visuals: {timeSeries: (target, input, config) => {
                options=config; renders++; return {destroy() {}};
            }},
            VisualBuilderSources: {
                reference: () => {exports.push('reference'); return {};},
                attach: () => {exports.push('attach');},
                setPage: () => {exports.push('setPage');},
            },
        };
        class Observer {observe() {} disconnect() {}}
        vm.runInNewContext(code, {
            window: {BW,addEventListener() {}}, BW,
            document: {getElementById:id=>elements[id],querySelector:()=>({}),documentElement:{}},
            ResizeObserver:Observer,MutationObserver:Observer,
            requestAnimationFrame:callback=>{callback();return 1;},cancelAnimationFrame() {},
        });
        assert.equal(elements['gr-chart'].dataset.rendered,'true');
        assert.equal(renders,1);
        assert.deepEqual(Array.from(options.xValues,day=>day.toISOString().slice(0,10)),['2026-10-21','2026-10-22']);
        options.onInspect({value:0.91,period:'2026-10-21'});
        assert.equal(value.textContent,'0.91');
        assert.equal(period.textContent,'EUR per USD · Period 2026-10-21');
        elements['gr-chart-type'].value='bar';
        listeners.type();
        assert.equal(options.type,'bar');
        elements['gr-range'].value='1';
        listeners.range();
        assert.equal(renders,3);
        assert.deepEqual(exports,allowExport===false?[]:[
            'reference','attach','setPage','reference','attach','setPage','reference','attach','setPage',
        ]);
    }
});
