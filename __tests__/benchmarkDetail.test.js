/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const script = fs.readFileSync(path.join(__dirname, '../app/static/js/components/benchmark_detail.js'), 'utf8');
const template = fs.readFileSync(path.join(__dirname, '../app/templates/components/benchmark_detail.html'), 'utf8');
const sample = (id, overrides = {}) => ({
    id, name: id === 'gold' ? 'Gold' : 'Copper', category: 'Metals', currency: 'USD', unit: 'ounce',
    price: 200, date: '2025-05-01', prev_price: 100, prev_date: '2025-04-01', change_percent: 100,
    is_daily: false, source_name: 'Public source', source_url: 'https://example.org/source',
    history: [{ date: '2025-04-01', price: 100 }, { date: '2025-05-01', price: 200 }], ...overrides
});
const response = data => ({ ok: true, json: async () => ({ data }) });
const click = label => {
    const node = Array.from(document.querySelectorAll('button')).find(node => node.textContent === label);
    expect(node).toBeTruthy(); node.click(); return node;
};

beforeEach(() => {
    if (window.BW && BW.BenchmarkDetail) BW.BenchmarkDetail.destroy();
    jest.restoreAllMocks();
    localStorage.clear();
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 });
    document.body.innerHTML = '<main id="table-shell"><a href="/commodity/gold" data-benchmark-id="gold">Gold</a><button id="table-control">Filter</button></main>' + template;
    global.BW = {};
    window.matchMedia = jest.fn(() => ({ matches: false }));
    global.fetch = jest.fn(async url => response(sample(url.split('/').pop())));
    window.eval(fs.readFileSync(path.join(__dirname, '../app/static/js/vendor/d3.v7.9.0.min.js'), 'utf8'));
    window.eval(fs.readFileSync(path.join(__dirname, '../app/static/js/core/visuals.js'), 'utf8'));
    window.eval(script);
    BW.BenchmarkDetail.init();
});
afterEach(() => { BW.BenchmarkDetail.destroy(); });

test('opens read-only source details and restores focus without changing the table', async () => {
    const trigger = document.querySelector('a[data-benchmark-id]');
    trigger.focus();
    await BW.BenchmarkDetail.open('gold', trigger);
    const detail = document.getElementById('benchmark-detail');
    expect(detail.hidden).toBe(false);
    expect(detail.getAttribute('role')).toBe('complementary');
    expect(detail.hasAttribute('aria-modal')).toBe(false);
    expect(document.querySelector('.benchmark-detail-value').textContent).toBe('200.00');
    expect(detail.textContent).toContain('USD / ounce');
    expect(detail.textContent).toContain('2025-05-01');
    expect(detail.querySelector('a[href="https://example.org/source"]').rel).toBe('noopener noreferrer');
    expect(detail.querySelector('svg')).toBeTruthy();
    const input = document.getElementById('benchmark-detail-observation');
    input.value = '0'; input.dispatchEvent(new Event('input'));
    expect(input.getAttribute('aria-valuetext')).toContain('2025-04-01 · 100.00');
    BW.BenchmarkDetail.close();
    expect(detail.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(document.getElementById('table-control').textContent).toBe('Filter');
});

test('mobile details make the background inert, trap focus, and close on Escape', async () => {
    window.matchMedia.mockReturnValue({ matches: true });
    window.innerWidth = 390;
    const trigger = document.querySelector('a[data-benchmark-id]');
    await BW.BenchmarkDetail.open('gold', trigger);
    const detail = document.getElementById('benchmark-detail');
    expect(detail.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById('table-shell').inert).toBe(true);
    const close = detail.querySelector('[data-detail-action="close"]');
    close.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement.textContent).toBe('Add to research');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(detail.hidden).toBe(true);
    expect(document.getElementById('table-shell').inert).toBeFalsy();
    expect(document.activeElement).toBe(trigger);
});

test('a later selection wins even if an aborted older request resolves afterwards', async () => {
    const requests = {};
    fetch.mockImplementation((url, options) => new Promise(resolve => { requests[url.split('/').pop()] = { resolve, options }; }));
    const first = BW.BenchmarkDetail.open('gold');
    const second = BW.BenchmarkDetail.open('copper');
    expect(requests.gold.options.signal.aborted).toBe(true);
    requests.copper.resolve(response(sample('copper')));
    await second;
    requests.gold.resolve(response(sample('gold')));
    await first;
    expect(document.getElementById('benchmark-detail-title').textContent).toBe('Copper');
});

