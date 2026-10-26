// Lifecycle contracts for replacing saved-reference detail panels.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync('app/static/js/components/global-reference.js', 'utf8');

function emitter(properties = {}) {
    const events = new Map();
    return Object.assign(properties, {
        addEventListener(name, callback) {
            if (!events.has(name)) events.set(name, new Set());
            events.get(name).add(callback);
        },
        removeEventListener(name, callback) { events.get(name)?.delete(callback); },
        emit(name, event = {}) { for (const callback of [...(events.get(name) || [])]) callback(event); },
        count(name) { return events.get(name)?.size || 0; },
    });
}
const history = [
    {date:'2024-01-02', period:'FY2024', price:10},
    {date:'2026-10-22', period:'2026-10-22', price:12},
];
function panel(id, {legacy = false, allowExport = false} = {}) {
    const elements = {
        [legacy ? 'gr-chart' : 'market-reference-history']:{id:legacy ? 'gr-chart' : 'market-reference-history', clientWidth:800, clientHeight:320, dataset:{}},
        'gr-chart-data':{textContent:JSON.stringify({name:id, unit:'USD', frequency:'daily', history, allowExport})},
        'bw-visual-source':{textContent:JSON.stringify({id, source:id + ' source'})},
    };
    if (legacy) {
        const value = {textContent:''}, period = {textContent:''};
        Object.assign(elements, {
            'gr-readout':{querySelector:selector => selector === 'strong' ? value : period},
            'gr-range':emitter({value:'all'}), 'gr-chart-type':emitter({value:'line'}),
            'gr-range-caption':{textContent:''},
        });
    }
    const controls = {};
    return {elements, controls, querySelector:selector => selector === '.gr-chart-controls' ? controls : elements[selector.slice(1)]};
}
function runtime(initial = panel('empty'), overrides = {}) {
    const window = emitter({BW:{Visuals:{}}});
    const frames = new Map(), observers = [];
    let serial = 0;
    class Observer {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe(target) { this.target = target; }
        disconnect() { this.disconnected = true; }
    }
    const document = {getElementById:id => initial.elements[id], querySelector:initial.querySelector, documentElement:{}};
    Object.assign(window.BW, overrides);
    const context = {window, document, ResizeObserver:Observer, MutationObserver:Observer,
        requestAnimationFrame:callback => { frames.set(++serial, callback); return serial; },
        cancelAnimationFrame:id => frames.delete(id),
    };
    vm.runInNewContext(code, context);
    return {window, api:window.BW.ReferencePage, document, frames, observers, context,
        flush() { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(); }};
}
const empty = () => ({elements:{}, querySelector:() => null});

test('auto mount and scoped remount reuse each target; replacement forwards state and source scope', () => {
    const first = panel('A'), second = panel('B');
    const calls = [], quickVisual = [];
    const environment = runtime(first, {
        QuickVisuals:{open:(...args) => quickVisual.push(args)},
        ReferenceHistory:{mount(target, data, options) {
            const controller = {destroyed:0, destroy() { this.destroyed++; }, getState:() => options.state || {range:'ALL'}};
            calls.push({target, data, options, controller}); return controller;
        }},
    });
    const one = environment.api.mount(first);
    assert.equal(environment.api.mount(), one);
    assert.equal(environment.api.mount(first, {state:{range:'1Y'}}), one);
    assert.equal(calls.length, 1);
    assert.equal(one.getState().range, 'ALL');
    const state = {range:'CUSTOM', custom:{start:'2026-01-01', end:'2026-10-22'}, chartStyle:'step'};
    const two = environment.api.mount(second, {state});
    assert.notEqual(two, one);
    assert.equal(calls[1].target, second.elements['market-reference-history']);
    assert.equal(calls[1].options.state, state);
    assert.equal(two.getState(), state);
    calls[1].options.quickVisual(history, 'step', 'trigger');
    assert.equal(quickVisual[0][0].id, 'B');
    assert.equal(quickVisual[0][0].source, 'B source');
    assert.equal(quickVisual[0][1].allowCustomize, false);
    one.destroy(); one.destroy();
    assert.equal(calls[0].controller.destroyed, 1);
    assert.notEqual(environment.api.mount(first), one, 'Destroy must permit the same host to be mounted again');
    assert.equal(calls.length, 3);
    two.destroy();
});

