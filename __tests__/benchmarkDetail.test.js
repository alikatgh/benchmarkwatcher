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
    document.body.innerHTML = '<main id="table-shell"><a href="/commodity/gold" data-benchmark-id="gold">Gold</a><button id="table-control">Filter</button></main>' + template;
    global.BW = {};
    window.matchMedia = jest.fn(() => ({ matches: false }));
    global.fetch = jest.fn(async url => response(sample(url.split('/').pop())));
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
    expect(tables[1].textContent).toContain('150.00');
    expect(tables[1].textContent).not.toContain('2025-04-01');
    expect(detail.querySelectorAll('svg circle')).toHaveLength(4);
});

test('compatible comparison can display absolute values and a zero baseline never becomes infinity', async () => {
    fetch.mockImplementation(async url => response(sample(url.split('/').pop(), { history: [{ date: '2025-04-01', price: 0 }, { date: '2025-05-01', price: 1 }] })));
    await BW.BenchmarkDetail.compare(['gold', 'copper']);
    const detail = document.getElementById('benchmark-detail');
    expect(detail.textContent).toContain('a positive baseline is required');
    expect(detail.querySelector('svg.benchmark-detail-plot')).toBeNull();
    expect(detail.querySelector('[data-detail-mode="absolute"]').disabled).toBe(false);
    click('Absolute values');
    expect(detail.querySelector('svg.benchmark-detail-plot')).toBeTruthy();
    expect(detail.innerHTML).not.toContain('Infinity');
});

test('comparison retains successful series when one request fails and enforces the four-series limit', async () => {
    fetch.mockImplementation(async url => url.endsWith('copper') ? { ok: false } : response(sample('gold')));
    await BW.BenchmarkDetail.compare(['gold', 'copper']);
    expect(document.querySelector('svg')).toBeTruthy();
    expect(document.getElementById('benchmark-detail-body').textContent).toContain('Retry unavailable series');
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
    expect(document.querySelector('svg path').getAttribute('d').match(/M/g)).toHaveLength(2);
    click('All');
    expect(document.querySelector('table').textContent).toContain('2020-01-01');
    expect(document.querySelector('table').textContent).not.toContain('not-a-date');
});
