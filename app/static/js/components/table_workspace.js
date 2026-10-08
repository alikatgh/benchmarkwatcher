/** Persistent, read-only benchmark views. No source observation is editable here. */
(function () {
    'use strict';
    window.BW = window.BW || {};
    const KEY = 'bw-table-workspace-v1';
    const RANGES = ['1W', '1M', '3M', '6M', '1Y', 'ALL'];
    const PROPERTIES = [
        { key: 'commodity', label: 'Benchmark', type: 'text', field: 'name', width: 280, min: 200 },
        { key: 'price', label: 'Reference value', type: 'number', field: 'price', width: 166, min: 135 },
        { key: 'pct', label: 'Change %', type: 'number', field: 'changePct', width: 120, min: 100 },
        { key: 'trend', label: 'History', width: 140, min: 110 },
        { key: 'updated', label: 'Observed', type: 'date', field: 'date', width: 132, min: 112 },
        { key: 'chg', label: 'Change', type: 'number', field: 'changeAbs', width: 120, min: 100 },
        { key: 'category', label: 'Category', type: 'text', field: 'category', width: 150, min: 110 },
        { key: 'frequency', label: 'Frequency', type: 'text', field: 'frequency', width: 120, min: 100 }
    ];
    const property = key => PROPERTIES.find(item => item.key === key);
    const copy = value => JSON.parse(JSON.stringify(value));
    const byId = id => document.getElementById(id);
    const number = value => value === '' || value === null || value === undefined || typeof value === 'boolean' ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
    const text = value => String(value ?? '').trim();
    const node = (tag, className, content) => { const element = document.createElement(tag); if (className) element.className = className; if (content !== undefined) element.textContent = content; return element; };
    const button = (label, callback, className = 'tw-button') => { const element = node('button', className, label); element.type = 'button'; element.addEventListener('click', callback); return element; };
    function defaults() {
        return { query: '', filters: { category: '', frequency: '', availability: '', direction: '', watch: '' }, sorts: [{ key: 'commodity', direction: 'asc' }], order: PROPERTIES.map(p => p.key), visible: ['commodity', 'price', 'pct', 'trend', 'updated'], widths: {}, density: 'comfortable', range: '1Y' };
    }
    function normalize(input) {
        const result = defaults();
        if (!input || typeof input !== 'object') return result;
        result.query = text(input.query).slice(0, 250);
        const filters = input.filters || {};
        result.filters = {
            category: text(filters.category).slice(0, 80),
            frequency: ['daily', 'monthly'].includes(filters.frequency) ? filters.frequency : '',
            availability: ['available', 'unavailable', 'change', 'no-change'].includes(filters.availability) ? filters.availability : '',
            direction: ['up', 'down', 'flat'].includes(filters.direction) ? filters.direction : '',
            watch: ['watched', 'unwatched'].includes(filters.watch) ? filters.watch : ''
        };
        const seen = new Set();
        if (Array.isArray(input.sorts)) result.sorts = input.sorts.filter(rule => rule && property(rule.key)?.type && !seen.has(rule.key) && seen.add(rule.key)).slice(0, PROPERTIES.length).map(rule => ({ key: rule.key, direction: rule.direction === 'desc' ? 'desc' : 'asc' }));
        if (Array.isArray(input.order)) result.order = ['commodity', ...new Set([...input.order, ...result.order].filter(key => key !== 'commodity' && property(key)))];
        if (Array.isArray(input.visible)) result.visible = ['commodity', ...new Set(input.visible.filter(key => key !== 'commodity' && property(key)))];
        PROPERTIES.forEach(p => { const width = number(input.widths?.[p.key]); if (width !== null) result.widths[p.key] = Math.max(p.min, Math.min(600, width)); });
        result.density = input.density === 'compact' ? 'compact' : 'comfortable';
        result.range = RANGES.includes(input.range) ? input.range : result.range;
        return result;
    }
    function compareRows(a, b, sorts) {
        for (const rule of sorts) {
            const p = property(rule.key);
            if (!p?.type) continue;
            let av = a.dataset[p.field], bv = b.dataset[p.field];
            if (p.type === 'number') { av = number(av); bv = number(bv); }
            else if (p.type === 'date') { av = av && Number.isFinite(Date.parse(av)) ? Date.parse(av) : null; bv = bv && Number.isFinite(Date.parse(bv)) ? Date.parse(bv) : null; }
            else { av = text(av) || null; bv = text(bv) || null; }
            if (av === null && bv === null) continue;
            if (av === null) return 1;
            if (bv === null) return -1;
            const comparison = typeof av === 'string' ? av.localeCompare(bv, undefined, { sensitivity: 'base', numeric: true }) : av - bv;
            if (comparison) return rule.direction === 'desc' ? -comparison : comparison;
        }
        return text(a.dataset.id).localeCompare(text(b.dataset.id));
    }
    const Workspace = {
        ready: false,
        properties: PROPERTIES,
        defaults,
        normalize,
        compareRows,
        current: defaults(),
        views: [],
        activeId: 'all',
        selected: new Set(),
        watched: new Set(),
        externalQuery: '',
        externalFilter: 'all',
        navigationWatchOnly: false,
        storageOkay: true,
        controlsCollapsed: false,
        controlsManual: null,
        compactLayout: false,
        mobileLayout: false,
        sheetPanel: null,
        sheetHistoryActive: false,
        historyClosing: false,
        getRows() { return Array.from(byId('table-body')?.querySelectorAll('tr[data-id]') || []); },
        getVisibleRows() { return this.getRows().filter(row => !row.hidden && row.style.display !== 'none'); },
        getSelectedIds() { return this.getRows().filter(row => this.selected.has(row.dataset.id)).map(row => row.dataset.id); },
        announce(message) { if (byId('tw-announcement')) byId('tw-announcement').textContent = message; },
        persist() {
            try {
                localStorage.setItem(KEY, JSON.stringify({ version: 1, activeId: this.activeId, current: this.current, views: this.views }));
                this.storageOkay = true;
            } catch (_) { this.storageOkay = false; }
            if (byId('tw-storage-warning')) byId('tw-storage-warning').hidden = this.storageOkay;
            this.updateViewStatus();
            return this.storageOkay;
        },
        restore() {
            try {
                const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
                if (saved?.version === 1) {
                    this.current = normalize(saved.current);
                    const ids = new Set();
                    this.views = (Array.isArray(saved.views) ? saved.views : []).filter(view => view && typeof view.id === 'string' && view.id.startsWith('view-') && !ids.has(view.id) && ids.add(view.id) && text(view.name)).slice(0, 40).map(view => ({ id: view.id, name: text(view.name).slice(0, 60), config: normalize(view.config) }));
                    this.activeId = ['all', 'watchlist', ...this.views.map(view => view.id)].includes(saved.activeId) ? saved.activeId : 'all';
                }
            } catch (_) { this.storageOkay = false; }
        },
        change(patch, renderControls = false) {
            this.current = normalize({ ...this.current, ...patch });
            this.persist();
            this.apply();
            if (renderControls) this.renderControls();
        },
        setExternalQuery(query, filter = 'all') { this.externalQuery = text(query).toLowerCase(); this.externalFilter = filter; this.apply(); },
        setWatchOnly(watched) { this.navigationWatchOnly = Boolean(watched); this.renderViews(); this.apply(); },
        setCategory(category) { this.change({ filters: { ...this.current.filters, category: text(category) } }, true); },
        setWatchlist(ids) { this.watched = new Set(Array.isArray(ids) ? ids.map(String) : []); this.apply(); },
        rangeChanged(range) {
            if (!RANGES.includes(range) || this.current.range === range) return;
            this.current.range = range;
            this.persist();
            this.renderControls();
        },
        matches(row) {
            const data = row.dataset;
            const haystack = [data.name, data.category, data.currency, data.unit, data.source].filter(Boolean).join(' ').toLowerCase();
            if ((this.current.query && !haystack.includes(this.current.query.toLowerCase())) || (this.externalQuery && !haystack.includes(this.externalQuery))) return false;
            if (this.navigationWatchOnly && !this.watched.has(data.id)) return false;
            const f = this.current.filters;
            if (f.category && text(data.category).toLowerCase() !== f.category.toLowerCase()) return false;
            if (f.frequency && data.frequency !== f.frequency) return false;
            if (f.direction && data.direction !== f.direction) return false;
            if (f.watch === 'watched' && !this.watched.has(data.id)) return false;
            if (f.watch === 'unwatched' && this.watched.has(data.id)) return false;
            const available = number(data.price) !== null, change = number(data.changePct) !== null;
            if ((f.availability === 'available' && !available) || (f.availability === 'unavailable' && available) || (f.availability === 'change' && !change) || (f.availability === 'no-change' && change)) return false;
            if (['daily', 'monthly'].includes(this.externalFilter) && data.frequency !== this.externalFilter) return false;
            if (['up', 'down', 'flat'].includes(this.externalFilter) && data.direction !== this.externalFilter) return false;
            return true;
        },
        hydrateRows() {
            this.getRows().forEach(row => {
                // Only the identity link opens details. Row checkboxes and actions remain independent.
                row.onclick = null;
                row.removeAttribute('onclick'); row.removeAttribute('onkeydown'); row.removeAttribute('tabindex'); row.removeAttribute('role');
                if (!row.querySelector('[data-col="selection"]')) {
                    const cell = node('td'); cell.dataset.col = 'selection';
                    const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.className = 'tw-row-select'; checkbox.setAttribute('aria-label', `Select ${row.dataset.name || 'benchmark'}`);
                    checkbox.addEventListener('change', () => { if (checkbox.checked) this.selected.add(row.dataset.id); else this.selected.delete(row.dataset.id); this.updateSelection(); this.announce(`${this.selected.size} benchmarks selected`); });
                    cell.append(checkbox); row.prepend(cell);
                }
                const name = row.querySelector('.commodity-name');
                if (name && name.tagName !== 'A') {
                    const link = node('a', 'commodity-name', name.textContent.trim());
                    link.href = `/commodity/${encodeURIComponent(row.dataset.id)}`; link.dataset.benchmarkId = row.dataset.id;
                    name.replaceWith(link);
                }
                const link = row.querySelector('.commodity-name');
                if (link) { link.dataset.benchmarkId = row.dataset.id; link.title = row.dataset.name; }
                const identity = row.querySelector('.commodity-cell');
                if (identity && !identity.querySelector('.tw-watch')) {
                    const watch = button('☆', () => document.dispatchEvent(new CustomEvent('bw:watch-toggle', { detail: { id: row.dataset.id } })), 'tw-watch');
                    identity.append(watch);
                }
                ['category', 'frequency'].forEach(key => { if (!row.querySelector(`[data-col="${key}"]`)) { const cell = node('td', '', key === 'frequency' ? (row.dataset.frequency === 'daily' ? 'Daily' : 'Monthly') : row.dataset.category); cell.dataset.col = key; row.append(cell); } });
                const priceElement = row.querySelector('.price-value');
                const preferences = BW.CompactTable?.getSettings?.()?.price || {};
                const price = number(row.dataset.price);
                if (priceElement && price !== null && preferences.format !== 'compact') {
                    const precision = Math.max(0, Math.min(10, Number(preferences.precision ?? 2) || 0));
                    priceElement.textContent = price.toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision });
                }
                const currency = row.querySelector('.price-currency');
                if (currency) currency.textContent = [row.dataset.currency, row.dataset.unit].filter(Boolean).join(' / ');
                row.querySelector('.commodity-icon')?.remove();
                row.querySelector('.freq-badge')?.remove();
                const sparkline = row.querySelector('svg[id^="sparkline-"]');
                if (sparkline) { sparkline.parentElement.className = 'tw-sparkline'; sparkline.setAttribute('role', 'img'); sparkline.setAttribute('aria-label', `Historical observations for ${row.dataset.name}`); }
            });
        },
        refresh() {
            if (!this.ready) return;
            this.hydrateRows();
            const ids = new Set(this.getRows().map(row => row.dataset.id));
            this.selected = new Set([...this.selected].filter(id => ids.has(id)));
            this.renderCategories(); this.apply();
        },
        apply() {
            if (!this.ready) return;
            const rows = this.getRows();
            rows.sort((a, b) => compareRows(a, b, this.current.sorts));
            rows.forEach(row => {
                const visible = this.matches(row);
                row.hidden = !visible; row.style.display = visible ? '' : 'none';
                row.classList.toggle('quick-find-hidden', !visible);
                byId('table-body').append(row);
                const watch = row.querySelector('.tw-watch');
                if (watch) { const watched = this.watched.has(row.dataset.id); watch.textContent = watched ? '★' : '☆'; watch.setAttribute('aria-pressed', String(watched)); watch.setAttribute('aria-label', `${watched ? 'Unwatch' : 'Watch'} ${row.dataset.name}`); }
            });
            this.applyColumns(); this.updateSelection(); this.renderChips();
            const count = this.getVisibleRows().length;
            if (byId('tw-result-count')) byId('tw-result-count').textContent = `${count} of ${rows.length} benchmarks`;
            this.renderCompactSummary();
            if (byId('tw-empty')) byId('tw-empty').hidden = count > 0;
            if (byId('tw-export-filtered')) byId('tw-export-filtered').disabled = count === 0;
            if (byId('tw-export-all')) byId('tw-export-all').disabled = rows.length === 0;
            this.renderSortIndicators();
            document.dispatchEvent(new CustomEvent('bw:table-view-change', { detail: { activeId: this.activeId, state: copy(this.current), count } }));
            this.renderMobileRows();
            if (this.sheetHistoryActive) this.sheetReturnUrl = location.href;
            if (byId('tw-sheet-done') && this.panelId === 'tw-filters') byId('tw-sheet-done').textContent = `Show ${count} ${count === 1 ? 'result' : 'results'}`;
        },
        applyColumns() {
            const table = byId('data-table'); if (!table) return;
            table.dataset.density = this.current.density;
            const columns = ['selection', ...this.current.order];
            table.querySelectorAll('tr').forEach(row => {
                columns.forEach(key => {
                    const cell = row.querySelector(`[data-col="${key}"]`); if (!cell) return;
                    row.append(cell);
                    const visible = key === 'selection' || this.current.visible.includes(key);
                    cell.hidden = !visible;
                    cell.style.setProperty('display', visible ? 'table-cell' : 'none', 'important');
                    const p = property(key); const width = p ? (this.current.widths[key] || p.width) : 42;
                    cell.style.width = `${width}px`; cell.style.minWidth = `${width}px`; cell.style.maxWidth = `${width}px`;
                    const resizer = cell.querySelector('.tw-resizer'); if (resizer) resizer.setAttribute('aria-valuenow', String(width));
                });
            });
            const total = 42 + this.current.visible.reduce((sum, key) => sum + (this.current.widths[key] || property(key).width), 0);
            table.style.width = `${total}px`; table.style.minWidth = `max(100%, ${total}px)`;
        },
        renderMobileRows() {
            const list = byId('tw-mobile-list'); if (!list || !this.mobileLayout) return;
            list.dataset.density = this.current.density;
            const focused = document.activeElement?.closest('[data-mobile-id]');
            const focusedId = focused?.dataset.mobileId, focusedAction = document.activeElement?.dataset.mobileAction;
            list.replaceChildren();
            const visible = new Set(this.current.visible);
            this.getVisibleRows().forEach(row => {
                const data = row.dataset, item = node('article', 'tw-mobile-row');
                item.dataset.mobileId = data.id; item.setAttribute('role', 'listitem');
                item.classList.toggle('is-selected', this.selected.has(data.id));
                const heading = node('div', 'tw-mobile-row-heading'), selectLabel = node('label', 'tw-mobile-select');
                const select = node('input'); select.type = 'checkbox'; select.checked = this.selected.has(data.id); select.dataset.mobileAction = 'select';
                select.setAttribute('aria-label', `Select ${data.name}`);
                select.addEventListener('change', () => { select.checked ? this.selected.add(data.id) : this.selected.delete(data.id); this.updateSelection(); this.announce(`${this.selected.size} benchmarks selected`); });
                selectLabel.append(select);
                const name = node('a', 'tw-mobile-name', data.name); name.href = row.querySelector('.commodity-name')?.href || `/commodity/${encodeURIComponent(data.id)}`;
                name.dataset.benchmarkId = data.id; name.dataset.mobileAction = 'detail';
                const watched = this.watched.has(data.id), watch = button(watched ? '★' : '☆', () => document.dispatchEvent(new CustomEvent('bw:watch-toggle', { detail: { id: data.id } })), 'tw-watch');
                watch.dataset.mobileAction = 'watch'; watch.setAttribute('aria-pressed', String(watched)); watch.setAttribute('aria-label', `${watched ? 'Unwatch' : 'Watch'} ${data.name}`);
                heading.append(selectLabel, name, watch); item.append(heading);
                const values = node('div', 'tw-mobile-row-values');
                if (visible.has('price')) { const price = node('div', 'tw-mobile-price'); price.append(node('strong', '', row.querySelector('.price-value')?.textContent || '—'), node('small', '', row.querySelector('.price-currency')?.textContent || [data.currency, data.unit].filter(Boolean).join(' / '))); values.append(price); }
                if (visible.has('pct')) { const change = node('span', 'tw-mobile-change', (row.querySelector('.pct-cell [data-value]') || row.querySelector('.pct-cell'))?.textContent?.trim() || '—'); change.style.color = `var(--color-${['up', 'down', 'flat'].includes(data.direction) ? data.direction : 'flat'})`; change.setAttribute('aria-label', `Historical change ${change.textContent}`); values.append(change); }
                if (values.childElementCount) item.append(values);
                if (visible.has('trend')) {
                    const history = BW.CompactTable?.sparklineData?.find(commodity => String(commodity.id) === data.id);
                    if (history && BW.Visuals?.sparkline) {
                        const chart = node('div', 'tw-mobile-history'), svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                        svg.id = `tw-mobile-sparkline-${BW.CompactTable.safeDomId?.(data.id) || data.id}`;
                        svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Historical observations for ${data.name}`); chart.append(svg); item.append(chart); list.append(item);
                        const preferences = BW.CompactTable.getSettings?.()?.trend || {}, count = preferences.points === 'all' ? Infinity : (parseInt(preferences.points, 10) || 30);
                        BW.Visuals.sparkline(svg, count === Infinity ? (history.history || []) : (history.history || []).slice(-count), {type: preferences.type || 'area', gapDays: history.is_daily ? 7 : 62, showMA: preferences.showMA, showHighLow: preferences.showHighLow});
                    }
                }
                const meta = node('div', 'tw-mobile-meta');
                if (visible.has('updated')) meta.append(node('span', '', `Observed ${data.date || '—'}`));
                if (visible.has('category')) meta.append(node('span', '', data.category));
                if (visible.has('frequency')) meta.append(node('span', '', data.frequency === 'daily' ? 'Daily observations' : 'Monthly observations'));
                if (meta.childElementCount) item.append(meta);
                if (visible.has('chg')) { const absolute = node('div', 'tw-mobile-extra'); absolute.append(node('span', '', 'Change'), node('span', '', row.querySelector('.chg-value')?.textContent?.trim() || '—')); item.append(absolute); }
                list.append(item);
            });
            this.updateMobileBusy();
            if (focusedId && focusedAction) [...list.querySelectorAll('[data-mobile-id]')].find(item => item.dataset.mobileId === focusedId)?.querySelector(`[data-mobile-action="${focusedAction}"]`)?.focus({preventScroll:true});
        },
        updateMobileBusy() {
            const busy = byId('data-table')?.getAttribute('aria-busy') === 'true', list = byId('tw-mobile-list'), status = byId('tw-mobile-status');
            if (list) { list.setAttribute('aria-busy', String(busy)); list.inert = busy; }
            if (status) { status.hidden = !this.mobileLayout || !busy; status.textContent = busy ? 'Updating observations…' : ''; }
        },
        updateLayout() {
            const root = byId('table-workspace'); if (!root) return;
            const width = root.clientWidth || root.getBoundingClientRect().width;
            // jsdom and hidden workspaces have no layout; wait for an actual width.
            if (!width) return;
            const compact = width <= 767, mobile = width <= 540;
            if (compact === this.compactLayout && mobile === this.mobileLayout) return;
            if (this.hasOpenPanel()) this.closePanels(true);
            this.compactLayout = compact; this.mobileLayout = mobile;
            if (compact) this.setControlsCollapsed(false);
            if (compact) byId('tw-filter-button')?.setAttribute('aria-haspopup','dialog'); else byId('tw-filter-button')?.removeAttribute('aria-haspopup');
            if (byId('tw-property-help')) byId('tw-property-help').textContent = mobile ? 'Choose information shown in each result. Reordering and column widths apply to the table on larger screens.' : 'Drag a property to reorder, or use Move left / right. Benchmark stays pinned. Drag a header edge or use its arrow keys to resize.';
            this.renderChips(); this.renderMobileRows(); this.updateMobileBusy();
        },
        resize(key, width, persist = true) {
            const p = property(key); if (!p) return;
            this.current.widths[key] = Math.round(Math.max(p.min, Math.min(600, width)));
            this.applyColumns();
            if (persist) this.persist();
        },
        fitProperty(key) {
            const p = property(key); if (!p) return;
            const probe = node('span');
            probe.style.cssText = 'position:fixed;left:-10000px;top:0;white-space:pre;font:14px Inter,system-ui,sans-serif;visibility:hidden';
            document.body.append(probe);
            const values = [p.label, ...this.getRows().map(row => p.field ? row.dataset[p.field] || '' : '')];
            let width = p.min;
            values.forEach(value => { probe.textContent = value; width = Math.max(width, probe.getBoundingClientRect().width + (key === 'commodity' ? 72 : 32)); });
            probe.remove();
            this.resize(key, key === 'trend' ? p.width : width);
        },
        moveProperty(key, offset) {
            const order = [...this.current.order], index = order.indexOf(key), next = index + offset;
            if (key === 'commodity' || index < 1 || next < 1 || next >= order.length) return;
            [order[index], order[next]] = [order[next], order[index]];
            this.change({ order }); this.renderProperties();
            byId(`tw-move-${key}-${offset > 0 ? 'right' : 'left'}`)?.focus();
        },
        sortBy(key, additive = false) {
            if (!property(key)?.type) return;
            const existing = this.current.sorts.find(rule => rule.key === key);
            const next = { key, direction: existing?.direction === 'asc' ? 'desc' : 'asc' };
            const sorts = additive ? this.current.sorts.map(rule => rule.key === key ? next : rule) : [next];
            if (additive && !existing) sorts.push(next);
            this.change({ sorts }); this.renderSortRules();
        },
        renderHeaders() {
            const tr = byId('data-table')?.querySelector('thead tr'); if (!tr) return;
            PROPERTIES.forEach(p => {
                let th = tr.querySelector(`[data-col="${p.key}"]`);
                if (!th) { th = node('th'); th.scope = 'col'; th.dataset.col = p.key; tr.append(th); }
                th.onclick = null; th.removeAttribute('onclick'); th.replaceChildren();
                if (p.type) {
                    const sort = button(p.label, event => this.sortBy(p.key, event.shiftKey), 'tw-header-sort');
                    sort.append(node('span', 'tw-sort-indicator')); th.append(sort);
                } else th.append(node('span', 'tw-header-label', p.label));
                const resizer = node('span', 'tw-resizer');
                resizer.tabIndex = 0; resizer.setAttribute('role', 'separator'); resizer.setAttribute('aria-orientation', 'vertical'); resizer.setAttribute('aria-label', `Resize ${p.label}`); resizer.setAttribute('aria-valuemin', String(p.min)); resizer.setAttribute('aria-valuemax', '600');
                resizer.addEventListener('keydown', event => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault(); event.stopPropagation();
                    const old = this.current.widths[p.key] || p.width;
                    this.resize(p.key, event.key === 'Home' ? p.width : event.key === 'End' ? 600 : old + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 50 : 10));
                    this.announce(`${p.label} width ${this.current.widths[p.key]} pixels`);
                });
                resizer.addEventListener('dblclick', event => { event.preventDefault(); this.fitProperty(p.key); });
                resizer.addEventListener('pointerdown', event => {
                    if (event.button !== 0) return;
                    event.preventDefault(); event.stopPropagation();
                    const start = event.clientX, width = this.current.widths[p.key] || p.width;
                    const move = e => this.resize(p.key, width + e.clientX - start, false);
                    const end = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', end); document.removeEventListener('pointercancel', end); this.persist(); };
                    document.addEventListener('pointermove', move); document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);
                });
                th.append(resizer);
            });
        },
        renderSortIndicators() {
            byId('data-table')?.querySelectorAll('th[data-col]').forEach(th => {
                const index = this.current.sorts.findIndex(rule => rule.key === th.dataset.col), rule = this.current.sorts[index];
                th.removeAttribute('aria-sort'); if (index === 0) th.setAttribute('aria-sort', rule.direction === 'asc' ? 'ascending' : 'descending');
                const indicator = th.querySelector('.tw-sort-indicator'); if (indicator) indicator.textContent = rule ? ` ${rule.direction === 'asc' ? '↑' : '↓'}${this.current.sorts.length > 1 ? index + 1 : ''}` : '';
                th.querySelector('.tw-header-sort')?.setAttribute('title', rule ? `Sort priority ${index + 1}, ${rule.direction === 'asc' ? 'ascending' : 'descending'}. Click to reverse; Shift-click to retain other sorts.` : 'Sort ascending. Shift-click to add a sort.');
            });
            if (byId('tw-sort-count')) byId('tw-sort-count').textContent = this.current.sorts.length ? `(${this.current.sorts.length})` : '';
            const summary = this.current.sorts.map(rule => `${property(rule.key)?.label} ${rule.direction === 'desc' ? 'descending' : 'ascending'}`).join(', ') || 'No sort applied';
            byId('tw-sort-button')?.setAttribute('title', `Change sorting: ${summary}`);
            if (byId('tw-more-sort-summary')) byId('tw-more-sort-summary').textContent = this.current.sorts.map(rule => `${property(rule.key)?.label} · ${rule.direction === 'desc' ? 'descending' : 'ascending'}`).join(', ') || 'No sort applied';
        },
        updateSelection() {
            const rows = this.getRows(), visible = this.getVisibleRows(), selectedVisible = visible.filter(row => this.selected.has(row.dataset.id)).length;
            rows.forEach(row => { const checked = this.selected.has(row.dataset.id); const checkbox = row.querySelector('.tw-row-select'); if (checkbox) checkbox.checked = checked; row.classList.toggle('tw-selected', checked); });
            const all = byId('tw-select-all');
            if (all) { all.checked = visible.length > 0 && selectedVisible === visible.length; all.indeterminate = selectedVisible > 0 && selectedVisible < visible.length; all.disabled = !visible.length; all.setAttribute('aria-label', `Select all ${visible.length} filtered benchmarks`); }
            const selectedRows = rows.filter(row => this.selected.has(row.dataset.id));
            const hiddenCount = selectedRows.length - selectedVisible;
            if (byId('tw-selection')) byId('tw-selection').hidden = selectedRows.length === 0;
            if (byId('tw-selection-count')) byId('tw-selection-count').textContent = `${selectedRows.length} selected${hiddenCount ? ` (${hiddenCount} outside filters)` : ''}`;
            if (byId('tw-export-selected')) byId('tw-export-selected').textContent = `Export ${selectedRows.length} selected`;
            if (byId('tw-compare-selected')) { byId('tw-compare-selected').disabled = selectedRows.length < 2 || selectedRows.length > 4; byId('tw-compare-selected').title = 'Select 2–4 benchmarks to compare'; }
            byId('tw-mobile-list')?.querySelectorAll('[data-mobile-id]').forEach(item => {
                const id = item.dataset.mobileId;
                item.classList.toggle('is-selected', this.selected.has(id));
                const checkbox = item.querySelector('input[type=checkbox]'); if (checkbox) checkbox.checked = this.selected.has(id);
            });
            document.dispatchEvent(new CustomEvent('bw:table-selection', { detail: { ids: selectedRows.map(row => row.dataset.id), rows: selectedRows } }));
        },
        clearFilters() { this.change({ query: '', filters: defaults().filters }, true); },
        renderCategories() {
            const select = byId('tw-category'); if (!select) return;
            const categories = [...new Set([...this.getRows().map(row => text(row.dataset.category)), this.current.filters.category].filter(Boolean))].sort();
            select.replaceChildren(new Option('All categories', '')); categories.forEach(category => select.add(new Option(category.replace(/\b\w/g, c => c.toUpperCase()), category)));
            select.value = this.current.filters.category;
        },
        renderChips() {
            const container = byId('tw-filter-chips'); if (!container) return;
            container.replaceChildren();
            const items = node('div', 'tw-chip-items'); container.append(items);
            const labels = { category: 'Category', frequency: 'Frequency', availability: 'Availability', direction: 'Direction', watch: 'Membership' };
            let count = 0;
            Object.entries(this.current.filters).forEach(([key, value]) => {
                if (!value) return; count += 1;
                const select = byId(`tw-${key}`), option = Array.from(select?.options || []).find(item => item.value === value);
                const chip = button(`${this.compactLayout ? '' : labels[key] + ': '}${option?.textContent || value} ×`, () => this.change({ filters: { ...this.current.filters, [key]: '' } }, true), 'tw-chip'); chip.setAttribute('aria-label', `Remove ${labels[key]} filter: ${option?.textContent || value}`); items.append(chip);
            });
            if (this.current.query) items.append(button(`Search: ${this.current.query} ×`, () => this.change({ query: '' }, true), 'tw-chip'));
            if (this.navigationWatchOnly) items.append(node('span', 'tw-help', 'Watchlist navigation is also applied'));
            if (this.externalQuery || this.externalFilter !== 'all') items.append(node('span', 'tw-help', 'Global search is also applied'));
            if (count || this.current.query) { const clear = button(this.compactLayout ? 'Clear' : 'Reset view filters', () => this.clearFilters(), 'tw-button tw-subtle'); if (this.compactLayout) clear.setAttribute('aria-label', 'Clear all view filters'); container.append(clear); }
            container.hidden = items.childElementCount === 0;
            if (byId('tw-filter-count')) byId('tw-filter-count').textContent = count ? `(${count})` : '';
            byId('tw-filter-button')?.classList.toggle('tw-filter-active', count > 0);
        },
        renderViews() {
            const container = byId('tw-views'); if (!container) return;
            container.replaceChildren();
            [{ id: 'all', name: this.navigationWatchOnly ? 'All in watchlist' : 'All benchmarks' }, { id: 'watchlist', name: 'Watchlist' }, ...this.views].forEach(view => {
                const tab = button(view.name, () => this.activateView(view.id), 'tw-view'); tab.dataset.viewId = view.id; tab.setAttribute('aria-pressed', String(view.id === this.activeId)); container.append(tab);
            });
            const picker = byId('tw-view-select');
            if (picker) { picker.replaceChildren(...[{ id: 'all', name: this.navigationWatchOnly ? 'All in watchlist' : 'All benchmarks' }, { id: 'watchlist', name: 'Watchlist' }, ...this.views].map(view => new Option(view.name, view.id))); picker.value = this.activeId; }
            const current = this.views.find(view => view.id === this.activeId);
            if (byId('tw-view-name') && byId('tw-view-menu')?.hidden) byId('tw-view-name').value = current?.name || '';
            this.renderCompactSummary();
            this.updateViewStatus();
        },
        renderCompactSummary() {
            const view = this.views.find(item => item.id === this.activeId);
            const name = view?.name || (this.activeId === 'watchlist' ? 'Watchlist' : this.navigationWatchOnly ? 'All in watchlist' : 'All benchmarks');
            if (byId('tw-summary-view')) byId('tw-summary-view').textContent = name;
            const filters = Object.values(this.current.filters).filter(Boolean).length + Number(Boolean(this.current.query || this.externalQuery || this.externalFilter !== 'all'));
            if (byId('tw-summary-context')) byId('tw-summary-context').textContent = `${this.current.range} · ${this.getVisibleRows().length} of ${this.getRows().length}${filters ? ` · ${filters} filters` : ''}`;
        },
        setControlsCollapsed(collapsed, manual = false) {
            const controls = byId('tw-controls'), views = byId('tw-viewbar'), toggle = byId('tw-controls-toggle');
            if (!controls || !toggle) return;
            if (collapsed && !manual && (controls.contains(document.activeElement) || views?.contains(document.activeElement) || this.hasOpenPanel())) return;
            const region = byId('table-workspace')?.querySelector('.tw-table-region');
            const preserveRows = collapsed && !manual && !this.controlsCollapsed && region;
            const previousTop = preserveRows ? region.getBoundingClientRect().top : 0;
            if (manual) this.controlsManual = collapsed ? 'closed' : 'open';
            this.controlsCollapsed = collapsed;
            controls.hidden = collapsed;
            if (views) views.hidden = collapsed;
            if (byId('tw-compact-summary')) byId('tw-compact-summary').hidden = !collapsed;
            byId('table-workspace')?.classList.toggle('tw-controls-collapsed', collapsed);
            toggle.setAttribute('aria-expanded', String(!collapsed));
            toggle.textContent = collapsed ? 'Show controls ⌄' : 'Hide controls ⌃';
            if (preserveRows) {
                const targetScroll = region.scrollTop + region.getBoundingClientRect().top - previousTop;
                region.scrollTop = Math.max(0, targetScroll);
                if (targetScroll < 0) window.scrollBy(0, targetScroll);
            }
            this.renderCompactSummary();
        },
        hasOpenPanel() {
            return ['view-menu', 'more-menu', 'tool-sheet', 'filters', 'sort-panel', 'properties', 'actions'].some(name => { const panel = byId(`tw-${name}`); return panel && !panel.hidden; });
        },
        updateScrollControls() {
            const root = byId('table-workspace'), region = root?.querySelector('.tw-table-region');
            if (!root || !region || !byId('tw-controls') || this.compactLayout || this.controlsManual || !root.getClientRects().length) return;
            // The root's document position does not depend on its children's height.
            // Separate thresholds prevent collapse/expand oscillation near the edge.
            const top = root.getBoundingClientRect().top + window.scrollY;
            const header = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bw-header-height')) || 48;
            const pagePast = window.scrollY > top - header + 56;
            // Leave enough scroll above the visible rows to compensate for the
            // removed controls, so collapsing never jumps to a different row.
            const controlsHeight = byId('tw-controls').getBoundingClientRect().height + Math.max(0, (byId('tw-viewbar')?.getBoundingClientRect().height || 0) - 44);
            if (!this.controlsCollapsed && (region.scrollTop > controlsHeight + 56 || pagePast)) this.setControlsCollapsed(true);
            else if (this.controlsCollapsed && region.scrollTop <= 4 && window.scrollY < Math.max(8, top - header - 120)) this.setControlsCollapsed(false);
        },
        prepareViewDialog(mode = 'manage') {
            const view = mode === 'manage' ? this.views.find(item => item.id === this.activeId) : null;
            this.editingViewId = view?.id || null;
            if (byId('tw-view-heading')) byId('tw-view-heading').textContent = view ? 'Edit saved view' : 'Save this view';
            if (byId('tw-view-submit')) byId('tw-view-submit').textContent = view ? 'Save changes' : 'Save as new view';
            if (byId('tw-view-name')) byId('tw-view-name').value = view?.name || '';
            if (byId('tw-view-actions')) byId('tw-view-actions').hidden = !view;
            if (byId('tw-view-help')) byId('tw-view-help').textContent = view ? 'Save this name and the current filters, sorting, properties, density and range.' : 'Save filters, sorting, properties, density and observation range as a new view in this browser.';
            if (byId('tw-view-save-status')) byId('tw-view-save-status').textContent = '';
        },
        updateViewStatus() {
            const current = this.views.find(view => view.id === this.activeId);
            const modified = current && JSON.stringify(current.config) !== JSON.stringify(this.current);
            if (byId('tw-view-status')) byId('tw-view-status').textContent = !this.storageOkay ? 'Not saved · retry or export a backup' : modified ? 'View changed · update it in View settings' : 'View preferences saved in this browser';
        },
        activateView(id) {
            const saved = this.views.find(view => view.id === id);
            if (!saved && !['all', 'watchlist'].includes(id)) return;
            const oldRange = this.current.range;
            this.activeId = id;
            if (saved) this.current = normalize(saved.config);
            else { this.current = normalize({ ...this.current, query: '', filters: { ...defaults().filters, watch: id === 'watchlist' ? 'watched' : '' } }); }
            this.persist(); this.renderControls(); this.apply();
            if (this.current.range !== oldRange) BW.CompactTable?.setDataRange(this.current.range);
            this.announce(`${saved?.name || (id === 'all' ? 'All benchmarks' : 'Watchlist')} view opened`);
        },
        saveView(name) {
            name = text(name).slice(0, 60); if (!name) return false;
            if (this.views.length >= 40) { this.announce('You can save up to 40 views. Remove an unused view first.'); return false; }
            const id = `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            this.views.push({ id, name, config: copy(this.current) }); this.activeId = id; this.persist(); this.renderViews();
            this.announce(this.storageOkay ? `${name} saved in this browser` : `${name} created, but not saved. Retry or export a backup.`);
            return true;
        },
        renderControls() {
            if (byId('tw-query')) byId('tw-query').value = this.current.query;
            this.renderCategories();
            Object.entries(this.current.filters).forEach(([key, value]) => { if (byId(`tw-${key}`)) byId(`tw-${key}`).value = value; });
            if (byId('tw-density')) byId('tw-density').value = this.current.density;
            this.renderViews(); this.renderProperties(); this.renderSortRules(); this.renderChips();
        },
        renderProperties() {
            const list = byId('tw-property-list'); if (!list) return; list.replaceChildren();
            this.current.order.forEach((key, index) => {
                const p = property(key), row = node('div', 'tw-property'); row.dataset.property = key; row.draggable = key !== 'commodity';
                const label = node('label'); const check = node('input'); check.type = 'checkbox'; check.checked = this.current.visible.includes(key); check.disabled = key === 'commodity';
                check.addEventListener('change', () => this.change({ visible: check.checked ? [...this.current.visible, key] : this.current.visible.filter(item => item !== key) })); label.append(check, document.createTextNode(p.label));
                const moves = node('div', 'tw-property-moves');
                [-1, 1].forEach(offset => { const direction = offset < 0 ? 'left' : 'right'; const move = button(offset < 0 ? '←' : '→', () => this.moveProperty(key, offset)); move.id = `tw-move-${key}-${direction}`; move.setAttribute('aria-label', `Move ${p.label} ${direction}`); move.disabled = key === 'commodity' || (offset < 0 ? index <= 1 : index === this.current.order.length - 1); moves.append(move); });
                row.append(node('span', 'tw-drag-handle', key === 'commodity' ? '⌖' : '⠿'), label, moves);
                row.addEventListener('dragstart', event => { if (key === 'commodity') { event.preventDefault(); return; } this.draggedProperty = key; event.dataTransfer?.setData('text/plain', key); });
                row.addEventListener('dragover', event => { if (key !== 'commodity') event.preventDefault(); });
                row.addEventListener('drop', event => { event.preventDefault(); const source = this.draggedProperty; this.draggedProperty = null; if (!source || source === key || key === 'commodity') return; const order = this.current.order.filter(item => item !== source); order.splice(order.indexOf(key), 0, source); this.change({ order }); this.renderProperties(); });
                list.append(row);
            });
        },
        renderSortRules() {
            const list = byId('tw-sort-rules'); if (!list) return; list.replaceChildren();
            this.current.sorts.forEach((rule, index) => {
                const row = node('div', 'tw-sort-rule'); row.append(node('span', 'tw-help', String(index + 1)));
                const key = node('select'); key.setAttribute('aria-label', `Sort ${index + 1} property`);
                PROPERTIES.filter(p => p.type).forEach(p => { const option = new Option(p.label, p.key); option.disabled = this.current.sorts.some((other, i) => other.key === p.key && i !== index); key.add(option); }); key.value = rule.key;
                const direction = node('select'); direction.setAttribute('aria-label', `Sort ${index + 1} direction`); direction.add(new Option('Ascending', 'asc')); direction.add(new Option('Descending', 'desc')); direction.value = rule.direction;
                const update = () => { const sorts = copy(this.current.sorts); sorts[index] = { key: key.value, direction: direction.value }; this.change({ sorts }); this.renderSortRules(); };
                key.addEventListener('change', update); direction.addEventListener('change', update);
                const remove = button('×', () => { this.change({ sorts: this.current.sorts.filter((_, i) => i !== index) }); this.renderSortRules(); }); remove.setAttribute('aria-label', `Remove sort ${index + 1}`);
                row.append(key, direction, remove); list.append(row);
            });
            if (byId('tw-add-sort')) byId('tw-add-sort').disabled = this.current.sorts.length >= PROPERTIES.filter(p => p.type).length;
        },
        closePanels(restoreFocus = false, keepHistory = false) {
            let focusTarget = this.panelTrigger;
            const dismissedPanel = this.panelId;
            ['view-menu', 'more-menu', 'tool-sheet', 'filters', 'sort-panel', 'properties', 'actions'].forEach(name => {
                const panel = byId(`tw-${name}`); if (!panel || panel.hidden) return;
                if (panel.open) { if (typeof panel.close === 'function') panel.close(); else panel.removeAttribute('open'); }
                panel.hidden = true; const trigger = document.querySelector(`[aria-controls="tw-${name}"]`); trigger?.setAttribute('aria-expanded', 'false'); focusTarget ||= trigger;
                document.querySelectorAll(`[aria-controls="tw-${name}"]`).forEach(control => control.setAttribute('aria-expanded', 'false'));
            });
            if (this.sheetPanel && this.sheetAnchor) { this.sheetAnchor.replaceWith(this.sheetPanel); this.sheetPanel = null; this.sheetAnchor = null; }
            if (!keepHistory && this.sheetHistoryActive) {
                this.sheetHistoryActive = false;
                if (history.state?.bwTableSheet === this.sheetToken) { this.historyClosing = true; this.sheetReturnUrl = location.href; history.back(); }
            }
            this.panelId = null;
            this.panelTrigger = null;
            if (restoreFocus && focusTarget) {
                if (!focusTarget.getClientRects().length && (this.compactLayout || this.mobileLayout)) {
                    const desktopTrigger = {'tw-filters':'tw-filter-button','tw-sort-panel':'tw-sort-button','tw-properties':'tw-properties-button','tw-actions':'tw-actions-button','tw-view-menu':'tw-view-menu-button'}[dismissedPanel];
                    focusTarget = [byId(desktopTrigger),byId('tw-more-button'),byId('tw-view-select'),byId('tw-query')].find(element => element?.getClientRects().length) || focusTarget;
                }
                focusTarget?.focus({preventScroll:true});
            }
        },
        togglePanel(panelId, trigger, mode) {
            const panel = byId(panelId); if (!panel) return;
            if (this.historyClosing) { this.pendingPanel = [panelId, trigger, mode]; return; }
            if (!panel.hidden && this.panelId === panelId) { this.closePanels(true); return; }
            const returnFocus = this.compactLayout ? (panelId === 'tw-filters' ? byId('tw-filter-button') : byId('tw-more-button')) : trigger;
            this.closePanels(false, this.compactLayout);
            panel.hidden = false; trigger?.setAttribute('aria-expanded', 'true'); this.panelId = panelId;
            this.panelTrigger = returnFocus || trigger;
            if (this.compactLayout && !this.sheetHistoryActive) {
                this.sheetToken = `table-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                this.sheetBaseUrl = location.href; this.sheetReturnUrl = location.href;
                history.pushState({...history.state, bwTableSheet:this.sheetToken}, '', location.href);
                this.sheetHistoryActive = true;
            }
            let dialog = panel;
            if (this.compactLayout && panel.tagName !== 'DIALOG' && byId('tw-tool-sheet')) {
                this.sheetAnchor = document.createComment('table control position'); panel.before(this.sheetAnchor); this.sheetPanel = panel;
                byId('tw-sheet-content').append(panel);
                dialog = byId('tw-tool-sheet'); dialog.hidden = false;
                const title = {'tw-filters':'Filters','tw-sort-panel':'Sort','tw-properties':'Columns','tw-actions':'Export'}[panelId] || 'View controls';
                byId('tw-sheet-heading').textContent = title;
                byId('tw-sheet-clear').hidden = panelId !== 'tw-filters';
                const resultCount = this.getVisibleRows().length;
                byId('tw-sheet-done').textContent = panelId === 'tw-filters' ? `Show ${resultCount} ${resultCount === 1 ? 'result' : 'results'}` : 'Done';
            }
            if (panelId === 'tw-view-menu') this.prepareViewDialog(mode || (trigger?.id === 'tw-new-view' ? 'new' : 'manage'));
            if (dialog.tagName === 'DIALOG') { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', ''); }
            if (panelId === 'tw-view-menu') (byId('tw-view-name') || panel.querySelector('input'))?.focus();
            else if (dialog.tagName === 'DIALOG') dialog.querySelector('h2[tabindex]')?.focus();
            else panel.querySelector('input,select,button')?.focus();
        },
        consumeSheetPop(event) {
            if ((!this.sheetHistoryActive && !this.historyClosing) || event.state?.bwTableSheet === this.sheetToken) return false;
            const current = new URL(location.href), base = new URL(this.sheetBaseUrl || location.href);
            const sameWorkspace = current.pathname === base.pathname && (current.searchParams.get('view') || '') === (base.searchParams.get('view') || '') && (current.searchParams.get('workspace') || '') === (base.searchParams.get('workspace') || '');
            this.sheetHistoryActive = false;
            this.closePanels(true, true);
            const pending = this.pendingPanel; this.pendingPanel = null; this.historyClosing = false;
            if (sameWorkspace) {
                // A sheet is one Back layer. Keep the filter URL synchronized with
                // the persisted controls instead of undoing the user's edits.
                history.replaceState(event.state, '', this.sheetReturnUrl || location.href);
                event.stopImmediatePropagation();
                if (pending) this.togglePanel(...pending);
            }
            return sameWorkspace;
        },
        csvField(value, numeric = false) {
            let content = text(value);
            if (numeric) content = number(value) === null ? '' : String(number(value));
            else if (/^[\s]*[=+\-@\t\r]/.test(content)) content = `'${content}`;
            return `"${content.replace(/"/g, '""')}"`;
        },
        buildCsv(rows) {
            const headers = ['ID', 'Benchmark', 'Category', 'Reference value', 'Currency', 'Unit', 'Change', 'Change %', 'Observation date', 'Frequency', 'Source', 'Range'];
            return `${headers.join(',')}\r\n${rows.map(row => {
                const d = row.dataset;
                return [this.csvField(d.id), this.csvField(d.name), this.csvField(d.category), this.csvField(d.price, true), this.csvField(d.currency), this.csvField(d.unit), this.csvField(d.changeAbs, true), this.csvField(d.changePct, true), this.csvField(d.date), this.csvField(d.frequency), this.csvField(d.source), this.csvField(this.current.range)].join(',');
            }).join('\r\n')}\r\n`;
        },
        download(content, filename, type) {
            const url = URL.createObjectURL(new Blob([content], { type })); const link = node('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
        exportRows(scope) {
            if (byId('data-table')?.getAttribute('aria-busy') === 'true') { this.announce('Observations are still loading. Export after the range has finished updating.'); return; }
            const rows = scope === 'selected' ? this.getRows().filter(row => this.selected.has(row.dataset.id)) : scope === 'all' ? this.getRows() : this.getVisibleRows();
            if (!rows.length) return;
            this.download('\uFEFF' + this.buildCsv(rows), `benchmarks-${scope}-${this.current.range}-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
            this.announce(`Exported ${rows.length} ${scope === 'selected' ? 'selected' : scope === 'all' ? 'loaded' : 'filtered'} benchmarks`);
        },
        bind() {
            ['tw-view-menu','tw-more-menu','tw-tool-sheet'].forEach(id => byId(id)?.addEventListener('keydown', event => {
                if (event.key !== 'Tab') return;
                const dialog = event.currentTarget;
                const targets = [...dialog.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(element => element.getClientRects().length);
                if (!targets.length) { event.preventDefault(); return; }
                const first = targets[0], last = targets[targets.length - 1];
                if (event.shiftKey && (document.activeElement === first || document.activeElement?.matches('h2[tabindex="-1"]'))) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }));
            byId('tw-view-select')?.addEventListener('change', event => this.activateView(event.target.value));
            byId('tw-more-button')?.addEventListener('click', () => this.togglePanel('tw-more-menu', byId('tw-more-button')));
            byId('tw-more-menu')?.querySelectorAll('[data-tw-command]').forEach(command => command.addEventListener('click', () => {
                const target = {'new-view':'tw-view-menu','view-settings':'tw-view-menu','sort':'tw-sort-panel','properties':'tw-properties','actions':'tw-actions'}[command.dataset.twCommand];
                if (target) this.togglePanel(target, byId('tw-more-button'), command.dataset.twCommand === 'new-view' ? 'new' : 'manage');
            }));
            ['tw-more-menu','tw-tool-sheet'].forEach(id => {
                const dialog = byId(id);
                dialog?.addEventListener('cancel', event => { event.preventDefault(); this.closePanels(true); });
                dialog?.querySelector('[data-tw-dismiss]')?.addEventListener('click', () => this.closePanels(true));
                dialog?.addEventListener('click', event => { if (event.target !== dialog) return; const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) this.closePanels(true); });
            });
            byId('tw-sheet-done')?.addEventListener('click', () => this.closePanels(true));
            byId('tw-sheet-clear')?.addEventListener('click', () => this.clearFilters());
            window.addEventListener('popstate', event => this.consumeSheetPop(event), true);
            [['tw-filter-button', 'tw-filters'], ['tw-sort-button', 'tw-sort-panel'], ['tw-properties-button', 'tw-properties'], ['tw-actions-button', 'tw-actions'], ['tw-view-menu-button', 'tw-view-menu']].forEach(([trigger, panel]) => byId(trigger)?.addEventListener('click', () => this.togglePanel(panel, byId(trigger))));
            byId('tw-new-view')?.addEventListener('click', () => this.togglePanel('tw-view-menu', byId('tw-new-view')));
            byId('tw-controls-toggle')?.addEventListener('click', () => { this.closePanels(); byId('tw-controls-toggle').focus(); this.setControlsCollapsed(!this.controlsCollapsed, true); });
            byId('tw-view-close')?.addEventListener('click', () => this.closePanels(true));
            byId('tw-view-menu')?.addEventListener('cancel', event => { event.preventDefault(); this.closePanels(true); });
            byId('tw-view-menu')?.addEventListener('click', event => { if (event.target !== event.currentTarget) return; const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) this.closePanels(true); });
            byId('tw-query')?.addEventListener('input', event => this.change({ query: event.target.value }));
            Object.keys(defaults().filters).forEach(key => byId(`tw-${key}`)?.addEventListener('change', event => this.change({ filters: { ...this.current.filters, [key]: event.target.value } })));
            byId('tw-density')?.addEventListener('change', event => this.change({ density: event.target.value }));
            byId('tw-add-sort')?.addEventListener('click', () => { const next = PROPERTIES.find(p => p.type && !this.current.sorts.some(rule => rule.key === p.key)); if (next) { this.change({ sorts: [...this.current.sorts, { key: next.key, direction: 'asc' }] }); this.renderSortRules(); } });
            byId('tw-reset-filters')?.addEventListener('click', () => this.clearFilters());
            byId('tw-view-form')?.addEventListener('submit', event => {
                event.preventDefault(); const name = text(byId('tw-view-name').value).slice(0, 60); if (!name) return;
                const view = this.views.find(item => item.id === this.editingViewId);
                if (view) { view.name = name; view.config = copy(this.current); this.persist(); this.renderViews(); this.announce(this.storageOkay ? `${name} updated` : 'View update is not saved'); }
                else { if (!this.saveView(name)) return; this.editingViewId = this.activeId; }
                if (this.storageOkay) this.closePanels(true);
                else if (byId('tw-view-save-status')) byId('tw-view-save-status').textContent = 'Not saved. Close this dialog to retry saving or export your views backup.';
            });
            byId('tw-copy-view')?.addEventListener('click', () => { this.prepareViewDialog('new'); byId('tw-view-name')?.focus(); });
            byId('tw-delete-view')?.addEventListener('click', () => { const view = this.views.find(item => item.id === this.editingViewId); if (!view || !window.confirm(`Remove the view “${view.name}”? Your research and watchlist will be kept.`)) return; this.views = this.views.filter(item => item.id !== view.id); this.activeId = 'all'; this.persist(); this.renderViews(); this.closePanels(true); this.announce(this.storageOkay ? 'View removed' : 'View removal is not saved. Retry saving.'); });
            byId('tw-select-all')?.addEventListener('change', event => { const rows = this.getVisibleRows(); rows.forEach(row => event.target.checked ? this.selected.add(row.dataset.id) : this.selected.delete(row.dataset.id)); this.updateSelection(); this.announce(`${event.target.checked ? 'Selected' : 'Deselected'} ${rows.length} filtered benchmarks`); });
            byId('tw-clear-selection')?.addEventListener('click', () => { this.selected.clear(); this.updateSelection(); this.announce('Selection cleared'); });
            byId('tw-watch-selected')?.addEventListener('click', () => this.getSelectedIds().filter(id => !this.watched.has(id)).forEach(id => document.dispatchEvent(new CustomEvent('bw:watch-toggle', { detail: { id } }))));
            byId('tw-research-selected')?.addEventListener('click', event => document.dispatchEvent(new CustomEvent('bw:research-add', { detail: { ids: this.getSelectedIds(), trigger: event.currentTarget } })));
            byId('tw-compare-selected')?.addEventListener('click', event => document.dispatchEvent(new CustomEvent('bw:compare', { detail: { ids: this.getSelectedIds(), trigger: event.currentTarget } })));
            ['selected', 'filtered', 'all'].forEach(scope => byId(`tw-export-${scope}`)?.addEventListener('click', () => this.exportRows(scope)));
            byId('tw-retry-save')?.addEventListener('click', () => { this.persist(); this.announce(this.storageOkay ? 'View preferences saved in this browser' : 'Still unable to save. Your current view is retained on this page.'); });
            byId('tw-backup-views')?.addEventListener('click', () => this.download(JSON.stringify({ version: 1, activeId: this.activeId, current: this.current, views: this.views }, null, 2), 'benchmark-views-backup.json', 'application/json'));
            byId('table-workspace')?.addEventListener('keydown', event => {
                if (event.key !== 'Escape' || !this.hasOpenPanel()) return;
                event.preventDefault(); event.stopPropagation(); this.closePanels(true);
            });
            document.addEventListener('bw:watchlist-change', event => this.setWatchlist(event.detail?.ids));
            document.addEventListener('bw:table-data', () => this.renderMobileRows());
            if (byId('tw-mobile-list')) {
                const table = byId('data-table');
                this.mobileObserver = new MutationObserver(() => {
                    this.updateMobileBusy();
                    if (!this.mobileLayout || this.mobileFrame) return;
                    this.mobileFrame = requestAnimationFrame(() => { this.mobileFrame = null; this.renderMobileRows(); });
                });
                this.mobileObserver.observe(table, {subtree:true,childList:true,attributes:true,attributeFilter:['aria-busy']});
            }
            if (typeof ResizeObserver === 'function') { this.layoutObserver = new ResizeObserver(() => this.updateLayout()); this.layoutObserver.observe(byId('table-workspace')); }
            window.addEventListener('resize', () => this.updateLayout());
            if (byId('tw-controls')) {
                const onScroll = () => { if (this.scrollFrame) return; this.scrollFrame = requestAnimationFrame(() => { this.scrollFrame = null; this.updateScrollControls(); }); };
                window.addEventListener('scroll', onScroll, { passive: true });
                byId('table-workspace').querySelector('.tw-table-region')?.addEventListener('scroll', onScroll, { passive: true });
            }
        },
        init() {
            if (this.ready || !byId('table-workspace') || !byId('data-table')) return;
            this.restore(); this.ready = true;
            const params = new URLSearchParams(location.search), urlRange = params.get('range'), urlCategory = params.get('category');
            const renderedRange = RANGES.includes(urlRange) ? urlRange : '1Y';
            if (RANGES.includes(urlRange)) this.current.range = urlRange;
            if (urlCategory) this.current.filters.category = urlCategory;
            const watches = BW.BenchmarkDetail?.getWatchlist?.(); if (Array.isArray(watches)) this.watched = new Set(watches.map(String));
            this.updateLayout(); this.renderHeaders(); this.bind(); this.hydrateRows(); this.renderControls(); this.apply(); this.persist();
            if (this.current.range !== renderedRange || urlCategory) BW.CompactTable?.setDataRange(this.current.range, { history: document.getElementById('home-overview') ? 'none' : 'replace' });
            document.dispatchEvent(new CustomEvent('bw:table-ready'));
        }
    };
    BW.TableWorkspace = Workspace;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Workspace.init(), { once: true }); else Workspace.init();
})();
