/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const script = fs.readFileSync(path.join(__dirname, '../app/static/js/components/table_workspace.js'), 'utf8');
function row({ id, name = id, price = '', change = '', category = 'metal', frequency = 'daily', date = '' }) {
    return `<tr data-id="${id}" data-name="${name}" data-price="${price}" data-change-pct="${change}" data-change-abs="${change}" data-category="${category}" data-frequency="${frequency}" data-date="${date}" data-currency="USD" data-unit="tonne" data-source="Public source" data-direction="${Number(change) > 0 ? 'up' : Number(change) < 0 ? 'down' : 'flat'}"><td data-col="commodity"><div class="commodity-cell"><div class="commodity-name">${name}</div></div></td><td data-col="price"><span class="price-value" data-raw="${price}"></span><span class="price-currency">USD</span></td><td data-col="pct"></td><td data-col="updated"></td></tr>`;
}
function setup(saved) {
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' });
    localStorage.clear();
    if (saved) localStorage.setItem('bw-table-workspace-v1', JSON.stringify(saved));
    document.body.innerHTML = `<section id="table-workspace"><div id="tw-views"></div><div id="tw-view-status"></div><div id="tw-storage-warning" hidden></div><div id="tw-announcement"></div><input id="tw-query"><select id="tw-category"></select><select id="tw-frequency"><option value=""></option><option value="daily"></option></select><select id="tw-density"><option value="comfortable"></option><option value="compact"></option></select><div id="tw-filter-chips"></div><div id="tw-property-list"></div><div id="tw-sort-rules"></div><div id="tw-result-count"></div><div id="tw-empty"></div><div id="tw-selection"><strong id="tw-selection-count"></strong></div><button id="tw-export-selected"></button><button id="tw-compare-selected"></button><table id="data-table"><thead><tr><th data-col="selection"><input type="checkbox" id="tw-select-all"></th></tr></thead><tbody id="table-body">${row({ id: 'z', name: 'Zinc', price: 20, change: -3, date: '2025-02-01' })}${row({ id: 'c', name: 'Copper', price: 100, change: 2, date: '2025-01-01' })}${row({ id: 'g', name: 'Gold', category: 'precious', frequency: 'monthly' })}${row({ id: 'a', name: 'Aluminium', price: 0, change: 0, date: '2025-02-01' })}</tbody></table></section>`;
    window.history.replaceState({}, '', '/');
    global.BW = { CompactTable: { setDataRange: jest.fn() } };
    window.eval(script);
    BW.TableWorkspace.init();
    return BW.TableWorkspace;
}
afterEach(() => jest.restoreAllMocks());

test('typed numeric sorting keeps zero and missing-last in both directions', () => {
    const w = setup();
    w.sortBy('price');
    expect(w.getRows().map(r => r.dataset.id)).toEqual(['a', 'z', 'c', 'g']);
    w.sortBy('price');
    expect(w.getRows().map(r => r.dataset.id)).toEqual(['c', 'z', 'a', 'g']);
});

test('multi-sort dates uses an explicit tie priority and stable IDs', () => {
    const w = setup();
    w.change({ sorts: [{ key: 'updated', direction: 'desc' }, { key: 'price', direction: 'desc' }] });
    expect(w.getRows().map(r => r.dataset.id)).toEqual(['z', 'a', 'c', 'g']);
    expect(document.querySelector('[data-col="updated"]').getAttribute('aria-sort')).toBe('descending');
    expect(document.querySelector('[data-col="price"] .tw-sort-indicator').textContent).toContain('2');
});

