/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const markup = fs.readFileSync(path.join(__dirname, '../app/templates/components/research_workspace.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../app/static/js/components/research_workspace.js'), 'utf8');
let research;
const field = name => document.querySelector('#rw-editor-form [name="' + name + '"]');
function enter(input, value, commit = true) {
  input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  if (input.type === 'checkbox') input.checked = value; else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  if (commit) input.dispatchEvent(new Event('change', { bubbles: true }));
}
function boot() { document.body.innerHTML = markup; window.eval(source); research = window.BW.ResearchWorkspace; research.init(); return research; }
function property(type, name, options = '') {
  const form = new FormData(); form.set('propertyName', name); form.set('propertyType', type); form.set('propertyOptions', options); form.set('propertyUnit', type === 'number' ? 'days' : ''); research.addProperty(form); return research.state.properties.at(-1);
}
function backup() { return JSON.parse(JSON.stringify(research.state)); }

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  document.body.innerHTML = markup;
  delete window.BW;
  Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  URL.createObjectURL = jest.fn(() => 'blob:backup');
  URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  boot();
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

test('creates and edits real entries, saves only in this browser, and reloads production storage', () => {
  research.focusNewEntry();
  enter(field('title'), 'Supply sources'); enter(field('notes'), 'Check the revision schedule.'); enter(field('tags'), 'Metals, Monthly, Metals');
  expect(research.state.entries[0]).toMatchObject({ title: 'Supply sources', notes: 'Check the revision schedule.', tags: ['Metals', 'Monthly'] });
  expect(document.getElementById('rw-save-state').textContent).toBe('Saved in this browser');
  expect(JSON.parse(localStorage.getItem(research.STORAGE_KEY)).entries[0].title).toBe('Supply sources');
  delete window.BW; boot();
  expect(research.getSearchItems()[0].title).toBe('Supply sources');
});

test('preserves failed edits and backup payload, retries successfully without false saved status', () => {
  research.focusNewEntry();
  const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
  enter(field('notes'), 'A draft that must survive');
  expect(research.saveState).toBe('failed');
  expect(document.getElementById('rw-save-state').textContent).toContain('Not saved');
  expect(field('notes').value).toBe('A draft that must survive');
  expect(JSON.parse(research.exportBackup()).entries[0].notes).toBe('A draft that must survive');
  set.mockRestore(); research.action('retry');
  expect(research.saveState).toBe('saved');
  expect(JSON.parse(localStorage.getItem(research.STORAGE_KEY)).entries[0].notes).toBe('A draft that must survive');
});

test('cancels the current field with Escape and keeps other saved fields intact', () => {
  research.focusNewEntry(); enter(field('title'), 'Original'); enter(field('notes'), 'Keep this');
  enter(field('title'), 'Unfinished rename', false);
  field('title').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(research.state.entries[0].title).toBe('Original');
  expect(research.state.entries[0].notes).toBe('Keep this');
  expect(document.getElementById('rw-editor').open).toBe(true);
});

test('undo restores edits, archive is reversible, and duplicated entries have new identity', () => {
  research.focusNewEntry(); enter(field('title'), 'First title'); enter(field('title'), 'Second title'); research.undo();
  expect(research.state.entries[0].title).toBe('First title');
  const original = research.state.entries[0].id; research.action('duplicate');
  expect(research.state.entries).toHaveLength(2); expect(research.editorId).not.toBe(original);
  research.action('archive'); expect(research.rows()).toHaveLength(1);
  research.updateView({ archived: true }); expect(research.rows()).toHaveLength(1);
  research.focusEntry(research.rows()[0].id); research.action('archive');
  expect(research.state.entries.every(entry => !entry.archived)).toBe(true);
});

test('linked observations remain immutable while custom typed properties are editable', () => {
  const ids = research.addBenchmarks([{ id: 'copper', name: 'Copper', price: 0, unit: 'USD/t', date: '2026-01-01', source_name: 'Public source' }]);
  expect(research.addBenchmarks([{ id: 'copper', price: 99 }])).toEqual(ids);
  expect(research.state.entries).toHaveLength(1);
  expect(research.state.entries[0].benchmark.price).toBe(0);
  const types = [['text', 'Researcher', 'Analyst'], ['number', 'Lag', -2.5], ['date', 'Review date', '2026-10-01'], ['checkbox', 'Checked', true], ['select', 'Priority', 'High']];
  const props = types.map(([type, name]) => property(type, name, 'Low, High'));
  research.focusEntry(ids[0]);
  props.forEach((p, index) => enter(document.querySelector('[data-property="' + p.id + '"]'), types[index][2]));
  const entry = research.state.entries[0];
  props.forEach((p, index) => expect(entry.values[p.id]).toBe(types[index][2]));
  expect(entry.benchmark.price).toBe(0);
  expect(research.validateBackup(backup()).entries[0].values[props[1].id]).toBe(-2.5);
});