test('closing aborts the request and an eventual response cannot reopen the pane', async () => {
    let resolve;
    fetch.mockImplementation(() => new Promise(done => { resolve = done; }));
    const loading = BW.BenchmarkDetail.open('gold');
    BW.BenchmarkDetail.close();
    resolve(response(sample('gold'))); await loading;
    expect(document.getElementById('benchmark-detail').hidden).toBe(true);
    expect(document.body.classList.contains('bw-detail-open')).toBe(false);
});

test('failed requests keep a full-page escape route and retry successfully', async () => {
    fetch.mockResolvedValueOnce({ ok: false });
    await BW.BenchmarkDetail.open('gold');
    expect(document.getElementById('benchmark-detail-title').textContent).toBe('Gold');
    expect(document.querySelector('.benchmark-detail-error').textContent).toContain('could not be loaded');
    expect(document.querySelector('.benchmark-detail-error a').getAttribute('href')).toBe('/commodity/gold');
    click('Retry');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(document.querySelector('.benchmark-detail-value').textContent).toBe('200.00');
});

test.each([null, '', ' ', false, [], 'unavailable'])('does not turn missing prices into zero (%s)', async value => {
    fetch.mockResolvedValue(response(sample('gold', { price: value, prev_price: null, change_percent: null, history: [{ date: '2025-05-01', price: value }] })));
    await BW.BenchmarkDetail.open('gold');
    expect(document.querySelector('.benchmark-detail-value').textContent).toBe('Unavailable');
    expect(document.querySelector('.benchmark-detail-change')).toBeNull();
    expect(document.querySelector('svg')).toBeNull();
    expect(document.querySelector('.benchmark-detail-table td:nth-child(2)').textContent).toBe('Unavailable');
});

test('zero is a real value and one observation does not acquire a made-up change', async () => {
    fetch.mockResolvedValue(response(sample('gold', { price: 0, prev_price: null, change_percent: null, history: [{ date: '2025-05-01', price: 0 }] })));
    await BW.BenchmarkDetail.open('gold');
    expect(document.querySelector('.benchmark-detail-value').textContent).toBe('0.00');
    expect(document.getElementById('benchmark-detail-observation').disabled).toBe(true);
    expect(document.getElementById('benchmark-detail-history').textContent).toContain('Only one observation');
});

test('untrusted names and source URLs are rendered safely', async () => {
    fetch.mockResolvedValue(response(sample('gold', { name: '<img src=x onerror=alert(1)>', source_url: 'javascript:alert(1)', source_name: '<script>alert(1)</script>' })));
    await BW.BenchmarkDetail.open('gold');
    const detail = document.getElementById('benchmark-detail');
    expect(detail.querySelector('img,script,a[href^="javascript:"]')).toBeNull();
    expect(detail.textContent).toContain('<img src=x onerror=alert(1)>');
});

test('watching persists, reverses, emits membership, and bulk watching is idempotent', () => {
    const listener = jest.fn(); document.addEventListener('bw:watchlist-change', listener);
    expect(BW.BenchmarkDetail.toggleWatch('gold')).toBe(true);
    expect(JSON.parse(localStorage.getItem('bw.watchlist.v1'))).toEqual({ version: 1, ids: ['gold'] });
    BW.BenchmarkDetail.addToWatchlist(['gold', 'copper', 'bad/id']);
    expect(BW.BenchmarkDetail.getWatchlist()).toEqual(['gold', 'copper']);
    expect(listener.mock.calls.at(-1)[0].detail).toEqual({ ids: ['gold', 'copper'], saved: true });
    expect(BW.BenchmarkDetail.toggleWatch('gold')).toBe(false);
    expect(BW.BenchmarkDetail.getWatchlist()).toEqual(['copper']);
    document.removeEventListener('bw:watchlist-change', listener);
});

