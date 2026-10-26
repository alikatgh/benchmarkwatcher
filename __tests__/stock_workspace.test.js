/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const { TextEncoder, TextDecoder } = require('util');

const source = fs.readFileSync(path.join(__dirname, '../app/static/js/components/stock-workspace.js'), 'utf8');
const stocks = [
    { id: 'stock-XNAS-AAA', name: 'Alpha Corp', symbol: 'ZZZ' },
    { id: 'stock-XNAS-BBB', name: 'Beta Corp', symbol: 'AAA' },
    { id: 'stock-XNAS-CCC', name: 'Gamma Corp', symbol: 'MMM' },
];
const urlFor = id => '/stocks/' + id;
const panel = (id, extra = '') => `<section id="market-detail-panel" data-instrument-id="${id}" data-page-title="${id} · Saved history"><h1>${id}</h1><div id="gr-chart" tabindex="0"></div><h2 id="gr-table-heading">Observations</h2>${extra}</section>`;
const row = stock => `<li data-stock-id="${stock.id}" data-stock-name="${stock.name}" data-stock-symbol="${stock.symbol}" data-stock-source="saved" data-stock-search="${stock.name} ${stock.symbol} saved USD"><button type="button" data-stock-star="${stock.id}"><span>☆</span></button><a data-stock-link href="${urlFor(stock.id)}">${stock.name}</a></li>`;
const fixture = (catalog = stocks, selected = catalog[0]?.id) => `<div id="stock-workspace" data-stock-source=""><details id="stock-navigator" open><summary><strong data-stock-current-name></strong></summary><form><input id="stock-search" maxlength="100"></form><button type="button" data-stock-view="all">All</button><button type="button" data-stock-view="watchlist">Watchlist</button><button type="button" data-stock-view="recent">Recent</button><select id="stock-sort"><option value="name">Company</option><option value="symbol">Symbol</option></select><span id="stock-count"></span><div class="stock-list-scroll"><ul id="stock-list">${catalog.map(row).join('')}</ul><div id="stock-empty" hidden><h2 id="stock-empty-title"></h2><p id="stock-empty-description"></p><a data-stock-clear href="/stocks">Show all</a></div></div></details><strong data-stock-current-symbol></strong><span id="stock-position"></span><button id="stock-current-star" type="button"><span>☆</span></button><button id="stock-previous" type="button"></button><button id="stock-next" type="button"></button><p id="stock-navigation-status"></p><button id="stock-retry" type="button" hidden>Retry</button><a id="stock-open-page" hidden>Open company page</a><div id="stock-detail-host" tabindex="-1">${selected ? panel(selected) : ''}</div></div>`;
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
};
const response = (html, options = {}) => ({
    ok: options.ok ?? true,
    url: options.url || '',
    headers: { get: key => key === 'content-type' ? (options.type || 'text/html; charset=utf-8') : key === 'content-length' ? (options.length || null) : null },
    text: jest.fn().mockResolvedValue(html),
    ...(options.body ? { body: options.body } : {}),
});
const flush = () => jest.advanceTimersByTimeAsync(0);
const $ = selector => document.querySelector(selector);
const selected = () => $('#market-detail-panel')?.dataset.instrumentId;
const link = id => $(`[data-stock-id="${id}"] [data-stock-link]`);
const clickStock = id => link(id).click();
const visible = () => [...document.querySelectorAll('[data-stock-id]')].filter(item => !item.hidden).map(item => item.dataset.stockId);
const input = value => { $('#stock-search').value = value; $('#stock-search').dispatchEvent(new Event('input', { bubbles: true })); };
const chooseView = view => $(`[data-stock-view="${view}"]`).click();
let media, charts, mountOrder;

function boot({ catalog = stocks, selectedId = catalog[0]?.id, mobile = false } = {}) {
    document.body.innerHTML = fixture(catalog, selectedId);
    media.matches = !mobile;
    window.BW = { ReferencePage: { mount: jest.fn(node => {
        const instance = { destroy: jest.fn(() => mountOrder.push('destroy:' + instance.id)), getState: jest.fn(() => instance.state), id: node.querySelector('#market-detail-panel')?.dataset.instrumentId || node.dataset.instrumentId };
        charts.push(instance);
        mountOrder.push('mount:' + instance.id);
        return instance;
    }) } };
    window.eval(source);
    return window.BW.StockWorkspace;
}

beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    history.replaceState(null, '', urlFor(stocks[0].id));
    document.title = 'Alpha Corp';
    charts = []; mountOrder = [];
    media = new EventTarget(); media.matches = true;
    window.matchMedia = jest.fn(() => media);
    window.scrollTo = jest.fn();
    Element.prototype.scrollIntoView = jest.fn();
    global.TextEncoder = TextEncoder;
    global.TextDecoder = TextDecoder;
    global.fetch = jest.fn(url => Promise.resolve(response(panel(new URL(url).pathname.split('/').pop()))));
});

afterEach(() => {
    window.BW?.StockWorkspace?.destroy();
    delete window.BW;
    jest.restoreAllMocks();
    jest.useRealTimers();
    delete global.fetch;
});

test('one click replaces only the detail, preserving the sidebar identity, search, and scroll', async () => {
    boot();
    const sidebar = $('#stock-navigator'), list = $('#stock-list'), scroller = $('.stock-list-scroll');
    const originalRows = [...list.children];
    scroller.scrollTop = 320;
    input('Corp');
    clickStock(stocks[1].id);
    expect($('#stock-detail-host').getAttribute('aria-busy')).toBe('true');
    await flush();
    expect(selected()).toBe(stocks[1].id);
    expect($('#stock-navigator')).toBe(sidebar);
    expect($('#stock-list')).toBe(list);
    expect([...list.children]).toEqual(originalRows);
    expect(scroller.scrollTop).toBe(320);
    expect($('#stock-search').value).toBe('Corp');
    expect(link(stocks[1].id).getAttribute('aria-current')).toBe('page');
    expect(link(stocks[0].id).hasAttribute('aria-current')).toBe(false);
    expect(location.pathname).toBe(urlFor(stocks[1].id));
    expect(location.search).toBe('?q=Corp');
    expect(document.title).toBe(stocks[1].id + ' · Saved history');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(location.href, expect.objectContaining({
        headers: { 'X-BW-Fragment': 'stock-detail', Accept: 'text/html' },
        credentials: 'same-origin', signal: expect.any(AbortSignal),
    }));
});

test('each committed chart is destroyed once after its replacement mounts with only portable state', async () => {
    boot();
    charts[0].state = { range: 'custom', custom: { from: '2023-01-01', to: '2024-01-01' }, chartStyle: 'step', showDots: false, settingsOpen: true, exactDatesOpen: true, inspectedDate: '2023-05-01', series: Array(100).fill(5), observer: {} };
    clickStock(stocks[1].id); await flush();
    expect(mountOrder).toEqual(['mount:' + stocks[0].id, 'mount:' + stocks[1].id, 'destroy:' + stocks[0].id]);
    expect(window.BW.ReferencePage.mount.mock.calls[1][1]).toEqual({ state: { range: 'custom', custom: { from: '2023-01-01', to: '2024-01-01' }, chartStyle: 'step', showDots: false, settingsOpen: true, exactDatesOpen: true, inspectedDate: null } });
    expect(charts[0].destroy).toHaveBeenCalledTimes(1);
    charts[1].state = { range: '1Y', custom: {}, chartStyle: 'line', showDots: true, settingsOpen: false, exactDatesOpen: false, inspectedDate: '2024-02-01' };
    clickStock(stocks[1].id); await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(window.BW.ReferencePage.mount.mock.calls[2][1].state.inspectedDate).toBe('2024-02-01');
    expect(charts[1].destroy).toHaveBeenCalledTimes(1);
});

test('the latest selection wins even when the aborted older request resolves last', async () => {
    boot();
    const old = deferred();
    fetch.mockReturnValueOnce(old.promise);
    clickStock(stocks[1].id);
    const oldSignal = fetch.mock.calls[0][1].signal;
    clickStock(stocks[2].id); await flush();
    expect(oldSignal.aborted).toBe(true);
    expect(selected()).toBe(stocks[2].id);
    old.resolve(response(panel(stocks[1].id))); await flush();
    expect(selected()).toBe(stocks[2].id);
    expect(location.pathname).toBe(urlFor(stocks[2].id));
    expect(window.BW.ReferencePage.mount).toHaveBeenCalledTimes(2);
    expect($('#stock-retry').hidden).toBe(true);
    expect($('#stock-detail-host').hasAttribute('aria-busy')).toBe(false);
});

