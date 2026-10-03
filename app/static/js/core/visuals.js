/* Shared D3 rendering for benchmark histories, comparisons and workbook values. */
(function () {
    'use strict';
    window.BW = window.BW || {};
    const d = window.d3;
    const DAY = 86400000;
    let sequence = 0;
    const numeric = value => ['number', 'string'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
    const color = () => getComputedStyle(document.documentElement).getPropertyValue('--theme-accent').trim() || '#1967d2';
    const format = value => value === null ? 'Unavailable' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
    function domain(values, zero) {
        let [lo, hi] = d.extent(values.filter(Number.isFinite));
        if (lo === undefined) return [0, 1];
        if (zero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
        const pad = lo === hi ? Math.max(Math.abs(lo) * .05, 1) : (hi - lo) * .06;
        return [zero && lo === 0 ? 0 : lo - pad, hi + pad];
    }
    function history(rows) {
        const dates = new Map();
        (Array.isArray(rows) ? rows : []).forEach(row => {
            const date = String(row.date || '').slice(0, 10);
            const time = Date.parse(date + 'T00:00:00Z');
            if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date) {
                dates.set(date, { ...row, date, time, value: numeric(row.value === undefined ? row.price : row.value) });
            }
        });
        return [...dates.values()].sort((a, b) => a.time - b.time);
    }
    function segments(points, gapDays) {
        const groups = []; let group = [], previous = null;
        points.forEach(point => {
            if (point.value === null || (previous && point.time - previous.time > gapDays * DAY)) {
                if (group.length) groups.push(group);
                group = [];
            }
            if (point.value !== null) group.push(point);
            previous = point.value === null ? null : point;
        });
        if (group.length) groups.push(group);
        return groups;
    }
    function root(target, width, height, label) {
        const selection = target ? d.select(target) : d.create('svg');
        const svg = target?.tagName?.toLowerCase() === 'svg' || !target ? selection : selection.selectAll('svg.bw-d3-chart').data([null]).join('svg');
        svg.selectAll('*').remove();
        svg.classed('bw-d3-chart', true).attr('viewBox', `0 0 ${width} ${height}`)
            .attr('role', 'img').attr('aria-label', label).attr('xmlns', 'http://www.w3.org/2000/svg');
        svg.append('title').text(label);
        return svg;
    }
    function empty(svg, width, height, message) {
        svg.append('text').attr('x', width / 2).attr('y', height / 2).attr('text-anchor', 'middle').attr('fill', 'currentColor').text(message || 'No usable observations in this range.');
    }
    function axes(svg, x, y, width, height, options = {}) {
        const left = options.left ?? 70, right = options.right ?? width - 24, bottom = height - 38;
        if (options.grid !== false) svg.append('g').attr('class', 'bw-d3-grid').attr('transform', `translate(${left},0)`)
            .call(d.axisLeft(y).ticks(options.yTicks || 5).tickSize(-(right - left)).tickFormat('')).call(g => g.select('.domain').remove());
        svg.append('g').attr('class', 'bw-d3-axis').attr('transform', `translate(${options.yAxisPosition === 'right' ? right : left},0)`).call((options.yAxisPosition === 'right' ? d.axisRight(y) : d.axisLeft(y)).ticks(options.yTicks || 5).tickFormat(options.yFormat || d.format('~s')));
        const axis = d.axisBottom(x);
        if (options.xValues) axis.tickValues(options.xValues);
        else axis.ticks(options.finance ? Math.max(3, Math.min(7, Math.floor((right - left) / 100))) : Math.max(2, Math.min(options.xTicks || 7, Math.floor(width / 125))));
        if (options.xFormat) axis.tickFormat(options.xFormat);
        const xAxis = svg.append('g').attr('class', 'bw-d3-axis bw-d3-axis-x').attr('transform', `translate(0,${bottom})`).call(axis);
        if (options.verticalGrid) svg.append('g').attr('class', 'bw-d3-grid').attr('transform', `translate(0,${bottom})`).call(d.axisBottom(x).ticks(Math.max(2, Math.floor(width / 125))).tickSize(-(bottom - 24)).tickFormat('')).call(g => g.select('.domain').remove());
        if (options.gridColor) svg.selectAll('.bw-d3-grid line').style('stroke', options.gridColor);
        svg.selectAll('.bw-d3-axis text').style('font-size', (options.axisFontSize || 11) + 'px');
        if (options.finance) {
            svg.selectAll('.bw-d3-axis .domain,.bw-d3-axis .tick line').remove();
            svg.selectAll('.bw-d3-axis text').attr('dy', '.35em');
            xAxis.selectAll('text').attr('dy', '1.1em').attr('text-anchor', value => x(value) - left < 24 ? 'start' : right - x(value) < 24 ? 'end' : 'middle');
        }
    }
    function timeSeries(target, input, options = {}) {
        const width = options.width || Math.max(320, target?.clientWidth || 760), height = options.height || 320;
        const left = options.finance ? 8 : options.yAxisPosition === 'right' ? 24 : 70, right = width - (options.yAxisPosition === 'right' ? (options.finance ? 62 : 70) : 24), top = options.finance ? 16 : 32, bottom = height - 38;
        const series = input.map((series, index) => ({ ...series, color: series.color || color(), index, points: history(series.points || []) }));
        const values = series.flatMap(s => s.points.filter(p => p.value !== null));
        const svg = root(target, width, height, options.label || 'Historical observations. Exact values available in the observation table.');
        if (!values.length) { empty(svg, width, height); return { svg: svg.node(), destroy() {}, resetZoom() {} }; }
        let [first, last] = d.extent(values, p => p.time);
        if (first === last) { first -= DAY; last += DAY; }
        const originalX = d.scaleUtc().domain([first, last]).range([left, right]);
        let x = originalX.copy();
        const y = (options.log && values.every(p => p.value > 0) ? d.scaleLog() : d.scaleLinear())
            .domain(domain(values.map(p => p.value), options.type === 'bar' || options.zero)).range([bottom, top]);
        const clipId = 'bw-d3-clip-' + (++sequence);
        svg.append('defs').append('clipPath').attr('id', clipId).append('rect').attr('x', left).attr('y', top).attr('width', right - left).attr('height', bottom - top);
        const grid = svg.append('g');
        const marks = svg.append('g').attr('clip-path', `url(#${clipId})`);
        const crosshair = svg.append('line').attr('class', 'bw-d3-crosshair').attr('y1', top).attr('y2', bottom).attr('visibility', 'hidden');
        function draw() {
            grid.selectAll('*').remove(); marks.selectAll('*').remove();
            const duration = +x.domain()[1] - +x.domain()[0];
            const magnitude = Math.max(...y.domain().map(Math.abs));
            axes(grid, x, y, width, height, {...options, left, right,
                ...(options.finance ? {yFormat: options.yFormat || y.tickFormat(4, magnitude >= 1e6 ? '~s' : magnitude < .001 ? '.2~g' : ',~f'), xFormat: d.utcFormat(duration > 3 * 365 * DAY ? '%Y' : duration > 100 * DAY ? '%b %y' : '%d %b')} : {})});
            if (options.finance && options.type !== 'bar') marks.append('line').attr('class', 'bw-d3-baseline')
                .attr('x1', left).attr('x2', right).attr('y1', y(values[0].value)).attr('y2', y(values[0].value))
                .attr('stroke', 'currentColor').attr('stroke-opacity', .25).attr('stroke-dasharray', '2 4');
            series.forEach(s => {
                const groups = segments(s.points, s.gapDays || 62);
                const isolated = new Set(groups.filter(group => group.length === 1).map(group => group[0]));
                const curve = options.type === 'step' ? d.curveStepAfter : options.tension > 0 ? d.curveCardinal.tension(1 - options.tension) : d.curveLinear;
                const line = d.line().x(p => x(p.time)).y(p => y(p.value)).curve(curve);
                if (options.type === 'area') marks.selectAll(`.area-${s.index}`).data(groups).join('path').attr('class', `area-${s.index} benchmark-detail-area`)
                    .attr('d', d.area().x(p => x(p.time)).y0(bottom).y1(p => y(p.value)).curve(curve)).attr('fill', options.fillColor || s.color).attr('fill-opacity', options.fillOpacity ?? .12);
                if (!['scatter', 'bar'].includes(options.type)) marks.selectAll(`.line-${s.index}`).data([groups]).join('path').attr('class', `line-${s.index} benchmark-detail-line bw-d3-line`)
                    .attr('d', groups => groups.map(line).join(' ')).attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', options.lineWidth || 1.8).attr('stroke-dasharray', s.index ? ['6 3', '2 3', '8 3 2 3'][(s.index - 1) % 3] : null);
                const points = s.points.filter(p => p.value !== null);
                if (options.type === 'bar') {
                    const spacing = d.min(d.pairs(points), pair => x(pair[1].time) - x(pair[0].time)) || 16;
                    const barWidth = Math.max(.5, Math.min(22, spacing * .8 / series.length));
                    marks.selectAll(`.bar-${s.index}`).data(points).join('rect').attr('class', `bar-${s.index} bw-d3-bar`)
                        .attr('x', p => x(p.time) - barWidth * series.length / 2 + s.index * barWidth).attr('width', barWidth)
                        .attr('y', p => Math.min(y(0), y(p.value))).attr('height', p => Math.abs(y(p.value) - y(0))).attr('fill', s.color)
                        .append('title').text(p => `${s.name || ''} · ${p.date}: ${format(p.value)} ${s.unit || ''}`);
                } else {
                    marks.selectAll(`.point-${s.index}`).data(points).join('circle').attr('class', `point-${s.index} benchmark-detail-observation-dot bw-d3-point`)
                        .attr('cx', p => x(p.time)).attr('cy', p => y(p.value)).attr('r', p => points.length === 1 || isolated.has(p) ? 3 : options.type === 'scatter' ? 3 : (options.dots === false ? (points.length === 1 ? 3 : 5) : (options.pointRadius ?? 2)))
                        .attr('fill', p => options.dots === false && points.length > 1 && !isolated.has(p) ? 'transparent' : s.color).append('title').text(p => `${s.name || ''}: ${p.date} · ${Number(p.value).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${s.unit || ''}`);
                }
            });
            if (options.zero && y.domain()[0] <= 0 && y.domain()[1] >= 0) marks.append('line').attr('x1', left).attr('x2', right).attr('y1', y(0)).attr('y2', y(0)).attr('stroke', 'currentColor').attr('opacity', .4);
        }
        draw();
        const ordered = [...new Map([...values].sort((a, b) => a.time - b.time).map(point => [point.time, point])).values()];
        let selected = ordered.length - 1, activeSeries = 0;
        const focus = svg.append('g').attr('class', 'bw-d3-focus').attr('pointer-events', 'none');
        const tooltipId = 'bw-d3-tooltip-' + sequence;
        const tooltip = svg.append('g').attr('id', tooltipId).attr('class', 'bw-d3-tooltip').attr('role', 'tooltip').attr('visibility', 'hidden').attr('pointer-events', 'none');
        const tip = tooltip.append('path').attr('class', 'bw-d3-tooltip-surface');
        const box = tooltip.append('rect').attr('class', 'bw-d3-tooltip-surface').attr('rx', options.tooltipRadius ?? 4);
        const content = tooltip.append('g');
        const ruler = svg.append('text').attr('visibility', 'hidden').attr('aria-hidden', 'true').attr('class', 'bw-d3-tooltip-text');
        if (options.tooltipBg) tooltip.selectAll('.bw-d3-tooltip-surface').style('fill', options.tooltipBg);
        if (options.tooltipText) tooltip.style('color', options.tooltipText);
        function textWidth(text, bold = false) {
            ruler.text(text).attr('font-weight', bold ? 600 : 400);
            return ruler.node().getComputedTextLength?.() || text.length * 7;
        }
        function popup(point, matches, active) {
            if (!active || options.interactive === false || options.tooltip === false || x(point.time) < left || x(point.time) > right) {
                tooltip.attr('visibility', 'hidden'); svg.attr('aria-describedby', null); return;
            }
            const limit = Math.max(80, Math.min(320, width - 16)), padding = Math.max(6, Math.min(20, Number(options.tooltipPadding) || 10));
            const rows = [], date = options.tooltipDate?.(point) || d.utcFormat('%b %-d, %Y')(new Date(point.time));
            const value = item => {
                const n = Number(item.point.value);
                const formatted = options.tooltipFormat ? options.tooltipFormat(n, item.series) : n !== 0 && (Math.abs(n) < 1e-8 || Math.abs(n) >= 1e18) ? String(n) : n.toLocaleString(undefined, {minimumFractionDigits:item.series.unit === '%' ? 3 : 0, maximumFractionDigits:17});
                return formatted + (item.series.unit === '%' ? '%' : '');
            };
            function label(text, maxLines = 2) {
                const lines = []; let line = '';
                // Split long tokens as well as words; the full original label is
                // retained in the tooltip's accessible description.
                for (const char of String(text)) {
                    if (line && textWidth(line + char) > limit - padding * 2) { lines.push(line.trimEnd()); line = ''; }
                    line += char;
                }
                if (line.trim()) lines.push(line.trim());
                const shown = lines.slice(0, maxLines);
                if (lines.length > maxLines) {
                    let last = shown[maxLines - 1];
                    while (last && textWidth(last + '…') > limit - padding * 2) last = last.slice(0, -1);
                    shown[maxLines - 1] = last + '…';
                }
                shown.forEach(text => rows.push([{text}]));
            }
            if (matches.length === 1) {
                const item = matches[0], number = value(item);
                if (series.length > 1) label(item.series.name || 'Series ' + (item.series.index + 1), 1);
                if (textWidth(date) + 8 + textWidth(number, true) <= limit - padding * 2) rows.push([{text:date},{text:number,bold:true,gap:8}]);
                else { label(date); rows.push([{text:number,bold:true}]); }
                if (item.series.unit && item.series.unit !== '%') label(item.series.unit);
                if (point.period && point.period !== date) label('Period: ' + point.period, 1);
            } else {
                label(date);
                matches.forEach(item => {
                    label(item.series.name || 'Series ' + (item.series.index + 1));
                    rows.push([{text:value(item),bold:true}]);
                    if (item.series.unit && item.series.unit !== '%') label(item.series.unit);
                });
            }
            const fullLabel = date + (point.period && point.period !== date ? ' · Period: ' + point.period : '') + ' · ' + matches.map(item => (item.series.name ? item.series.name + ': ' : '') + value(item) + (item.series.unit !== '%' ? ' ' + (item.series.unit || '') : '')).join('; ');
            tooltip.attr('aria-label', fullLabel);
            content.selectAll('*').remove();
            rows.forEach((parts, index) => {
                const line = content.append('text').attr('class', 'bw-d3-tooltip-text').attr('x', padding).attr('y', padding + 13 + index * 18);
                parts.forEach(part => line.append('tspan').attr('dx', part.gap || null).attr('font-weight', part.bold ? 600 : 400).text(part.text));
            });
            const boxWidth = Math.min(limit, Math.max(100, ...rows.map(parts => parts.reduce((sum, part) => sum + textWidth(part.text, part.bold) + (part.gap || 0), 0) + padding * 2)));
            const boxHeight = padding * 2 + rows.length * 18;
            const pointX = x(point.time), pointY = y(matches[0]?.point.value ?? point.value);
            const originX = Math.max(8, Math.min(width - boxWidth - 8, pointX - boxWidth / 2));
            const below = pointY - boxHeight - 16 < 8;
            const originY = Math.max(8, Math.min(height - boxHeight - 8, below ? pointY + 16 : pointY - boxHeight - 16));
            const anchorX = Math.max(10, Math.min(boxWidth - 10, pointX - originX));
            box.attr('width', boxWidth).attr('height', boxHeight);
            tip.attr('d', below ? `M${anchorX-6},0L${anchorX},-8L${anchorX+6},0Z` : `M${anchorX-6},${boxHeight}L${anchorX},${boxHeight+8}L${anchorX+6},${boxHeight}Z`);
            tooltip.attr('transform', `translate(${originX},${originY})`).attr('visibility', 'visible');
            svg.attr('aria-describedby', tooltipId);
        }
        function inspect(point, active = true) {
            if (!point) return;
            crosshair.attr('x1', x(point.time)).attr('x2', x(point.time)).attr('visibility', active && x(point.time) >= left && x(point.time) <= right ? 'visible' : 'hidden');
            const matches = series.map(s => ({ series: s, point: s.points.find(p => p.time === point.time && p.value !== null) })).filter(item => item.point);
            const chosen = matches.find(item => item.series.index === activeSeries) || matches[0];
            if (chosen) activeSeries = chosen.series.index;
            popup(chosen?.point || point, chosen ? [chosen] : [], active);
            focus.selectAll('circle').data(matches).join('circle')
                .attr('cx', item => x(item.point.time)).attr('cy', item => y(item.point.value)).attr('r', active ? 5 : 3.5)
                .attr('visibility', item => x(item.point.time) >= left && x(item.point.time) <= right && (active || options.finance) ? 'visible' : 'hidden').attr('fill', item => item.series.color).attr('stroke', 'var(--theme-surface,#fff)').attr('stroke-width', 2);
            options.onInspect?.(chosen?.point, chosen?.series, {active});
        }
        function inspectDate(date) {
            const index = ordered.findIndex(point => point.date === date);
            if (index >= 0) { selected = index; inspect(ordered[selected]); }
        }
        function resetInspection() { selected = ordered.length - 1; inspect(ordered[selected], false); }
        svg.attr('tabindex', options.interactive === false ? null : 0);
        svg.attr('aria-keyshortcuts', options.interactive === false ? null : 'ArrowLeft ArrowRight Home End Escape' + (series.length > 1 ? ' ArrowUp ArrowDown' : ''));
        if (options.interactive !== false) {
            svg.on('pointermove.inspect pointerdown.inspect', event => {
                const position = d.pointer(event, svg.node()), time = +x.invert(position[0]);
                selected = d.bisector(p => p.time).center(ordered, time);
                const nearest = series.map(s => ({series:s, point:s.points.find(p => p.time === ordered[selected].time && p.value !== null)})).filter(item => item.point).sort((a,b) => Math.abs(y(a.point.value) - position[1]) - Math.abs(y(b.point.value) - position[1]))[0];
                if (nearest) activeSeries = nearest.series.index;
                inspect(ordered[selected]);
            }).on('pointerleave.inspect pointercancel.inspect', event => {
                if (event.type === 'pointercancel' || event.pointerType !== 'touch') resetInspection();
            }).on('keydown.inspect', event => {
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); resetInspection(); return; }
                if (['ArrowUp', 'ArrowDown'].includes(event.key) && series.length > 1) {
                    event.preventDefault();
                    const available = series.filter(s => s.points.some(p => p.time === ordered[selected].time && p.value !== null));
                    const index = available.findIndex(s => s.index === activeSeries);
                    activeSeries = available[(index + (event.key === 'ArrowDown' ? 1 : available.length - 1)) % available.length].index;
                    inspect(ordered[selected]); return;
                }
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                selected = event.key === 'Home' ? 0 : event.key === 'End' ? ordered.length - 1 : Math.max(0, Math.min(ordered.length - 1, selected + (event.key === 'ArrowLeft' ? -1 : 1)));
                inspect(ordered[selected]);
            }).on('blur.inspect', () => {
                // Moving focus to the observation slider must keep its selected
                // date; hide only the transient popup as focus leaves the plot.
                tooltip.attr('visibility', 'hidden'); svg.attr('aria-describedby', null);
            });
        }
        let zoom;
        if (options.zoom || options.pan) {
            zoom = d.zoom().extent([[left, top], [right, bottom]]).translateExtent([[left, top], [right, bottom]]).scaleExtent([1, 64])
                .filter(event => {
                    if (event.type === 'wheel') return options.zoom && (!options.modifier || options.modifier === 'none' ||
                        (options.modifier === 'ctrl' ? event.ctrlKey || event.metaKey : event[options.modifier + 'Key']));
                    if (event.touches?.length > 1) return options.zoom;
                    return !event.button && options.pan;
                }).on('zoom', event => { x = event.transform.rescaleX(originalX); draw(); inspect(ordered[selected]); });
            svg.call(zoom).on('dblclick.zoom', null);
        }
        if (options.initialDate && ordered.some(point => point.date === options.initialDate)) inspectDate(options.initialDate);
        else inspect(ordered[selected], false);
        if (options.animation && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) marks.attr('opacity', 0).transition().duration(Math.min(1000, options.animation)).attr('opacity', 1);
        return { svg: svg.node(), inspectDate, resetZoom() { if (zoom) svg.call(zoom.transform, d.zoomIdentity); }, destroy() { tooltip.attr('visibility','hidden'); svg.attr('aria-describedby',null); marks.interrupt(); svg.on('.zoom', null).on('.inspect', null); }, toBase64Image() { return png(svg.node()); } };
    }
    function sparkline(target, input, options = {}) {
        let points = input.map((p, i) => typeof p === 'object' && p !== null ? { ...p, value: numeric(p.price ?? p.value), x: Date.parse(p.date) || i } : { value: numeric(p), x: i });
        if (input.some(p => p && typeof p === 'object' && p.date)) {
            const spaced = [];
            points.forEach((point, i) => {
                if (i && point.x - points[i - 1].x > (options.gapDays || 62) * DAY) spaced.push({x: point.x, value: null});
                spaced.push(point);
            });
            points = spaced;
        }
        const usable = points.filter(p => p.value !== null), width = 160, height = 40;
        const svg = root(target, width, height, target.getAttribute('aria-label') || 'Historical observations');
        svg.attr('preserveAspectRatio', 'none');
        if (options.type === 'none') { svg.attr('hidden', true); return; }
        svg.attr('hidden', null);
        if (!usable.length) { empty(svg, width, height, 'No data'); return; }
        const x = d.scaleLinear().domain(d.extent(points, p => p.x)).range([4, 156]);
        const y = d.scaleLinear().domain(domain(usable.map(p => p.value), options.type === 'bar')).range([36, 4]);
        const line = d.line().defined(p => p.value !== null).x(p => x(p.x)).y(p => y(p.value)).curve(options.type === 'step' ? d.curveStepAfter : options.tension > 0 ? d.curveCardinal.tension(1 - options.tension) : d.curveLinear);
        if (options.type === 'bar') svg.selectAll('rect').data(usable).join('rect').attr('x', p => x(p.x) - 1).attr('y', p => Math.min(y(0), y(p.value))).attr('width', Math.max(1, 135 / points.length)).attr('height', p => Math.abs(y(p.value) - y(0))).attr('fill', color());
        else {
            if (['area', 'step'].includes(options.type)) svg.append('path').datum(points).attr('d', d.area().defined(p => p.value !== null).x(p => x(p.x)).y0(36).y1(p => y(p.value)).curve(options.type === 'step' ? d.curveStepAfter : options.tension > 0 ? d.curveCardinal.tension(1 - options.tension) : d.curveLinear)).attr('fill', color()).attr('opacity', .1);
            svg.append('path').datum(points).attr('d', line).attr('fill', 'none').attr('stroke', color()).attr('stroke-width', 1.6);
        }
        if (options.type === 'sparkline-range') svg.append('line').attr('x1', 4).attr('x2', 156).attr('y1', y(d.mean(usable, p => p.value))).attr('y2', y(d.mean(usable, p => p.value))).attr('stroke', 'currentColor').attr('stroke-dasharray', '3 3').attr('opacity', .5);
        if (options.showMA) svg.append('path').datum(points.map((p, i) => ({ ...p, value: i >= 6 && points.slice(i - 6, i + 1).every(p => p.value !== null) ? d.mean(points.slice(i - 6, i + 1), p => p.value) : null }))).attr('d', line).attr('fill', 'none').attr('stroke', 'var(--sparkline-ma)').attr('stroke-width', 1).attr('stroke-dasharray', '2 2');
        const marked = options.showHighLow ? [d.least(usable, p => p.value), d.greatest(usable, p => p.value)] : [usable[usable.length - 1]];
        svg.selectAll('circle').data(marked).join('circle').attr('cx', p => x(p.x)).attr('cy', p => y(p.value)).attr('r', 2).attr('fill', color());
    }
    function distribution(target, input, options = {}) {
        // Published percentages keep unavailable observations as unfilled space.
        const svg = root(target, 100, 6, options.label || 'Observation distribution');
        svg.classed('bw-d3-distribution', true).attr('preserveAspectRatio', 'none');
        const x = d.scaleLinear().domain([0, 100]).range([0, 100]).clamp(true);
        let offset = 0;
        const parts = input.map(part => {
            const start = offset;
            offset = Math.min(100, offset + Math.max(0, numeric(part.value) || 0));
            return { ...part, start, end: offset };
        });
        svg.selectAll('rect').data(parts).join('rect').attr('class', 'bw-d3-segment')
            .attr('x', part => x(part.start)).attr('width', part => x(part.end) - x(part.start))
            .attr('height', 6).attr('fill', part => part.color)
            .append('title').text(part => part.label);
        return svg.node();
    }
    async function png(svg) {
        const clone = svg.cloneNode(true);
        const originals = [svg, ...svg.querySelectorAll('*')], copies = [clone, ...clone.querySelectorAll('*')];
        originals.forEach((node, i) => {
            const style = getComputedStyle(node);
            ['color', 'fill', 'stroke', 'font-size', 'font-family', 'stroke-width', 'opacity'].forEach(key => copies[i].style.setProperty(key, style.getPropertyValue(key)));
        });
        const box = svg.viewBox.baseVal;
        clone.setAttribute('width', box.width); clone.setAttribute('height', box.height);
        const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
        try {
            const image = new Image();
            await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
            const canvas = document.createElement('canvas'); canvas.width = box.width * 2; canvas.height = box.height * 2;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--theme-bg').trim() || '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/png');
        } finally { /* Data URLs require no object-URL lifetime or CSP exception. */ }
    }
    BW.Visuals = { timeSeries, sparkline, distribution, history, segments, domain, numeric, format, color, root, axes, empty, png };
})();