test('failed watchlist storage retains the session draft, reports failure, and retry saves it', () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    BW.BenchmarkDetail.toggleWatch('gold');
    expect(BW.BenchmarkDetail.getWatchlist()).toEqual(['gold']);
    expect(document.getElementById('benchmark-detail-notice-text').textContent).toContain('Not saved');
    expect(document.querySelector('[data-detail-action="retry-save"]').hidden).toBe(false);
    setItem.mockRestore();
    click('Retry save');
    expect(JSON.parse(localStorage.getItem('bw.watchlist.v1')).ids).toEqual(['gold']);
    expect(document.getElementById('benchmark-detail-notice-text').textContent).toContain('Saved in this browser');
});

test('mobile watchlist retry stays within the accessible dialog and returns outside after closing', async () => {
    window.matchMedia.mockReturnValue({ matches: true });
    window.innerWidth = 390;
    await BW.BenchmarkDetail.open('gold');
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    BW.BenchmarkDetail.toggleWatch('gold');
    const notice = document.getElementById('benchmark-detail-notice');
    expect(document.getElementById('benchmark-detail').contains(notice)).toBe(true);
    document.querySelector('[data-detail-action="retry-save"]').focus();
    expect(document.activeElement.textContent).toBe('Retry save');
    BW.BenchmarkDetail.close();
    expect(document.getElementById('benchmark-detail').contains(notice)).toBe(false);
    expect(notice.hidden).toBe(false);
});

test('adds the real record to research after releasing modal state', async () => {
    window.matchMedia.mockReturnValue({ matches: true });
    window.innerWidth = 390;
    const research = document.createElement('section'); research.id = 'research-workspace'; document.body.append(research);
    BW.ResearchWorkspace = { addBenchmarks: jest.fn(() => {
        expect(document.getElementById('table-shell').inert).toBeFalsy();
    }) };
    await BW.BenchmarkDetail.open('gold');
    click('Add to research');
    expect(BW.ResearchWorkspace.addBenchmarks).toHaveBeenCalledWith([expect.objectContaining({ id: 'gold', price: 200 })]);
    expect(document.getElementById('benchmark-detail').hidden).toBe(true);
});

test('comparison discloses different baselines, preserves actual dates, and disallows mixed-unit absolute values', async () => {
    fetch.mockImplementation(async url => response(url.endsWith('gold') ? sample('gold') : sample('copper', {
        unit: 'tonne', history: [{ date: '2025-04-15', price: 50 }, { date: '2025-05-15', price: 75 }]
    })));
    await BW.BenchmarkDetail.compare(['gold', 'copper']);
    const detail = document.getElementById('benchmark-detail');
    expect(detail.textContent).toContain('Baseline: 2025-04-01');
    expect(detail.textContent).toContain('Baseline: 2025-04-15');
    expect(detail.textContent).toContain('Baseline dates may differ');
    expect(detail.querySelector('[data-detail-mode="absolute"]').disabled).toBe(true);
    const tables = detail.querySelectorAll('table');
    expect(tables).toHaveLength(2);
    expect(tables[1].textContent).toContain('50.00');
    expect(tables[1].textContent).not.toContain('2025-04-01');
    expect(detail.querySelectorAll('svg .bw-d3-point')).toHaveLength(4);
    expect(detail.querySelector('[data-detail-mode="percent"]').getAttribute('aria-pressed')).toBe('true');
    expect(detail.querySelectorAll('.benchmark-comparison-keys>span')).toHaveLength(2);
    click('Index 100');
    expect(detail.querySelectorAll('table')[1].textContent).toContain('150.00');
});

test.each([0, -10])('compatible comparison retains raw values when a nonpositive baseline cannot be normalized (%s)', async baseline => {
    fetch.mockImplementation(async url => response(sample(url.split('/').pop(), { history: [{ date: '2025-04-01', price: baseline }, { date: '2025-05-01', price: 1 }] })));
    await BW.BenchmarkDetail.compare(['gold', 'copper']);
    const detail = document.getElementById('benchmark-detail');
    expect(detail.textContent).toContain('a positive baseline is required');
    expect(detail.querySelector('svg.benchmark-detail-plot')).toBeNull();
    expect(detail.querySelector('[data-detail-mode="absolute"]').disabled).toBe(false);
    click('Value');
    expect(detail.querySelector('svg.benchmark-detail-plot')).toBeTruthy();
    expect(detail.innerHTML).not.toContain('Infinity');
});