test('category, frequency, availability and global/local searches compose', () => {
    const w = setup();
    w.change({ filters: { category: 'metal', frequency: 'daily', availability: 'available' } });
    expect(w.getVisibleRows()).toHaveLength(3);
    w.setExternalQuery('copper');
    expect(w.getVisibleRows().map(r => r.dataset.id)).toEqual(['c']);
    w.change({ query: 'zinc' });
    expect(w.getVisibleRows()).toHaveLength(0);
    expect(document.getElementById('tw-empty').hidden).toBe(false);
    w.setExternalQuery(''); w.clearFilters();
    w.change({ filters: { availability: 'no-change' } });
    expect(w.getVisibleRows().map(r => r.dataset.id)).toEqual(['g']);
});

test('header selection selects filtered scope and reports hidden selected rows', () => {
    const w = setup();
    w.setCategory('metal');
    const checkbox = document.getElementById('tw-select-all'); checkbox.checked = true; checkbox.dispatchEvent(new Event('change'));
    expect(w.getSelectedIds()).toEqual(['a', 'c', 'z']);
    w.change({ query: 'copper' });
    expect(document.getElementById('tw-selection-count').textContent).toBe('3 selected (2 outside filters)');
    document.querySelector('tr[data-id="c"] .tw-row-select').click();
    expect(w.getSelectedIds()).toEqual(['a', 'z']);
    expect(checkbox.checked).toBe(false);
});

test('named views restore query, filters, range, sorts, layout and density after reload', () => {
    let w = setup();
    w.change({ query: 'copper', filters: { frequency: 'daily' }, range: '3M', density: 'compact', sorts: [{ key: 'price', direction: 'desc' }], visible: ['commodity', 'price', 'category'], order: ['commodity', 'category', 'price'], widths: { commodity: 330, price: 170 } });
    w.saveView('Daily research');
    const saved = JSON.parse(localStorage.getItem('bw-table-workspace-v1'));
    w = setup(saved);
    expect(w.current).toEqual(saved.current);
    expect(w.getVisibleRows().map(r => r.dataset.id)).toEqual(['c']);
    expect(BW.CompactTable.setDataRange).toHaveBeenCalledWith('3M', { history: 'replace' });
    expect(document.querySelector('td[data-col="commodity"]').style.width).toBe('330px');
    expect(document.querySelector('td[data-col="pct"]').hidden).toBe(true);
});

test('row rebuild preserves view and selection, removes absent selected IDs', () => {
    const w = setup();
    w.selected = new Set(['c', 'z']);
    w.change({ query: 'copper', widths: { commodity: 350 }, density: 'compact' });
    document.getElementById('table-body').innerHTML = row({ id: 'c', name: 'Copper', price: 120 }) + row({ id: 'a', name: 'Aluminium', price: 10 });
    w.refresh();
    expect(w.getSelectedIds()).toEqual(['c']);
    expect(w.getVisibleRows().map(r => r.dataset.id)).toEqual(['c']);
    expect(document.querySelector('td[data-col="commodity"]').style.width).toBe('350px');
    expect(document.querySelectorAll('tr[data-id] .tw-row-select')).toHaveLength(2);
    expect(document.querySelector('.commodity-name').tagName).toBe('A');
    expect(document.querySelectorAll('tr[onclick],tr[tabindex]')).toHaveLength(0);
});

test('column keyboard resize and reorder do not sort or alter identity visibility', () => {
    const w = setup();
    const before = JSON.stringify(w.current.sorts);
    const resize = document.querySelector('[aria-label="Resize Reference value"]');
    resize.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(w.current.widths.price).toBe(176);
    expect(JSON.stringify(w.current.sorts)).toBe(before);
    w.moveProperty('price', 1);
    expect(w.current.order.slice(0, 3)).toEqual(['commodity', 'pct', 'price']);
    w.moveProperty('commodity', 2);
    expect(w.current.order[0]).toBe('commodity');
    w.change({ visible: [] });
    expect(w.current.visible).toEqual(['commodity']);
});

