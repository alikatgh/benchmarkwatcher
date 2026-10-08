/* Context adapters for the shared graphics editor. Reads saved observations only. */
(function () {
    'use strict';
    window.BW = window.BW || {};
    const bindings = new WeakMap();
    const json = id => { try { return JSON.parse(document.getElementById(id)?.textContent || 'null'); } catch (_) { return null; } };
    const node = (tag, text, className) => { const item = document.createElement(tag); if (text) item.textContent = text; if (className) item.className = className; return item; };
    const unit = record => [record.currency, record.unit].filter(Boolean).join(' / ');
    const source = record => [record.source_name || record.source, record.source_url].filter(Boolean).join(' · ');
    const gaps = {daily:7, weekly:10, monthly:62, quarterly:115, annual:400};
    let selectedIds = [], pageSpec;
    function attach(host, specification, label = 'Quick visual') {
        if (!host) return null;
        let binding = bindings.get(host);
        if (binding) { binding.spec = specification; binding.button.textContent = label; return binding.button; }
        const button = node('button', label, 'bw-create-graphic'); button.type = 'button';
        const status = node('span', '', 'bw-graphic-status'); status.setAttribute('role', 'status');
        binding = {button, status, spec:specification}; bindings.set(host, binding);
        button.addEventListener('click', async () => {
            if (!BW.QuickVisuals) return;
            button.disabled = true; status.textContent = '';
            try {
                const spec = await (typeof binding.spec === 'function' ? binding.spec() : binding.spec);
                if (host.isConnected) { button.disabled = false; BW.QuickVisuals.open(spec || {}, {trigger:button}); }
            } catch (error) { status.textContent = error.visualMessage || 'Could not load these observations. Try again.'; }
            finally { button.disabled = false; }
        });
        host.append(button, status); return button;
    }
    function benchmark(record, points, extra = {}) {
        const frequency = record.frequency || (record.is_daily ? 'daily' : 'monthly');
        return {id:'benchmark:' + record.id, title:record.name + ' over time', type:'line', unit:unit(record),
            source:source(record), notes:'Historical reference observations. Missing periods remain gaps.', frequency,
            series:[{id:record.id, name:record.name, unit:unit(record), source:source(record), sourceUrl:record.source_url,
                frequency, gapDays:gaps[frequency] || 62, points:points || record.history || []}], ...extra};
    }
    function reference(data, metadata = {}) {
        return {id:metadata.id || location.pathname, title:metadata.title || data.name, unit:data.unit, type:'line',
            source:metadata.source || '', notes:metadata.notes || 'Original source periods. Missing observations remain gaps; source flags are retained.',
            series:[{name:data.name, unit:data.unit, frequency:data.frequency, gapDays:gaps[data.frequency] || 62,
                points:data.history, source:metadata.source, sourceUrl:metadata.sourceUrl}]};
    }
    function catalogSpecs(records) {
        // Only a common measure, source, unit and reporting period can share a ranking.
        const groups = new Map();
        for (const record of records || []) {
            const key = JSON.stringify([record.measure,record.unit,record.period,record.source]);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(record);
        }
        return [...groups.values()].map(items => {
            const first = items[0], title = first.measure + (first.period ? ' · ' + first.period : '');
            return {id:'catalog:' + items.map(item=>item.id).join(','), name:title + ' (' + items.length + ')', title,
                type:'ranking', unit:first.unit, source:first.source,
                notes:'Latest saved observations on this results page only. Matched measure, publisher, units and period; this is not a complete global ranking.',
                rows:items.map(item => ({label:item.label, value:item.value, display_value:item.display_value, unit:item.unit,
                    period:item.period, source:[item.source,item.sourceUrl].filter(Boolean).join(' · '), status:item.status, footnote:item.footnote}))};
        });
    }
    function unavailable(message) { const error = new Error(message); error.visualMessage = message; throw error; }
    function cachedRecord(row) {
        const record = BW.CompactTable?.sparklineData?.find(item => String(item.id) === row.dataset.id);
        if (!record) unavailable('Observations are still loading. Try again when the table is ready.');
        return {...record, frequency:record.frequency || row.dataset.frequency};
    }
    function tableSpec(mode = 'selected', id) {
        if (document.getElementById('data-table')?.getAttribute('aria-busy') === 'true') unavailable('Observations are updating. Try again when the table is ready.');
        const all = [...document.querySelectorAll('#table-body tr[data-id]')];
        const visible = BW.TableWorkspace?.getVisibleRows?.() || all.filter(row => !row.hidden && row.style.display !== 'none');
        const selected = BW.TableWorkspace?.getSelectedIds?.() || selectedIds;
        const rows = id ? all.filter(row => row.dataset.id === id) : mode === 'filtered' ? visible : all.filter(row => selected.includes(row.dataset.id));
        if (!rows.length) unavailable(id ? 'This benchmark is no longer in the table.' : mode === 'filtered' ? 'No matching observations to visualize. Adjust the table filters.' : 'Select one or more benchmarks to visualize.');
        if (mode !== 'filtered' && rows.length > 8) unavailable('Select up to eight benchmark histories for a quick visual.');
        const records = rows.map(cachedRecord);
        const range = document.getElementById('date-range-display')?.textContent.trim() || BW.TableWorkspace?.current?.range || 'Current table range';
        const note = 'Table range: ' + range + '. Historical reference observations; source gaps remain open.';
        if (mode === 'filtered') return {
            id:'table:filtered:' + rows.map(row=>row.dataset.id).join(','), title:'Filtered reference values', type:'ranking',
            unit:unit(records[0]), source:[...new Set(records.map(source))].join('; '),
            notes:note + ' Only filtered rows are included. Reference dates can differ; inspect each value for its original period. Units are shown separately.',
            rows:records.map(record=>({id:record.id,label:record.name,value:record.price,unit:unit(record),period:record.date,
                source:source(record),sourceUrl:record.source_url,status:record.status,footnote:record.footnote}))
        };
        const specs = records.map(record => benchmark(record,record.history,{notes:note}));
        if (specs.length === 1) return specs[0];
        const combined = {id:'selection:' + records.map(record=>record.id).join(','), name:'Selected histories', title:'Selected benchmark histories', type:'line',
            unit:specs[0].unit, source:[...new Set(specs.map(spec=>spec.source))].join('; '),
            notes:note + ' Only selected rows are included. Units are shown separately.', series:specs.flatMap(spec=>spec.series)};
        return {...combined, datasets:[combined,...specs.map(spec=>({...spec,name:spec.title}))]};
    }
    function attachRow(host, id, name) {
        const button = attach(host,()=>tableSpec('row',id));
        if (!button || button.classList.contains('bw-quick-row')) return button;
        button.classList.add('bw-quick-row'); button.setAttribute('aria-label','Quick visual for ' + name); button.title = 'Quick visual';
        const icon = document.createElementNS('http://www.w3.org/2000/svg','svg');
        icon.setAttribute('viewBox','0 0 24 24'); icon.setAttribute('width','16'); icon.setAttribute('height','16'); icon.setAttribute('fill','none'); icon.setAttribute('stroke','currentColor'); icon.setAttribute('stroke-width','1.7'); icon.setAttribute('aria-hidden','true');
        const line = document.createElementNS(icon.namespaceURI,'path'); line.setAttribute('d','M4 4v16h16M7 15l4-5 4 3 5-7'); icon.append(line); button.replaceChildren(icon);
        return button;
    }
    async function defaultSpec() {
        if (pageSpec) return typeof pageSpec === 'function' ? pageSpec() : pageSpec;
        if (document.getElementById('table-workspace') || document.getElementById('grid-view')) return tableSpec(selectedIds.length ? 'selected' : 'filtered');
        const data = json('gr-chart-data'); if (data) return reference(data,json('bw-visual-source') || {});
        return {id:'custom', title:'Untitled graphic', notes:'Add your data and its source to create a graphic.'};
    }
    function setPage(spec) { pageSpec = spec; }
    function initCatalog() {
        const records = json('bw-visual-catalog'); if (!records) return;
        const datasets = catalogSpecs(records);
        const spec = {...datasets[0],datasets};
        attach(document.querySelector('[data-visual-catalog-actions]'), spec, 'Visualize this page');
        if (datasets.length) setPage(spec);
        document.querySelectorAll('[data-visual-history]').forEach(button => {
            button.addEventListener('click', async () => {
                button.disabled = true;
                const status = button.nextElementSibling;
                if (status?.matches('[role=status]')) status.textContent = '';
                try {
                    const url = new URL(button.dataset.visualHistory, location.href);
                    if (url.origin !== location.origin) throw new Error('Only saved local sources');
                    const response = await fetch(url); if (!response.ok) throw new Error('Unavailable');
                    const doc = new DOMParser().parseFromString(await response.text(),'text/html');
                    const data = JSON.parse(doc.getElementById('gr-chart-data').textContent);
                    const meta = JSON.parse(doc.getElementById('bw-visual-source')?.textContent || '{}');
                    button.disabled = false; BW.QuickVisuals.open(reference(data,meta),{trigger:button});
                } catch (_) { if (status?.matches('[role=status]')) status.textContent = 'History could not load. Try again.'; }
                finally { button.disabled = false; }
            });
        });
    }
    BW.VisualBuilderSources = {attach,attachRow,benchmark,reference,catalogSpecs,setPage,defaultSpec,tableSpec};
    document.addEventListener('bw:table-selection',event=>{selectedIds=event.detail?.ids || [];});
    document.addEventListener('DOMContentLoaded',()=>{
        initCatalog();
        const filtered = attach(document.getElementById('tw-visual-actions'),()=>tableSpec('filtered'),'Visualize filtered');
        if (filtered) {
            filtered.setAttribute('aria-label','Visualize filtered'); filtered.title = 'Visualize filtered';
            const label = node('span','Visualize filtered','bw-quick-label');
            const icon = document.createElementNS('http://www.w3.org/2000/svg','svg');
            icon.setAttribute('viewBox','0 0 24 24'); icon.setAttribute('width','16'); icon.setAttribute('height','16'); icon.setAttribute('fill','none'); icon.setAttribute('stroke','currentColor'); icon.setAttribute('stroke-width','1.7'); icon.setAttribute('aria-hidden','true');
            const line = document.createElementNS(icon.namespaceURI,'path'); line.setAttribute('d','M4 4v16h16M7 15l4-5 4 3 5-7'); icon.append(line); filtered.replaceChildren(icon,label);
        }
        attach(document.getElementById('tw-selection'),tableSpec);
    });
})();