test('one pagehide listener keeps every active controller alive for bfcache and destroys on final leave', () => {
    const controllers = [];
    const environment = runtime(panel('A'), {ReferenceHistory:{mount() {
        const controller = {destroyed:0, destroy() { this.destroyed++; }};
        controllers.push(controller); return controller;
    }}});
    environment.api.mount(panel('B')); environment.api.mount(panel('C'));
    assert.equal(environment.window.count('pagehide'), 1);
    // Loading the adapter twice also reuses its registry and single listener.
    vm.runInNewContext(code, environment.context);
    assert.equal(environment.window.count('pagehide'), 1);
    assert.equal(controllers.length, 3);
    environment.window.emit('pagehide', {persisted:true});
    assert.deepEqual(controllers.map(item => item.destroyed), [0,0,0]);
    environment.window.emit('pagehide', {persisted:false});
    environment.window.emit('pagehide', {persisted:false});
    assert.deepEqual(controllers.map(item => item.destroyed), [1,1,1]);
});

test('missing, invalid and empty chart panels return null without allocating controls or observers', () => {
    let calls = 0;
    const environment = runtime(empty(), {ReferenceHistory:{mount() { calls++; }}});
    assert.equal(environment.api.mount(), null);
    assert.equal(environment.api.mount(null), null);
    for (const source of [undefined, '{bad', 'null', '{}', '{"history":[]}', '{"history":"wrong"}']) {
        const candidate = panel('bad');
        if (source === undefined) delete candidate.elements['gr-chart-data'];
        else candidate.elements['gr-chart-data'].textContent = source;
        assert.equal(environment.api.mount(candidate), null);
    }
    const incomplete = panel('legacy', {legacy:true}); delete incomplete.elements['gr-range'];
    assert.equal(environment.api.mount(incomplete), null);
    delete environment.window.BW.ReferenceHistory;
    assert.equal(environment.api.mount(panel('missing renderer')), null);
    assert.equal(calls, 0); assert.equal(environment.observers.length, 0);
});

test('legacy scopes restore controls and destroy removes listeners, pending work and observers', () => {
    const candidate = panel('legacy', {legacy:true});
    const draws = [], exports = [];
    const environment = runtime(empty(), {
        Visuals:{timeSeries(target, series, options) {
            const chart = {destroyed:0, destroy() { this.destroyed++; }};
            draws.push({target, series, options, chart}); return chart;
        }},
        VisualBuilderSources:{reference:() => exports.push('reference')},
    });
    const handle = environment.api.mount(candidate, {state:{range:'1', chartStyle:'bar'}});
    assert.equal(draws.length, 1);
    assert.equal(draws[0].series[0].points.length, 1);
    assert.equal(draws[0].options.type, 'bar');
    assert.equal(handle.getState().range, '1'); assert.equal(handle.getState().chartStyle, 'bar');
    assert.equal(environment.api.mount(candidate), handle);
    assert.deepEqual(exports, [], 'Reference-only legacy charts must never attach an export');
    const range = candidate.elements['gr-range'], type = candidate.elements['gr-chart-type'];
    assert.equal(range.count('change'), 1); assert.equal(type.count('change'), 1);
    range.value = 'all'; range.emit('change'); environment.flush();
    assert.equal(draws.length, 2); assert.equal(draws[1].series[0].points.length, 2);
    assert.equal(draws[0].chart.destroyed, 1);
    environment.observers[0].callback(); assert.equal(environment.frames.size, 0, 'Unchanged resize must not redraw');
    candidate.elements['gr-chart'].clientWidth = 900;
    environment.observers[0].callback(); assert.equal(environment.frames.size, 1);
    const pending = [...environment.frames.values()][0];
    handle.destroy(); handle.destroy();
    assert.equal(range.count('change'), 0); assert.equal(type.count('change'), 0);
    assert.equal(environment.frames.size, 0);
    assert.ok(environment.observers.every(observer => observer.disconnected));
    assert.equal(draws[1].chart.destroyed, 1);
    pending(); range.emit('change'); type.emit('change');
    for (const observer of environment.observers) observer.callback();
    assert.equal(draws.length, 2); assert.equal(environment.frames.size, 0);
});

test('legacy exporter receives metadata and controls from its own panel', () => {
    const candidate = panel('scoped export', {legacy:true, allowExport:true}), exports = [];
    const environment = runtime(empty(), {
        Visuals:{timeSeries:() => ({destroy() {}})},
        VisualBuilderSources:{
            reference(data, metadata) { exports.push({data, metadata}); return {id:metadata.id}; },
            attach(host, spec) { exports.push({host, spec}); }, setPage(spec) { exports.push({page:spec}); },
        },
    });
    const handle = environment.api.mount(candidate);
    assert.equal(exports[0].metadata.id, 'scoped export');
    assert.equal(exports[1].host, candidate.controls);
    assert.equal(exports[2].page.id, 'scoped export');
    handle.destroy();
});