test('watchlist events filter rows without altering saved source data', () => {
    const w = setup();
    w.setWatchlist(['c']); w.setWatchOnly(true);
    expect(w.getVisibleRows().map(r => r.dataset.id)).toEqual(['c']);
    document.dispatchEvent(new CustomEvent('bw:watchlist-change', { detail: { ids: ['z'] } }));
    expect(w.getVisibleRows().map(r => r.dataset.id)).toEqual(['z']);
    expect(document.querySelector('tr[data-id="z"] .tw-watch').getAttribute('aria-pressed')).toBe('true');
});

test('CSV preserves raw zero, negative, absent, quoting and neutralizes formula text', () => {
    const w = setup();
    const source = w.getRows().find(r => r.dataset.id === 'z'); source.dataset.name = '=HYPERLINK("unsafe")'; source.dataset.source = 'Public, "source"';
    const csv = w.buildCsv(w.getRows());
    expect(csv).toContain('"\'=HYPERLINK(""unsafe"")"');
    expect(csv).toContain('"-3","-3"');
    expect(csv).toContain('"0","USD","tonne","0","0"');
    expect(csv).toContain('"Gold","precious","","USD","tonne","",""');
    expect(csv).toContain('"Public, ""source"""');
    expect(csv).toContain('"1Y"');
});

test('failed storage retains working configuration and never claims it was saved', () => {
    const w = setup();
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    w.change({ query: 'copper' });
    expect(w.current.query).toBe('copper');
    expect(w.getVisibleRows()).toHaveLength(1);
    expect(document.getElementById('tw-storage-warning').hidden).toBe(false);
    expect(document.getElementById('tw-view-status').textContent).toContain('Not saved');
    expect(w.persist()).toBe(false);
});

test('malformed saved properties and sorts are normalized without duplicate columns', () => {
    const w = setup({ version: 1, current: { order: ['bad', 'price', 'price'], visible: ['bad', 'price', 'price'], widths: { price: 9000 }, sorts: [{ key: 'bad', direction: 'asc' }, { key: 'price', direction: 'desc' }, { key: 'price', direction: 'asc' }] } });
    expect(w.current.visible).toEqual(['commodity', 'price']);
    expect(w.current.order.filter(key => key === 'price')).toHaveLength(1);
    expect(w.current.widths.price).toBe(600);
    expect(w.current.sorts).toEqual([{ key: 'price', direction: 'desc' }]);
});

function loadCompactIntegration(w) {
    window.eval(fs.readFileSync(path.join(__dirname, '../app/static/js/core/utils.js'), 'utf8'));
    window.eval(fs.readFileSync(path.join(__dirname, '../app/static/js/components/compact_table.js'), 'utf8'));
    let settings = JSON.parse(JSON.stringify(BW.CompactTable.defaultSettings));
    jest.spyOn(BW.CompactTable, 'getSettings').mockImplementation(() => JSON.parse(JSON.stringify(settings)));
    jest.spyOn(BW.CompactTable, 'saveSettings').mockImplementation(value => { settings = value; });
    jest.spyOn(BW.CompactTable, 'initSparklines').mockImplementation(() => {});
    return BW.CompactTable;
}

test('failed range request retains observations and restores the previously displayed range', async () => {
    const w = setup();
    const region = document.createElement('div'); region.className = 'tw-table-region'; document.getElementById('table-workspace').append(region);
    const table = loadCompactIntegration(w);
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    table.setDataRange('1M');
    expect(w.current.range).toBe('1M');
    expect(document.getElementById('data-table').getAttribute('aria-busy')).toBe('true');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(w.current.range).toBe('1Y');
    expect(w.getRows()).toHaveLength(4);
    expect(document.getElementById('tw-range-error').textContent).toContain('Previous observations are still shown');
    expect(document.getElementById('data-table').getAttribute('aria-busy')).toBe('false');
    expect(new URLSearchParams(location.search).get('range')).toBe('1Y');
});

