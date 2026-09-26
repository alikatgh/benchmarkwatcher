/* Contextual source data, browser-local watching, and comparison at actual dates. */
(function () {
    'use strict';
    window.BW = window.BW || {};
    const STORAGE_KEY = 'bw.watchlist.v1';
    const COLORS = ['#4285f4', '#b05aca', '#d77813', '#279888'];
    const state = {
        ids: [], watchlist: null, watchSaved: true, records: [], range: '1Y',
        mode: 'indexed', seq: 0, controller: null, trigger: null,
        inertNodes: [], open: false, initialized: false, noticeTimer: null, noticeHome: null
    };
    const byId = id => document.getElementById(id);
    const pane = () => byId('benchmark-detail');
    const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(id);
    const uniqueIds = ids => Array.from(new Set((Array.isArray(ids) ? ids : []).filter(validId)));
    function number(value) {
        if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null;
        const result = Number(value);
        return Number.isFinite(result) ? result : null;
    }
    function format(value) {
        const n = number(value);
        return n === null ? 'Unavailable' : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function element(tag, className, content) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (content !== undefined) node.textContent = String(content);
        return node;
    }
    function button(label, action, className) {
        const node = element('button', className, label);
        node.type = 'button';
        node.addEventListener('click', action);
        return node;
    }
    function pageLink(record) {
        const link = element('a', 'benchmark-detail-link', 'Open full page');
        link.href = '/commodity/' + encodeURIComponent(record.id);
        return link;
    }
    function unit(record) {
        return [record.currency, record.unit].filter(value => typeof value === 'string' && value.trim()).join(' / ') || 'Unit not supplied';
    }
    function dateValue(value) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
        const timestamp = Date.parse(value + 'T00:00:00Z');
        return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
    }
    function history(record) {
        const observations = new Map();
        (Array.isArray(record.history) ? record.history : []).forEach(point => {
            if (point && dateValue(point.date) !== null) observations.set(point.date, { date: point.date, price: number(point.price) });
        });
        return Array.from(observations.values()).sort((a, b) => a.date.localeCompare(b.date));
    }
    function announce(message, failed) {
        const notice = byId('benchmark-detail-notice');
        if (!notice) return;
        clearTimeout(state.noticeTimer);
        notice.hidden = false;
        byId('benchmark-detail-notice-text').textContent = message;
        notice.querySelector('[data-detail-action="retry-save"]').hidden = !failed;
        if (!failed) state.noticeTimer = setTimeout(() => { notice.hidden = true; }, 6000);
    }
    function getWatchlist() {
        if (state.watchlist === null) {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                const saved = raw ? JSON.parse(raw) : { version: 1, ids: [] };
                if (!saved || saved.version !== 1 || !Array.isArray(saved.ids)) throw new Error('Invalid watchlist');
                state.watchlist = uniqueIds(saved.ids);
            } catch (_) {
                state.watchlist = [];
                state.watchSaved = false;
                announce('Your saved watchlist could not be read. Changes in this tab may not be saved.', true);
            }
        }
        return state.watchlist.slice();
    }
    function syncWatchButtons() {
        if (!pane()) return;
        pane().querySelectorAll('[data-watch-id]').forEach(node => {
            const watched = getWatchlist().includes(node.dataset.watchId);
            node.setAttribute('aria-pressed', String(watched));
            node.textContent = watched ? '★ Watching' : '☆ Watch';
        });
    }
    function persistWatchlist(message) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ids: getWatchlist() }));
            state.watchSaved = true;
        } catch (_) { state.watchSaved = false; }
        syncWatchButtons();
        document.dispatchEvent(new CustomEvent('bw:watchlist-change', { detail: { ids: getWatchlist(), saved: state.watchSaved } }));
        announce(state.watchSaved ? message + ' Saved in this browser.' : message + ' Not saved; kept in this tab. Retry saving.', !state.watchSaved);
        return state.watchSaved;
    }
    function toggleWatch(id) {
        if (!validId(id)) return false;
        const watched = getWatchlist().includes(id);
        state.watchlist = watched ? state.watchlist.filter(item => item !== id) : state.watchlist.concat(id);
        persistWatchlist(watched ? 'Removed from watchlist.' : 'Added to watchlist.');
        return !watched;
    }
    function addToWatchlist(ids) {
        state.watchlist = uniqueIds(getWatchlist().concat(uniqueIds(ids)));
        return persistWatchlist('Watchlist updated.');
    }
    function restoreBackground() {
        state.inertNodes.forEach(item => { item.node.inert = item.inert; });
        state.inertNodes = [];
    }
    function placeNotice(inPane) {
        const notice = byId('benchmark-detail-notice');
        if (!notice || !state.noticeHome) return;
        if (inPane) pane().append(notice);
        else {
            const { parent, next } = state.noticeHome;
            parent.insertBefore(notice, next && next.parentNode === parent ? next : null);
        }
    }
    function modal() {
        return typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 1279px)').matches : window.innerWidth < 1280;
    }
    function syncModal() {
        if (!state.open || !pane()) return;
        const isModal = modal();
        pane().setAttribute('role', isModal ? 'dialog' : 'complementary');
        if (isModal) pane().setAttribute('aria-modal', 'true');
        else pane().removeAttribute('aria-modal');
        byId('benchmark-detail-backdrop').hidden = !isModal;
        restoreBackground();
        placeNotice(isModal);
        if (!isModal) return;
        let branch = pane();
        while (branch && branch !== document.body) {
            Array.from(branch.parentElement.children).forEach(node => {
                if (node === branch || node.id === 'benchmark-detail-backdrop' || node.id === 'benchmark-detail-notice' || ['SCRIPT', 'STYLE', 'LINK'].includes(node.tagName)) return;
                state.inertNodes.push({ node, inert: node.inert });
                node.inert = true;
            });
            branch = branch.parentElement;
        }
    }
    function onKey(event) {
        if (!state.open) return;
        if (event.key === 'Escape' && !event.defaultPrevented) {
            event.preventDefault();
            close();
        } else if (event.key === 'Tab' && modal()) {
            const focusable = Array.from(pane().querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),summary,[tabindex="0"]'))
                .filter(node => !node.hidden && !node.closest('[hidden]') && (!node.closest('details:not([open])') || node.tagName === 'SUMMARY'));
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (!first) { event.preventDefault(); pane().focus(); }
            else if (event.shiftKey && (document.activeElement === first || !pane().contains(document.activeElement))) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && (document.activeElement === last || !pane().contains(document.activeElement))) { event.preventDefault(); first.focus(); }
        }
    }
    function close() {
        state.open = false;
        state.seq += 1;
        if (state.controller) state.controller.abort();
        restoreBackground();
        placeNotice(false);
        if (pane()) { pane().hidden = true; pane().removeAttribute('aria-busy'); }
        if (byId('benchmark-detail-backdrop')) byId('benchmark-detail-backdrop').hidden = true;
        document.body.classList.remove('bw-detail-open', 'bw-compare-open');
        const returnTarget = state.trigger && state.trigger.isConnected ? state.trigger
            : Array.from(document.querySelectorAll('a[data-benchmark-id]')).find(node => node.dataset.benchmarkId === state.ids[0]);
        if (returnTarget) returnTarget.focus({ preventScroll: true });
        document.dispatchEvent(new CustomEvent('bw:detail-close'));
    }
    function begin(ids, trigger) {
        init();
        if (!pane()) return Promise.resolve(false);
        state.ids = ids;
        state.records = [];
        state.mode = 'indexed';
        state.trigger = trigger || document.activeElement;
        state.open = true;
        pane().hidden = false;
        document.body.classList.add('bw-detail-open');
        document.body.classList.toggle('bw-compare-open', ids.length > 1);
        syncModal();
        byId('benchmark-detail-context').textContent = ids.length > 1 ? 'Compare benchmarks' : 'Benchmark details';
        byId('benchmark-detail-title').textContent = ids.length > 1 ? 'Compare ' + ids.length + ' benchmarks' : titleFromRow(ids[0]);
        byId('benchmark-detail-category').textContent = '';
        byId('benchmark-detail-actions').replaceChildren(...(ids.length === 1 ? [pageLink({ id: ids[0] })] : []));
        pane().querySelector('[data-detail-action="close"]').focus({ preventScroll: true });
        return load();
    }
    function titleFromRow(id) {
        const link = Array.from(document.querySelectorAll('a[data-benchmark-id]')).find(node => node.dataset.benchmarkId === id);
        return link ? link.textContent.trim() : id.replace(/_/g, ' ');
    }
    function open(id, trigger) {
        return validId(id) ? begin([id], trigger) : Promise.resolve(false);
    }
    function compare(ids, trigger) {
        const clean = uniqueIds(ids);
        if (clean.length < 2 || clean.length > 4) {
            announce('Select 2 to 4 benchmarks to compare.', false);
            return Promise.resolve(false);
        }
        return begin(clean, trigger);
    }
    async function load() {
        const request = ++state.seq;
        if (state.controller) state.controller.abort();
        state.controller = typeof AbortController === 'function' ? new AbortController() : null;
        pane().setAttribute('aria-busy', 'true');
        byId('benchmark-detail-body').replaceChildren(element('p', 'benchmark-detail-loading', 'Loading source observations…'));
        const options = state.controller ? { signal: state.controller.signal } : {};
        const results = await Promise.all(state.ids.map(async id => {
            try {
                const response = await fetch('/api/commodity/' + encodeURIComponent(id), options);
                if (!response.ok) throw new Error('Request failed');
                const json = await response.json();
                if (!json || !json.data || typeof json.data !== 'object' || Array.isArray(json.data)) throw new Error('Invalid response');
                return { ...json.data, id };
            } catch (error) { return { id, error: true }; }
        }));
        if (request !== state.seq || !state.open) return false;
        state.records = results;
        pane().removeAttribute('aria-busy');
        if (results.length > 1) renderComparison();
        else if (results[0].error) renderError(results[0]);
        else renderDetail(results[0]);
        return true;
    }
    function renderError(record) {
        const error = element('div', 'benchmark-detail-error');
        error.append(element('p', '', 'Source observations could not be loaded. Your table and selection are unchanged.'), button('Retry', load), document.createTextNode(' '), pageLink(record));
        byId('benchmark-detail-body').replaceChildren(error);
    }
    function watchButton(record) {
        const node = button('☆ Watch', () => toggleWatch(record.id));
        node.dataset.watchId = record.id;
        return node;
    }
    function addResearch(records) {
        if (!byId('research-workspace')) {
            const ids = uniqueIds(records.map(record => record.id));
            if (ids.length) window.location.assign('/?workspace=research&add_benchmark=' + encodeURIComponent(ids.join(',')));
            return;
        }
        if (!BW.ResearchWorkspace || typeof BW.ResearchWorkspace.addBenchmarks !== 'function') {
            announce('The research workspace is unavailable. Reload this page to try again.', false);
            return;
        }
        try {
            close();
            BW.ResearchWorkspace.addBenchmarks(records);
        } catch (_) { announce('The research entry could not be opened. Please try again.', false); }
    }
    function facts(items) {
        const list = element('dl', 'benchmark-detail-facts');
        items.forEach(([label, value]) => list.append(element('dt', '', label), element('dd', '', value || 'Not supplied')));
        return list;
    }
    function renderDetail(record) {
        byId('benchmark-detail-title').textContent = record.name || titleFromRow(record.id);
        byId('benchmark-detail-category').textContent = record.category || 'Public benchmark';
        byId('benchmark-detail-actions').replaceChildren(watchButton(record), pageLink(record));
        const value = element('section');
        value.append(element('p', 'benchmark-detail-muted', 'Latest reference value'), element('p', 'benchmark-detail-value', format(record.price)), element('p', 'benchmark-detail-unit', unit(record)));
        value.append(facts([['Observation date', record.date], ['Reporting cadence', cadence(record)]]));
        const change = number(record.change_percent);
        if (change !== null && number(record.prev_price) !== null && record.prev_date && record.date) {
            const node = element('p', 'benchmark-detail-change', (change > 0 ? '+' : '') + format(change) + '% from ' + record.prev_date + ' to ' + record.date);
            node.dataset.direction = change >= 0 ? 'up' : 'down';
            value.append(node);
        } else value.append(element('p', 'benchmark-detail-muted', 'Previous-observation change unavailable.'));
        const chart = element('section');
        chart.id = 'benchmark-detail-history';
        const source = element('section', 'benchmark-detail-source');
        source.append(element('h3', '', 'Source & context'), element('p', '', record.source_name || 'Source not supplied'));
        if (record.source_url) {
            try {
                const url = new URL(record.source_url);
                if (['https:', 'http:'].includes(url.protocol)) {
                    const link = element('a', '', 'Visit source');
                    link.href = url.href;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    const paragraph = element('p');
                    paragraph.append(link);
                    source.append(paragraph);
                }
            } catch (_) { /* Unusable source URLs remain plain source names. */ }
        }
        source.append(element('p', 'benchmark-detail-muted', 'Historical reference observations. Sources may publish with a delay or revise earlier values. Observation dates can differ across benchmarks.'));
        if (record.updated_at) source.append(element('p', 'benchmark-detail-muted', 'Dataset updated: ' + String(record.updated_at).slice(0, 10)));
        const research = element('section');
        research.append(element('h3', '', 'Your research'), element('p', 'benchmark-detail-chart-note', 'Add your notes, tags, and review status alongside this benchmark. Source values remain read-only.'), button('Add to research', () => addResearch([record])), element('p', 'benchmark-detail-chart-note', 'Research and watchlist entries are saved in this browser only.'));
        byId('benchmark-detail-body').replaceChildren(value, chart, source, research);
        renderHistory();
        syncWatchButtons();
    }
    function cadence(record) {
        if (record.is_daily === true || record.frequency === 'daily') return 'Daily observations';
        if (record.is_daily === false || record.frequency === 'monthly') return 'Monthly observations';
        return record.frequency || 'Cadence not supplied';
    }
    function chartData(records) {
        const all = records.filter(record => !record.error).map(record => ({ record, points: history(record) }));
        const timestamps = all.flatMap(series => series.points.map(point => dateValue(point.date)));
        const latest = timestamps.length ? timestamps.reduce((maximum, value) => Math.max(maximum, value), -Infinity) : null;
        let cutoff = -Infinity;
        if (latest !== null && state.range !== 'ALL') {
            const date = new Date(latest);
            date.setUTCFullYear(date.getUTCFullYear() - (state.range === '5Y' ? 5 : 1));
            cutoff = date.getTime();
        }
        return all.map(series => ({ ...series, points: series.points.filter(point => dateValue(point.date) >= cutoff) }));
    }
    function ranges() {
        const controls = element('div', 'benchmark-detail-ranges');
        controls.setAttribute('role', 'group');
        controls.setAttribute('aria-label', 'History range');
        ['1Y', '5Y', 'ALL'].forEach(range => {
            const control = button(range === 'ALL' ? 'All' : range, () => {
                state.range = range;
                if (state.records.length > 1) renderComparison(); else renderHistory();
                const active = pane().querySelector('[data-detail-range="' + range + '"]');
                if (active) active.focus({ preventScroll: true });
            });
            control.dataset.detailRange = range;
            control.setAttribute('aria-pressed', String(range === state.range));
            controls.append(control);
        });
        return controls;
    }
    function svgNode(tag, attrs, content) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
        Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
        if (content !== undefined) node.textContent = content;
        return node;
    }
    function plot(series, indexed) {
        const svg = svgNode('svg', { viewBox: '0 0 520 220', class: 'benchmark-detail-plot', role: 'img', 'aria-label': indexed ? 'Indexed reference histories. Actual dates and values are available in observation tables below.' : 'Reference history. Actual dates and values are available in the observation table below.' });
        const values = series.flatMap(item => item.points.filter(point => point.value !== null));
        if (!values.length) return element('p', 'benchmark-detail-empty', 'No usable observations in this range. Try a wider range or view the source.');
        const times = values.map(point => dateValue(point.date));
        const minTime = times.reduce((result, value) => Math.min(result, value), Infinity);
        const maxTime = times.reduce((result, value) => Math.max(result, value), -Infinity);
        const min = values.reduce((result, point) => Math.min(result, point.value), Infinity);
        const max = values.reduce((result, point) => Math.max(result, point.value), -Infinity);
        const spread = max - min || Math.max(Math.abs(min) * .05, 1);
        const low = min - spread * .1, high = max + spread * .1;
        const x = date => 56 + ((dateValue(date) - minTime) / (maxTime - minTime || 1)) * 448;
        const y = value => 178 - ((value - low) / (high - low)) * 160;
        [low, (low + high) / 2, high].forEach(value => {
            svg.append(svgNode('line', { x1: 56, x2: 504, y1: y(value), y2: y(value), stroke: 'var(--theme-border,#e2e6ea)', 'stroke-width': 1 }));
            svg.append(svgNode('text', { x: 48, y: y(value) + 4, 'text-anchor': 'end' }, value.toLocaleString(undefined, { maximumFractionDigits: 1, notation: Math.abs(value) >= 10000 ? 'compact' : 'standard' })));
        });
        svg.append(svgNode('text', { x: 56, y: 209 }, new Date(minTime).toISOString().slice(0, 10)), svgNode('text', { x: 504, y: 209, 'text-anchor': 'end' }, new Date(maxTime).toISOString().slice(0, 10)));
        series.forEach((item, index) => {
            const color = item.color || COLORS[index % COLORS.length];
            let path = '', previous = null;
            item.points.forEach(point => {
                if (point.value === null) { previous = null; return; }
                const gap = previous && dateValue(point.date) - dateValue(previous.date);
                const maxGap = (item.record.is_daily === true ? 7 : 62) * 86400000;
                path += (!previous || gap > maxGap ? 'M' : 'L') + x(point.date).toFixed(2) + ',' + y(point.value).toFixed(2) + ' ';
                const dot = svgNode('circle', { cx: x(point.date), cy: y(point.value), r: series.length > 1 ? 2 : 1.5, fill: color });
                dot.append(svgNode('title', {}, (item.record.name || item.record.id) + ': ' + point.date + ' · ' + format(point.price) + ' ' + unit(item.record) + (indexed ? ' · Index ' + format(point.value) : '')));
                svg.append(dot);
                previous = point;
            });
            svg.append(svgNode('path', { d: path, fill: 'none', stroke: color, 'stroke-width': 1.8, 'stroke-linejoin': 'round', 'stroke-dasharray': series.length > 1 ? (['none', '6 3', '2 3', '8 3 2 3'][state.ids.indexOf(item.record.id)] || 'none') : 'none' }));
        });
        return svg;
    }
    function observationTable(record, points, indexed) {
        const details = element('details', 'benchmark-detail-observations');
        details.append(element('summary', '', 'Observation table · ' + points.length + ' records'));
        const wrap = element('div', 'benchmark-detail-table-wrap');
        const table = element('table', 'benchmark-detail-table');
        table.append(element('caption', '', (record.name || record.id) + ' · ' + unit(record) + ' · Newest first'));
        const head = element('thead');
        const tr = element('tr');
        ['Date', 'Reference value'].concat(indexed ? ['Index'] : []).forEach(label => {
            const th = element('th', '', label); th.scope = 'col'; tr.append(th);
        });
        head.append(tr);
        const body = element('tbody');
        table.append(head, body);
        wrap.append(table); details.append(wrap);
        const sorted = points.slice().reverse();
        let shown = 0;
        const more = button('Show older observations', () => { appendRows(); more.focus({ preventScroll: true }); }, 'benchmark-detail-table-more');
        function appendRows() {
            sorted.slice(shown, shown + 25).forEach(point => {
                const row = element('tr');
                row.append(element('td', '', point.date), element('td', '', format(point.price)));
                if (indexed) row.append(element('td', '', format(point.value)));
                body.append(row);
            });
            shown = Math.min(shown + 25, sorted.length);
            more.hidden = shown >= sorted.length;
            more.textContent = 'Show older observations (' + (sorted.length - shown) + ' remaining)';
        }
        appendRows(); details.append(more);
        return details;
    }
    function renderHistory() {
        const container = byId('benchmark-detail-history');
        if (!container || !state.records[0] || state.records[0].error) return;
        const record = state.records[0];
        const series = chartData([record])[0];
        const points = series.points.map(point => ({ ...point, value: point.price }));
        const heading = element('div', 'benchmark-detail-chart-head');
        heading.append(element('h3', '', 'Reference history'), ranges());
        container.replaceChildren(heading, plot([{ record, points, color: 'var(--theme-accent,#1967d2)' }], false));
        const usable = points.filter(point => point.price !== null);
        if (usable.length) {
            container.append(element('p', 'benchmark-detail-chart-note', 'Range ends at the latest published observation. ' + (usable.length === 1 ? 'Only one observation; no change is calculated.' : 'Dots show actual observations. Extended gaps are left open.')));
            const picker = element('div', 'benchmark-detail-point');
            const label = element('label', '', 'Explore an observation');
            label.htmlFor = 'benchmark-detail-observation';
            const output = element('output');
            output.htmlFor = 'benchmark-detail-observation';
            const input = element('input');
            input.id = 'benchmark-detail-observation'; input.type = 'range'; input.min = '0'; input.max = String(usable.length - 1); input.value = input.max; input.step = '1';
            input.disabled = usable.length === 1;
            const update = () => {
                const point = usable[Number(input.value)];
                const text = point.date + ' · ' + format(point.price) + ' ' + unit(record);
                output.textContent = text; input.setAttribute('aria-valuetext', text);
            };
            input.addEventListener('input', update); update();
            picker.append(label, output, input); container.append(picker);
        }
        container.append(observationTable(record, points, false));
    }
    function compatible(records) {
        return records.length > 1 && records.every(record => !record.error && record.currency && record.unit && record.currency === records[0].currency && record.unit === records[0].unit);
    }
    function renderComparison() {
        byId('benchmark-detail-title').textContent = 'Compare benchmarks';
        byId('benchmark-detail-category').textContent = state.ids.length + ' selected · Historical observations';
        const researchRecords = state.records.filter(record => !record.error);
        const researchButton = button('Add to research', () => addResearch(researchRecords));
        researchButton.disabled = researchRecords.length === 0;
        byId('benchmark-detail-actions').replaceChildren(button('Watch all', () => addToWatchlist(state.ids)), researchButton);
        const section = element('section');
        const heading = element('div', 'benchmark-detail-chart-head');
        heading.append(element('h3', '', state.mode === 'indexed' ? 'Indexed histories' : 'Reference values'), ranges());
        section.append(heading);
        const modes = element('div', 'benchmark-detail-mode');
        [['indexed', 'Index · first value = 100'], ['absolute', 'Absolute values']].forEach(([mode, label]) => {
            const control = button(label, () => {
                state.mode = mode; renderComparison();
                const target = pane().querySelector('[data-detail-mode="' + mode + '"]');
                if (target) target.focus();
            });
            control.dataset.detailMode = mode;
            control.setAttribute('aria-pressed', String(state.mode === mode));
            control.disabled = mode === 'absolute' && !compatible(state.records);
            modes.append(control);
        });
        section.append(modes);
        const indexed = state.mode === 'indexed';
        const series = chartData(state.records).map(item => {
            const baseline = item.points.find(point => point.price !== null);
            const canIndex = baseline && baseline.price > 0;
            return {
                ...item, baseline, canIndex, color: COLORS[state.ids.indexOf(item.record.id)],
                points: item.points.map(point => ({ ...point, value: indexed ? (canIndex && point.price !== null ? point.price / baseline.price * 100 : null) : point.price }))
            };
        });
        section.append(plot(series, indexed));
        section.append(element('p', 'benchmark-detail-chart-note', indexed
            ? 'Each series starts at 100 on its own first available date in this range. Baseline dates may differ; equal index values do not imply equal prices. Missing dates are not filled.'
            : 'Values share the same currency and unit. Dots retain actual observation dates; missing dates are not filled.'));
        const lastDates = series.filter(item => item.points.length).map(item => item.points[item.points.length - 1].date).sort();
        if (lastDates.length) section.append(element('p', 'benchmark-detail-chart-note', 'Range ends at the newest observation in this selection: ' + lastDates[lastDates.length - 1] + '.'));
        if (!compatible(state.records)) section.append(element('p', 'benchmark-detail-chart-note', 'Absolute comparison requires matching currency and unit for every benchmark.'));
        const legend = element('div', 'benchmark-detail-legend');
        state.records.forEach(record => {
            const row = element('div', 'benchmark-detail-legend-item');
            const dot = svgNode('svg', { viewBox: '0 0 24 14', class: 'benchmark-detail-legend-dot', 'aria-hidden': 'true' });
            dot.append(svgNode('line', { x1: 0, x2: 24, y1: 7, y2: 7, stroke: COLORS[state.ids.indexOf(record.id)], 'stroke-width': 2, 'stroke-dasharray': ['none', '6 3', '2 3', '8 3 2 3'][state.ids.indexOf(record.id)] }));
            const info = element('div');
            info.append(element('strong', '', record.name || titleFromRow(record.id)));
            if (record.error) {
                info.append(element('small', '', 'Could not load source observations.'));
            } else {
                const item = series.find(item => item.record.id === record.id);
                info.append(element('small', '', unit(record) + ' · ' + cadence(record)));
                info.append(element('small', '', 'Source: ' + (record.source_name || 'Not supplied')));
                info.append(element('small', '', item.baseline ? 'Baseline: ' + item.baseline.date + ' · ' + format(item.baseline.price) + ' ' + unit(record) : 'No observations in this range.'));
                if (indexed && !item.canIndex) info.append(element('small', '', 'Index unavailable: a positive baseline is required. Raw values remain in the table.'));
            }
            const link = pageLink(record); link.textContent = 'Details';
            row.append(dot, info, link); legend.append(row);
        });
        section.append(legend);
        if (state.records.some(record => record.error)) section.append(button('Retry unavailable series', load));
        series.forEach(item => section.append(observationTable(item.record, item.points, indexed)));
        byId('benchmark-detail-body').replaceChildren(section);
    }
    function onStorage(event) {
        if ((event.key !== STORAGE_KEY && event.key !== null) || !state.watchSaved) return;
        state.watchlist = null;
        const ids = getWatchlist();
        syncWatchButtons();
        document.dispatchEvent(new CustomEvent('bw:watchlist-change', { detail: { ids, saved: state.watchSaved } }));
    }
    function init() {
        if (!pane() || state.initialized) return;
        state.initialized = true;
        const notice = byId('benchmark-detail-notice');
        state.noticeHome = { parent: notice.parentNode, next: notice.nextSibling };
        pane().querySelector('[data-detail-action="close"]').addEventListener('click', close);
        byId('benchmark-detail-backdrop').addEventListener('click', close);
        byId('benchmark-detail-notice').querySelector('[data-detail-action="retry-save"]').addEventListener('click', () => persistWatchlist('Watchlist saved.'));
        byId('benchmark-detail-notice').querySelector('[data-detail-action="dismiss-notice"]').addEventListener('click', () => { byId('benchmark-detail-notice').hidden = true; });
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', syncModal);
        window.addEventListener('storage', onStorage);
        getWatchlist();
    }
    function destroy() {
        close();
        clearTimeout(state.noticeTimer);
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('DOMContentLoaded', init);
        window.removeEventListener('resize', syncModal);
        window.removeEventListener('storage', onStorage);
    }
    BW.BenchmarkDetail = { init, open, close, compare, toggleWatch, addToWatchlist, getWatchlist, destroy };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