test('a selection that finishes after list controls change commits the latest query, view, and sort to its URL', async () => {
    boot();
    const pending = deferred();
    fetch.mockReturnValueOnce(pending.promise);
    clickStock(stocks[1].id);
    input('Beta'); input('Corp');
    $(`[data-stock-star="${stocks[1].id}"]`).click();
    chooseView('watchlist');
    $('#stock-sort').value = 'symbol';
    $('#stock-sort').dispatchEvent(new Event('change', { bubbles: true }));
    expect(selected()).toBe(stocks[0].id);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(fetch.mock.calls[0][0]).search).toBe('');
    pending.resolve(response(panel(stocks[1].id))); await flush();
    expect(selected()).toBe(stocks[1].id);
    expect(visible()).toEqual([stocks[1].id]);
    const committed = new URL(location.href);
    expect(committed.pathname).toBe(urlFor(stocks[1].id));
    expect(Object.fromEntries(committed.searchParams)).toEqual({ q: 'Corp', view: 'watchlist', sort: 'symbol' });
    expect(history.state.bwStocks).toEqual(expect.objectContaining({ id: stocks[1].id, query: 'Corp', view: 'watchlist', sort: 'symbol' }));
    expect($('#stock-search').value).toBe('Corp');
    expect($('#stock-sort').value).toBe('symbol');
    expect(fetch).toHaveBeenCalledTimes(1);
});

test('failed replacement mounts preserve the original chart handle and handlers without committing the selection', async () => {
    boot();
    const host = $('#stock-detail-host'), scroller = $('.stock-list-scroll');
    const retainedNote = document.createElement('p'); retainedNote.textContent = 'Retained panel sibling';
    host.appendChild(retainedNote);
    const originalNodes = [...host.childNodes], originalPanel = $('#market-detail-panel');
    const originalURL = location.href, originalTitle = document.title;
    host.scrollTop = 425; scroller.scrollTop = 230;
    const originalState = { range: 'custom', custom: { from: '2022-01-01', to: '2024-01-01' }, chartStyle: 'step', showDots: false, settingsOpen: true, exactDatesOpen: true, inspectedDate: '2023-02-01' };
    charts[0].state = { ...originalState, series: ['not portable'] };
    const originalChartNode = $('#gr-chart'), chartKeyHandler = jest.fn();
    originalChartNode.addEventListener('keydown', chartKeyHandler);
    charts[0].destroy.mockImplementation(() => {
        mountOrder.push('destroy:' + stocks[0].id);
        originalChartNode.removeEventListener('keydown', chartKeyHandler);
    });
    const mount = window.BW.ReferencePage.mount, normalMount = mount.getMockImplementation();
    // Every replacement attempt fails until the renderer is explicitly restored.
    mount.mockImplementation(node => {
        expect(node).not.toBe(host);
        expect(node.dataset.instrumentId).toBe(stocks[1].id);
        host.scrollTop = 0;
        throw new Error('Chart renderer unavailable');
    });
    clickStock(stocks[1].id); await flush();
    expect([...host.childNodes]).toHaveLength(originalNodes.length);
    originalNodes.forEach((node, i) => expect(host.childNodes[i]).toBe(node));
    expect($('#market-detail-panel')).toBe(originalPanel);
    expect(retainedNote.isConnected).toBe(true);
    expect(selected()).toBe(stocks[0].id);
    expect(location.href).toBe(originalURL);
    expect(document.title).toBe(originalTitle);
    expect(host.scrollTop).toBe(425); expect(scroller.scrollTop).toBe(230);
    expect(link(stocks[0].id).getAttribute('aria-current')).toBe('page');
    expect(link(stocks[1].id).hasAttribute('aria-current')).toBe(false);
    expect(charts[0].destroy).not.toHaveBeenCalled();
    expect(charts).toHaveLength(1);
    expect(mount).toHaveBeenCalledTimes(2);
    originalChartNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(chartKeyHandler).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('bw.stock.recent.v1'))).toEqual([stocks[0].id]);
    expect($('#stock-detail-host').hasAttribute('aria-busy')).toBe(false);
    expect($('#stock-retry').hidden).toBe(false);
    expect($('#stock-navigation-status').textContent).toContain('Still showing Alpha Corp');
    charts[0].state = { ...originalState, chartStyle: 'line' };
    $('#stock-retry').click(); await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mount).toHaveBeenCalledTimes(3);
    expect(mount.mock.calls[2][1].state).toEqual({ ...originalState, chartStyle: 'line', inspectedDate: null });
    expect(charts[0].destroy).not.toHaveBeenCalled();
    expect(charts).toHaveLength(1);
    expect($('#market-detail-panel')).toBe(originalPanel);
    expect(location.href).toBe(originalURL);
    expect(document.title).toBe(originalTitle);
    expect(host.scrollTop).toBe(425);
    originalChartNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(chartKeyHandler).toHaveBeenCalledTimes(2);
    mount.mockImplementation(normalMount);
    $('#stock-retry').click(); await flush();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(selected()).toBe(stocks[1].id);
    expect(charts[0].destroy).toHaveBeenCalledTimes(1);
    expect(charts[1].destroy).not.toHaveBeenCalled();
    expect(mount.mock.calls[3][1].state).toEqual({ ...originalState, chartStyle: 'line', inspectedDate: null });
    originalChartNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(chartKeyHandler).toHaveBeenCalledTimes(2);
    expect($('#stock-retry').hidden).toBe(true);
});

