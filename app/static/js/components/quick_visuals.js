/* Small, on-demand charts beside source data. Nothing is fetched or drawn on load. */
(function () {
    'use strict';
    window.BW = window.BW || {};
    let active = null, serial = 0;
    const text = value => value === undefined || value === null ? '' : String(value);
    const array = value => Array.isArray(value) ? value : [];
    function element(tag, value, className) {
        const node = document.createElement(tag);
        if (value !== undefined) node.textContent = value;
        if (className) node.className = className;
        return node;
    }
    function button(value, action) {
        const node = element('button', value); node.type = 'button'; node.dataset.qvAction = action; return node;
    }
    function field(parent, name, key) {
        const label = element('label', undefined, 'bw-qv-field'), select = element('select');
        select.dataset.qvField = key; select.setAttribute('aria-label', name);
        label.append(element('span', name), select); parent.append(label); return select;
    }
    function fillOptions(select, options) {
        select.replaceChildren();
        options.forEach(([value, name]) => { const option = element('option', name); option.value = value; select.append(option); });
    }
    function rememberScroll(trigger) {
        const positions = [], scrolling = document.scrollingElement;
        for (let node = trigger?.parentElement; node; node = node.parentElement) positions.push([node, node.scrollLeft, node.scrollTop]);
        if (scrolling && !positions.some(([node]) => node === scrolling)) positions.push([scrolling, scrolling.scrollLeft, scrolling.scrollTop]);
        return () => positions.forEach(([node, left, top]) => { if (node.isConnected) { node.scrollLeft = left; node.scrollTop = top; } });
    }
    function sourceRows(spec) {
        return [...spec.series.flatMap(series => series.points.map(point => ({ ...point, label: series.name }))), ...spec.rows];
    }
    function flags(row) {
        return [...new Set([row.status, row.estimated === true ? 'estimated' : '', row.planned === true ? 'planned' : '', ...array(row.flags).map(text),
            row.invalidDate ? 'invalid date' : '', row.invalidValue ? 'invalid value' : ''].filter(Boolean))].join(' · ');
    }
    function open(input = {}, options = {}) {
        if (!BW.VisualBuilder) throw new Error('The visual renderer must load before quick visuals.');
        if (active) active.close();
        input = input && typeof input === 'object' ? input : {};
        const trigger = options.trigger || document.activeElement, restoreScroll = rememberScroll(trigger);
        let current = BW.VisualBuilder.normalize(input), controller, chart = null, closed = false, resizeObserver = null;
        // Area remains an explicit editor option; the quick view starts with an unfilled line.
        if (current.type === 'area') current.type = 'line';
        const datasets = array(input.datasets).filter(item => item && typeof item === 'object').map((item, index) => ({ ...item, id: text(item.id || 'qv-dataset-' + index) }));
        if (datasets.length && !datasets.some(item => item.id === current.id)) datasets.unshift({ ...current, name: current.title });
        const dialog = element('dialog', undefined, 'bw-quick-visual'), headingId = 'bw-qv-title-' + (++serial);
        dialog.setAttribute('aria-labelledby', headingId);
        const header = element('header', undefined, 'bw-qv-header'), heading = element('h2', 'Quick visual'); heading.id = headingId;
        const closeButton = button('Close', 'close'); closeButton.setAttribute('aria-label', 'Close quick visual'); header.append(heading, closeButton);
        const body = element('div', undefined, 'bw-qv-body'), context = element('h3', current.title, 'bw-qv-context'), controls = element('div', undefined, 'bw-qv-controls');
        let datasetSelect = null;
        if (datasets.length > 1) { datasetSelect = field(controls, 'Dataset', 'dataset'); fillOptions(datasetSelect, datasets.map(item => [item.id, text(item.name || item.title || item.id)])); datasetSelect.value = current.id; }
        const unitSelect = field(controls, 'Unit', 'unit'), unitLabel = element('p', '', 'bw-qv-unit'), typeSelect = field(controls, 'Style', 'type');
        const legend = element('ul', undefined, 'bw-qv-legend'), stage = element('div', undefined, 'bw-qv-chart');
        const tooltip = element('div', '', 'bw-qv-tooltip'); tooltip.hidden = true; tooltip.id = 'bw-qv-tooltip-' + serial; tooltip.setAttribute('role', 'tooltip');
        const inspection = element('p', '', 'bw-qv-inspection'); inspection.setAttribute('role', 'status'); inspection.setAttribute('aria-live', 'polite');
        const notes = element('div', undefined, 'bw-qv-notes'), sources = element('details', undefined, 'bw-qv-sources'), summary = element('summary', 'Source details');
        const sourceCredits = element('div', undefined, 'bw-qv-credits'), tableHost = element('div', undefined, 'bw-qv-table-wrap');
        sources.append(summary, sourceCredits, tableHost);
        body.append(context, controls, unitLabel, legend, stage, inspection, notes, sources);
        const footer = element('footer', undefined, 'bw-qv-footer'), customize = button('Customize graphic', 'customize'); footer.append(customize);
        dialog.append(header, body, footer); document.body.append(dialog); stage.append(tooltip);
        function inspect(item) {
            if (!item) { tooltip.hidden = true; inspection.textContent = ''; chart?.svg.removeAttribute('aria-describedby'); return; }
            tooltip.textContent = item.text; tooltip.hidden = false; inspection.textContent = item.text;
            chart?.svg.setAttribute('aria-describedby', tooltip.id);
            const viewBox = chart?.svg.getAttribute('viewBox')?.split(' ').map(Number), scale = stage.clientWidth && viewBox ? stage.clientWidth / viewBox[2] : 1;
            const width = stage.clientWidth || viewBox?.[2] || 280, height = stage.clientHeight || viewBox?.[3] || 250;
            const tipWidth = tooltip.offsetWidth || Math.min(320, width - 16), tipHeight = tooltip.offsetHeight || 65;
            tooltip.style.left = Math.max(8, Math.min(width - tipWidth - 8, item.x * scale + 12)) + 'px';
            tooltip.style.top = Math.max(8, Math.min(height - tipHeight - 8, item.y * scale + 12)) + 'px';
        }
        function updateControls() {
            context.textContent = current.title;
            fillOptions(unitSelect, current.units.map(unit => [unit, unit || 'Unspecified'])); unitSelect.value = current.unit;
            unitSelect.parentElement.hidden = current.units.length < 2; unitLabel.hidden = current.units.length > 1; unitLabel.textContent = current.unit || 'Unit not specified';
            const styles = current.series.length ? [['line', 'Line'], ['bar', 'Bars'], ['scatter', 'Dots'], ['horizontal', 'Ranking']] : [['horizontal', 'Ranking'], ['bar', 'Bars'], ['scatter', 'Dots']];
            if (current.geojson || current.type === 'map') styles.push(['map', 'Map']);
            fillOptions(typeSelect, styles); typeSelect.value = current.type;
        }
        function sourceTable() {
            if (closed || !sources.isConnected) return;
            tableHost.replaceChildren(); if (!sources.open) return;
            const rows = sourceRows(current), table = element('table'), thead = element('thead'), head = element('tr'), tbody = element('tbody');
            ['Series / label', 'Source period', 'Exact value', 'Unit', 'Status', 'Source', 'Notes'].forEach(value => { const th = element('th', value); th.scope = 'col'; head.append(th); });
            thead.append(head); table.append(thead, tbody);
            rows.slice(0, 500).forEach(row => {
                const line = element('tr'), exact = row.display_value !== undefined && row.display_value !== '' ? text(row.display_value) : row.value === null ? row.invalidValue ? text(row.rawValue) + ' (invalid)' : 'Unavailable' : text(row.rawValue ?? row.value);
                [row.label, row.period || row.date || 'Undated', exact, row.unit || 'Unspecified', flags(row), row.source || 'Not specified', row.footnote].forEach((value, index) => {
                    const cell = element('td', value);
                    if (index === 5 && /^https?:\/\//i.test(row.sourceUrl)) { const link = element('a', row.sourceUrl); link.href = row.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; cell.append(element('br'), link); }
                    line.append(cell);
                }); tbody.append(line);
            });
            if (rows.length > 500) tableHost.append(element('p', 'Showing the first 500 source observations. All observations remain in the original table and chart metadata.'));
            tableHost.append(table);
        }
        function redraw() {
            if (closed) return;
            inspect(null); chart?.destroy();
            const width = stage.clientWidth || Math.max(240, Math.min(728, window.innerWidth - 48));
            chart = BW.VisualBuilder.render(stage, current, { presentation: 'quick', width, onInspect: inspect }); stage.append(tooltip);
            legend.replaceChildren();
            if (chart.legend.length > 1) chart.legend.forEach(item => { const row = element('li'), swatch = element('span', undefined, 'bw-qv-swatch'); swatch.style.backgroundColor = item.color; row.append(swatch, document.createTextNode(item.name)); legend.append(row); });
            legend.hidden = chart.legend.length < 2;
            notes.replaceChildren(); chart.caption.notes.forEach(value => notes.append(element('p', value))); notes.hidden = !chart.caption.notes.length;
            sourceCredits.replaceChildren(); chart.caption.sources.forEach(value => sourceCredits.append(element('p', value))); sourceTable();
        }
        function close(returnFocus = true) {
            if (closed) return; closed = true; resizeObserver?.disconnect(); window.removeEventListener('resize', onResize);
            if (resizeFrame !== null) { window.cancelAnimationFrame(resizeFrame); resizeFrame = null; }
            chart?.destroy(); if (dialog.open && typeof dialog.close === 'function') dialog.close(); dialog.remove();
            if (active === controller) active = null;
            if (returnFocus) { if (trigger?.isConnected) trigger.focus({ preventScroll: true }); restoreScroll(); }
        }
        let resizeFrame = null;
        function onResize() {
            if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
            resizeFrame = window.requestAnimationFrame(() => { resizeFrame = null; redraw(); });
        }
        closeButton.addEventListener('click', () => close());
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        dialog.addEventListener('close', () => close());
        dialog.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
            if (event.key === 'Tab' && typeof dialog.showModal !== 'function') {
                const nodes = [...dialog.querySelectorAll('button,select,summary,svg[tabindex],a[href]')].filter(node => !node.closest('[hidden]') && (!node.closest('details') || node.closest('details').open || node.tagName === 'SUMMARY'));
                const first = nodes[0], last = nodes[nodes.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
        });
        datasetSelect?.addEventListener('change', () => {
            const selected = datasets.find(item => item.id === datasetSelect.value); if (!selected) return;
            current = BW.VisualBuilder.normalize(selected); if (current.type === 'area') current.type = 'line'; updateControls(); redraw();
        });
        unitSelect.addEventListener('change', () => { current.unit = unitSelect.value; current.highlight = ''; redraw(); });
        typeSelect.addEventListener('change', () => { current.type = typeSelect.value; current.zero = ['bar', 'horizontal'].includes(current.type); redraw(); });
        sources.addEventListener('toggle', sourceTable);
        customize.addEventListener('click', () => {
            const spec = { ...current, datasets }; close(false);
            BW.VisualBuilder.open(spec, { trigger, onClose: restoreScroll });
        });
        controller = { dialog, close: () => close(), getSpec: () => BW.VisualBuilder.normalize(current), render: redraw };
        active = controller; updateControls();
        try {
            if (typeof dialog.showModal === 'function') dialog.showModal(); else { dialog.setAttribute('open', ''); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); }
            redraw(); closeButton.focus({ preventScroll: true });
            if (typeof ResizeObserver === 'function') { let lastWidth = stage.clientWidth; resizeObserver = new ResizeObserver(() => { if (stage.clientWidth !== lastWidth) { lastWidth = stage.clientWidth; onResize(); } }); resizeObserver.observe(stage); }
            else window.addEventListener('resize', onResize);
        } catch (error) { close(); throw error; }
        return controller;
    }
    BW.QuickVisuals = { open, close: () => active?.close() };
})();
