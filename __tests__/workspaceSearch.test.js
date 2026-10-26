/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../app/static/js/components/workspace.js'), 'utf8')
    .replace("    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Workspace.init(), { once: true }); else Workspace.init();", '');

const stock = (ticker = 'AAPL', name = 'Apple Inc.') => ({
    id: 'stock-XNAS-' + ticker, kind: 'stock', name,
    description: ticker + ' · Historical stock observations', href: '/stocks/stock-XNAS-' + ticker,
});
const response = (results = [], unavailable = []) => ({ ok: true, json: async () => ({ results, unavailable }) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let workspace;

beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = `<button id="bw-search-trigger">Search workspace</button><span id="bw-search-shortcut"></span>
        <dialog id="bw-search-dialog"><button id="bw-search-close">Close search</button><input id="bw-global-query" maxlength="100">
        <p id="bw-search-status"></p><div id="bw-search-results"></div></dialog><div id="research-workspace"></div>`;
    window.BW = {};
    window.eval(source);
    workspace = window.BW.Workspace;
    workspace.catalogLoaded = true;
    global.fetch = jest.fn().mockResolvedValue(response());
});
afterEach(() => { workspace.endSearch(); jest.useRealTimers(); delete global.fetch; });

const search = async value => { workspace.setSearchQuery(value); await jest.advanceTimersByTimeAsync(225); };
const results = () => document.getElementById('bw-search-results');

test('empty search stays local, and typing debounces one bounded public request', async () => {
    workspace.beginSearch();
    await jest.advanceTimersByTimeAsync(500);
    expect(fetch).not.toHaveBeenCalled();
    workspace.setSearchQuery('A');
    await jest.advanceTimersByTimeAsync(200);
    workspace.setSearchQuery('AAPL');
    await jest.advanceTimersByTimeAsync(224);
    expect(fetch).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/workspace-search?q=AAPL', expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

test('a changed query aborts its request and ignores a late stale response', async () => {
    const old = deferred();
    fetch.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response([stock('MSFT', 'Microsoft')]));
    workspace.beginSearch();
    await search('Apple');
    const signal = fetch.mock.calls[0][1].signal;
    workspace.setSearchQuery('Microsoft');
    expect(signal.aborted).toBe(true);
    await jest.advanceTimersByTimeAsync(225);
    expect(workspace.publicSearch.results.map(item => item.name)).toEqual(['Microsoft']);
    old.resolve(response([stock()]));
    await jest.advanceTimersByTimeAsync(0);
    expect(workspace.publicSearch.query).toBe('Microsoft');
    expect(results().textContent).toContain('Microsoft');
    expect(results().textContent).not.toContain('Apple Inc.');
});

test('clear and dialog close cancel timers and active requests, then reopen without old results', async () => {
    const pending = deferred();
    fetch.mockReturnValue(pending.promise);
    const dialog = document.getElementById('bw-search-dialog');
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new Event('close')); };
    workspace.initSearch();
    document.getElementById('bw-search-trigger').click();
    workspace.setSearchQuery('Apple');
    workspace.setSearchQuery('');
    await jest.advanceTimersByTimeAsync(225);
    expect(fetch).not.toHaveBeenCalled();
    await search('AAPL');
    const signal = fetch.mock.calls[0][1].signal;
    document.getElementById('bw-search-close').click();
    expect(signal.aborted).toBe(true);
    expect(workspace.publicSearch).toMatchObject({ query: '', results: [], status: 'idle' });
    pending.resolve(response([stock()]));
    await jest.advanceTimersByTimeAsync(0);
    expect(workspace.publicSearch.results).toEqual([]);
    document.getElementById('bw-search-trigger').click();
    expect(document.getElementById('bw-global-query').value).toBe('');
    await jest.advanceTimersByTimeAsync(6000);
    expect(fetch).toHaveBeenCalledTimes(1);
});

