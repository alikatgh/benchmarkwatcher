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
    let selectedIds = [], catalogPromise, pageSpec;
    function attach(host, specification, label = 'Create graphic') {
        if (!host) return null;
        let binding = bindings.get(host);
        if (binding) { binding.spec = specification; binding.button.textContent = label; return binding.button; }
        const button = node('button', label, 'bw-create-graphic'); button.type = 'button';
        const status = node('span', '', 'bw-graphic-status'); status.setAttribute('role', 'status');
        binding = {button, status, spec:specification}; bindings.set(host, binding);
        button.addEventListener('click', async () => {
            if (!BW.VisualBuilder) return;
            button.disabled = true; status.textContent = '';
            try {
                const spec = await (typeof binding.spec === 'function' ? binding.spec() : binding.spec);
                if (host.isConnected) BW.VisualBuilder.open(spec || {});
            } catch (_) { status.textContent = 'Could not load these observations. Try again.'; }
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
    async function getCatalog() {
        if (!catalogPromise) catalogPromise = fetch('/api/commodities?include_history=false').then(async response => {
            if (!response.ok) throw new Error('Catalog unavailable');
            const payload = await response.json(); return Array.isArray(payload) ? payload : payload.data || payload.commodities || [];
        }).catch(error => { catalogPromise = null; throw error; });
        return catalogPromise;
    }
    async function loadBenchmark(id) {
        const response = await fetch('/api/commodity/' + encodeURIComponent(id));
        if (!response.ok) throw new Error('History unavailable');
        const payload = await response.json(); return payload.data || payload.commodity || payload;
    }
    async function tableSpec() {
        const visible = [...document.querySelectorAll('#table-body tr[data-id]')].filter(row => !row.hidden && row.style.display !== 'none');
        const category = new URLSearchParams(location.search).get('category');
        const catalog = await getCatalog();
        const ids = selectedIds.length ? selectedIds : [visible[0]?.dataset.id || catalog.find(record=>!category || record.category === category)?.id].filter(Boolean);
        if (!ids.length) return {};
        if (ids.length > 8) throw new Error('Choose up to eight histories');
        const records = await Promise.all(ids.map(loadBenchmark));
        const specs = records.map(record => benchmark(record));
        if (records.length === 1) return specs[0];
        const sameUnit = specs.every(spec=>spec.unit === specs[0].unit);
        const combined = {id:'comparison:' + ids.join(','), name:'Selected histories', title:'Selected benchmark histories', type:'line',
            unit:sameUnit ? specs[0].unit : '', source:[...new Set(specs.map(spec=>spec.source))].join('; '),
            notes:'Selected benchmarks. Only matching units share an axis; original observation dates are retained.', series:specs.flatMap(spec=>spec.series)};
        return {...combined, datasets:[combined,...specs.map(spec=>({...spec,name:spec.title}))]};
    }
    async function defaultSpec() {
        if (pageSpec) return typeof pageSpec === 'function' ? pageSpec() : pageSpec;
        if (document.getElementById('table-workspace') || document.getElementById('grid-view')) return tableSpec();
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
                    BW.VisualBuilder.open(reference(data,meta));
                } catch (_) { if (status?.matches('[role=status]')) status.textContent = 'History could not load. Try again.'; }
                finally { button.disabled = false; }
            });
        });
    }
    function initCategory() {
        const section = document.getElementById('bw-category-graphic'); if (!section) return;
        const select = section.querySelector('select'), stage = section.querySelector('[data-category-preview]');
        const status = section.querySelector('[role=status]'), heading = section.querySelector('h2');
        let sequence = 0, currentId = '', graphic, spec;
        async function load() {
            const token = ++sequence; status.textContent = 'Loading saved history…';
            stage.setAttribute('aria-busy','true'); section.querySelector('[data-category-actions]').hidden = true;
            try {
                const record = await loadBenchmark(select.value); if (token !== sequence) return;
                spec = benchmark(record,undefined,{type:'area',title:record.name + ' · historical reference prices'});
                graphic?.destroy(); graphic = BW.VisualBuilder.render(stage,spec);
                attach(section.querySelector('[data-category-actions]'),()=>spec,'Edit this graphic');
                section.querySelector('[data-category-actions]').hidden = false; status.textContent = '';
            } catch (_) { if (token === sequence) { stage.replaceChildren(); status.textContent = 'History is unavailable. Choose a benchmark to retry.'; } }
            finally { if (token === sequence) stage.removeAttribute('aria-busy'); }
        }
        async function update() {
            const params = new URLSearchParams(location.search), category = params.get('category');
            const shown = !!category && (!params.get('workspace') || params.get('workspace') === 'benchmarks');
            section.hidden = !shown;
            const featured = document.getElementById('bw-featured'); if (featured) featured.hidden = shown;
            if (!shown) { ++sequence; currentId=''; return; }
            if (category === currentId) return;
            currentId = category; const token = ++sequence;
            spec = null; section.querySelector('[data-category-actions]').hidden = true;
            const names = {energy:'Energy',metal:'Metals',precious:'Precious metals',agricultural:'Agriculture',index:'Indices'};
            heading.textContent = (names[category] || 'Benchmark') + ' in graphics';
            const related = section.querySelector('footer a');
            related.href = '/data?q=' + encodeURIComponent(names[category] || category);
            related.textContent = 'Explore related country data →';
            stage.replaceChildren(); status.textContent = 'Loading saved benchmarks…';
            try {
                const records = (await getCatalog()).filter(record=>record.category === category); if (token !== sequence) return;
                select.replaceChildren(...records.map(record => new Option(record.name,record.id)));
                if (records.length) await load();
                else status.textContent = 'No saved benchmarks in this category yet.';
            } catch (_) { if (token === sequence) { currentId=''; status.textContent = 'Could not load this category. Reopen it to retry.'; } }
        }
        select.addEventListener('change',load);
        document.addEventListener('bw:table-view-change',()=>queueMicrotask(update));
        document.addEventListener('bw:table-ready',()=>queueMicrotask(update));
        document.addEventListener('click',event=>{if(event.target.closest('[data-workspace-category],[data-workspace]')) setTimeout(update,0);});
        window.addEventListener('popstate',()=>queueMicrotask(update));
        update();
    }
    BW.VisualBuilderSources = {attach,benchmark,reference,catalogSpecs,setPage,defaultSpec};
    document.addEventListener('bw:table-selection',event=>{selectedIds=event.detail?.ids || [];});
    document.addEventListener('DOMContentLoaded',()=>{
        const launch = document.querySelector('[data-open-visual-builder]');
        if (launch) launch.addEventListener('click',async()=>{
            launch.disabled=true;
            try { BW.VisualBuilder.open(await defaultSpec()); }
            catch (_) { BW.VisualBuilder.open({title:'Untitled graphic',notes:'Saved data could not load. Paste data to begin, or close and retry.'}); }
            finally {launch.disabled=false;}
        });
        initCatalog(); initCategory();
        attach(document.getElementById('tw-selection'),tableSpec);
    });
})();