test('three percentage lines start at zero, preserve gaps and correctly display gains and losses', async () => {
    const observations = {
        gold: [{date:'2025-04-01',price:100},{date:'2025-04-15',price:null},{date:'2025-05-01',price:90}],
        copper: [{date:'2025-04-15',price:10},{date:'2025-05-01',price:20}],
        oil: [{date:'2025-04-01',price:40},{date:'2025-05-01',price:30}]
    };
    fetch.mockImplementation(async url => { const id = url.split('/').pop(); return response(sample(id, {history:observations[id]})); });
    await BW.BenchmarkDetail.compare(['gold','copper','oil']);
    const values = index => Array.from(document.querySelectorAll('.point-' + index)).map(node => node.__data__.value);
    expect(values(0)[0]).toBe(0); expect(values(0)[1]).toBeCloseTo(-10);
    expect(values(1)).toEqual([0,100]); expect(values(2)).toEqual([0,-25]);
    expect(document.querySelector('.benchmark-detail-table').textContent).toContain('Unavailable');
    const strokes = Array.from(document.querySelectorAll('.bw-d3-line')).map(node => node.getAttribute('stroke'));
    expect(new Set(strokes).size).toBe(3);
    expect(document.querySelectorAll('.benchmark-detail-table tbody tr')).toHaveLength(7);
});

test('comparison retains successful series when one request fails and enforces the four-series limit', async () => {
    fetch.mockImplementation(async url => url.endsWith('gold') ? { ok: false } : response(sample('copper')));
    await BW.BenchmarkDetail.compare(['gold', 'copper']);
    expect(document.querySelector('svg')).toBeTruthy();
    expect(document.getElementById('benchmark-detail-body').textContent).toContain('Retry unavailable series');
    const plotDash = document.querySelector('.bw-d3-line').getAttribute('stroke-dasharray') || 'none';
    expect(document.querySelector('.benchmark-comparison-keys line').getAttribute('stroke-dasharray')).toBe(plotDash);
    expect(document.querySelectorAll('.benchmark-detail-legend-dot line')[1].getAttribute('stroke-dasharray')).toBe(plotDash);
    expect(await BW.BenchmarkDetail.compare(['a', 'b', 'c', 'd', 'e'])).toBe(false);
    expect(document.getElementById('benchmark-detail-notice-text').textContent).toContain('2 to 4');
});

test('range changes reveal older history and explicit missing values break the chart path', async () => {
    fetch.mockResolvedValue(response(sample('gold', { history: [
        { date: '2020-01-01', price: 50 }, { date: '2025-04-01', price: 100 },
        { date: '2025-04-02', price: null }, { date: '2025-04-03', price: 120 },
        { date: '2025-05-01', price: 200 }, { date: 'not-a-date', price: 20 }
    ] })));
    await BW.BenchmarkDetail.open('gold');
    expect(document.querySelector('table').textContent).not.toContain('2020-01-01');
    expect(document.querySelector('.benchmark-detail-line').getAttribute('d').match(/M/g)).toHaveLength(2);
    click('All');
    expect(document.querySelector('table').textContent).toContain('2020-01-01');
    expect(document.querySelector('table').textContent).not.toContain('not-a-date');
});

