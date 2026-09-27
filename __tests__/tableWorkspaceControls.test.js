/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const script = fs.readFileSync(path.join(__dirname, '../app/static/js/components/table_workspace.js'), 'utf8');
const template = fs.readFileSync(path.join(__dirname, '../app/templates/components/compact_table.html'), 'utf8');
let workspace;
beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'loading' });
    document.body.innerHTML = template.slice(0, template.indexOf('    <div class="tw-table-region"')).replace(/{%[\s\S]*?%}/g, '') + '<div class="tw-table-region"><table id="data-table"><thead><tr><th data-col="selection"><input id="tw-select-all" type="checkbox"></th></tr></thead><tbody id="table-body"><tr data-id="gold" data-name="Gold" data-category="precious" data-price="2000" data-frequency="daily"><td data-col="commodity"><div class="commodity-cell"><a class="commodity-name">Gold</a></div></td></tr></tbody></table></div><div id="tw-announcement"></div></section>';
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    window.history.replaceState({}, '', '/');
    window.BW = { CompactTable: { setDataRange: jest.fn() } };
    window.eval(script); workspace = window.BW.TableWorkspace; workspace.init();
    const root = document.getElementById('table-workspace');
    root.getClientRects = () => [{ top: 300 }];
    root.getBoundingClientRect = () => ({ top: 300 - window.scrollY });
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
});
afterEach(() => jest.restoreAllMocks());
const id = key => document.getElementById(key);

test('scroll compacts controls with stable context while selection and failed-save actions stay available', () => {
    workspace.selected.add('gold'); workspace.updateSelection();
    id('tw-storage-warning').hidden = false;
    const region = document.querySelector('.tw-table-region');
    region.scrollTop = 60; workspace.updateScrollControls();
    expect(id('tw-controls').hidden).toBe(true);
    expect(id('tw-summary-view').textContent).toBe('All benchmarks');
    expect(id('tw-summary-context').textContent).toBe('1Y · 1 of 1');
    expect(id('tw-selection').hidden).toBe(false);
    expect(id('tw-storage-warning').hidden).toBe(false);
    region.scrollTop = 30; workspace.updateScrollControls();
    expect(workspace.controlsCollapsed).toBe(true);
    region.scrollTop = 0; workspace.updateScrollControls();
    expect(workspace.controlsCollapsed).toBe(false);
    Object.defineProperty(window, 'scrollY', { value: 400, configurable: true });
    workspace.updateScrollControls(); expect(workspace.controlsCollapsed).toBe(true);
    Object.defineProperty(window, 'scrollY', { value: 260, configurable: true });
    workspace.updateScrollControls(); expect(workspace.controlsCollapsed).toBe(true);
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    workspace.updateScrollControls(); expect(workspace.controlsCollapsed).toBe(false);
});

test('focused controls and open panels prevent automatic collapse; manual expansion stays open', () => {
    const region = document.querySelector('.tw-table-region'); region.scrollTop = 100;
    id('tw-query').focus(); workspace.updateScrollControls();
    expect(workspace.controlsCollapsed).toBe(false);
    id('tw-query').blur(); id('tw-filter-button').click(); id('tw-category').blur();
    workspace.updateScrollControls(); expect(workspace.controlsCollapsed).toBe(false);
    workspace.closePanels(); workspace.updateScrollControls();
    expect(workspace.controlsCollapsed).toBe(true);
    id('tw-controls-toggle').click(); region.scrollTop = 500; workspace.updateScrollControls();
    expect(workspace.controlsCollapsed).toBe(false);
    expect(id('tw-controls-toggle').getAttribute('aria-expanded')).toBe('true');
    id('tw-controls-toggle').click(); region.scrollTop = 0; workspace.updateScrollControls();
    expect(workspace.controlsCollapsed).toBe(true);
});

test('automatic collapse preserves the visible row position and waits for compensation room', () => {
    const region = document.querySelector('.tw-table-region');
    id('tw-controls').getBoundingClientRect = () => ({ height: 88 });
    region.getBoundingClientRect = () => ({ top: workspace.controlsCollapsed ? 400 : 489 });
    region.scrollTop = 80; workspace.updateScrollControls();
    expect(workspace.controlsCollapsed).toBe(false);
    region.scrollTop = 160;
    const rowPosition = region.getBoundingClientRect().top - region.scrollTop;
    workspace.updateScrollControls();
    expect(workspace.controlsCollapsed).toBe(true);
    expect(region.getBoundingClientRect().top - region.scrollTop).toBe(rowPosition);
    workspace.updateScrollControls(); expect(workspace.controlsCollapsed).toBe(true);
});

test('built-in views save new; named views edit in a modal without overwriting an in-progress name', () => {
    id('tw-view-menu-button').click();
    expect(id('tw-view-menu').open).toBe(true);
    expect(id('tw-view-actions').hidden).toBe(true);
    expect(id('tw-view-submit').textContent).toBe('Save as new view');
    id('tw-view-name').value = 'Source review';
    id('tw-view-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(workspace.views).toHaveLength(1);
    expect(id('tw-view-menu').open).toBe(false);
    expect(document.activeElement).toBe(id('tw-view-menu-button'));
    id('tw-view-menu-button').click();
    expect(id('tw-view-actions').hidden).toBe(false);
    expect(id('tw-view-submit').textContent).toBe('Save changes');
    id('tw-view-name').value = 'Renamed review';
    workspace.renderControls();
    expect(id('tw-view-name').value).toBe('Renamed review');
    id('tw-view-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(workspace.views).toHaveLength(1); expect(workspace.views[0].name).toBe('Renamed review');
    id('tw-new-view').click();
    expect(id('tw-view-actions').hidden).toBe(true);
    id('tw-view-menu').dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(document.activeElement).toBe(id('tw-new-view'));
});

test('failed view saving stays explicit and retrying the modal does not create duplicate views', () => {
    id('tw-new-view').click(); id('tw-view-name').value = 'Unsaved review';
    const storage = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Full'); });
    id('tw-view-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(id('tw-view-menu').open).toBe(true);
    expect(id('tw-view-save-status').textContent).toContain('Not saved');
    expect(workspace.views).toHaveLength(1);
    storage.mockRestore();
    id('tw-view-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(workspace.views).toHaveLength(1);
    expect(id('tw-view-menu').open).toBe(false);
    expect(JSON.parse(localStorage.getItem('bw-table-workspace-v1')).views).toHaveLength(1);
});