test.each([
    ['network error', () => Promise.reject(new Error('offline'))],
    ['HTTP failure', () => Promise.resolve(response('unavailable', { ok: false }))],
    ['wrong response type', () => Promise.resolve(response('{}', { type: 'application/json' }))],
    ['cross-origin response', () => Promise.resolve(response(panel(stocks[1].id), { url: 'https://elsewhere.invalid/stocks/' + stocks[1].id }))],
    ['wrong company', () => Promise.resolve(response(panel(stocks[2].id)))],
    ['missing title', () => Promise.resolve(response(`<section id="market-detail-panel" data-instrument-id="${stocks[1].id}"></section>`))],
    ['duplicate panel', () => Promise.resolve(response(panel(stocks[1].id) + panel(stocks[1].id)))],
    ['oversized content length', () => Promise.resolve(response(panel(stocks[1].id), { length: String(1024 * 1024 + 1) }))],
    ['oversized response body', () => Promise.resolve(response(panel(stocks[1].id, 'x'.repeat(1024 * 1024))))],
])('%s preserves the current panel and URL and provides a manual retry', async (_name, failResponse) => {
    boot();
    const originalPanel = $('#market-detail-panel'), originalURL = location.href;
    fetch.mockImplementationOnce(failResponse);
    clickStock(stocks[1].id); await flush();
    expect($('#market-detail-panel')).toBe(originalPanel);
    expect(location.href).toBe(originalURL);
    expect(charts[0].destroy).not.toHaveBeenCalled();
    expect($('#stock-navigation-status').dataset.error).toBe('true');
    expect($('#stock-navigation-status').textContent).toContain('Still showing Alpha Corp');
    expect($('#stock-retry').hidden).toBe(false);
    expect($('#stock-open-page').href).toBe(new URL(urlFor(stocks[1].id), location.origin).href);
    expect($('#stock-detail-host').hasAttribute('aria-busy')).toBe(false);
    await jest.advanceTimersByTimeAsync(30000);
    expect(fetch).toHaveBeenCalledTimes(1);
    $('#stock-retry').click(); await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(selected()).toBe(stocks[1].id);
    expect($('#stock-retry').hidden).toBe(true);
    expect($('#stock-navigation-status').textContent).toBe('');
});