test('the request deadline aborts once and exposes manual retry without automatic retries', async () => {
    fetch.mockReturnValue(new Promise(() => {}));
    workspace.beginSearch();
    await search('AAPL');
    const signal = fetch.mock.calls[0][1].signal;
    await jest.advanceTimersByTimeAsync(5000);
    expect(signal.aborted).toBe(true);
    expect(workspace.publicSearch.status).toBe('error');
    expect(results().textContent).toContain('Retry public search');
    expect(document.getElementById('bw-search-status').textContent).not.toContain('No results');
    await jest.advanceTimersByTimeAsync(20000);
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValueOnce(response([stock()]));
    results().querySelector('button').click();
    await jest.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(results().textContent).toContain('Apple Inc.');
});

test('malformed envelopes fail safely; unknown kinds and unsafe links are rejected', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [stock()] }) });
    workspace.beginSearch();
    await search('Apple');
    expect(workspace.publicSearch.status).toBe('error');
    const valid = stock('AAPL', '<img src=x onerror=alert(1)>');
    fetch.mockResolvedValueOnce(response([
        null, {}, { ...stock(), kind: 'unknown' }, { ...stock(), href: 'https://evil.example/stocks/stock-XNAS-AAPL' },
        { ...stock(), href: '//evil.example' }, { ...stock(), href: 'javascript:alert(1)' },
        { ...stock(), href: '/stocks/stock-XNAS-MSFT' }, { ...stock(), id: '../AAPL', href: '/stocks/../AAPL' },
        { ...stock(), name: '' }, { ...stock(), description: undefined }, valid, valid,
    ]));
    await search('Apple');
    expect(workspace.publicSearch.results).toHaveLength(1);
    expect(results().querySelector('a').getAttribute('href')).toBe('/stocks/stock-XNAS-AAPL');
    expect(results().querySelector('img')).toBeNull();
    expect(results().textContent).toContain('<img src=x onerror=alert(1)>');
});

test('only eight valid results per kind and forty overall are shown', async () => {
    const prefixes = { stock: '/stocks/', fx: '/exchange-rates/', company: '/companies/', dataset: '/data/', reference: '/reference/' };
    const items = [];
    for (let i = 0; i < 10; i += 1) {
        const ids = { stock: 'stock-XNAS-A' + i, fx: 'fx-USD-AA' + String.fromCharCode(65 + i), company: String(i + 1), dataset: 'worldbank_' + String(i).padStart(32, '0'), reference: 'ref_' + i };
        for (const kind of Object.keys(ids)) items.push({ id: ids[kind], kind, name: kind + i, description: 'Local data', href: prefixes[kind] + ids[kind] });
    }
    fetch.mockResolvedValue(response(items));
    workspace.beginSearch();
    await search('query');
    expect(workspace.publicSearch.results).toHaveLength(40);
    for (const kind of Object.keys(prefixes)) expect(workspace.publicSearch.results.filter(item => item.kind === kind)).toHaveLength(8);
    expect(results().querySelectorAll('a')).toHaveLength(40);
    expect(document.getElementById('bw-search-status').textContent).toBe('40 results shown');
});

test('query input removes controls and never sends more than one hundred characters', async () => {
    workspace.beginSearch();
    await search('\u0000\n' + 'A'.repeat(101) + '\u007f');
    const url = new URL(fetch.mock.calls[0][0], 'https://example.test');
    expect(url.searchParams.get('q')).toBe('A'.repeat(100));
    expect(workspace.publicSearch.query).toBe('A'.repeat(100));
});