const resizeHandle = () => document.getElementById('benchmark-detail-resize');
const activeWidth = () => document.documentElement.style.getPropertyValue('--bw-detail-width');
function pointer(target, type, x, id = 1) {
    const event = new MouseEvent(type, { clientX: x, button: 0, bubbles: true, cancelable: true });
    Object.defineProperties(event, { pointerId: { value: id }, isPrimary: { value: true } });
    target.dispatchEvent(event);
}
function resizeKey(key, shiftKey = false) {
    resizeHandle().dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
}
function rebootDetail() {
    BW.BenchmarkDetail.destroy();
    document.body.innerHTML = '<main id="table-shell"></main>' + template;
    window.eval(fs.readFileSync(path.join(__dirname, '../app/static/js/vendor/d3.v7.9.0.min.js'), 'utf8'));
    window.eval(fs.readFileSync(path.join(__dirname, '../app/static/js/core/visuals.js'), 'utf8'));
    window.eval(script); BW.BenchmarkDetail.init();
}
function customDates(start, end) {
    click('Custom');
    document.getElementById('benchmark-chart-start').value = start;
    document.getElementById('benchmark-chart-end').value = end;
    document.querySelector('.benchmark-detail-date-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

test('left-edge drag widens the panel without rebuilding chart or losing the selected observation', async () => {
    window.innerWidth = 1920;
    await BW.BenchmarkDetail.open('gold');
    expect(activeWidth()).toBe('560px');
    const chart = document.querySelector('.benchmark-detail-plot');
    const input = document.getElementById('benchmark-detail-observation');
    input.value = '0'; input.dispatchEvent(new Event('input'));
    pointer(resizeHandle(), 'pointerdown', 880);
    pointer(document, 'pointermove', 680);
    expect(activeWidth()).toBe('760px');
    expect(document.querySelector('.benchmark-detail-plot')).toBe(chart);
    expect(input.value).toBe('0');
    pointer(document, 'pointerup', 680);
    expect(document.body.classList.contains('bw-detail-resizing')).toBe(false);
    expect(JSON.parse(localStorage.getItem('bw.detail.widths.v1'))).toEqual({ version: 1, detail: 760, compare: 720 });
    rebootDetail(); await BW.BenchmarkDetail.open('gold');
    expect(activeWidth()).toBe('760px');
});

test('keyboard separator controls clamp, expose their value, and keep comparison width separate', async () => {
    window.innerWidth = 1920;
    await BW.BenchmarkDetail.open('gold');
    const handle = resizeHandle();
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    resizeKey('ArrowLeft'); expect(activeWidth()).toBe('584px');
    resizeKey('ArrowRight', true); expect(activeWidth()).toBe('520px');
    resizeKey('End'); expect(activeWidth()).toBe('1068px');
    expect(handle.getAttribute('aria-valuenow')).toBe('1068');
    expect(handle.getAttribute('aria-valuemax')).toBe('1068');
    resizeKey('ArrowLeft'); expect(activeWidth()).toBe('1068px');
    resizeKey('Home'); expect(activeWidth()).toBe('360px');
    await BW.BenchmarkDetail.compare(['gold', 'copper']); expect(activeWidth()).toBe('720px');
    resizeKey('ArrowLeft'); expect(activeWidth()).toBe('744px');
    await BW.BenchmarkDetail.open('gold'); expect(activeWidth()).toBe('360px');
});

test('viewport changes clamp the remembered desktop width and keep mobile fullscreen without a resize tab stop', async () => {
    window.innerWidth = 1920;
    await BW.BenchmarkDetail.open('gold'); resizeKey('End'); expect(activeWidth()).toBe('1068px');
    window.innerWidth = 1280; window.dispatchEvent(new Event('resize')); expect(activeWidth()).toBe('428px');
    window.innerWidth = 390; window.dispatchEvent(new Event('resize'));
    expect(activeWidth()).toBe('390px'); expect(resizeHandle().hidden).toBe(true); expect(resizeHandle().tabIndex).toBe(-1);
    resizeKey('End'); expect(activeWidth()).toBe('390px');
    window.innerWidth = 1920; window.dispatchEvent(new Event('resize'));
    expect(activeWidth()).toBe('1068px'); expect(resizeHandle().hidden).toBe(false);
});

test('expanding navigation preserves list space without overwriting a preferred larger pane', async () => {
    window.innerWidth = 1920;
    await BW.BenchmarkDetail.open('gold'); resizeKey('End');
    window.innerWidth = 1440; window.dispatchEvent(new Event('resize'));
    expect(activeWidth()).toBe('588px');
    document.body.classList.add('bw-sidebar-collapsed');
    document.dispatchEvent(new CustomEvent('bw:sidebar-change'));
    expect(activeWidth()).toBe('720px');
    document.body.classList.remove('bw-sidebar-collapsed');
    document.dispatchEvent(new CustomEvent('bw:sidebar-change'));
    expect(activeWidth()).toBe('588px');
    window.innerWidth = 1920; window.dispatchEvent(new Event('resize'));
    expect(activeWidth()).toBe('1068px');
});

test('canceling a drag restores the width and closing mid-drag releases resizing state', async () => {
    await BW.BenchmarkDetail.open('gold');
    pointer(resizeHandle(), 'pointerdown', 880); pointer(document, 'pointermove', 600);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(activeWidth()).toBe('560px'); expect(document.getElementById('benchmark-detail').hidden).toBe(false);
    pointer(resizeHandle(), 'pointerdown', 880); pointer(document, 'pointermove', 600);
    pointer(document, 'pointercancel', 600); expect(activeWidth()).toBe('560px');
    pointer(resizeHandle(), 'pointerdown', 880); BW.BenchmarkDetail.close();
    expect(document.body.classList.contains('bw-detail-resizing')).toBe(false);
    pointer(document, 'pointermove', 500); expect(activeWidth()).toBe('');
});

test('malformed width preferences and blocked storage never prevent resizing', async () => {
    localStorage.setItem('bw.detail.widths.v1', JSON.stringify({ version: 1, detail: 999999, compare: '700' }));
    rebootDetail(); await BW.BenchmarkDetail.open('gold'); expect(activeWidth()).toBe('560px');
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => resizeKey('ArrowLeft')).not.toThrow(); expect(activeWidth()).toBe('584px');
});

test('monthly presets use inclusive calendar dates including a leap-year month boundary', async () => {
    fetch.mockResolvedValue(response(sample('gold', { history: [
        {date:'2023-12-31',price:90}, {date:'2024-01-01',price:100},
        {date:'2024-02-28',price:105}, {date:'2024-02-29',price:110}, {date:'2024-03-31',price:120}
    ] })));
    await BW.BenchmarkDetail.open('gold'); click('1M');
    let table = document.querySelector('.benchmark-detail-table');
    expect(table.textContent).toContain('2024-02-29'); expect(table.textContent).not.toContain('2024-02-28');
    click('YTD'); table = document.querySelector('.benchmark-detail-table');
    expect(table.textContent).toContain('2024-01-01'); expect(table.textContent).not.toContain('2023-12-31');
    expect(document.querySelectorAll('[data-detail-range]')).toHaveLength(8);
});

test('custom dates reject reversed or empty values and preserve the displayed range', async () => {
    await BW.BenchmarkDetail.open('gold');
    const before = document.querySelector('.benchmark-detail-table').textContent;
    customDates('2025-05-02', '2025-04-01');
    expect(document.getElementById('benchmark-chart-date-error').textContent).toContain('on or before');
    expect(document.getElementById('benchmark-chart-start').getAttribute('aria-invalid')).toBe('true');
    expect(document.querySelector('[data-detail-range="1Y"]').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.benchmark-detail-table').textContent).toBe(before);
    customDates('', '2025-04-01');
    expect(document.getElementById('benchmark-chart-date-error').textContent).toContain('valid start and end');
});

test('custom window includes both endpoints, handles a single observation, and clearly shows an empty interval', async () => {
    await BW.BenchmarkDetail.open('gold');
    customDates('2025-04-01', '2025-05-01');
    expect(document.querySelectorAll('.benchmark-detail-table tbody tr')).toHaveLength(2);
    expect(document.querySelector('[data-detail-range="CUSTOM"]').getAttribute('aria-pressed')).toBe('true');
    customDates('2025-05-01', '2025-05-01');
    expect(document.querySelectorAll('.benchmark-detail-table tbody tr')).toHaveLength(1);
    expect(document.getElementById('benchmark-detail-observation').disabled).toBe(true);
    customDates('2025-04-02', '2025-04-30');
    expect(document.querySelector('.benchmark-detail-empty').textContent).toContain('No usable observations');
    expect(document.querySelectorAll('.benchmark-detail-table tbody tr')).toHaveLength(0);
    expect(document.getElementById('benchmark-detail-observation')).toBeNull();
});

test('area display preserves source gaps, table expansion and observation focus; hidden dots retain hover values', async () => {
    fetch.mockResolvedValue(response(sample('gold', { history: [
        {date:'2025-01-01',price:100}, {date:'2025-02-01',price:110}, {date:'2025-03-01',price:null},
        {date:'2025-04-01',price:120}, {date:'2025-05-01',price:125}
    ] })));
    await BW.BenchmarkDetail.open('gold');
    document.querySelector('.benchmark-detail-observations').open = true;
    const input = document.getElementById('benchmark-detail-observation'); input.value = '0'; input.dispatchEvent(new Event('input'));
    const select = document.getElementById('benchmark-chart-style'); select.value = 'area'; select.dispatchEvent(new Event('change'));
    expect(document.querySelectorAll('.benchmark-detail-area')).toHaveLength(2);
    expect(document.querySelector('.benchmark-detail-line').getAttribute('d').match(/M/g)).toHaveLength(2);
    expect(document.querySelector('.benchmark-detail-observations').open).toBe(true);
    expect(document.getElementById('benchmark-detail-observation').getAttribute('aria-valuetext')).toContain('2025-01-01');
    expect(document.activeElement.id).toBe('benchmark-chart-style');
    const dots = document.getElementById('benchmark-chart-dots'); dots.checked = false; dots.dispatchEvent(new Event('change'));
    expect(document.querySelector('.benchmark-detail-observation-dot').getAttribute('fill')).toBe('transparent');
    expect(document.querySelector('.benchmark-detail-observation-dot title').textContent).toContain('2025-01-01 · 100.00');
    expect(JSON.parse(localStorage.getItem('bw.detail.chart.v1'))).toEqual({version:1,style:'area',dots:false});
    rebootDetail(); await BW.BenchmarkDetail.open('gold');
    expect(document.getElementById('benchmark-chart-style').value).toBe('area');
    expect(document.getElementById('benchmark-chart-dots').checked).toBe(false);
});

test('comparison custom dates retain each actual baseline and never add missing observations', async () => {
    fetch.mockImplementation(async url => response(url.endsWith('gold') ? sample('gold') : sample('copper', {
        history: [{date:'2025-04-15',price:50},{date:'2025-05-15',price:75}]
    })));
    await BW.BenchmarkDetail.compare(['gold','copper']); customDates('2025-04-10','2025-05-15');
    expect(document.querySelector('.benchmark-detail-legend').textContent).toContain('Baseline: 2025-05-01');
    expect(document.querySelector('.benchmark-detail-legend').textContent).toContain('Baseline: 2025-04-15');
    expect(document.querySelectorAll('.benchmark-detail-table tbody tr')).toHaveLength(3);
});


test('switching back to a preset refreshes the editable dates to match that range', async () => {
    await BW.BenchmarkDetail.open('gold'); customDates('2025-04-01', '2025-04-01'); click('1Y');
    expect(document.getElementById('benchmark-chart-start').value).toBe('2024-05-01');
    expect(document.getElementById('benchmark-chart-end').value).toBe('2025-05-01');
});

test('chart, keyboard and slider share one exact observation readout', async () => {
    await BW.BenchmarkDetail.open('gold');
    const svg = document.querySelector('.benchmark-detail-plot');
    const input = document.getElementById('benchmark-detail-observation');
    const readout = document.querySelector('.benchmark-detail-readout');
    expect(readout.textContent).toContain('Latest');
    svg.dispatchEvent(new KeyboardEvent('keydown', {key:'Home', bubbles:true}));
    expect(input.value).toBe('0');
    expect(readout.textContent).toContain('100.00');
    expect(readout.textContent).toContain('Selected');
    input.value = '1'; input.dispatchEvent(new Event('input'));
    expect(readout.textContent).toContain('200.00');
    expect(document.querySelector('.benchmark-detail-range-change').textContent).toContain('+100.00 (+100.00%)');
    expect(document.querySelector('.bw-d3-crosshair').getAttribute('x1')).toBe(document.querySelector('.bw-d3-focus circle').getAttribute('cx'));
    svg.dispatchEvent(new Event('pointerleave'));
    expect(readout.textContent).toContain('Latest');
    expect(document.querySelector('.bw-d3-crosshair').getAttribute('visibility')).toBe('hidden');
});

test.each([0,-10])('range readout keeps a nonpositive baseline absolute instead of inventing a percentage (%s)', async baseline => {
    fetch.mockResolvedValue(response(sample('gold', {history:[{date:'2025-04-01',price:baseline},{date:'2025-05-01',price:5}]})));
    await BW.BenchmarkDetail.open('gold');
    expect(document.querySelector('.benchmark-detail-range-change').textContent).not.toContain('%');
    expect(document.querySelector('.benchmark-detail-readout').textContent).not.toMatch(/NaN|Infinity/);
});
