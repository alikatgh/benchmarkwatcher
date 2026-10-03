/* D3 history of cached official references; no requests to external providers. */
(function () {
    'use strict';
    const target = document.getElementById('gr-chart');
    const source = document.getElementById('gr-chart-data');
    if (!target || !source || !window.BW?.Visuals) return;
    let data;
    try { data = JSON.parse(source.textContent); } catch (_) { return; }
    const readout = document.getElementById('gr-readout');
    const range = document.getElementById('gr-range');
    const type = document.getElementById('gr-chart-type');
    const caption = document.getElementById('gr-range-caption');
    const gaps = {daily: 4, weekly: 10, monthly: 40, annual: 370};
    let chart, frame;
    function inspect(point) {
        if (!point) return;
        readout.querySelector('strong').textContent = String(point.value);
        readout.querySelector('span').textContent = `${data.unit} · Period ${point.period || point.date}${point.status ? ' · Source flag ' + point.status : ''}`;
    }
    function render() {
        chart?.destroy();
        let points = data.history;
        if (range.value !== 'all' && points.length) {
            const threshold = new Date(points[points.length - 1].date + 'T00:00:00Z');
            threshold.setUTCFullYear(threshold.getUTCFullYear() - Number(range.value));
            points = points.filter(point => Date.parse(point.date + 'T00:00:00Z') >= +threshold);
        }
        caption.textContent = points.length ? `${points.length} saved observations · ${points[0].period} — ${points[points.length - 1].period}` : 'No saved observations in this range.';
        chart = BW.Visuals.timeSeries(target, [{name: data.name, unit: data.unit, gapDays: gaps[data.frequency] || 40, points}], {
            width: Math.max(280, target.clientWidth), height: target.clientHeight,
            finance: true, yAxisPosition: 'right', type: type.value, dots: false,
            externalReadout: true, yFormat: value => Number(value).toLocaleString(undefined, {maximumSignificantDigits: 5}),
            onInspect: inspect, label: `${data.name}. Original source periods and exact values in the observation table.`,
            animation: 160,
        });
        target.dataset.rendered = 'true';
    }
    function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(render); }
    range.addEventListener('change', schedule);
    type.addEventListener('change', schedule);
    const resize = new ResizeObserver(schedule);
    resize.observe(target);
    const theme = new MutationObserver(schedule);
    theme.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
    render();
    window.addEventListener('pagehide', () => { cancelAnimationFrame(frame); chart?.destroy(); resize.disconnect(); theme.disconnect(); }, {once: true});
})();