test('AJAX refresh preserves unavailable change and raw precision in workspace CSV', () => {
    const w = setup();
    const table = loadCompactIntegration(w);
    table.updateTableData([
        { id: 'single', name: 'One observation', category: 'metal', currency: 'USD', unit: 'tonne', source_name: 'Public source', price: 14, date: '2025-01-01', change: null, change_percent: null },
        { id: 'precise', name: 'Precise', category: 'metal', currency: 'USD', price: 12, date: '2025-01-01', change: -1.23456, change_percent: 2.34567 }
    ]);
    const single = w.getRows().find(r => r.dataset.id === 'single');
    expect(single.dataset.changePct).toBe('');
    expect(single.querySelector('.pct-cell').textContent).toContain('—');
    expect(w.buildCsv(w.getRows())).toContain('"-1.23456","2.34567"');
    expect(w.buildCsv([single])).toContain('"14","USD","tonne","",""');
    expect(single.dataset.source).toBe('Public source');
});

test('export waits for the requested range so old observations cannot be mislabeled', () => {
    const w = setup();
    const download = jest.spyOn(w, 'download');
    document.getElementById('data-table').setAttribute('aria-busy', 'true');
    w.exportRows('filtered');
    expect(download).not.toHaveBeenCalled();
    expect(document.getElementById('tw-announcement').textContent).toContain('still loading');
});

test('range replacement failure restores actual observations, not the superseded pending range', async () => {
    const w = setup();
    const table = loadCompactIntegration(w);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = jest.fn().mockImplementationOnce(() => new Promise(() => {})).mockRejectedValueOnce(new Error('offline'));
    table.setDataRange('1M'); table.setDataRange('3M');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(w.current.range).toBe('1Y');
    expect(table.loadedRange).toBe('1Y');
    expect(w.getRows()).toHaveLength(4);
});

test('hydration formats grouped reference values without changing export precision', () => {
    const w = setup();
    const table = loadCompactIntegration(w);
    table.updateTableData([{ id: 'gold', name: 'Gold', price: 5274.70123, currency: 'USD', date: '2025-01-01', change: 0, change_percent: 0 }]);
    expect(document.querySelector('.price-value').textContent).toBe('5,274.70');
    expect(w.buildCsv(w.getRows())).toContain('"5274.70123"');
});

test('navigation watchlist scope is external and preserves the current named view on return', () => {
    const w = setup();
    w.change({ query: 'copper', filters: { category: 'metal' }, sorts: [{ key: 'price', direction: 'desc' }] });
    w.saveView('Copper research');
    const current = JSON.stringify(w.current), active = w.activeId;
    w.setWatchlist([]); w.setWatchOnly(true);
    expect(w.getVisibleRows()).toHaveLength(0);
    expect(document.getElementById('tw-filter-chips').textContent).toContain('Watchlist navigation');
    w.setWatchOnly(false);
    expect(w.getVisibleRows().map(row => row.dataset.id)).toEqual(['c']);
    expect(JSON.stringify(w.current)).toBe(current);
    expect(w.activeId).toBe(active);
});

test('range restoration can fetch without creating or replacing browser history', async () => {
    const w = setup();
    const table = loadCompactIntegration(w);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] });
    const push = jest.spyOn(window.history, 'pushState');
    const replace = jest.spyOn(window.history, 'replaceState');
    table.setDataRange('3M', { history: 'none' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(push).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
    expect(w.current.range).toBe('3M');
    expect(table.loadedRange).toBe('3M');
});

test('closing a shared panel returns focus to the exact trigger that opened it', () => {
    const w = setup();
    const trigger = document.createElement('button'); trigger.textContent = 'New view';
    const panel = document.createElement('div'); panel.id = 'tw-view-menu'; panel.hidden = true; panel.innerHTML = '<input aria-label="View name">';
    document.getElementById('table-workspace').append(trigger, panel);
    w.togglePanel('tw-view-menu', trigger);
    expect(document.activeElement).toBe(panel.querySelector('input'));
    w.closePanels(true);
    expect(document.activeElement).toBe(trigger);
});