test('an aborted deadline preserves the previous company and allows one explicit retry', async () => {
    boot();
    fetch.mockImplementationOnce((_url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    clickStock(stocks[1].id);
    await jest.advanceTimersByTimeAsync(7999);
    expect($('#stock-retry').hidden).toBe(true);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(selected()).toBe(stocks[0].id);
    expect($('#stock-retry').hidden).toBe(false);
    expect(charts[0].destroy).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(30000);
    expect(fetch).toHaveBeenCalledTimes(1);
    $('#stock-retry').click(); await flush();
    expect(selected()).toBe(stocks[1].id);
});

test('the deadline releases busy state even when a transport ignores abort and never settles', async () => {
    boot();
    const stalled = deferred();
    fetch.mockReturnValueOnce(stalled.promise);
    clickStock(stocks[1].id);
    await jest.advanceTimersByTimeAsync(8000);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect($('#stock-detail-host').hasAttribute('aria-busy')).toBe(false);
    expect($('#stock-retry').hidden).toBe(false);
    expect(selected()).toBe(stocks[0].id);
    $('#stock-retry').click(); await flush();
    expect(selected()).toBe(stocks[1].id);
    stalled.resolve(response(panel(stocks[1].id, '<p>stale response</p>'))); await flush();
    expect($('#market-detail-panel').textContent).not.toContain('stale response');
    expect(window.BW.ReferencePage.mount).toHaveBeenCalledTimes(2);
});

test('a streamed response stops reading and cancels its reader as soon as the byte limit is exceeded', async () => {
    boot();
    const reader = { read: jest.fn().mockResolvedValueOnce({ done: false, value: new Uint8Array(1024 * 1024 + 1) }), cancel: jest.fn().mockResolvedValue(), releaseLock: jest.fn() };
    fetch.mockResolvedValueOnce(response('', { body: { getReader: () => reader } }));
    clickStock(stocks[1].id); await flush();
    expect(reader.read).toHaveBeenCalledTimes(1);
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
    expect(selected()).toBe(stocks[0].id);
    expect($('#stock-retry').hidden).toBe(false);
});

test('filter, view, and sort stay local; previous and next use the visible order', async () => {
    boot();
    input('Gamma');
    expect(visible()).toEqual([stocks[2].id]);
    expect($('#stock-position').textContent).toBe('Not in this view');
    expect(fetch).not.toHaveBeenCalled();
    input('missing');
    expect($('#stock-empty').hidden).toBe(false);
    expect($('#stock-empty-title').textContent).toBe('No matching companies');
    $('[data-stock-clear]').click();
    $('#stock-sort').value = 'symbol';
    $('#stock-sort').dispatchEvent(new Event('change', { bubbles: true }));
    expect(visible()).toEqual([stocks[1].id, stocks[2].id, stocks[0].id]);
    expect($('#stock-next').disabled).toBe(true);
    expect($('#stock-previous').disabled).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    $('#stock-previous').click(); await flush();
    expect(selected()).toBe(stocks[2].id);
    $('#stock-next').click(); await flush();
    expect(selected()).toBe(stocks[0].id);
    expect(new URL(location.href).searchParams.get('sort')).toBe('symbol');
    expect(fetch.mock.calls.every(([url]) => new URL(url).origin === location.origin && /^\/stocks\/stock-XNAS-/.test(new URL(url).pathname))).toBe(true);
});

test('local watchlist and recent selections persist and view changes never fetch', async () => {
    boot();
    $(`[data-stock-star="${stocks[1].id}"]`).click();
    expect(JSON.parse(localStorage.getItem('bw.stock.watchlist.v1'))).toEqual([stocks[1].id]);
    chooseView('watchlist');
    expect(visible()).toEqual([stocks[1].id]);
    expect(fetch).not.toHaveBeenCalled();
    clickStock(stocks[1].id); await flush();
    $('#stock-current-star').click();
    expect(visible()).toEqual([]);
    expect($('#stock-empty-title').textContent).toBe('Your watchlist is empty');
    expect(JSON.parse(localStorage.getItem('bw.stock.watchlist.v1'))).toEqual([]);
    chooseView('recent');
    expect(visible()).toEqual([stocks[1].id, stocks[0].id]);
    expect(JSON.parse(localStorage.getItem('bw.stock.recent.v1'))).toEqual([stocks[1].id, stocks[0].id]);
    expect(fetch).toHaveBeenCalledTimes(1);
});

test('Recent next and previous traverse a stable list while stored recency updates, including after Back', async () => {
    boot();
    clickStock(stocks[1].id); await flush();
    clickStock(stocks[2].id); await flush();
    chooseView('recent');
    const order = [stocks[2].id, stocks[1].id, stocks[0].id];
    expect(visible()).toEqual(order);
    expect($('#stock-position').textContent).toBe('1 of 3');
    $('#stock-next').click(); await flush();
    expect(selected()).toBe(stocks[1].id);
    expect(visible()).toEqual(order);
    expect($('#stock-position').textContent).toBe('2 of 3');
    const middle = { state: structuredCloneForTest(history.state), url: location.href };
    $('#stock-next').click(); await flush();
    expect(selected()).toBe(stocks[0].id);
    expect(visible()).toEqual(order);
    expect($('#stock-next').disabled).toBe(true);
    expect(JSON.parse(localStorage.getItem('bw.stock.recent.v1'))).toEqual([stocks[0].id, stocks[1].id, stocks[2].id]);
    $('#stock-previous').click(); await flush();
    expect(selected()).toBe(stocks[1].id);
    expect(visible()).toEqual(order);
    history.replaceState(middle.state, '', middle.url);
    window.dispatchEvent(new PopStateEvent('popstate', { state: middle.state })); await flush();
    expect(visible()).toEqual(order);
    $('#stock-next').click(); await flush();
    expect(selected()).toBe(stocks[0].id);
    chooseView('all'); chooseView('recent');
    expect(visible()).toEqual([stocks[0].id, stocks[1].id, stocks[2].id]);
});

test('a direct Recent entry includes its selected company even when local history starts empty', () => {
    history.replaceState(null, '', urlFor(stocks[0].id) + '?view=recent');
    boot();
    expect(selected()).toBe(stocks[0].id);
    expect(visible()).toEqual([stocks[0].id]);
    expect($('[data-stock-view="recent"]').getAttribute('aria-pressed')).toBe('true');
    expect($('#stock-position').textContent).toBe('1 of 1');
    expect(JSON.parse(localStorage.getItem('bw.stock.recent.v1'))).toEqual([stocks[0].id]);
    expect(fetch).not.toHaveBeenCalled();
});

test('the empty search recovery restores all companies and focus without fetching a report', () => {
    boot();
    input('No matching company');
    expect(visible()).toEqual([]);
    expect($('#stock-empty').hidden).toBe(false);
    $('#stock-empty [data-stock-clear]').click();
    expect(visible()).toEqual(stocks.map(stock => stock.id));
    expect($('#stock-search').value).toBe('');
    expect($('#stock-empty').hidden).toBe(true);
    expect(document.activeElement).toBe($('#stock-search'));
    expect(fetch).not.toHaveBeenCalled();
});

test.each(['not json', '{"unexpected":true}', '[null,5,"unknown","stock-XNAS-BBB","stock-XNAS-BBB"]'])('corrupt or untrusted stored lists are normalized (%s)', stored => {
    localStorage.setItem('bw.stock.watchlist.v1', stored);
    localStorage.setItem('bw.stock.recent.v1', stored);
    boot();
    chooseView('watchlist');
    expect(visible()).toEqual(stored.startsWith('[null') ? [stocks[1].id] : []);
    chooseView('recent');
    expect(visible()).toEqual(stored.startsWith('[null') ? [stocks[0].id, stocks[1].id] : [stocks[0].id]);
    expect(fetch).not.toHaveBeenCalled();
});

test('blocked local storage leaves navigation and in-memory watchlist usable', async () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    expect(() => boot()).not.toThrow();
    $(`[data-stock-star="${stocks[1].id}"]`).click();
    chooseView('watchlist');
    expect(visible()).toEqual([stocks[1].id]);
    clickStock(stocks[1].id); await flush();
    expect(selected()).toBe(stocks[1].id);
    expect($('#stock-current-star').getAttribute('aria-pressed')).toBe('true');
});

test('stored watchlist and recent reads are bounded and recent writes retain only twelve unique known companies', async () => {
    const catalog = Array.from({ length: 120 }, (_, i) => ({ id: 'stock-XNAS-T' + i, name: 'Company ' + String(i).padStart(3, '0'), symbol: 'T' + i }));
    localStorage.setItem('bw.stock.watchlist.v1', JSON.stringify(catalog.map(item => item.id)));
    localStorage.setItem('bw.stock.recent.v1', JSON.stringify(catalog.slice(0, 20).map(item => item.id)));
    boot({ catalog });
    chooseView('watchlist');
    expect(visible()).toHaveLength(100);
    $(`[data-stock-star="${catalog[110].id}"]`).click();
    expect(JSON.parse(localStorage.getItem('bw.stock.watchlist.v1'))).toHaveLength(100);
    expect($(`[data-stock-star="${catalog[110].id}"]`).getAttribute('aria-pressed')).toBe('false');
    chooseView('recent');
    expect(visible()).toHaveLength(12);
    chooseView('all');
    clickStock(catalog[20].id); await flush();
    const recent = JSON.parse(localStorage.getItem('bw.stock.recent.v1'));
    expect(recent).toHaveLength(12);
    expect(recent[0]).toBe(catalog[20].id);
    expect(new Set(recent).size).toBe(12);
});

test('list keyboard selection moves through the visible order without hijacking chart arrow keys', async () => {
    boot();
    const chart = $('#gr-chart');
    chart.focus();
    const chartArrow = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    expect(chart.dispatchEvent(chartArrow)).toBe(true);
    expect(chartArrow.defaultPrevented).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    const first = link(stocks[0].id);
    const listArrow = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    first.dispatchEvent(listArrow); await flush();
    expect(listArrow.defaultPrevented).toBe(true);
    expect(selected()).toBe(stocks[1].id);
    expect(document.activeElement).toBe(link(stocks[1].id));
    link(stocks[1].id).dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })); await flush();
    expect(selected()).toBe(stocks[2].id);
    link(stocks[2].id).dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })); await flush();
    expect(selected()).toBe(stocks[0].id);
});

