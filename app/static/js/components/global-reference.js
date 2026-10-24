/* D3 history of cached official references; no requests to external providers. */
(function () {
    'use strict';
    const target = document.getElementById('gr-chart');
    const sharedTarget = document.getElementById('market-reference-history');
    const source = document.getElementById('gr-chart-data');
    if ((!target && !sharedTarget) || !source || !window.BW?.Visuals) return;
    let data;
    try { data = JSON.parse(source.textContent); } catch (_) { return; }
    if (sharedTarget && BW.ReferenceHistory) {
        let metadata = {};
        try { metadata = JSON.parse(document.getElementById('bw-visual-source')?.textContent || '{}'); } catch (_) {}
        const controller = BW.ReferenceHistory.mount(sharedTarget, {...data,is_daily:data.frequency === 'daily'}, {
            idPrefix:'market', unit:data.unit, sourcePeriods:true, showTable:false, preferenceKey:'bw.detail.chart.v1',
            format:value => value === null ? 'Unavailable' : Number(value).toLocaleString(undefined,{maximumSignificantDigits:8}),
            quickVisual: BW.QuickVisuals ? (points,type,trigger) => {
                BW.QuickVisuals.open({id:metadata.id || data.name,title:data.name,type,unit:data.unit,source:metadata.source,
                    notes:metadata.notes,frequency:data.frequency,series:[{name:data.name,unit:data.unit,frequency:data.frequency,
                        gapDays:4,points,source:metadata.source,sourceUrl:metadata.sourceUrl}]}, {trigger,allowCustomize:data.allowExport !== false});
            } : null,
            gapDays:4,
        });
        window.addEventListener('pagehide', event => {if (!event.persisted) controller?.destroy();});
        return;
    }
    const readout = document.getElementById('gr-readout');
    const range = document.getElementById('gr-range');
    const type = document.getElementById('gr-chart-type');
    const caption = document.getElementById('gr-range-caption');
    // A 53-week fiscal year spans 371 days; it is still a consecutive annual report.
    const gaps = {daily: 4, weekly: 10, monthly: 40, annual: 400};
    let chart, frame, disposed = false, width = 0, height = 0;
    function inspect(point) {
        if (!point) return;
        readout.querySelector('strong').textContent = String(point.display_value ?? point.value);
        readout.querySelector('span').textContent = `${data.unit} · Period ${point.period || point.date}${point.status ? ' · Source flag ' + point.status : ''}`;
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
        chart = BW.Visuals.timeSeries(target, [{name: data.name, unit: data.unit, gapDays: gaps[data.frequency] || 40, points}], {
            width, height,
            finance: true, yAxisPosition: 'right', type: type.value, dots: false,
            // Short daily histories should label observed days, not repeated intraday ticks.
            xValues: data.frequency === 'daily' && points.length <= 7
                ? points.map(point => new Date(point.date + 'T00:00:00Z')) : undefined,
            externalReadout: true, yFormat: value => Number(value).toLocaleString('en', {
                notation: Math.abs(value) >= 1e6 ? 'compact' : 'standard', maximumSignificantDigits: 5,
            }),
            tooltipDate: point => point.period || point.date,
            onInspect: inspect, label: `${data.name}. Original source periods and exact values in the observation table.`,
            animation: 160,
        });
        target.dataset.rendered = 'true';
        if (data.allowExport !== false && BW.VisualBuilderSources) {
            let metadata = {};
            try { metadata = JSON.parse(document.getElementById('bw-visual-source')?.textContent || '{}'); } catch (_) {}
            const spec = BW.VisualBuilderSources.reference({...data, history:points},metadata);
            spec.type = type.value;
            BW.VisualBuilderSources.attach(document.querySelector('.gr-chart-controls'), spec);
            BW.VisualBuilderSources.setPage(spec);
        }
    }
    function schedule() { if (disposed) return; cancelAnimationFrame(frame); frame = requestAnimationFrame(render); }
    range.addEventListener('change', schedule);
    type.addEventListener('change', schedule);
    const resize = new ResizeObserver(() => {if (Math.max(280,target.clientWidth) !== width || target.clientHeight !== height) schedule();});
    resize.observe(target);
    const theme = new MutationObserver(schedule);
    theme.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
    render();
    window.addEventListener('pagehide', event => {
        // A back/forward-cache entry resumes this same document and its controls.
        if (event.persisted) return;
        disposed = true; cancelAnimationFrame(frame); chart?.destroy(); resize.disconnect(); theme.disconnect();
    });
})();