test('public errors preserve usable local research and never send its private content', async () => {
    const entry = { id: 'private-1', title: 'Apple research', status: 'Draft', tags: ['internal'], notes: 'PRIVATE_NOTE_BODY_42' };
    const focusEntry = jest.fn();
    window.BW.ResearchWorkspace = { getSearchItems: () => [entry], focusEntry };
    workspace.catalog = [{ id: 'apple_index', name: 'Apple benchmark', category: 'index' }];
    fetch.mockRejectedValue(new Error('offline'));
    workspace.beginSearch();
    await search('Apple');
    expect(results().textContent).toContain('Apple benchmark');
    expect(results().textContent).toContain('Apple research');
    expect(document.getElementById('bw-search-status').textContent).toBe('2 results shown');
    expect(JSON.stringify(fetch.mock.calls)).not.toContain(entry.notes);
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('private-1');
    const dialog = document.getElementById('bw-search-dialog');
    dialog.close = jest.fn();
    [...results().querySelectorAll('button')].find(button => button.textContent.includes('Apple research')).click();
    expect(focusEntry).toHaveBeenCalledWith('private-1');
});

test('pending or unavailable sources do not display a false definitive empty state', async () => {
    const pending = deferred();
    fetch.mockReturnValueOnce(pending.promise);
    workspace.beginSearch();
    await search('missing');
    expect(document.getElementById('bw-search-status').textContent).toBe('Searching workspace…');
    expect(results().textContent).not.toContain('No matches');
    pending.resolve(response([], ['company', 'not-a-kind']));
    await jest.advanceTimersByTimeAsync(0);
    expect(workspace.publicSearch.unavailable).toEqual(['company']);
    expect(results().textContent).toContain('Retry public search');
    expect(results().textContent).not.toContain('No matches');
});

test('local visible result counts use the rendered cap and ordinary benchmark clicks retain detail handoff', () => {
    workspace.catalog = Array.from({ length: 35 }, (_, i) => ({ id: 'gold_' + i, name: 'Gold ' + i, category: 'metal' }));
    window.BW.BenchmarkDetail = { open: jest.fn() };
    document.getElementById('bw-search-dialog').close = jest.fn();
    workspace.beginSearch();
    workspace.setSearchQuery('gold');
    expect(document.getElementById('bw-search-status').textContent).toContain('30 results shown');
    expect(results().querySelectorAll('a')).toHaveLength(30);
    const link = results().querySelector('a');
    // Prevent jsdom's unsupported navigation after the application sees the modifier click.
    link.addEventListener('click', event => event.preventDefault(), { once: true });
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
    expect(window.BW.BenchmarkDetail.open).not.toHaveBeenCalled();
    link.click();
    expect(window.BW.BenchmarkDetail.open).toHaveBeenCalledWith('gold_0', document.getElementById('bw-search-trigger'));
    expect(workspace.searchActive).toBe(false);
});


test('clearing an active query aborts and discards even an ignored abort response', async () => {
    const pending = deferred();
    fetch.mockReturnValue(pending.promise);
    workspace.beginSearch();
    await search('AAPL');
    const signal = fetch.mock.calls[0][1].signal;
    workspace.setSearchQuery('');
    expect(signal.aborted).toBe(true);
    pending.resolve(response([stock()]));
    await jest.advanceTimersByTimeAsync(6000);
    expect(workspace.publicSearch).toMatchObject({ query: '', results: [], status: 'idle' });
    expect(fetch).toHaveBeenCalledTimes(1);
});

test('unicode queries remain valid URL input and cannot exceed the server character bound', async () => {
    workspace.beginSearch();
    await search('A'.repeat(99) + '😀' + '\uD800' + 'overflow');
    const url = new URL(fetch.mock.calls[0][0], 'https://example.test');
    expect(url.searchParams.get('q')).toBe('A'.repeat(99) + '😀');
    expect(Array.from(workspace.publicSearch.query)).toHaveLength(100);
});

test('a partial source failure keeps healthy public groups and offers retry', async () => {
    fetch.mockResolvedValue(response([stock()], ['company']));
    workspace.beginSearch();
    await search('Apple');
    expect(results().textContent).toContain('Stock histories');
    expect(results().textContent).toContain('Apple Inc.');
    expect(results().textContent).toContain('Retry public search');
    expect(document.getElementById('bw-search-status').textContent).toBe('1 result shown');
});