test('Back and Forward restore company, list controls, and both saved scroll positions', async () => {
    boot();
    const scroller = $('.stock-list-scroll'), host = $('#stock-detail-host');
    scroller.scrollTop = 145; host.scrollTop = 310;
    scroller.dispatchEvent(new Event('scroll'));
    await jest.advanceTimersByTimeAsync(20);
    const back = { state: structuredCloneForTest(history.state), url: location.href };
    clickStock(stocks[1].id); await flush();
    input('Corp');
    $('#stock-sort').value = 'symbol'; $('#stock-sort').dispatchEvent(new Event('change'));
    scroller.scrollTop = 420; host.scrollTop = 800;
    host.dispatchEvent(new Event('scroll'));
    await jest.advanceTimersByTimeAsync(20);
    const forward = { state: structuredCloneForTest(history.state), url: location.href };
    history.replaceState(back.state, '', back.url);
    window.dispatchEvent(new PopStateEvent('popstate', { state: back.state })); await flush();
    expect(selected()).toBe(stocks[0].id);
    expect($('#stock-search').value).toBe('');
    expect($('#stock-sort').value).toBe('name');
    expect(scroller.scrollTop).toBe(145); expect(host.scrollTop).toBe(310);
    history.replaceState(forward.state, '', forward.url);
    window.dispatchEvent(new PopStateEvent('popstate', { state: forward.state })); await flush();
    expect(selected()).toBe(stocks[1].id);
    expect($('#stock-search').value).toBe('Corp');
    expect($('#stock-sort').value).toBe('symbol');
    expect(scroller.scrollTop).toBe(420); expect(host.scrollTop).toBe(800);
    expect(location.href).toBe(forward.url);
});