test('unfinished numeric input survives reload as a draft and cannot enter numeric sorting as zero', () => {
  const number = property('number', 'Assumption'); research.focusNewEntry();
  const input = document.querySelector('[data-property="' + number.id + '"]');
  enter(input, '12.5'); enter(input, '-');
  expect(research.state.entries[0].values[number.id]).toBe(12.5);
  expect(research.state.entries[0].drafts[number.id]).toBe('-');
  expect(research.validateBackup(backup()).entries[0].drafts[number.id]).toBe('-');
  research.focusEntry(research.editorId);
  expect(document.querySelector('[data-property="' + number.id + '"]').value).toBe('-');
  enter(document.querySelector('[data-property="' + number.id + '"]'), '0');
  expect(research.state.entries[0].values[number.id]).toBe(0);
  expect(research.state.entries[0].drafts[number.id]).toBeUndefined();
});

test('filters/searches user content and sorts numbers numerically with missing values last both ways', () => {
  const p = property('number', 'Sample');
  [2, 11, null].forEach((value, index) => { research.focusNewEntry(); enter(field('title'), 'Entry ' + index); if (value !== null) enter(document.querySelector('[data-property="' + p.id + '"]'), String(value)); });
  research.updateView({ sort: p.id, direction: 'asc' });
  expect(research.rows().map(e => e.values[p.id])).toEqual([2, 11, undefined]);
  research.updateView({ direction: 'desc' }); expect(research.rows().map(e => e.values[p.id])).toEqual([11, 2, undefined]);
  research.setSearch('Entry 1'); expect(research.rows()).toHaveLength(1);
  research.updateView({ status: 'Reviewed' }); expect(research.rows()).toHaveLength(0);
});

test('saved views restore search, sort, property order and hidden properties', () => {
  research.updateView({ query: 'monthly', status: 'In progress', sort: 'title', direction: 'asc', columns: ['title', 'notes', 'status', 'benchmark', 'tags', 'updatedAt'], hidden: ['tags'] }); research.saveView('Monthly sources');
  research.updateView({ query: '', status: '', hidden: [] });
  [...document.querySelectorAll('.rw-view')].find(button => button.textContent === 'Monthly sources').click();
  expect(research.state.view).toMatchObject({ query: 'monthly', status: 'In progress', sort: 'title', direction: 'asc', hidden: ['tags'] });
  expect(research.state.view.columns[1]).toBe('notes');
});

test('validates imports before any write and previews merge conflicts', () => {
  research.focusNewEntry(); enter(field('title'), 'Local entry');
  const imported = backup(); imported.entries[0].title = 'Newer imported entry'; imported.entries[0].updatedAt = '2030-01-01T00:00:00.000Z';
  research.previewImport(JSON.stringify(imported));
  expect(research.state.entries[0].title).toBe('Local entry');
  expect(document.getElementById('rw-import-summary').textContent).toContain('1 matching existing IDs');
  expect(research.applyImport('merge')).toBe(true); expect(research.state.entries[0].title).toBe('Newer imported entry');
  research.undo(); expect(research.state.entries[0].title).toBe('Local entry');
  const broken = backup(); broken.entries[0].status = 'Unsupported';
  expect(() => research.previewImport(JSON.stringify(broken))).toThrow('Invalid entry status');
  expect(research.state.entries[0].title).toBe('Local entry');
});

test('merge retains newer local entries and rejects incompatible property definitions; replace and undo work', () => {
  const p = property('number', 'Lag'); research.focusNewEntry(); enter(field('title'), 'Current');
  const imported = backup(); imported.entries[0].updatedAt = '2000-01-01T00:00:00.000Z'; imported.entries[0].title = 'Old';
  research.previewImport(imported); research.applyImport('merge'); expect(research.state.entries[0].title).toBe('Current');
  imported.properties[0].type = 'text'; research.previewImport(imported);
  expect(research.applyImport('merge')).toBe(false); expect(document.getElementById('rw-import-error').textContent).toContain('conflicts');
  expect(research.applyImport('replace')).toBe(true); expect(research.state.properties.find(prop => prop.id === p.id).type).toBe('text');
  research.undo(); expect(research.state.properties[0].type).toBe('number');
});

