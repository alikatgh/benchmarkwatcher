/* D3 history of cached official references; no requests to external providers. */
(function () {
    'use strict';
    const BW = window.BW = window.BW || {};
    if (BW.ReferencePage?.mount) { BW.ReferencePage.mount(document); return; }
    const mounted = new WeakMap();
    const active = new Set();
    const find = (scope, id) => scope?.id === id ? scope :
        (scope === document && scope.getElementById ? scope.getElementById(id) : scope?.querySelector?.('#' + id));
    function metadata(scope) {
        try { return JSON.parse(find(scope, 'bw-visual-source')?.textContent || '{}') || {}; }
        catch (_) { return {}; }
    }
    function retain(target, controller) {
        if (!controller) return null;
        let destroyed = false;
        const handle = {
            getState: () => controller.getState?.() ?? null,
            destroy() {
                if (destroyed) return;
                destroyed = true;
                active.delete(handle);
                mounted.delete(target);
                controller.destroy?.();
            },
        };
        mounted.set(target, handle);
        active.add(handle);
        return handle;
    }
    function mount(scope = document, {state} = {}) {
        const sharedTarget = find(scope, 'market-reference-history');
        const target = sharedTarget || find(scope, 'gr-chart');
        if (!target) return null;
        if (mounted.has(target)) return mounted.get(target);
        const source = find(scope, 'gr-chart-data');
        if (!source || !BW.Visuals) return null;
        let data;
        try { data = JSON.parse(source.textContent); } catch (_) { return null; }
        if (!data || !Array.isArray(data.history) || !data.history.length) return null;
        if (sharedTarget) {
            if (!BW.ReferenceHistory?.mount) return null;
            const savedSource = metadata(scope);
            return retain(target, BW.ReferenceHistory.mount(target, {...data,is_daily:data.frequency === 'daily'}, {
                idPrefix:'market', unit:data.unit, sourcePeriods:true, showTable:false, preferenceKey:'bw.detail.chart.v1', state,
                format:value => value === null ? 'Unavailable' : Number(value).toLocaleString(undefined,{maximumSignificantDigits:8}),
                quickVisual: BW.QuickVisuals ? (points,type,trigger) => {
                    BW.QuickVisuals.open({id:savedSource.id || data.name,title:data.name,type,unit:data.unit,source:savedSource.source,
                        notes:savedSource.notes,frequency:data.frequency,series:[{name:data.name,unit:data.unit,frequency:data.frequency,
                            gapDays:4,points,source:savedSource.source,sourceUrl:savedSource.sourceUrl}]}, {trigger,allowCustomize:data.allowExport !== false});
                } : null,
                gapDays:4,
            }));
        }
        return retain(target, mountLegacy(scope, target, data, state));
    }
    function mountLegacy(scope, target, data, state) {
        const readout = find(scope, 'gr-readout');
        const value = readout?.querySelector('strong');
        const period = readout?.querySelector('span');
        const range = find(scope, 'gr-range');
        const type = find(scope, 'gr-chart-type');
        const caption = find(scope, 'gr-range-caption');
        if (!value || !period || !range || !type || !caption) return null;
        if (['all','5','1'].includes(state?.range)) range.value = state.range;
        if (['line','step','bar','scatter'].includes(state?.chartStyle)) type.value = state.chartStyle;
        // A 53-week fiscal year spans 371 days; it is still a consecutive annual report.
        const gaps = {daily:4, weekly:10, monthly:40, annual:400};
        let chart, frame, disposed = false, width = 0, height = 0;
        function inspect(point) {
            if (!point) return;
            value.textContent = String(point.display_value ?? point.value);
            period.textContent = `${data.unit} · Period ${point.period || point.date}${point.status ? ' · Source flag ' + point.status : ''}`;
        }
        function render() {
            if (disposed) return;
            width = Math.max(280, target.clientWidth); height = target.clientHeight;
            chart?.destroy();
            let points = data.history;
            if (range.value !== 'all' && points.length) {
                const threshold = new Date(points[points.length - 1].date + 'T00:00:00Z');
                threshold.setUTCFullYear(threshold.getUTCFullYear() - Number(range.value));
                points = points.filter(point => Date.parse(point.date + 'T00:00:00Z') >= +threshold);
            }
            caption.textContent = points.length ? `${points.length} saved observations · ${points[0].period} — ${points[points.length - 1].period}` : 'No saved observations in this range.';
            chart = BW.Visuals.timeSeries(target, [{name:data.name, unit:data.unit, gapDays:gaps[data.frequency] || 40, points}], {
                width, height,
                finance:true, yAxisPosition:'right', type:type.value, dots:false,
                // Short daily histories label observed days, not repeated intraday ticks.
                xValues:data.frequency === 'daily' && points.length <= 7
                    ? points.map(point => new Date(point.date + 'T00:00:00Z')) : undefined,
                externalReadout:true, yFormat:value => Number(value).toLocaleString('en', {
                    notation:Math.abs(value) >= 1e6 ? 'compact' : 'standard', maximumSignificantDigits:5,
                }),
                tooltipDate:point => point.period || point.date,
                onInspect:inspect, label:`${data.name}. Original source periods and exact values in the observation table.`,
                animation:160,
            });
            target.dataset.rendered = 'true';
            if (data.allowExport !== false && BW.VisualBuilderSources) {
                const spec = BW.VisualBuilderSources.reference({...data, history:points}, metadata(scope));
                spec.type = type.value;
                BW.VisualBuilderSources.attach(scope.querySelector?.('.gr-chart-controls'), spec);
                BW.VisualBuilderSources.setPage(spec);
            }
        }
        function schedule() { if (disposed) return; cancelAnimationFrame(frame); frame = requestAnimationFrame(render); }
        range.addEventListener('change', schedule);
        type.addEventListener('change', schedule);
        const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
            if (Math.max(280,target.clientWidth) !== width || target.clientHeight !== height) schedule();
        }) : null;
        resize?.observe(target);
        const theme = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null;
        theme?.observe(document.documentElement, {attributes:true, attributeFilter:['data-theme']});
        function destroy() {
            if (disposed) return;
            disposed = true;
            cancelAnimationFrame(frame);
            range.removeEventListener?.('change', schedule);
            type.removeEventListener?.('change', schedule);
            chart?.destroy(); resize?.disconnect(); theme?.disconnect();
        }
        try { render(); } catch (error) { destroy(); throw error; }
        return {destroy, getState:() => ({range:range.value, chartStyle:type.value})};
    }
    BW.ReferencePage = {mount};
    window.addEventListener('pagehide', event => {
        // A back/forward-cache entry resumes the same document and controls.
        if (event.persisted) return;
        for (const handle of [...active]) handle.destroy();
    });
    mount();
})();
