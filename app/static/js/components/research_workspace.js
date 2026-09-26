/* Browser-local personal research. Source snapshots are immutable; user values are separate. */
(function () {
    'use strict';
    if (window.BW?.ResearchWorkspace) return;
    const STORAGE_KEY = 'bw.research.workspace.v1';
    const MAX_VIEWS = 40;
    const STATUSES = ['To review', 'In progress', 'Reviewed'];
    const TYPES = ['text', 'number', 'date', 'checkbox', 'select'];
    const BASE = [
        { id: 'title', name: 'Title' }, { id: 'status', name: 'Status' },
        { id: 'benchmark', name: 'Linked benchmark' }, { id: 'tags', name: 'Tags' },
        { id: 'notes', name: 'Note' }, { id: 'updatedAt', name: 'Last edited' }
    ];
    const DEFAULT_VIEW = { query: '', status: '', archived: false, sort: 'updatedAt', direction: 'desc', columns: BASE.map(p => p.id), hidden: [] };
    const fresh = () => ({ version: 1, entries: [], properties: [], views: [], view: structured(DEFAULT_VIEW) });
    const structured = value => JSON.parse(JSON.stringify(value));
    const text = (tag, value, className) => { const node = document.createElement(tag); if (value !== undefined) node.textContent = String(value); if (className) node.className = className; return node; };
    const uid = prefix => prefix + (window.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
    const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    const safeURL = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch (_) { return null; } };
    const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    function requireValue(condition, message) { if (!condition) throw new Error(message); }
    function bounded(value, limit, field) { requireValue(typeof value === 'string' && value.length <= limit, 'Invalid ' + field + '.'); return value; }
    function timestamp(value) { requireValue(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'Invalid edit date.'); return new Date(value).toISOString(); }
    function validateView(value, ids) {
        requireValue(value && typeof value === 'object' && !Array.isArray(value), 'Invalid view.');
        const view = structured(DEFAULT_VIEW);
        view.query = bounded(value.query ?? '', 1000, 'view search');
        requireValue(value.status === '' || STATUSES.includes(value.status), 'Invalid status filter.');
        view.status = value.status; view.archived = value.archived === true;
        view.sort = ids.has(value.sort) ? value.sort : 'updatedAt'; view.direction = value.direction === 'asc' ? 'asc' : 'desc';
        for (const key of ['columns', 'hidden']) {
            requireValue(Array.isArray(value[key]) && value[key].every(id => typeof id === 'string' && ids.has(id)), 'Invalid view properties.');
            view[key] = [...new Set(value[key])];
        }
        view.columns = ['title', ...view.columns.filter(id => id !== 'title'), ...[...ids].filter(id => !view.columns.includes(id))];
        view.hidden = view.hidden.filter(id => id !== 'title');
        return view;
    }
    function validateBackup(raw) {
        requireValue(raw && raw.version === 1 && Array.isArray(raw.entries) && Array.isArray(raw.properties), 'This is not a supported BenchmarkWatcher Research version 1 backup.');
        requireValue(raw.entries.length <= 5000 && raw.properties.length <= 30, 'This backup exceeds the limit of 5,000 entries or 30 personal properties.');
        const ids = new Set(BASE.map(p => p.id));
        const properties = raw.properties.map(p => {
            requireValue(p && typeof p === 'object' && typeof p.id === 'string' && /^p_[a-zA-Z0-9_-]{1,100}$/.test(p.id) && !ids.has(p.id), 'Invalid or duplicate property ID.');
            ids.add(p.id); requireValue(TYPES.includes(p.type), 'Unsupported property type.');
            const property = { id: p.id, name: bounded(p.name, 60, 'property name'), type: p.type, unit: bounded(p.unit ?? '', 30, 'property unit'), options: [] };
            requireValue(property.name.trim(), 'Property names cannot be empty.');
            if (p.type === 'select') {
                requireValue(Array.isArray(p.options) && p.options.length > 0 && p.options.length <= 50, 'Select properties need 1 to 50 options.');
                property.options = [...new Set(p.options.map(v => bounded(v, 100, 'select option')))];
                requireValue(property.options.every(v => v.trim()), 'Select options cannot be empty.');
            }
            return property;
        });
        const entryIds = new Set();
        const entries = raw.entries.map(entry => {
            requireValue(entry && typeof entry === 'object' && typeof entry.id === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(entry.id) && !entryIds.has(entry.id), 'Invalid or duplicate entry ID.');
            entryIds.add(entry.id); requireValue(STATUSES.includes(entry.status), 'Invalid entry status.');
            requireValue(Array.isArray(entry.tags) && entry.tags.length <= 50, 'Invalid entry tags.');
            requireValue(entry.values && typeof entry.values === 'object' && !Array.isArray(entry.values), 'Invalid personal values.');
            const cleaned = { id: entry.id, title: bounded(entry.title, 300, 'title'), status: entry.status, notes: bounded(entry.notes, 100000, 'notes'), citations: bounded(entry.citations ?? '', 20000, 'citations'), tags: [...new Set(entry.tags.map(tag => bounded(tag, 100, 'tag')))], archived: entry.archived === true, createdAt: timestamp(entry.createdAt), updatedAt: timestamp(entry.updatedAt), values: {}, drafts: {}, benchmark: null };
            // Citations may be unfinished drafts; they are never rendered as links without URL validation.
            for (const property of properties) {
                if (entry.drafts && own(entry.drafts, property.id)) { requireValue(property.type === 'number', 'Only number properties support unfinished drafts.'); cleaned.drafts[property.id] = bounded(entry.drafts[property.id], 1000, 'property draft'); }
                if (!own(entry.values, property.id)) continue;
                const value = entry.values[property.id];
                if (property.type === 'number') requireValue(value === '' || (typeof value === 'number' && Number.isFinite(value)), 'Invalid number in ' + property.name + '.');
                else if (property.type === 'checkbox') requireValue(typeof value === 'boolean', 'Invalid checkbox in ' + property.name + '.');
                else if (property.type === 'date') requireValue(value === '' || (typeof value === 'string' && validDate(value)), 'Invalid date in ' + property.name + '.');
                else if (property.type === 'select') requireValue(value === '' || property.options.includes(value), 'Unknown option in ' + property.name + '.');
                else bounded(value, 10000, 'text value');
                cleaned.values[property.id] = value;
            }
            if (entry.benchmark) {
                const source = entry.benchmark;
                cleaned.benchmark = {};
                for (const key of ['id', 'name', 'unit', 'currency', 'date', 'source', 'sourceUrl', 'category']) cleaned.benchmark[key] = bounded(source[key] ?? '', 1000, 'linked source ' + key);
                requireValue(cleaned.benchmark.id, 'Linked benchmark ID is missing.');
                cleaned.benchmark.price = source.price == null ? null : source.price;
                requireValue(cleaned.benchmark.price === null || (typeof source.price === 'number' && Number.isFinite(source.price)), 'Invalid source price.');
            }
            return cleaned;
        });
        requireValue(!raw.views || Array.isArray(raw.views), 'Invalid saved views.');
        requireValue(!raw.views || raw.views.length <= MAX_VIEWS, 'This workspace supports up to ' + MAX_VIEWS + ' saved views.');
        const viewIds = new Set();
        const views = (raw.views || []).map(view => {
            requireValue(view && typeof view.id === 'string' && /^v_[a-zA-Z0-9_-]{1,100}$/.test(view.id) && !viewIds.has(view.id), 'Invalid saved view ID.'); viewIds.add(view.id);
            return { id: view.id, name: bounded(view.name, 60, 'view name'), config: validateView(view.config, ids) };
        });
        return { version: 1, entries, properties, views, view: raw.view ? validateView(raw.view, ids) : { ...structured(DEFAULT_VIEW), columns: [...ids] } };
    }
    function mergeViews(current, imported, propertyIds) {
        const views = current.map(view => ({ ...view, config: validateView(view.config, propertyIds) }));
        const signatures = new Set(views.map(view => JSON.stringify([view.name, view.config])));
        const usedIds = new Set([...current, ...imported].map(view => view.id));
        for (const source of imported) {
            const view = { ...source, config: validateView(source.config, propertyIds) };
            const signature = JSON.stringify([view.name, view.config]);
            if (signatures.has(signature)) continue;
            if (views.some(existing => existing.id === view.id)) {
                do { view.id = uid('v_'); } while (usedIds.has(view.id));
                usedIds.add(view.id);
            }
            views.push(view); signatures.add(signature);
        }
        return views;
    }

    const Research = {
        state: fresh(), undoStack: [], root: null, timer: null, editorId: null, pendingImport: null, activeView: 'all', saveState: 'idle', loadBlocked: false, fieldOriginal: new WeakMap(),
        init() {
            if (this.root) return;
            this.root = document.getElementById('research-workspace');
            if (!this.root) return;
            let raw;
            try { raw = localStorage.getItem(STORAGE_KEY); }
            catch (_) { this.storageReadFailed = true; this.loadError = 'Browser storage is unavailable. Edits stay in memory; retry saving or export a backup.'; this.saveState = 'failed'; }
            if (raw) {
                try { this.state = validateBackup(JSON.parse(raw)); this.saveState = 'saved'; }
                catch (_) { this.loadBlocked = true; this.loadError = 'The saved workspace could not be read. It has not been overwritten. Import a valid backup using Replace to recover it.'; this.saveState = 'failed'; }
            }
            const savedView = this.state.views.find(view => JSON.stringify(view.config) === JSON.stringify(this.state.view));
            this.activeView = savedView?.id || (this.state.view.archived ? 'archive' : this.state.view.status === 'To review' ? 'review' : 'all');
            this.root.addEventListener('click', event => {
                const action = event.target.closest('[data-rw-action]');
                if (action) this.action(action.dataset.rwAction, action);
                const entry = event.target.closest('[data-rw-entry]');
                if (entry) this.focusEntry(entry.dataset.rwEntry);
            });
            this.$('rw-search').addEventListener('input', event => this.setSearch(event.target.value));
            this.$('rw-status-filter').addEventListener('change', event => this.updateView({ status: event.target.value }));
            this.$('rw-sort').addEventListener('change', event => this.updateView({ sort: event.target.value }));
            this.$('rw-sort-direction').addEventListener('click', () => this.updateView({ direction: this.state.view.direction === 'asc' ? 'desc' : 'asc' }));
            this.$('rw-editor-form').addEventListener('submit', event => event.preventDefault());
            this.$('rw-editor-form').addEventListener('focusin', event => {
                if (event.target.name || event.target.dataset.property) this.fieldOriginal.set(event.target, { state: structured(this.state), value: event.target.value, checked: event.target.checked });
            });
            this.$('rw-editor-form').addEventListener('input', event => this.editField(event.target));
            this.$('rw-editor-form').addEventListener('change', event => {
                const original = this.fieldOriginal.get(event.target);
                if (original && (original.value !== event.target.value || original.checked !== event.target.checked)) this.remember(original.state);
                this.editField(event.target); this.flush();
                this.fieldOriginal.set(event.target, { state: structured(this.state), value: event.target.value, checked: event.target.checked });
            });
            this.$('rw-editor-form').addEventListener('keydown', event => {
                if (event.key !== 'Escape') return;
                const original = this.fieldOriginal.get(event.target);
                if (original && (original.value !== event.target.value || original.checked !== event.target.checked)) {
                    event.preventDefault(); event.stopPropagation(); event.target.value = original.value; event.target.checked = original.checked; this.editField(event.target); this.flush(); this.announce('Field restored.');
                }
            });
            this.root.querySelectorAll('dialog').forEach(dialog => {
                dialog.addEventListener('cancel', event => { event.preventDefault(); this.closeDialog(dialog); });
                dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.closeDialog(dialog); } });
            });
            this.$('rw-property-form').addEventListener('submit', event => { event.preventDefault(); this.addProperty(new FormData(event.target)); });
            this.$('rw-property-form').elements.propertyType.addEventListener('change', event => { this.$('rw-options-label').hidden = event.target.value !== 'select'; this.$('rw-unit-label').hidden = event.target.value !== 'number'; });
            this.$('rw-unit-label').hidden = true;
            this.$('rw-view-form').addEventListener('submit', event => { event.preventDefault(); this.saveView(event.target.elements.viewName.value); });
            this.$('rw-import-file').addEventListener('change', event => this.readImport(event.target.files?.[0]));
            this.root.querySelectorAll('[name="rw-import-mode"]').forEach(input => input.addEventListener('change', () => this.renderImportMode()));
            window.addEventListener('pagehide', () => this.flush());
            window.addEventListener('beforeunload', event => { if (this.saveState === 'failed' || this.saveState === 'draft') { this.flush(); if (this.saveState === 'failed') { event.preventDefault(); event.returnValue = ''; } } });
            // Do not replace in-memory drafts when another tab changes storage.
            window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) { this.loadBlocked = true; this.saveState = 'failed'; this.loadError = 'Research changed in another tab. Export this tab’s backup, then reload before editing.'; this.renderSaveState(); } });
            this.render();
        },
        $(id) { return document.getElementById(id); },
        announce(message) { this.$('rw-announcement').textContent = message; },
        remember(snapshot = this.state) { this.undoStack.push(structured(snapshot)); if (this.undoStack.length > 30) this.undoStack.shift(); this.$('rw-undo').disabled = false; },
        scheduleSave() { this.saveState = 'draft'; this.renderSaveState(); clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 450); },
        flush() {
            clearTimeout(this.timer); this.timer = null;
            if (this.saveState === 'idle' || this.saveState === 'saved') return true;
            if (this.loadBlocked) { this.saveState = 'failed'; this.renderSaveState(); return false; }
            this.saveState = 'saving'; this.renderSaveState();
            try {
                if (this.storageReadFailed) {
                    const existing = localStorage.getItem(STORAGE_KEY);
                    this.storageReadFailed = false;
                    if (existing) { this.loadBlocked = true; this.saveState = 'failed'; this.loadError = 'An existing workspace is now available. Export your current drafts, then reload and merge the backup.'; this.renderSaveState(); return false; }
                }
                localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); this.saveState = 'saved'; this.loadError = '';
            }
            catch (_) { this.saveState = 'failed'; this.loadError = 'Storage is unavailable or full. Your draft is still here. Retry or export a backup.'; }
            this.renderSaveState(); return this.saveState === 'saved';
        },
        renderSaveState() {
            const labels = { idle: 'No changes yet', draft: 'Unsaved changes…', saving: 'Saving…', saved: 'Saved in this browser', failed: 'Not saved — ' + (this.loadError || 'Retry or export a backup.') };
            ['rw-save-state', 'rw-editor-save'].forEach(id => { const node = this.$(id); node.textContent = labels[this.saveState]; node.dataset.saveState = this.saveState; });
            this.$('rw-retry').hidden = this.saveState !== 'failed' || this.loadBlocked;
        },
        change(callback, message) { this.remember(); callback(); this.scheduleSave(); this.render(); if (message) this.announce(message); },
        allProperties() { return [...BASE, ...this.state.properties]; },
        updateView(patch) { Object.assign(this.state.view, patch); this.activeView = ''; this.scheduleSave(); this.render(); },
        setSearch(query) { if (!this.root) this.init(); if (!this.root) return; this.updateView({ query: String(query).slice(0, 1000) }); },
        getSearchItems() {
            if (!this.root) this.init();
            let state = this.state;
            if (!this.root) {
                // Standalone benchmark pages can search local notes without mounting or writing a workspace.
                try { const raw = localStorage.getItem(STORAGE_KEY); state = raw ? validateBackup(JSON.parse(raw)) : fresh(); }
                catch (_) { return []; }
            }
            return state.entries.filter(e => !e.archived).map(e => ({ id: e.id, title: e.title || 'Untitled entry', status: e.status, tags: [...e.tags], notes: e.notes }));
        },
        rows() {
            const view = this.state.view, query = view.query.trim().toLocaleLowerCase();
            const rows = this.state.entries.filter(entry => entry.archived === view.archived && (!view.status || entry.status === view.status) && (!query || [entry.title, entry.notes, entry.tags.join(' '), entry.benchmark?.name, ...Object.values(entry.values), ...Object.values(entry.drafts || {})].join(' ').toLocaleLowerCase().includes(query)));
            const getValue = entry => entry.drafts && own(entry.drafts, view.sort) ? undefined : view.sort === 'benchmark' ? entry.benchmark?.name : own(entry.values, view.sort) ? entry.values[view.sort] : view.sort === 'tags' ? entry.tags.join(', ') : entry[view.sort];
            return rows.sort((a, b) => {
                const av = getValue(a), bv = getValue(b), am = av == null || av === '', bm = bv == null || bv === '';
                if (am !== bm) return am ? 1 : -1;
                const compare = typeof av === 'number' && typeof bv === 'number' ? av - bv : typeof av === 'boolean' && typeof bv === 'boolean' ? Number(av) - Number(bv) : String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: false });
                return compare ? compare * (view.direction === 'asc' ? 1 : -1) : a.id.localeCompare(b.id);
            });
        },
        render() {
            if (!this.root) return;
            const view = this.state.view, properties = this.allProperties();
            this.$('rw-search').value = view.query; this.$('rw-status-filter').value = view.status;
            const sortSelect = this.$('rw-sort'); sortSelect.replaceChildren();
            properties.filter(p => !['notes', 'tags'].includes(p.id)).forEach(p => { const option = text('option', p.name); option.value = p.id; sortSelect.append(option); }); sortSelect.value = view.sort;
            this.$('rw-sort-direction').textContent = view.direction === 'asc' ? '↑' : '↓';
            this.$('rw-sort-direction').setAttribute('aria-label', (view.direction === 'asc' ? 'Ascending. Change to descending sort' : 'Descending. Change to ascending sort'));
            const views = this.$('rw-views'); views.replaceChildren();
            [{ id: 'all', name: 'All entries', config: { status: '', archived: false } }, { id: 'review', name: 'To review', config: { status: 'To review', archived: false } }, { id: 'archive', name: 'Archived', config: { status: '', archived: true } }, ...this.state.views].forEach(viewOption => {
                const wrapper = text('span', undefined, 'rw-saved-view'), button = text('button', viewOption.name, 'rw-view'); button.type = 'button'; button.setAttribute('aria-pressed', String(this.activeView === viewOption.id)); button.addEventListener('click', () => { this.state.view = { ...this.state.view, query: '', ...structured(viewOption.config) }; this.activeView = viewOption.id; this.scheduleSave(); this.render(); }); wrapper.append(button);
                if (viewOption.id.startsWith('v_')) { const remove = text('button', '×', 'rw-remove-view'); remove.type = 'button'; remove.setAttribute('aria-label', 'Remove view ' + viewOption.name); remove.addEventListener('click', () => this.change(() => { this.state.views = this.state.views.filter(v => v.id !== viewOption.id); this.activeView = ''; }, 'View removed. Entries are unchanged. Undo is available.')); wrapper.append(remove); }
                views.append(wrapper);
            });
            const columns = view.columns.map(id => properties.find(p => p.id === id)).filter(p => p && !view.hidden.includes(p.id));
            const header = text('tr'); columns.forEach(property => { const th = text('th'); th.scope = 'col'; const button = text('button', property.name + (view.sort === property.id ? view.direction === 'asc' ? ' ↑' : ' ↓' : '')); button.type = 'button'; button.addEventListener('click', () => this.updateView({ sort: property.id, direction: view.sort === property.id && view.direction === 'asc' ? 'desc' : 'asc' })); th.setAttribute('aria-sort', view.sort === property.id ? view.direction === 'asc' ? 'ascending' : 'descending' : 'none'); th.append(button); header.append(th); }); this.$('rw-table-head').replaceChildren(header);
            const rows = this.rows(), body = this.$('rw-table-body'); body.replaceChildren();
            rows.forEach(entry => { const tr = text('tr'); columns.forEach(property => {
                const td = text('td');
                if (property.id === 'title') { const button = text('button', entry.title || 'Untitled entry', 'rw-entry-title'); button.type = 'button'; button.dataset.rwEntry = entry.id; button.title = entry.title || 'Untitled entry'; td.append(button); }
                else if (property.id === 'status') { const badge = text('span', entry.status, 'rw-status'); badge.dataset.status = entry.status; td.append(badge); }
                else if (property.id === 'tags') { if (!entry.tags.length) td.append(text('span', '—', 'rw-muted')); entry.tags.forEach(tag => td.append(text('span', tag, 'rw-tag'))); }
                else if (property.id === 'updatedAt') { const time = text('time', new Date(entry.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })); time.dateTime = entry.updatedAt; time.title = new Date(entry.updatedAt).toLocaleString(); td.append(time); }
                else { let value = property.id === 'benchmark' ? entry.benchmark?.name : property.id === 'notes' ? entry.notes : entry.values[property.id]; if (entry.drafts && own(entry.drafts, property.id)) value = 'Draft · ' + entry.drafts[property.id]; if (typeof value === 'boolean') value = value ? '✓ Yes' : 'No'; if (typeof value === 'number') value = value.toLocaleString(undefined, { maximumFractionDigits: 10 }) + (property.unit ? ' ' + property.unit : ''); const span = text('span', value == null || value === '' ? '—' : value, 'rw-cell-text'); span.title = span.textContent; td.append(span); }
                tr.append(td);
            }); body.append(tr); });
            this.$('rw-count').textContent = rows.length + (rows.length === 1 ? ' entry' : ' entries') + (view.archived ? ' in archive' : '');
            this.$('rw-reset').hidden = !view.query && !view.status;
            this.$('rw-empty').hidden = rows.length !== 0; this.root.querySelector('.rw-table-region').hidden = rows.length === 0;
            this.$('rw-empty-heading').textContent = view.query || view.status ? 'No entries match this view' : view.archived ? 'The archive is empty' : 'A place for your next question';
            this.$('rw-empty-copy').textContent = view.query || view.status ? 'Try another search or clear the filters. Your entries are still here.' : view.archived ? 'Archived entries stay here until you restore them.' : 'Start with a note, or add a benchmark from the collection. Your source data stays read-only.';
            this.$('rw-undo').disabled = this.undoStack.length === 0;
            this.renderSaveState();
            document.dispatchEvent(new CustomEvent('bw:research-count', { detail: { count: this.state.entries.filter(e => !e.archived).length } }));
        },
        createEntry(benchmark = null) {
            const now = new Date().toISOString();
            return { id: uid('e_'), title: benchmark?.name || '', status: 'To review', tags: [], notes: '', citations: '', values: {}, drafts: {}, benchmark, archived: false, createdAt: now, updatedAt: now };
        },
        focusNewEntry() { if (!this.root) this.init(); if (!this.root) return; if (this.state.entries.length >= 5000) { this.announce('This workspace supports 5,000 entries. Export a backup before starting a new workspace.'); return; } let entry; this.change(() => { entry = this.createEntry(); this.state.entries.push(entry); this.state.view.archived = false; this.state.view.query = ''; this.state.view.status = ''; }, 'New entry created.'); this.focusEntry(entry.id); this.$('rw-editor-form').elements.title.focus(); },
        addBenchmarks(benchmarks) {
            if (!this.root) this.init(); if (!this.root || !Array.isArray(benchmarks)) return [];
            const result = []; this.remember();
            for (const source of benchmarks.slice(0, 100)) {
                if (!source || source.id == null) continue;
                const existing = this.state.entries.find(e => !e.archived && e.benchmark?.id === String(source.id));
                if (existing) { result.push(existing.id); continue; }
                if (this.state.entries.length >= 5000) break;
                const benchmark = { id: String(source.id).slice(0, 1000), name: String(source.name || source.id).slice(0, 300), unit: String(source.unit || '').slice(0, 1000), currency: String(source.currency || '').slice(0, 1000), date: String(source.date || source.latest_date || '').slice(0, 1000), source: String(source.source_name || source.source || '').slice(0, 1000), sourceUrl: String(source.source_url || '').slice(0, 1000), category: String(source.category || '').slice(0, 1000), price: source.price === '' || source.price == null || !Number.isFinite(Number(source.price)) ? null : Number(source.price) };
                const entry = this.createEntry(benchmark); this.state.entries.push(entry); result.push(entry.id);
            }
            if (result.length) { this.scheduleSave(); this.render(); this.announce(result.length + ' benchmark entries ready in Research.'); document.dispatchEvent(new CustomEvent('bw:research-open')); this.focusEntry(result[0]); }
            return result;
        },
        openDialog(dialog) { this.returnFocus = document.activeElement; if (!dialog.open) { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', ''); } },
        closeDialog(dialog) {
            const entryId = dialog.id === 'rw-editor' ? this.editorId : null;
            if (entryId) { this.flush(); this.editorId = null; }
            if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
            if (this.returnFocus?.isConnected) this.returnFocus.focus();
            else if (entryId) { const button = Array.from(this.root.querySelectorAll('[data-rw-entry]')).find(node => node.dataset.rwEntry === entryId); (button || this.root.querySelector('[data-rw-action="new"]')).focus(); }
        },
        focusEntry(id) {
            if (!this.root) this.init(); const entry = this.state.entries.find(e => e.id === id); if (!entry) return false;
            this.editorId = id; this.renderEditor(entry); document.dispatchEvent(new CustomEvent('bw:research-open')); this.openDialog(this.$('rw-editor')); return true;
        },
        renderEditor(entry) {
            const form = this.$('rw-editor-form');
            for (const key of ['title', 'status', 'notes', 'citations']) form.elements[key].value = entry[key]; form.elements.tags.value = entry.tags.join(', ');
            const linked = this.$('rw-linked-source'); linked.replaceChildren(); linked.hidden = !entry.benchmark;
            if (entry.benchmark) {
                const source = entry.benchmark; linked.append(text('strong', 'Linked benchmark · read-only snapshot')); const link = text('a', source.name); link.href = '/commodity/' + encodeURIComponent(source.id); linked.append(link);
                linked.append(text('p', [source.price === null ? 'Reference value unavailable' : source.price.toLocaleString(undefined, { maximumFractionDigits: 8 }), source.currency, source.unit].filter(Boolean).join(' ')));
                linked.append(text('p', [source.date ? 'Observation: ' + source.date : '', source.source].filter(Boolean).join(' · ')));
                linked.append(text('small', 'Captured when added. Open the benchmark for its current published history. Your personal properties do not alter source observations.'));
            }
            this.$('rw-archive-entry').textContent = entry.archived ? 'Restore entry' : 'Archive';
            this.$('rw-discard-entry').hidden = !this.isEmptyDraft(entry);
            const custom = this.$('rw-custom-fields'); custom.replaceChildren();
            this.state.properties.forEach(property => {
                const label = text('label', property.name + (property.unit ? ' (' + property.unit + ')' : ''));
                const input = document.createElement(property.type === 'select' ? 'select' : 'input'); input.dataset.property = property.id; input.setAttribute('aria-label', property.name);
                if (property.type === 'select') { const empty = text('option', 'No value'); empty.value = ''; input.append(empty); property.options.forEach(value => { const option = text('option', value); option.value = value; input.append(option); }); }
                else { input.type = property.type === 'checkbox' ? 'checkbox' : property.type === 'date' ? 'date' : 'text'; if (property.type === 'number') { input.inputMode = 'decimal'; input.maxLength = 1000; } if (property.type === 'text') input.maxLength = 10000; }
                if (property.type === 'checkbox') input.checked = entry.values[property.id] === true; else input.value = entry.drafts?.[property.id] ?? entry.values[property.id] ?? '';
                if (entry.drafts && own(entry.drafts, property.id)) { input.setAttribute('aria-invalid', 'true'); const error = text('small', 'Unfinished number saved as a draft. Enter a valid number to use it in the table.', 'rw-error'); label.append(error); }
                label.append(input); custom.append(label);
            });
            this.renderCitations(entry.citations); this.renderSaveState();
        },
        renderCitations(value) {
            const links = this.$('rw-citation-links'); links.replaceChildren(); let invalid = 0;
            value.split('\n').map(v => v.trim()).filter(Boolean).forEach(value => { const url = safeURL(value); if (!url) { invalid++; return; } const link = text('a', value); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; links.append(link); });
            this.$('rw-citation-error').hidden = invalid === 0; this.$('rw-citation-error').textContent = invalid + ' unfinished or unsupported link' + (invalid === 1 ? '' : 's') + '. Text is saved; only complete http or https links are clickable.';
        },
        editField(input) {
            const entry = this.state.entries.find(e => e.id === this.editorId); if (!entry) return;
            if (input.dataset.property) {
                const property = this.state.properties.find(p => p.id === input.dataset.property); if (!property) return;
                entry.drafts = entry.drafts || {};
                const invalidNumber = property.type === 'number' && input.value !== '' && (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(input.value.trim()) || !Number.isFinite(Number(input.value)));
                input.setAttribute('aria-invalid', String(invalidNumber));
                const oldError = input.parentElement.querySelector('.rw-error'); if (oldError) oldError.remove();
                if (invalidNumber) { entry.drafts[property.id] = input.value; input.parentElement.append(text('small', 'Unfinished number saved as a draft. Enter a valid number to use it in the table.', 'rw-error')); }
                else { delete entry.drafts[property.id]; entry.values[property.id] = property.type === 'checkbox' ? input.checked : property.type === 'number' && input.value !== '' ? Number(input.value) : input.value; }
            } else if (['title', 'notes', 'status', 'citations', 'tags'].includes(input.name)) {
                entry[input.name] = input.name === 'tags' ? [...new Set(input.value.split(',').map(tag => tag.trim().slice(0, 100)).filter(Boolean))].slice(0, 50) : input.value;
                if (input.name === 'citations') this.renderCitations(input.value);
            } else return;
            entry.updatedAt = new Date().toISOString(); this.$('rw-discard-entry').hidden = !this.isEmptyDraft(entry); this.scheduleSave(); this.render();
        },
        isEmptyDraft(entry) { return !entry.benchmark && !entry.title.trim() && !entry.notes.trim() && !entry.citations.trim() && !entry.tags.length && !Object.values(entry.values).some(value => value !== '' && value !== false) && !Object.keys(entry.drafts || {}).length; },
        renderProperties() {
            const list = this.$('rw-property-list'); list.replaceChildren(); const all = this.allProperties();
            this.state.view.columns.forEach((id, index) => {
                const property = all.find(p => p.id === id); if (!property) return;
                const row = text('div', undefined, 'rw-property-row'), label = text('label'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = !this.state.view.hidden.includes(id); input.disabled = id === 'title';
                input.addEventListener('change', () => { this.state.view.hidden = input.checked ? this.state.view.hidden.filter(value => value !== id) : [...this.state.view.hidden, id]; this.scheduleSave(); this.render(); }); label.append(input, text('span', property.name)); row.append(label);
                [['↑', -1, 'left'], ['↓', 1, 'right']].forEach(([symbol, movement, direction]) => { const button = text('button', symbol, 'rw-button'); button.type = 'button'; button.disabled = id === 'title' || index + movement < 1 || index + movement >= this.state.view.columns.length; button.setAttribute('aria-label', 'Move ' + property.name + ' ' + direction); button.addEventListener('click', () => { const columns = this.state.view.columns; [columns[index], columns[index + movement]] = [columns[index + movement], columns[index]]; this.scheduleSave(); this.render(); this.renderProperties(); this.$('rw-property-list').querySelectorAll('.rw-property-row')[index + movement].querySelector('button').focus(); }); row.append(button); }); list.append(row);
            });
        },
        addProperty(form) {
            const name = String(form.get('propertyName') || '').trim(), type = form.get('propertyType'), unit = type === 'number' ? String(form.get('propertyUnit') || '').trim() : '', options = [...new Set(String(form.get('propertyOptions') || '').split(',').map(v => v.trim()).filter(Boolean))];
            const error = !name ? 'Enter a property name.' : this.state.properties.length >= 30 ? 'This workspace supports up to 30 personal properties.' : this.allProperties().some(p => p.name.toLocaleLowerCase() === name.toLocaleLowerCase()) ? 'Choose a different name; that property already exists.' : type === 'select' && (options.length < 1 || options.length > 50 || options.some(v => v.length > 100)) ? 'Enter 1 to 50 unique options, each up to 100 characters.' : '';
            this.$('rw-property-error').hidden = !error; this.$('rw-property-error').textContent = error; if (error) return;
            const property = { id: uid('p_'), name, type, unit, options: type === 'select' ? options : [] };
            this.change(() => { this.state.properties.push(property); this.state.view.columns.push(property.id); }, 'Personal property added.'); this.renderProperties(); this.$('rw-property-form').reset(); this.$('rw-options-label').hidden = true; this.$('rw-unit-label').hidden = true;
        },
        saveView(name) {
            name = name.trim(); if (!name || this.state.views.length >= MAX_VIEWS) { this.announce('Use a name and keep at most ' + MAX_VIEWS + ' saved views.'); return; }
            const view = { id: uid('v_'), name, config: structured(this.state.view) }; this.change(() => { this.state.views.push(view); this.activeView = view.id; }, 'View saved in this browser.'); this.closeDialog(this.$('rw-view-dialog')); this.$('rw-view-form').reset();
        },
        async readImport(file) {
            if (!file) return; this.pendingImport = null; this.$('rw-import-error').hidden = true;
            try { requireValue(file.size <= 5 * 1024 * 1024, 'Choose a backup smaller than 5 MB.'); const raw = typeof file.text === 'function' ? await file.text() : await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsText(file); }); this.previewImport(raw); }
            catch (error) { this.openDialog(this.$('rw-import-dialog')); this.$('rw-import-summary').textContent = 'This file could not be imported.'; this.$('rw-import-error').hidden = false; this.$('rw-import-error').textContent = error.message || 'Could not read the file.'; this.root.querySelector('[data-rw-action="apply-import"]').disabled = true; }
            this.$('rw-import-file').value = '';
        },
        previewImport(raw) {
            this.pendingImport = validateBackup(typeof raw === 'string' ? JSON.parse(raw) : raw);
            const ids = new Set(this.state.entries.map(e => e.id)), matches = this.pendingImport.entries.filter(e => ids.has(e.id)).length;
            const propertyIds = new Set([...BASE, ...this.state.properties, ...this.pendingImport.properties].map(property => property.id));
            this.pendingMergeViewCount = mergeViews(this.state.views, this.pendingImport.views, propertyIds).length;
            this.$('rw-import-summary').textContent = this.pendingImport.entries.length + ' entries (' + matches + ' matching existing IDs), ' + this.pendingImport.properties.length + ' personal properties, and ' + this.pendingImport.views.length + ' saved views. Your current workspace has ' + this.state.entries.length + ' entries. Merging would keep ' + this.pendingMergeViewCount + ' saved views after removing identical copies.';
            this.$('rw-import-error').hidden = true; this.root.querySelector('[data-rw-action="apply-import"]').disabled = false;
            this.root.querySelector('[name="rw-import-mode"][value="merge"]').checked = true; this.renderImportMode(); this.openDialog(this.$('rw-import-dialog'));
        },
        renderImportMode() {
            const overLimit = this.root.querySelector('[name="rw-import-mode"]:checked').value === 'merge' && this.pendingMergeViewCount > MAX_VIEWS;
            this.$('rw-import-error').hidden = !overLimit;
            this.$('rw-import-error').textContent = overLimit ? 'Merging would create ' + this.pendingMergeViewCount + ' saved views, exceeding the limit of ' + MAX_VIEWS + '. Choose Replace to use only the backup’s views, or remove saved views before merging.' : '';
            this.root.querySelector('[data-rw-action="apply-import"]').disabled = overLimit;
        },
        applyImport(mode) {
            if (!this.pendingImport) return false;
            try {
                let next = structured(this.pendingImport);
                if (mode !== 'replace') {
                    next = structured(this.state);
                    for (const property of this.pendingImport.properties) {
                        const existing = next.properties.find(p => p.id === property.id);
                        requireValue(!existing || JSON.stringify(existing) === JSON.stringify(property), 'Property “' + property.name + '” conflicts with an existing property. Choose Replace, or import into another browser.');
                        if (!existing) { next.properties.push(property); next.view.columns.push(property.id); }
                    }
                    next.views = mergeViews(next.views, this.pendingImport.views, new Set([...BASE, ...next.properties].map(property => property.id)));
                    requireValue(next.views.length <= MAX_VIEWS, 'Merging would exceed the limit of ' + MAX_VIEWS + ' saved views. Choose Replace to use only the backup’s views, or remove saved views before merging.');
                    const entries = new Map(next.entries.map(e => [e.id, e]));
                    this.pendingImport.entries.forEach(entry => { const existing = entries.get(entry.id); if (!existing || Date.parse(entry.updatedAt) > Date.parse(existing.updatedAt)) entries.set(entry.id, entry); }); next.entries = [...entries.values()];
                }
                next = validateBackup(next); this.remember(); this.state = next; this.activeView = '';
                // A valid explicit Replace also recovers an unreadable local backup.
                if (mode === 'replace') { this.loadBlocked = false; this.storageReadFailed = false; this.loadError = ''; }
                this.scheduleSave(); this.render(); this.flush(); this.closeDialog(this.$('rw-import-dialog')); this.pendingImport = null; this.announce('Backup imported. Undo is available.'); return true;
            } catch (error) { this.$('rw-import-error').hidden = false; this.$('rw-import-error').textContent = error.message; return false; }
        },
        exportBackup() {
            const content = JSON.stringify({ ...this.state, exportedAt: new Date().toISOString(), application: 'BenchmarkWatcher Research' }, null, 2);
            const blob = new Blob([content], { type: 'application/json;charset=utf-8' }), url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'benchmarkwatcher-research-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); this.announce('Research backup download started. Includes current unsaved changes.'); return content;
        },
        undo() { if (!this.undoStack.length) return; this.state = this.undoStack.pop(); this.scheduleSave(); this.render(); if (this.editorId) { const entry = this.state.entries.find(e => e.id === this.editorId); if (entry) this.renderEditor(entry); else this.closeDialog(this.$('rw-editor')); } this.announce('Previous change restored.'); },
        action(action) {
            const closeNames = { 'close-editor': 'rw-editor', 'close-properties': 'rw-properties-dialog', 'close-import': 'rw-import-dialog', 'close-view': 'rw-view-dialog' }; if (closeNames[action]) { this.closeDialog(this.$(closeNames[action])); return; }
            if (action === 'new') this.focusNewEntry();
            if (action === 'undo') this.undo();
            if (action === 'retry') { this.saveState = 'draft'; this.flush(); }
            if (action === 'reset') this.updateView({ query: '', status: '' });
            if (action === 'export') this.exportBackup();
            if (action === 'import') this.$('rw-import-file').click();
            if (action === 'properties') { this.renderProperties(); this.openDialog(this.$('rw-properties-dialog')); }
            if (action === 'save-view') this.openDialog(this.$('rw-view-dialog'));
            if (action === 'apply-import') this.applyImport(this.root.querySelector('[name="rw-import-mode"]:checked').value);
            if (action === 'discard') { const entry = this.state.entries.find(e => e.id === this.editorId); if (entry && this.isEmptyDraft(entry)) { this.change(() => { this.state.entries = this.state.entries.filter(e => e.id !== entry.id); }, 'Empty draft discarded. Undo is available.'); this.closeDialog(this.$('rw-editor')); } }
            if (action === 'archive') { const entry = this.state.entries.find(e => e.id === this.editorId); if (entry) { this.change(() => { entry.archived = !entry.archived; entry.updatedAt = new Date().toISOString(); }, entry.archived ? 'Entry restored.' : 'Entry archived. Find it in Archived, or undo.'); this.closeDialog(this.$('rw-editor')); } }
            if (action === 'duplicate') { const entry = this.state.entries.find(e => e.id === this.editorId); if (entry && this.state.entries.length < 5000) { let copy; this.change(() => { copy = structured(entry); copy.id = uid('e_'); copy.title = (entry.title || 'Untitled entry') + ' (copy)'; copy.title = copy.title.slice(0, 300); copy.createdAt = copy.updatedAt = new Date().toISOString(); copy.archived = false; this.state.entries.push(copy); }, 'Entry duplicated.'); this.editorId = copy.id; this.renderEditor(copy); } }
        },
        validateBackup,
        STORAGE_KEY
    };
    window.BW = window.BW || {}; window.BW.ResearchWorkspace = Research;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Research.init(), { once: true }); else Research.init();
})();