test('renders markup and citations safely as text, blocks javascript URLs, and exports exact JSON drafts', () => {
  research.focusNewEntry(); const injection = '<img src=x onerror=alert(1)>';
  enter(field('title'), injection); enter(field('notes'), '=WEBSERVICE("https://example.test")');
  enter(field('citations'), 'javascript:alert(1)\nhttps://example.com/report');
  expect(document.querySelector('#rw-table-body img')).toBeNull();
  expect(document.querySelector('#rw-table-body .rw-entry-title').textContent).toBe(injection);
  expect(document.querySelectorAll('#rw-citation-links a')).toHaveLength(1);
  expect(document.querySelector('#rw-citation-links a').rel).toContain('noopener');
  expect(JSON.parse(research.exportBackup()).entries[0].notes).toBe('=WEBSERVICE("https://example.test")');
});

test('invalid existing storage is preserved until an explicit valid replacement', () => {
  localStorage.setItem(research.STORAGE_KEY, '{broken'); delete window.BW; boot();
  research.focusNewEntry(); enter(field('title'), 'Do not overwrite original');
  expect(localStorage.getItem(research.STORAGE_KEY)).toBe('{broken');
  expect(research.saveState).toBe('failed');
  const valid = backup(); research.previewImport(valid); expect(research.applyImport('replace')).toBe(true);
  expect(research.saveState).toBe('saved'); expect(JSON.parse(localStorage.getItem(research.STORAGE_KEY)).entries[0].title).toBe('Do not overwrite original');
});

test('storage changes in another tab preserve local drafts and block an unreviewed overwrite', () => {
  research.focusNewEntry(); enter(field('notes'), 'This tab draft');
  window.dispatchEvent(new StorageEvent('storage', { key: research.STORAGE_KEY, newValue: '{}' }));
  enter(field('notes'), 'This tab keeps working');
  expect(research.saveState).toBe('failed');
  expect(research.state.entries[0].notes).toBe('This tab keeps working');
  expect(document.getElementById('rw-save-state').textContent).toContain('another tab');
});

test('an empty draft can be discarded and undo restores it', () => {
  research.focusNewEntry(); expect(document.getElementById('rw-discard-entry').hidden).toBe(false);
  research.action('discard'); expect(research.state.entries).toHaveLength(0);
  research.undo(); expect(research.state.entries).toHaveLength(1);
  research.focusEntry(research.state.entries[0].id); enter(field('title'), 'Keep me');
  expect(document.getElementById('rw-discard-entry').hidden).toBe(true);
  research.action('discard'); expect(research.state.entries).toHaveLength(1);
});

test('closing an edited entry restores focus after its table row was rerendered', () => {
  research.focusNewEntry(); enter(field('title'), 'Focusable entry'); research.closeDialog(document.getElementById('rw-editor'));
  const button = document.querySelector('[data-rw-entry]'); button.focus(); button.click();
  enter(field('notes'), 'Causes table rerender'); research.closeDialog(document.getElementById('rw-editor'));
  expect(document.activeElement.dataset.rwEntry).toBe(research.state.entries[0].id);
});

test('a temporary read failure never overwrites an older workspace when storage recovers', () => {
  research.focusNewEntry(); enter(field('title'), 'Existing saved entry'); const stored = localStorage.getItem(research.STORAGE_KEY);
  const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Unavailable'); });
  delete window.BW; boot(); research.focusNewEntry(); enter(field('title'), 'Temporary draft');
  get.mockRestore(); research.action('retry');
  expect(localStorage.getItem(research.STORAGE_KEY)).toBe(stored);
  expect(research.saveState).toBe('failed');
  expect(research.state.entries[0].title).toBe('Temporary draft');
});

test('global search on standalone pages reads valid local notes without writing or mounting an editor', () => {
  research.focusNewEntry(); enter(field('title'), 'A globally searchable note');
  const saved = localStorage.getItem(research.STORAGE_KEY);
  document.body.replaceChildren(); research.root = null;
  const write = jest.spyOn(Storage.prototype, 'setItem');
  expect(research.getSearchItems()[0].title).toBe('A globally searchable note');
  expect(write).not.toHaveBeenCalled();
  expect(localStorage.getItem(research.STORAGE_KEY)).toBe(saved);
  localStorage.setItem(research.STORAGE_KEY, '{invalid'); write.mockClear();
  expect(research.getSearchItems()).toEqual([]); expect(write).not.toHaveBeenCalled();
});