function structuredCloneForTest(value) { return JSON.parse(JSON.stringify(value)); }

test('returning to the current history entry cancels an unfinished selection without replacing its chart', async () => {
    boot();
    const saved = structuredCloneForTest(history.state), old = deferred();
    fetch.mockReturnValueOnce(old.promise);
    clickStock(stocks[1].id);
    window.dispatchEvent(new PopStateEvent('popstate', { state: saved }));
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect($('#stock-detail-host').hasAttribute('aria-busy')).toBe(false);
    old.resolve(response(panel(stocks[1].id))); await flush();
    expect(selected()).toBe(stocks[0].id);
    expect(window.BW.ReferencePage.mount).toHaveBeenCalledTimes(1);
    expect(charts[0].destroy).not.toHaveBeenCalled();
});

test('mobile picker starts closed for a selected company and closes and focuses detail after selection', async () => {
    boot({ mobile: true });
    const picker = $('#stock-navigator'), host = $('#stock-detail-host');
    expect(picker.open).toBe(false);
    picker.open = true;
    clickStock(stocks[1].id); await flush();
    expect(picker.open).toBe(false);
    expect(document.activeElement).toBe(host);
    expect(host.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' });
    media.matches = true; media.dispatchEvent(new Event('change'));
    expect(picker.open).toBe(true);
    media.matches = false; media.dispatchEvent(new Event('change'));
    expect(picker.open).toBe(false);
});

test('mobile empty workspace keeps the picker open until a successful selection', async () => {
    boot({ mobile: true, selectedId: null });
    expect($('#stock-navigator').open).toBe(true);
    clickStock(stocks[0].id); await flush();
    expect(selected()).toBe(stocks[0].id);
    expect($('#stock-navigator').open).toBe(false);
});

test('mobile window scroll is saved once per frame and restored during history traversal', async () => {
    history.scrollRestoration = 'auto';
    const workspace = boot({ mobile: true });
    expect(history.scrollRestoration).toBe('manual');
    const replace = jest.spyOn(history, 'replaceState');
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 570 });
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));
    expect(replace).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(20);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(history.state.bwStocks.windowScroll).toBe(570);
    const saved = structuredCloneForTest(history.state), savedURL = location.href;
    clickStock(stocks[1].id); await flush();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 80 });
    history.replaceState(saved, '', savedURL);
    window.dispatchEvent(new PopStateEvent('popstate', { state: saved })); await flush();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 570);
    workspace.destroy();
    expect(history.scrollRestoration).toBe('auto');
});

test('fragment cache is capped at six entries and expires after five minutes', async () => {
    const catalog = Array.from({ length: 8 }, (_, i) => ({ id: 'stock-XNAS-C' + i, name: 'Cache ' + i, symbol: 'C' + i }));
    history.replaceState(null, '', urlFor(catalog[0].id));
    boot({ catalog });
    for (const item of catalog.slice(1)) { clickStock(item.id); await flush(); }
    expect(fetch).toHaveBeenCalledTimes(7);
    clickStock(catalog[0].id); await flush();
    expect(fetch).toHaveBeenCalledTimes(8);
    clickStock(catalog[7].id); await flush();
    expect(fetch).toHaveBeenCalledTimes(8);
    await jest.advanceTimersByTimeAsync(300001);
    clickStock(catalog[0].id); await flush();
    expect(fetch).toHaveBeenCalledTimes(9);
});

test('the aggregate fragment byte cap evicts older valid responses below the per-response limit', async () => {
    const catalog = Array.from({ length: 5 }, (_, i) => ({ id: 'stock-XNAS-L' + i, name: 'Large ' + i, symbol: 'L' + i }));
    history.replaceState(null, '', urlFor(catalog[0].id));
    boot({ catalog });
    fetch.mockImplementation(url => Promise.resolve(response(panel(new URL(url).pathname.split('/').pop(), 'x'.repeat(750000)))));
    for (const item of catalog.slice(1, 4)) { clickStock(item.id); await flush(); }
    expect(fetch).toHaveBeenCalledTimes(3);
    clickStock(catalog[2].id); await flush();
    expect(fetch).toHaveBeenCalledTimes(3);
    clickStock(catalog[1].id); await flush();
    expect(fetch).toHaveBeenCalledTimes(4);
});

test('destroy aborts pending work, disposes the chart once, and removes navigation handlers', async () => {
    const workspace = boot(), old = deferred();
    fetch.mockReturnValueOnce(old.promise);
    clickStock(stocks[1].id);
    const signal = fetch.mock.calls[0][1].signal;
    workspace.destroy(); workspace.destroy();
    expect(signal.aborted).toBe(true);
    expect(charts[0].destroy).toHaveBeenCalledTimes(1);
    old.resolve(response(panel(stocks[1].id))); await flush();
    expect(selected()).toBe(stocks[0].id);
    expect(window.BW.ReferencePage.mount).toHaveBeenCalledTimes(1);
    input('Beta');
    expect(visible()).toHaveLength(3);
});