test('merge imports saved views, deduplicates identical copies, and preserves conflicting view IDs', () => {
  research.updateView({ query: 'local notes', status: 'To review' }); research.saveView('My research');
  const original = JSON.parse(JSON.stringify(research.state.views[0]));
  research.previewImport(backup()); expect(research.applyImport('merge')).toBe(true);
  expect(research.state.views).toHaveLength(1);
  const imported = backup();
  imported.views = [
    { ...JSON.parse(JSON.stringify(original)), id: 'v_identical_copy' },
    { ...JSON.parse(JSON.stringify(original)), config: { ...original.config, query: 'imported notes' } },
    { id: 'v_new_view', name: 'Reviewed notes', config: { ...original.config, status: 'Reviewed', query: '' } }
  ];
  research.previewImport(imported);
  expect(document.getElementById('rw-import-summary').textContent).toContain('Merging would keep 3 saved views');
  expect(research.applyImport('merge')).toBe(true);
  expect(research.state.views).toHaveLength(3);
  expect(research.state.views.find(view => view.id === original.id)).toEqual(original);
  const conflict = research.state.views.find(view => view.config.query === 'imported notes');
  expect(conflict.id).not.toBe(original.id);
  expect(conflict.name).toBe('My research');
  expect(research.state.views.some(view => view.id === 'v_new_view')).toBe(true);
  expect(research.state.view.query).toBe('local notes');
  expect(JSON.parse(localStorage.getItem(research.STORAGE_KEY)).views).toHaveLength(3);
  // Re-importing the same conflicting backup should not keep creating copies.
  research.previewImport(imported); expect(research.applyImport('merge')).toBe(true);
  expect(research.state.views).toHaveLength(3);
});

test('merge preserves imported views that reference newly imported custom properties', () => {
  const imported = backup();
  imported.properties.push({ id: 'p_lag', name: 'Lag', type: 'number', unit: 'days', options: [] });
  imported.views.push({ id: 'v_lag_view', name: 'Reporting lag', config: { ...imported.view, columns: [...imported.view.columns, 'p_lag'], sort: 'p_lag' } });
  research.previewImport(imported); expect(research.applyImport('merge')).toBe(true);
  expect(research.state.properties[0].id).toBe('p_lag');
  expect(research.state.views[0].config.sort).toBe('p_lag');
  [...document.querySelectorAll('.rw-view')].find(button => button.textContent === 'Reporting lag').click();
  expect(research.state.view.sort).toBe('p_lag');
  expect(research.state.view.columns).toContain('p_lag');
});

test('import preview blocks a merge above 40 views, offers Replace, and never partially changes state', () => {
  const config = backup().view;
  research.state.views = Array.from({ length: 40 }, (_, index) => ({ id: 'v_local_' + index, name: 'Local ' + index, config: { ...config, query: 'local ' + index } }));
  const imported = backup();
  imported.views = [{ id: 'v_imported', name: 'Imported', config: { ...config, query: 'imported' } }];
  const before = backup();
  research.previewImport(imported);
  expect(document.querySelector('[data-rw-action="apply-import"]').disabled).toBe(true);
  expect(document.getElementById('rw-import-error').textContent).toContain('41 saved views');
  expect(document.getElementById('rw-import-error').textContent).toContain('Choose Replace');
  expect(research.applyImport('merge')).toBe(false);
  expect(backup()).toEqual(before);
  const replace = document.querySelector('[name="rw-import-mode"][value="replace"]'); replace.checked = true; replace.dispatchEvent(new Event('change', { bubbles: true }));
  expect(document.querySelector('[data-rw-action="apply-import"]').disabled).toBe(false);
  expect(document.getElementById('rw-import-error').hidden).toBe(true);
  expect(research.applyImport('replace')).toBe(true);
  expect(research.state.views).toHaveLength(1);
  expect(research.state.views[0].id).toBe('v_imported');
  research.undo(); expect(research.state.views).toHaveLength(40);
  research.saveView('Over the limit'); expect(research.state.views).toHaveLength(40);
});

test('backup validation rejects more than 40 saved views with a specific limit message', () => {
  const imported = backup();
  imported.views = Array.from({ length: 41 }, (_, index) => ({ id: 'v_view_' + index, name: 'View ' + index, config: { ...imported.view, query: String(index) } }));
  expect(() => research.previewImport(imported)).toThrow('up to 40 saved views');
});
