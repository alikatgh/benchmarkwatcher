/* Local graphic authoring. Source observations are retained; nothing is uploaded. */
(function () {
    'use strict';
    window.BW = window.BW || {};
    const DAY = 86400000;
    const PAPER = '#fff1e5', INK = '#252b30', MUTED = '#5f686e', GRID = '#d7cfc8';
    const PALETTE = ['#087e8b', '#d66a36', '#607995', '#936183', '#79752b', '#b64854'];
    const TYPES = [['line', 'Line'], ['area', 'Area'], ['bar', 'Vertical bars'], ['scatter', 'Dots'], ['horizontal', 'Ranked horizontal bars'], ['map', 'Geographic map']];
    let active = null, serial = 0;
    const text = value => value === undefined || value === null ? '' : String(value);
    const array = value => Array.isArray(value) ? value : [];
    const inheritedText = (record, key, fallback) => Object.prototype.hasOwnProperty.call(record, key) ? text(record[key]) : text(fallback);
    const number = value => window.BW.Visuals?.numeric(value) ?? (['string', 'number'].includes(typeof value) && text(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null);
    const unitKey = value => text(value).trim().toLowerCase();
    const unique = values => [...new Set(values.filter(Boolean))];
    const pretty = value => value === null ? 'Unavailable' : Number(value).toLocaleString(undefined, { maximumSignificantDigits: 10 });
    const safeColor = value => /^#[0-9a-f]{6}$/i.test(text(value)) ? value : PALETTE[0];
    const chartType = value => ({ bars: 'bar', dots: 'scatter', ranking: 'horizontal', ranked: 'horizontal', 'horizontal-bars': 'horizontal' }[value] || (TYPES.some(([key]) => key === value) ? value : 'line'));
    function dateValue(value) {
        const raw = text(value).trim();
        let iso;
        if (/^\d{4}$/.test(raw)) iso = raw + '-01-01';
        else if (/^\d{4}-Q[1-4]$/i.test(raw)) iso = raw.slice(0, 4) + '-' + String((Number(raw.slice(-1)) - 1) * 3 + 1).padStart(2, '0') + '-01';
        else if (/^\d{4}-\d{2}$/.test(raw)) iso = raw + '-01';
        else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) iso = raw;
        else return null;
        const time = Date.parse(iso + 'T00:00:00Z');
        return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === iso ? { date: iso, time, period: raw } : null;
    }
    function observation(point, series, index) {
        point = point && typeof point === 'object' ? point : { value: point };
        const period = text(point.period || point.date);
        const date = series.ordinal ? /^\d{4}-\d{2}-\d{2}$/.test(text(point.date)) ? dateValue(point.date) : null : dateValue(point.date || point.period);
        const raw = Object.prototype.hasOwnProperty.call(point, 'rawValue') ? point.rawValue : point.value === undefined ? point.price : point.value;
        return { ...point, date: series.ordinal ? text(point.date) : date?.date || text(point.date), period, time: date?.time ?? null,
            value: number(raw), rawValue: typeof raw === 'number' && !Number.isFinite(raw) ? text(raw) : raw ?? null, index,
            unit: inheritedText(point, 'unit', series.unit), source: inheritedText(point, 'source', series.source),
            sourceUrl: text(point.sourceUrl || point.source_url || series.sourceUrl),
            status: text(point.status), footnote: text(point.footnote), invalidDate: !date && !series.ordinal,
            invalidValue: raw !== undefined && raw !== null && text(raw).trim() !== '' && number(raw) === null };
    }
    function normalize(input = {}) {
        input = input && typeof input === 'object' ? input : {};
        const spec = { ...input };
        spec.id = text(input.id || 'blank');
        spec.title = text(input.title || 'Untitled graphic');
        spec.subtitle = text(input.subtitle); spec.source = text(input.source); spec.notes = text(input.notes);
        spec.geoKey = text(input.geoKey || 'name'); spec.geoSource = text(input.geoSource);
        spec.ordinal = input.ordinal === true;
        spec.color = safeColor(input.color); spec.highlight = text(input.highlight);
        spec.type = chartType(input.type); spec.zero = ['area', 'bar', 'horizontal'].includes(spec.type) || input.zero === true;
        spec.limit = Math.min(100, Math.max(1, Number.parseInt(input.limit, 10) || 20));
        spec.series = array(input.series).filter(row => row && typeof row === 'object').map((row, index) => {
            const series = { ...row, id: text(row.id || 'series-' + index), name: text(row.name || row.id || 'Series ' + (index + 1)),
                unit: inheritedText(row, 'unit', input.unit), source: inheritedText(row, 'source', input.source), sourceUrl: text(row.sourceUrl || row.source_url),
                frequency: text(row.frequency || input.frequency), ordinal: spec.ordinal };
            series.points = array(row.points).map((point, i) => observation(point, series, i));
            return series;
        });
        spec.rows = array(input.rows).filter(row => row && typeof row === 'object').map((row, index) => {
            const raw = Object.prototype.hasOwnProperty.call(row, 'rawValue') ? row.rawValue : row.value === undefined ? row.price : row.value;
            return { ...row, label: text(row.label || row.name || row.id || 'Row ' + (index + 1)), value: number(raw), rawValue: typeof raw === 'number' && !Number.isFinite(raw) ? text(raw) : raw ?? null,
                unit: inheritedText(row, 'unit', input.unit), source: inheritedText(row, 'source', input.source), sourceUrl: text(row.sourceUrl || row.source_url),
                period: text(row.period || row.date), status: text(row.status), footnote: text(row.footnote), index,
                invalidValue: raw !== undefined && raw !== null && text(raw).trim() !== '' && number(raw) === null };
        });
        const ordinalKeys = new Map(), ordinalLabels = [];
        if (spec.ordinal) spec.series.forEach(series => {
            const occurrences = new Map();
            series.points.forEach(point => {
                const label = point.period || point.label || point.date || 'Observation ' + (point.index + 1);
                const occurrence = occurrences.get(label) || 0; occurrences.set(label, occurrence + 1);
                const key = label + '\u0000' + occurrence;
                if (!ordinalKeys.has(key)) { ordinalKeys.set(key, ordinalLabels.length); ordinalLabels.push(label); }
                point.ordinalPosition = ordinalKeys.get(key);
            });
        });
        spec.ordinalLabels = ordinalLabels;
        if (!input.type && spec.rows.length && !spec.series.length) spec.type = 'horizontal';
        spec.units = unique([...spec.series.flatMap(row => [row.unit, ...row.points.map(point => point.unit)]), ...spec.rows.map(row => row.unit)]);
        const hasUnknownUnit = spec.series.some(row => row.points.some(point => !point.unit)) || spec.rows.some(row => !row.unit);
        if (hasUnknownUnit || !spec.units.length) spec.units.push('');
        spec.unit = spec.units.find(unit => unitKey(unit) === unitKey(input.unit)) ?? spec.units[0];
        return spec;
    }
    function compatible(spec) {
        const key = unitKey(spec.unit);
        const series = spec.series.map(row => ({ ...row, points: row.points.map(point => unitKey(point.unit) === key ? point : { ...point, value: null, excludedUnit: true }) }))
            .filter(row => row.points.some(point => !point.excludedUnit));
        const rows = spec.rows.filter(row => unitKey(row.unit) === key);
        const excluded = spec.rows.length - rows.length + spec.series.reduce((sum, row) => sum + row.points.filter(point => unitKey(point.unit) !== key).length, 0);
        return { series, rows, excluded };
    }
    function gapDays(series) {
        const explicit = number(series.gapDays);
        if (explicit !== null && explicit > 0) return explicit;
        const frequency = series.frequency.toLowerCase();
        if (/annual|year/.test(frequency)) return 400;
        if (/quarter/.test(frequency)) return 100;
        if (/month/.test(frequency)) return 45;
        if (/week/.test(frequency)) return 10;
        if (/day|daily/.test(frequency)) return 4;
        const points = series.points.filter(point => !point.invalidDate);
        if (points.length && points.every(point => /^\d{4}$/.test(point.period))) return 400;
        if (points.length && points.every(point => /^\d{4}-Q[1-4]$/i.test(point.period))) return 100;
        if (points.length && points.every(point => /^\d{4}-\d{2}$/.test(point.period))) return 45;
        return 62;
    }
    function groups(series) {
        const result = []; let group = [], previous = null;
        [...series.points].filter(point => !point.invalidDate).sort((a, b) => series.ordinal ? a.index - b.index : a.time - b.time || a.index - b.index).forEach(point => {
            if (point.value === null || (previous && (series.ordinal ? Math.abs(point.ordinalPosition - previous.ordinalPosition) > 1 : point.time - previous.time > gapDays(series) * DAY))) {
                if (group.length) result.push(group);
                group = [];
            }
            if (point.value !== null) group.push(point);
            previous = point.value === null ? null : point;
        });
        if (group.length) result.push(group);
        return result;
    }
    function ranking(spec, data) {
        if (spec.rows.length) return data.rows;
        return data.series.map(series => {
            const point = [...series.points].filter(p => !p.invalidDate && !p.excludedUnit).sort((a, b) => spec.ordinal ? a.index - b.index : a.time - b.time || a.index - b.index).pop();
            return point ? { ...point, label: series.name, id: series.id } : { label: series.name, value: null, unit: series.unit, source: series.source, period: '' };
        });
    }
    function allRows(spec) {
        return [...spec.series.flatMap(series => series.points.map(point => ({ ...point, label: series.name, seriesId: series.id }))), ...spec.rows];
    }
    function statusLabel(row) {
        return unique([row.status, row.estimated === true ? 'estimated' : '', row.planned === true ? 'planned' : '', ...array(row.flags).map(text)]).join(', ');
    }
    function captions(spec, data, ranked) {
        const observations = allRows(spec), notes = [];
        if (spec.notes) notes.push(spec.notes);
        if (spec.ordinal) notes.push('Periods follow source order with equal spacing. Horizontal distances do not represent elapsed time.');
        if (data.excluded) notes.push(`${data.excluded} observation${data.excluded === 1 ? '' : 's'} in other units excluded. Values shown in ${spec.unit || 'an unspecified unit'}.`);
        const unavailable = observations.filter(row => row.value === null).length;
        const invalidDates = spec.series.flatMap(row => row.points).filter(point => point.invalidDate).length;
        if (unavailable) notes.push(`${unavailable} unavailable or invalid observation${unavailable === 1 ? '' : 's'} retained in the source data.`);
        if (invalidDates) notes.push(`${invalidDates} observation${invalidDates === 1 ? '' : 's'} without a valid date excluded from the timeline.`);
        if (['line', 'area'].includes(spec.type) && data.series.some(series => groups(series).length > 1)) notes.push('Missing observations and extended source gaps remain open.');
        const duplicates = data.series.reduce((sum, series) => {
            const dates = series.points.filter(point => !point.invalidDate && !point.excludedUnit).map(point => spec.ordinal ? point.period || point.date || point.index : point.time);
            return sum + dates.length - new Set(dates).size;
        }, 0);
        if (duplicates) notes.push(`${duplicates} repeated observation period${duplicates === 1 ? '' : 's'} retained separately; values are not averaged.`);
        const statuses = new Map();
        observations.forEach(row => { const status = statusLabel(row); if (status) statuses.set(status, (statuses.get(status) || 0) + 1); });
        if (statuses.size) notes.push('Source flags: ' + [...statuses].map(([status, count]) => `${status} (${count})`).join('; ') + '.');
        const footnotes = unique(observations.map(row => row.footnote));
        footnotes.forEach(note => notes.push(note));
        if (spec.type === 'horizontal' && ranked.filter(row => row.value !== null).length > spec.limit) notes.push(`Showing the highest ${spec.limit} compatible values of ${ranked.filter(row => row.value !== null).length}. All observations remain in the source data.`);
        if (spec.type === 'horizontal' && !spec.rows.length && data.series.length) notes.push('Each bar uses the latest source observation in its series. Original periods may differ.');
        if (spec.type === 'map') {
            notes.push('Geography: ' + text(spec.geoSource || 'supplied GeoJSON') + '. Areas without a matching observation are unfilled.');
            const mapKeys = ranked.map(row => text(row.geoId || row.label).trim().toLowerCase());
            if (new Set(mapKeys).size !== mapKeys.length) notes.push('Repeated geographic labels are left unfilled; values are not combined.');
        }
        const sourceCandidates = unique([spec.source, ...observations.map(row => [row.source, row.sourceUrl && !row.source.includes(row.sourceUrl) ? row.sourceUrl : ''].filter(Boolean).join(' · '))]);
        const sources = sourceCandidates.filter(source => !sourceCandidates.some(other => other !== source && other.length > source.length && other.includes(source)));
        return { notes: unique(notes), sources: sources.length ? sources : ['Source not specified'] };
    }
    function splitLines(value, max) {
        const lines = [];
        text(value).split(/\r?\n/).forEach(paragraph => {
            if (!paragraph) { lines.push(''); return; }
            let line = '';
            paragraph.split(/\s+/).forEach(word => {
                while (word.length > max) {
                    if (line) { lines.push(line); line = ''; }
                    lines.push(word.slice(0, max)); word = word.slice(max);
                }
                if (line && line.length + word.length + 1 > max) { lines.push(line); line = word; }
                else line += (line ? ' ' : '') + word;
            });
            if (line) lines.push(line);
        });
        return lines;
    }
    function svgText(parent, value, x, y, size = 16, options = {}) {
        return parent.append('text').attr('x', x).attr('y', y).attr('fill', options.fill || INK)
            .attr('font-family', options.serif ? 'Georgia, Times New Roman, serif' : 'Arial, Helvetica, sans-serif')
            .attr('font-size', size).attr('font-weight', options.bold ? 700 : 400)
            .attr('text-anchor', options.anchor || 'start').text(value);
    }
    function pointTitle(point, series) {
        const exact = point.value === null ? 'Unavailable' : point.display_value !== undefined && point.display_value !== '' ? text(point.display_value) : text(point.rawValue ?? point.value);
        return [series?.name || point.label, point.period || point.date, `${exact} ${point.unit || series?.unit || ''}`,
            statusLabel(point), point.footnote, point.source, point.sourceUrl].filter(Boolean).join(' · ');
    }
    function colorFor(spec, index, id) {
        if (spec.highlight && spec.highlight !== id) return '#adb7b9';
        return index === 0 || spec.highlight === id ? spec.color : PALETTE[index % PALETTE.length];
    }
    function domain(values, zero) {
        let lo = Math.min(...values), hi = Math.max(...values);
        if (zero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
        const pad = lo === hi ? Math.max(Math.abs(lo) * .05, 1) : (hi - lo) * .06;
        return [zero && lo === 0 ? 0 : lo - pad, zero && hi === 0 ? 0 : hi + pad];
    }
    function styleAxis(group) {
        group.attr('class', 'bw-vb-axis').attr('font-family', 'Arial, Helvetica, sans-serif').attr('font-size', 14).attr('color', MUTED);
        group.selectAll('text').attr('fill', MUTED).attr('font-family', 'Arial, Helvetica, sans-serif').attr('font-size', 14);
        group.selectAll('path,line').attr('stroke', GRID); group.select('.domain').remove();
    }
    function emptyGraphic(svg, box, message) {
        svg.append('rect').attr('x', box.left).attr('y', box.top).attr('width', box.right - box.left).attr('height', box.bottom - box.top)
            .attr('fill', '#f8e8dc').attr('stroke', GRID).attr('stroke-dasharray', '4 5');
        const lines = splitLines(message, box.quick ? Math.max(20, Math.floor((box.right - box.left) / 7)) : 66);
        lines.forEach((line, index) => svgText(svg, line, (box.left + box.right) / 2,
            (box.top + box.bottom) / 2 + (index - (box.quick ? (lines.length - 1) / 2 : 0)) * (box.quick ? 19 : 25), box.quick ? 12 : 18, { fill: MUTED, anchor: 'middle' }));
    }
    function drawTimeline(svg, spec, data, box) {
        const d = window.d3;
        const points = data.series.flatMap(series => series.points.filter(point => !point.invalidDate && point.value !== null));
        if (!points.length) { emptyGraphic(svg, box, spec.ordinal ? 'No source observations in this unit. Choose a dataset or apply your source data.' : 'No dated observations in this unit. Choose a dataset or apply your source data.'); return; }
        // The domain includes unavailable dates, so missing endpoints do not disappear.
        const position = point => spec.ordinal ? point.ordinalPosition : point.time;
        const dates = data.series.flatMap(series => series.points.filter(point => !point.invalidDate && !point.excludedUnit).map(position));
        let [first, last] = d.extent(dates); if (first === last) { first -= spec.ordinal ? .5 : DAY; last += spec.ordinal ? .5 : DAY; }
        const x = (spec.ordinal ? d.scaleLinear() : d.scaleUtc()).domain([first, last]).range([box.left, box.right]);
        const y = d.scaleLinear().domain(domain(points.map(point => point.value), spec.zero)).nice(5).range([box.bottom, box.top]);
        const grid = svg.append('g').attr('transform', `translate(${box.right},0)`)
            .call(d.axisRight(y).ticks(box.quick ? 4 : 5).tickSize(-(box.right - box.left)).tickFormat(value => box.quick ? d.format('.3~s')(value) : pretty(value)));
        styleAxis(grid); grid.selectAll('.tick line').attr('stroke-width', 1).attr('stroke-opacity', .85);
        const bottomAxis = d.axisBottom(x);
        if (spec.ordinal) {
            const step = Math.max(1, Math.ceil(spec.ordinalLabels.length / (box.quick ? Math.max(2, Math.floor((box.right - box.left) / 100)) : 7)));
            bottomAxis.tickValues(spec.ordinalLabels.map((label, index) => index).filter(index => index % step === 0 || index === spec.ordinalLabels.length - 1))
                .tickFormat(index => spec.ordinalLabels[index].length > (box.quick ? 12 : 20) ? spec.ordinalLabels[index].slice(0, box.quick ? 10 : 18) + '…' : spec.ordinalLabels[index]);
        } else bottomAxis.ticks(box.quick ? Math.max(2, Math.floor((box.right - box.left) / 110)) : 6).tickFormat(d.utcFormat(last - first > 2 * 365 * DAY ? '%Y' : last - first > 100 * DAY ? '%b %Y' : '%d %b'));
        const axis = svg.append('g').attr('transform', `translate(0,${box.bottom})`).call(bottomAxis);
        styleAxis(axis); axis.selectAll('line').remove(); axis.selectAll('text').attr('dy', '1.1em');
        axis.classed('bw-vb-bottom-axis', true);
        if (spec.zero) svg.append('line').attr('class', 'bw-vb-zero').attr('x1', box.left).attr('x2', box.right)
            .attr('y1', y(0)).attr('y2', y(0)).attr('stroke', MUTED).attr('stroke-width', 1.3);
        data.series.forEach((series, index) => {
            const color = colorFor(spec, index, series.id), segments = groups(series);
            const usable = series.points.filter(point => !point.invalidDate && point.value !== null);
            if (spec.type === 'area') segments.forEach(segment => svg.append('path').attr('class', 'bw-vb-area').attr('data-series', series.id)
                .attr('d', d.area().x(point => x(position(point))).y0(y(0)).y1(point => y(point.value))(segment))
                .attr('fill', color).attr('fill-opacity', data.series.length > 1 ? .3 : .58));
            if (['line', 'area'].includes(spec.type)) segments.forEach(segment => svg.append('path').attr('class', 'bw-vb-line').attr('data-series', series.id)
                .attr('d', d.line().x(point => x(position(point))).y(point => y(point.value))(segment)).attr('fill', 'none')
                .attr('stroke', color).attr('stroke-width', 2.5).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round')
                .attr('stroke-dasharray', index && !spec.highlight ? '7 3' : null));
            if (spec.type === 'bar') {
                const times = [...new Set(usable.map(position))].sort((a, b) => a - b);
                const spacing = d.min(d.pairs(times), pair => x(pair[1]) - x(pair[0])) || 25;
                const barWidth = Math.max(1, Math.min(28, spacing * .7 / Math.max(1, data.series.length)));
                usable.forEach(point => svg.append('rect').attr('class', 'bw-vb-mark').attr('data-period', point.period)
                    .attr('x', x(position(point)) - barWidth * data.series.length / 2 + index * barWidth).attr('width', barWidth)
                    .attr('y', Math.min(y(0), y(point.value))).attr('height', Math.abs(y(0) - y(point.value)))
                    .attr('fill', color).append('title').text(pointTitle(point, series)));
            } else {
                const isolated = new Set(segments.filter(segment => segment.length === 1).flat());
                const dense = usable.length > 24 && ['line', 'area'].includes(spec.type);
                usable.forEach(point => svg.append('circle').attr('class', 'bw-vb-mark').attr('data-period', point.period)
                    .attr('cx', x(position(point))).attr('cy', y(point.value))
                    .attr('r', dense && !isolated.has(point) ? 6 : spec.type === 'scatter' || isolated.has(point) ? 4 : 2.3)
                    .attr('fill', dense && !isolated.has(point) ? 'transparent' : statusLabel(point) ? PAPER : color)
                    .attr('stroke', dense && !isolated.has(point) ? 'none' : color).attr('stroke-width', statusLabel(point) ? 2 : 1)
                    .append('title').text(pointTitle(point, series)));
            }
        });
        if (!box.quick) timelineInspection(svg, spec, data, x, y, box, position);
    }
    function timelineInspection(svg, spec, data, x, y, box, position) {
        const observations = data.series.flatMap((series, index) => series.points.filter(point => !point.invalidDate && point.value !== null)
            .map(point => ({ point, series, color: colorFor(spec, index, series.id) }))).sort((a, b) => position(a.point) - position(b.point) || a.point.index - b.point.index);
        const inspection = svg.append('g').attr('class', 'bw-vb-inspection').attr('visibility', 'hidden').attr('pointer-events', 'none');
        const id = 'bw-vb-inspection-' + (++serial); inspection.attr('id', id).attr('role', 'tooltip');
        const ring = inspection.append('circle').attr('r', 5).attr('fill', PAPER).attr('stroke-width', 2.5);
        const card = inspection.append('g'), background = card.append('rect').attr('fill', '#fffaf6').attr('stroke', GRID).attr('rx', 3), content = card.append('g');
        let selected = observations.length - 1;
        function hide() { inspection.attr('visibility', 'hidden'); svg.attr('aria-describedby', null); }
        function inspect(index) {
            selected = Math.max(0, Math.min(observations.length - 1, index));
            const item = observations[selected]; if (!item) return;
            const lines = splitLines(pointTitle(item.point, item.series), 44), width = 340, height = lines.length * 20 + 22;
            const px = x(position(item.point)), py = y(item.point.value);
            const left = Math.max(box.left, Math.min(box.right - width, px + 14));
            const top = Math.max(box.top, Math.min(box.bottom - height, py - height - 12));
            ring.attr('cx', px).attr('cy', py).attr('stroke', item.color);
            card.attr('transform', `translate(${left},${top})`); background.attr('width', width).attr('height', height);
            content.selectAll('*').remove(); lines.forEach((line, i) => svgText(content, line, 12, 23 + i * 20, 14));
            inspection.attr('visibility', 'visible'); svg.attr('aria-describedby', id);
        }
        svg.attr('tabindex', 0).attr('aria-label', svg.attr('aria-label') + ' Use left and right arrow keys to inspect exact source observations.');
        svg.on('keydown.vb', event => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault(); event.stopPropagation();
                inspect(event.key === 'Home' ? 0 : event.key === 'End' ? observations.length - 1 : selected + (event.key === 'ArrowLeft' ? -1 : 1));
            } else if (event.key === 'Escape' && inspection.attr('visibility') === 'visible') { event.preventDefault(); event.stopPropagation(); hide(); }
        }).on('blur.vb', hide);
    }
    function drawRanking(svg, spec, rows, box) {
        const d = window.d3;
        const ranked = [...rows].filter(row => row.value !== null).sort((a, b) => b.value - a.value || a.index - b.index).slice(0, spec.limit);
        if (!ranked.length) { emptyGraphic(svg, box, 'No compatible values to rank. Choose a dataset or apply your source data.'); return; }
        const labelWidth = box.quick ? Math.min(155, (box.right - box.left) * .4) : 200;
        const left = box.left + labelWidth, right = box.right - (box.quick ? 8 : 62);
        const x = d.scaleLinear().domain(domain(ranked.map(row => row.value), true)).nice(5).range([left, right]);
        const y = d.scaleBand().domain(ranked.map((row, index) => index)).range([box.top + (box.quick ? 20 : 35), box.bottom]).padding(.26);
        const axis = svg.append('g').attr('transform', `translate(0,${box.top})`).call(d.axisTop(x).ticks(box.quick ? Math.max(2, Math.floor((right - left) / 70)) : 5).tickSize(-(box.bottom - box.top)).tickFormat(value => box.quick ? d.format('.3~s')(value) : pretty(value)));
        styleAxis(axis); axis.selectAll('.tick line').attr('stroke-opacity', .7);
        svg.append('line').attr('class', 'bw-vb-zero').attr('x1', x(0)).attr('x2', x(0)).attr('y1', box.top + 20).attr('y2', box.bottom).attr('stroke', MUTED).attr('stroke-width', 1.3);
        ranked.forEach((row, index) => {
            const center = y(index) + y.bandwidth() / 2;
            const maxLabel = box.quick ? Math.max(8, Math.floor(labelWidth / 7)) : 27;
            const label = row.label.length > maxLabel ? row.label.slice(0, maxLabel - 2) + '…' : row.label;
            svgText(svg, label, left - (box.quick ? 8 : 13), center + 5, box.quick ? 12 : 16, { anchor: 'end' }).append('title').text(row.label);
            if (row.period && !box.quick) svgText(svg, row.period, left - 13, center + 20, 11, { anchor: 'end', fill: MUTED });
            svg.append('rect').attr('class', 'bw-vb-mark').attr('data-period', row.period).attr('x', Math.min(x(0), x(row.value)))
                .attr('y', y(index)).attr('width', Math.abs(x(row.value) - x(0))).attr('height', y.bandwidth())
                .attr('fill', colorFor(spec, 0, row.id || row.label)).append('title').text(pointTitle(row));
            if (!box.quick) svgText(svg, pretty(row.value), x(row.value) + (row.value < 0 ? -8 : 8), center + 5, 15,
                { anchor: row.value < 0 ? 'end' : 'start', bold: true });
        });
    }
    function drawCategories(svg, spec, rows, box) {
        const d = window.d3, usable = rows.filter(row => row.value !== null);
        if (!usable.length) { emptyGraphic(svg, box, 'No compatible category values. Apply label,value source data to begin.'); return; }
        const x = d.scaleBand().domain(rows.map((row, index) => index)).range([box.left, box.right]).padding(.32);
        const y = d.scaleLinear().domain(domain(usable.map(row => row.value), spec.type === 'bar' || spec.zero)).nice(5).range([box.bottom, box.top]);
        const grid = svg.append('g').attr('transform', `translate(${box.right},0)`).call(d.axisRight(y).ticks(box.quick ? 4 : 5).tickSize(-(box.right - box.left)).tickFormat(value => box.quick ? d.format('.3~s')(value) : pretty(value)));
        styleAxis(grid);
        const tickCount = box.quick ? Math.max(2, Math.floor((box.right - box.left) / 95)) : 8;
        const step = Math.max(1, Math.ceil(rows.length / tickCount)), selected = rows.map((row, index) => index).filter(index => index % step === 0);
        const labelLength = box.quick ? 12 : 18;
        const axis = svg.append('g').attr('transform', `translate(0,${box.bottom})`).call(d.axisBottom(x).tickValues(selected).tickFormat(index => rows[index].label.length > labelLength ? rows[index].label.slice(0, labelLength - 2) + '…' : rows[index].label));
        styleAxis(axis); axis.selectAll('line').remove(); axis.selectAll('text').attr('dy', '1.1em');
        axis.classed('bw-vb-bottom-axis', true);
        if (spec.zero || spec.type === 'bar') svg.append('line').attr('class', 'bw-vb-zero').attr('x1', box.left).attr('x2', box.right).attr('y1', y(0)).attr('y2', y(0)).attr('stroke', MUTED);
        rows.forEach((row, index) => {
            if (row.value === null) return;
            const color = colorFor(spec, 0, row.id || row.label), mark = spec.type === 'bar'
                ? svg.append('rect').attr('x', x(index)).attr('width', x.bandwidth()).attr('y', Math.min(y(0), y(row.value))).attr('height', Math.abs(y(row.value) - y(0))).attr('fill', color)
                : svg.append('circle').attr('cx', x(index) + x.bandwidth() / 2).attr('cy', y(row.value)).attr('r', 4).attr('fill', statusLabel(row) ? PAPER : color).attr('stroke', color).attr('stroke-width', 2);
            mark.attr('class', 'bw-vb-mark').attr('data-period', row.period).append('title').text(pointTitle(row));
        });
    }
    function validateGeoJSON(value) {
        if (!value || !['FeatureCollection', 'Feature'].includes(value.type)) throw new Error('Use a GeoJSON Feature or FeatureCollection.');
        const features = value.type === 'Feature' ? [value] : value.features;
        if (!Array.isArray(features) || !features.length || features.length > 10000) throw new Error('GeoJSON must contain between 1 and 10,000 features.');
        const types = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'];
        let positions = 0;
        function coordinates(values) {
            if (!Array.isArray(values) || !values.length) throw new Error('GeoJSON contains missing coordinates.');
            if (typeof values[0] === 'number') {
                positions += 1;
                if (values.length < 2 || values.some(value => !Number.isFinite(value)) || Math.abs(values[0]) > 180 || Math.abs(values[1]) > 90) throw new Error('GeoJSON coordinates must use finite longitude and latitude in degrees.');
                if (positions > 300000) throw new Error('This map is too detailed. Use a GeoJSON file with fewer than 300,000 positions.');
            } else values.forEach(coordinates);
        }
        function geometry(item) {
            if (!item || !types.includes(item.type)) throw new Error('GeoJSON contains an unsupported or missing geometry.');
            if (item.type === 'GeometryCollection') {
                if (!Array.isArray(item.geometries) || !item.geometries.length) throw new Error('GeoJSON contains an empty geometry collection.');
                item.geometries.forEach(geometry);
            } else coordinates(item.coordinates);
        }
        features.forEach(feature => { if (feature.type !== 'Feature') throw new Error('Every GeoJSON item must be a Feature.'); geometry(feature.geometry); });
        return value;
    }
    function drawMap(svg, spec, rows, box) {
        if (!spec.geojson) { emptyGraphic(svg, box, 'Add your GeoJSON geography to make a map. No geography is supplied automatically.'); return; }
        let geography;
        try { geography = JSON.parse(JSON.stringify(validateGeoJSON(spec.geojson))); }
        catch (error) { emptyGraphic(svg, box, error.message); return; }
        const d = window.d3, features = geography.type === 'Feature' ? [geography] : geography.features;
        // D3's spherical polygon convention is opposite to RFC 7946 exterior rings.
        function orient(geometry) {
            if (geometry.type === 'Polygon' && d.geoArea({ type: 'Polygon', coordinates: geometry.coordinates }) > Math.PI * 2) geometry.coordinates.forEach(ring => ring.reverse());
            if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach(polygon => {
                if (d.geoArea({ type: 'Polygon', coordinates: polygon }) > Math.PI * 2) polygon.forEach(ring => ring.reverse());
            });
            if (geometry.type === 'GeometryCollection') geometry.geometries.forEach(orient);
        }
        features.forEach(feature => orient(feature.geometry));
        const projection = d.geoMercator().fitExtent([[box.left, box.top], [box.right, box.bottom - 55]], geography);
        if (!Number.isFinite(projection.scale()) || !projection.translate().every(Number.isFinite)) {
            projection.center(d.geoCentroid(geography)).scale(150).translate([(box.left + box.right) / 2, (box.top + box.bottom - 55) / 2]);
        }
        const path = d.geoPath(projection), matches = new Map();
        rows.forEach(row => {
            const key = text(row.geoId || row.label).trim().toLowerCase();
            if (matches.has(key)) matches.set(key, null); // A duplicate geographical key cannot silently pick one value.
            else matches.set(key, row);
        });
        const usable = rows.filter(row => row.value !== null), extent = usable.length ? d.extent(usable, row => row.value) : [0, 1];
        const range = extent[0] === extent[1] ? [extent[0] - 1, extent[1] + 1] : extent;
        const fill = d.scaleLinear().domain(range).range(['#e1eeee', spec.color]).interpolate(d.interpolateRgb);
        let matched = 0;
        features.forEach(feature => {
            const name = text(feature.properties?.[spec.geoKey || 'name'] ?? feature.id);
            const row = matches.get(name.trim().toLowerCase());
            const centroid = box.quick ? path.centroid(feature) : null;
            const center = centroid?.every(Number.isFinite) ? centroid : [(box.left + box.right) / 2, (box.top + box.bottom) / 2];
            if (row && row.value !== null) matched += 1;
            svg.append('path').attr('class', 'bw-vb-geography').attr('d', path(feature)).attr('fill', row?.value !== undefined && row?.value !== null ? fill(row.value) : '#e6ded8')
                .attr('data-inspect-x', box.quick ? center[0] : null).attr('data-inspect-y', box.quick ? center[1] : null)
                .attr('stroke', PAPER).attr('stroke-width', 1).append('title').text(row ? pointTitle(row) : `${name || 'Geography'} · No matching observation`);
        });
        svgText(svg, `${matched} of ${features.length} geographic features have compatible observations`, box.left, box.bottom - 20, 14, { fill: MUTED });
        if (usable.length) {
            const id = 'bw-vb-map-gradient-' + (++serial), gradient = svg.append('defs').append('linearGradient').attr('id', id);
            gradient.append('stop').attr('offset', '0%').attr('stop-color', '#e1eeee'); gradient.append('stop').attr('offset', '100%').attr('stop-color', spec.color);
            svg.append('rect').attr('x', box.right - 220).attr('y', box.bottom - 12).attr('width', 220).attr('height', 10).attr('fill', `url(#${id})`);
            svgText(svg, pretty(extent[0]), box.right - 220, box.bottom + 16, 13, { fill: MUTED });
            svgText(svg, pretty(extent[1]), box.right, box.bottom + 16, 13, { fill: MUTED, anchor: 'end' });
        }
    }
    function quickInspection(svg, box, onInspect) {
        const marks = svg.selectAll('.bw-vb-mark,.bw-vb-geography').nodes().map(node => ({ node,
            x: node.hasAttribute('data-inspect-x') ? Number(node.getAttribute('data-inspect-x')) : node.hasAttribute('cx') ? Number(node.getAttribute('cx')) : Number(node.getAttribute('x')) + Number(node.getAttribute('width')) / 2,
            y: node.hasAttribute('data-inspect-y') ? Number(node.getAttribute('data-inspect-y')) : node.hasAttribute('cy') ? Number(node.getAttribute('cy')) : Number(node.getAttribute('y')) + Number(node.getAttribute('height')) / 2,
            text: node.querySelector('title')?.textContent || '' }));
        if (box.timeline) marks.sort((a, b) => a.x - b.x);
        if (!marks.length) return;
        const ring = svg.append('circle').attr('class', 'bw-qv-active-mark').attr('r', 5).attr('fill', 'none').attr('stroke-width', 2).attr('visibility', 'hidden').attr('pointer-events', 'none');
        let selected = -1;
        function hide() { ring.attr('visibility', 'hidden'); onInspect?.(null); }
        function inspect(index) {
            selected = Math.max(0, Math.min(marks.length - 1, index));
            const item = marks[selected];
            ring.attr('cx', item.x).attr('cy', item.y).attr('visibility', 'visible'); onInspect?.(item);
        }
        svg.attr('tabindex', 0).attr('aria-label', svg.attr('aria-label') + ' Use left and right arrow keys to inspect exact source observations.');
        svg.on('keydown.quick', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            inspect(event.key === 'Home' ? 0 : event.key === 'End' ? marks.length - 1 : selected < 0 ? (event.key === 'ArrowLeft' ? marks.length - 1 : 0) : selected + (event.key === 'ArrowLeft' ? -1 : 1));
        }).on('blur.quick', hide).on('mouseleave.quick', hide).on('pointermove.quick', event => {
            const [x, y] = window.d3.pointer(event, svg.node());
            if (x < box.left || x > box.right || y < box.top || y > box.bottom) { hide(); return; }
            let nearest = 0, distance = Infinity;
            marks.forEach((item, index) => { const next = (x - item.x) ** 2 + (y - item.y) ** 2; if (next < distance) { nearest = index; distance = next; } });
            inspect(nearest);
        });
        svg.selectAll('.bw-vb-mark,.bw-vb-geography').on('mouseenter.quick', function () { inspect(marks.findIndex(item => item.node === this)); });
    }
    function renderQuick(target, input, options) {
        const d = window.d3, spec = normalize(input), data = compatible(spec), ranked = ranking(spec, data);
        const width = Math.max(240, Math.min(1000, number(options.width) || target?.clientWidth || 700));
        const rankedCount = Math.min(spec.limit, ranked.filter(row => row.value !== null).length);
        const height = spec.type === 'horizontal' ? Math.max(200, Math.min(440, rankedCount * 29 + 50)) : width < 450 ? 250 : 290;
        const box = { left: 8, right: width - (spec.type === 'horizontal' || spec.type === 'map' ? 12 : 54), top: spec.type === 'horizontal' ? 25 : 16, bottom: height - 38, quick: true,
            timeline: spec.series.length > 0 && !['horizontal', 'map'].includes(spec.type) };
        const caption = captions(spec, data, ranked), isSvg = target?.tagName?.toLowerCase() === 'svg';
        const svg = target ? (isSvg ? d.select(target) : d.select(target).selectAll('svg.bw-builder-graphic').data([null]).join('svg')) : d.create('svg');
        svg.selectAll('*').remove();
        svg.attr('class', 'bw-builder-graphic bw-quick-graphic').attr('viewBox', `0 0 ${width} ${height}`).attr('xmlns', 'http://www.w3.org/2000/svg')
            .attr('role', 'img').attr('aria-label', `${spec.title}. ${spec.unit || 'Unit not specified'}. ${caption.notes.join(' ')}`)
            .attr('style', 'display:block;width:100%;height:auto');
        svg.append('title').text(spec.title);
        svg.append('desc').text([spec.subtitle, spec.unit, ...caption.sources.map(source => 'Source: ' + source), ...caption.notes].filter(Boolean).join('\n'));
        const metadata = { ...spec }; delete metadata.datasets; delete metadata.units;
        svg.append('metadata').text(JSON.stringify(metadata));
        if (spec.type === 'horizontal') drawRanking(svg, spec, ranked, box);
        else if (spec.type === 'map') drawMap(svg, spec, ranked, box);
        else if (!spec.series.length && ['bar', 'scatter'].includes(spec.type)) drawCategories(svg, spec, data.rows, box);
        else drawTimeline(svg, spec, data, box);
        svg.selectAll('.bw-vb-bottom-axis .tick text').filter((value, index, nodes) => index === 0 || index === nodes.length - 1)
            .attr('text-anchor', (value, index, nodes) => index === 0 ? 'start' : 'end');
        quickInspection(svg, box, options.onInspect);
        return { svg: svg.node(), spec, caption, legend: data.series.map((series, index) => ({ id: series.id, name: series.name, color: colorFor(spec, index, series.id) })), destroy() { if (!isSvg) svg.remove(); } };
    }
    function render(target, input = {}, options = {}) {
        if (!window.d3) throw new Error('D3 must load before the graphic builder.');
        if (options.presentation === 'quick') return renderQuick(target, input, options);
        const d = window.d3, spec = normalize(input), data = compatible(spec), ranked = ranking(spec, data);
        const width = Math.max(640, Math.min(1600, number(spec.width) || 960)), inset = 42;
        const titleLines = splitLines(spec.title, Math.floor((width - 2 * inset) / 18));
        const subtitleLines = spec.subtitle ? splitLines(spec.subtitle, Math.floor((width - 2 * inset) / 9)) : [];
        const legend = !['horizontal', 'map'].includes(spec.type) ? data.series : [];
        const legendRows = legend.length > 1 ? Math.ceil(legend.length / 3) : 0;
        const top = 32 + titleLines.length * 37 + subtitleLines.length * 24 + 45 + legendRows * 25;
        const rankedCount = Math.min(spec.limit, ranked.filter(row => row.value !== null).length);
        const chartHeight = spec.type === 'horizontal' ? Math.max(320, rankedCount * 49 + 45) : 375;
        const box = { left: inset, right: width - 96, top, bottom: top + chartHeight };
        const caption = captions(spec, data, ranked), captionLines = [];
        caption.sources.forEach((source, index) => splitLines((index === 0 ? 'Source: ' : '') + source, Math.floor((width - 2 * inset) / 7.2)).forEach(line => captionLines.push({ line, source: true })));
        caption.notes.forEach(note => splitLines(note, Math.floor((width - 2 * inset) / 7.2)).forEach(line => captionLines.push({ line, source: false })));
        const footerTop = box.bottom + 60, height = footerTop + captionLines.length * 21 + 40;
        const isSvg = target?.tagName?.toLowerCase() === 'svg';
        const svg = target ? (isSvg ? d.select(target) : d.select(target).selectAll('svg.bw-builder-graphic').data([null]).join('svg')) : d.create('svg');
        svg.selectAll('*').remove();
        svg.attr('class', 'bw-builder-graphic').attr('viewBox', `0 0 ${width} ${height}`).attr('xmlns', 'http://www.w3.org/2000/svg')
            .attr('role', 'img').attr('aria-label', `${spec.title}. ${spec.subtitle} ${spec.unit}. ${caption.notes.join(' ')}`)
            .attr('font-family', 'Arial, Helvetica, sans-serif').attr('font-size', 14).attr('style', 'display:block;width:100%;height:auto;background:#fff1e5;color:#252b30');
        svg.append('title').text(spec.title);
        svg.append('desc').text([spec.subtitle, spec.unit, ...caption.sources.map(source => 'Source: ' + source), ...caption.notes].filter(Boolean).join('\n'));
        // Exact source metadata remains part of the exported document, including unavailable observations.
        const metadata = { ...spec }; delete metadata.datasets; delete metadata.units;
        svg.append('metadata').text(JSON.stringify(metadata));
        svg.append('rect').attr('class', 'bw-vb-paper').attr('width', width).attr('height', height).attr('fill', PAPER);
        titleLines.forEach((line, index) => svgText(svg, line, inset, 53 + index * 37, 32, { serif: true, bold: true }));
        let baseline = 53 + (titleLines.length - 1) * 37 + 31;
        subtitleLines.forEach(line => { svgText(svg, line, inset, baseline, 18, { fill: MUTED }); baseline += 24; });
        svgText(svg, spec.unit || 'Unit not specified', inset, baseline + 5, 15, { fill: MUTED });
        if (legendRows) legend.forEach((series, index) => {
            const x = inset + index % 3 * (width - inset * 2) / 3, y = top - legendRows * 25 + Math.floor(index / 3) * 25 - 10;
            svg.append('line').attr('x1', x).attr('x2', x + 23).attr('y1', y - 4).attr('y2', y - 4).attr('stroke', colorFor(spec, index, series.id)).attr('stroke-width', 3);
            svgText(svg, series.name.length > 30 ? series.name.slice(0, 28) + '…' : series.name, x + 31, y, 14).append('title').text(series.name);
        });
        if (spec.type === 'horizontal') drawRanking(svg, spec, ranked, box);
        else if (spec.type === 'map') drawMap(svg, spec, ranked, box);
        else if (!spec.series.length && ['bar', 'scatter'].includes(spec.type)) drawCategories(svg, spec, data.rows, box);
        else drawTimeline(svg, spec, data, box);
        svg.append('line').attr('x1', inset).attr('x2', width - inset).attr('y1', footerTop - 22).attr('y2', footerTop - 22).attr('stroke', GRID);
        captionLines.forEach((row, index) => svgText(svg, row.line, inset, footerTop + index * 21, 13, { fill: MUTED, bold: row.source }));
        return { svg: svg.node(), spec, destroy() { if (!isSvg) svg.remove(); } };
    }

    function delimitedRows(input, delimiter) {
        const rows = []; let row = [], cell = '', quoted = false, closed = false;
        const value = text(input).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
        for (let index = 0; index < value.length; index += 1) {
            const character = value[index];
            if (quoted) {
                if (character === '"' && value[index + 1] === '"') { cell += '"'; index += 1; }
                else if (character === '"') { quoted = false; closed = true; }
                else cell += character;
            } else if (character === delimiter || character === '\n') {
                row.push(cell); cell = ''; closed = false;
                if (character === '\n') { rows.push(row); row = []; }
            } else if (character === '"') {
                if (cell || closed) throw new Error('A quotation mark appears inside an unquoted field.');
                quoted = true;
            } else {
                if (closed && character.trim()) throw new Error('Unexpected text after a closing quotation mark.');
                if (!closed) cell += character;
            }
        }
        if (quoted) throw new Error('A quoted field is missing its closing quotation mark.');
        row.push(cell); if (row.some(item => item.trim())) rows.push(row);
        return rows.filter(items => items.some(item => item.trim()));
    }
    function parseData(input) {
        const errors = [], warnings = []; let rows;
        if (text(input).length > 2000000) return { ok: false, errors: ['Use a CSV or TSV below 2 MB.'], warnings };
        try { rows = delimitedRows(input, text(input).split(/\r?\n/)[0].includes('\t') ? '\t' : ','); }
        catch (error) { return { ok: false, errors: [error.message], warnings }; }
        if (rows.length < 2) return { ok: false, errors: ['Include a header and at least one observation.'], warnings };
        if (rows.length > 10001) return { ok: false, errors: ['Use at most 10,000 observations.'], warnings };
        const headers = rows.shift().map(header => header.trim().toLowerCase().replace(/[\s-]+/g, '_'));
        if (headers.some(header => !header)) errors.push('Every column needs a header.');
        if (new Set(headers).size !== headers.length) errors.push('Headers must be unique.');
        if (!headers.includes('value') && !headers.includes('price')) errors.push('Add a value column.');
        const dated = headers.includes('date') || (!headers.includes('label') && headers.includes('period'));
        if (!dated && !headers.includes('label')) errors.push('Add a date or label column.');
        if (errors.length) return { ok: false, errors, warnings };
        const records = [];
        rows.forEach((values, index) => {
            const line = index + 2;
            if (values.length !== headers.length) { errors.push(`Row ${line}: expected ${headers.length} fields, found ${values.length}.`); return; }
            const row = Object.fromEntries(headers.map((header, i) => [header, values[i].trim()]));
            const raw = row.value === undefined ? row.price : row.value;
            const missing = /^(?:|na|n\/a|null|unavailable|missing|—|-)$/i.test(raw);
            let parsed = raw;
            if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(parsed)) parsed = parsed.replace(/,/g, '');
            if (!missing && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(parsed) || !Number.isFinite(Number(parsed)))) errors.push(`Row ${line}: value must be finite numeric data or blank for an unavailable observation.`);
            row.value = missing ? null : Number(parsed);
            if (missing && !row.status) row.status = 'unavailable';
            if (dated) {
                const period = row.period || row.date, date = dateValue(row.date || row.period);
                if (!date) errors.push(`Row ${line}: date must be a valid YYYY-MM-DD, YYYY-MM, YYYY-Q1 or YYYY period.`);
                else { row.date = date.date; row.period = period; }
            } else if (!row.label) errors.push(`Row ${line}: label is required.`);
            ['latitude', 'longitude'].forEach(key => { if (row[key]) { const n = number(row[key]); if (n === null || Math.abs(n) > (key === 'latitude' ? 90 : 180)) errors.push(`Row ${line}: ${key} is outside its valid range.`); else row[key] = n; } });
            row.sourceUrl = row.source_url || row.sourceurl || '';
            row.display_value = row.display_value || raw;
            ['estimated', 'planned'].forEach(key => { if (row[key]) row[key] = /^(true|yes|1)$/i.test(row[key]); });
            records.push(row);
        });
        if (errors.length) return { ok: false, errors: errors.slice(0, 20), warnings };
        const series = [];
        if (dated) {
            const byName = new Map();
            records.forEach(row => {
                const name = row.series || row.label || 'Pasted observations', key = name + '\u0000' + (row.unit || '');
                if (!byName.has(key)) { const item = { id: 'paste-' + byName.size, name, unit: row.unit || '', source: row.source || '', frequency: row.frequency || '', gapDays: number(row.gap_days || row.gapdays), points: [] }; byName.set(key, item); series.push(item); }
                byName.get(key).points.push(row);
            });
            const duplicates = series.reduce((sum, item) => sum + item.points.length - new Set(item.points.map(row => row.date)).size, 0);
            if (duplicates) warnings.push(`${duplicates} repeated period${duplicates === 1 ? '' : 's'} retained separately.`);
        }
        const units = [...new Set(records.map(row => text(row.unit)))];
        if (units.length > 1) warnings.push('Multiple units found. Choose one unit to plot compatible values.');
        return { ok: true, errors: [], warnings, count: records.length, spec: { series, rows: dated ? [] : records, type: dated ? 'line' : 'horizontal', unit: records[0]?.unit || '',
            source: 'Imported user data', notes: '', frequency: '', ordinal: false } };
    }
    function serializeSVG(svg) {
        const clone = svg.cloneNode(true), box = svg.getAttribute('viewBox').split(/\s+/).map(Number);
        clone.querySelectorAll('.bw-vb-inspection').forEach(node => node.remove()); clone.removeAttribute('aria-describedby'); clone.removeAttribute('tabindex');
        clone.setAttribute('aria-label', text(clone.getAttribute('aria-label')).replace(' Use left and right arrow keys to inspect exact source observations.', ''));
        clone.setAttribute('width', box[2]); clone.setAttribute('height', box[3]); clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
    }
    async function png(svg) {
        const graphic = serializeSVG(svg), box = svg.getAttribute('viewBox').split(/\s+/).map(Number), image = new Image();
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('This browser could not render the SVG for PNG export. SVG export is still available.')); image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(graphic); });
        const canvas = document.createElement('canvas'), scale = Math.min(2, 8192 / Math.max(box[2], box[3]));
        canvas.width = Math.ceil(box[2] * scale); canvas.height = Math.ceil(box[3] * scale);
        const context = canvas.getContext('2d'); if (!context) throw new Error('PNG export is not available in this browser. Use SVG export.');
        context.fillStyle = PAPER; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const result = canvas.toDataURL('image/png'); if (result === 'data:,') throw new Error('This graphic is too large for PNG export. Use SVG export.');
        return result;
    }
    function download(url, filename) {
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
    }
    const draftKey = spec => 'bw.visual-builder.v1.' + encodeURIComponent(spec.id || 'blank');
    function saveDraft(spec) {
        const saved = { ...spec }; delete saved.datasets; delete saved.units;
        localStorage.setItem(draftKey(spec), JSON.stringify({ version: 1, savedAt: new Date().toISOString(), spec: saved }));
        return saved;
    }
    function readDraft(spec) {
        const raw = localStorage.getItem(draftKey(spec)); if (!raw) return null;
        const draft = JSON.parse(raw); if (draft.version !== 1 || !draft.spec || !Array.isArray(draft.spec.series) || !Array.isArray(draft.spec.rows)) throw new Error('This saved draft cannot be restored.');
        return draft;
    }
    function element(tag, content, className) {
        const node = document.createElement(tag); if (content !== undefined) node.textContent = content; if (className) node.className = className; return node;
    }
    function field(parent, label, key, tag = 'input', options = []) {
        const wrap = element('label', undefined, 'bw-vb-field'), name = element('span', label), node = element(tag);
        node.setAttribute('aria-label', label);
        node.dataset.vbField = key; if (tag === 'input') node.type = 'text';
        if (tag === 'select') options.forEach(([value, label]) => { const option = element('option', label); option.value = value; node.append(option); });
        if (tag === 'textarea') node.rows = 2;
        wrap.append(name, node); parent.append(wrap); return node;
    }
    function button(parent, label, action, className = '') {
        const node = element('button', label, className); node.type = 'button'; node.dataset.vbAction = action; parent.append(node); return node;
    }
    function open(input = {}, options = {}) {
        input = input && typeof input === 'object' ? input : {};
        if (active) active.close();
        const opener = options.trigger || document.activeElement, datasets = array(input.datasets), edits = new Map(), authoredByDataset = new Map();
        let authoredFields = new Set();
        let current = normalize(input), controller;
        const dialog = element('dialog', undefined, 'bw-visual-builder'); dialog.setAttribute('aria-labelledby', 'bw-vb-title');
        const header = element('header', undefined, 'bw-vb-header'), heading = element('div'), title = element('h2', 'Graphic builder'); title.id = 'bw-vb-title';
        heading.append(title, element('p', 'Shape a graphic from source observations. Drafts stay in this browser.')); header.append(heading);
        const headerActions = element('div', undefined, 'bw-vb-header-actions'); header.append(headerActions);
        const previewJump = button(headerActions, 'Preview', 'preview-jump', 'bw-vb-mobile-jump');
        const closeButton = button(headerActions, 'Close', 'close'); closeButton.setAttribute('aria-label', 'Close graphic builder');
        const main = element('div', undefined, 'bw-vb-main'), controls = element('form', undefined, 'bw-vb-controls'); controls.addEventListener('submit', event => event.preventDefault());
        const preview = element('section', undefined, 'bw-vb-preview-pane'); preview.setAttribute('aria-label', 'Graphic preview');
        const previewHeader = element('div', undefined, 'bw-vb-preview-heading'), previewTitle = element('h3', 'Live preview'); previewTitle.tabIndex = -1;
        previewHeader.append(previewTitle, element('span', 'Source data · editorial graphic'));
        const editReturn = button(previewHeader, 'Edit', 'edit-return', 'bw-vb-mobile-jump');
        const stage = element('div', undefined, 'bw-vb-preview'); preview.append(previewHeader, stage);
        const fields = {};
        if (datasets.length) fields.dataset = field(controls, 'Dataset', 'dataset', 'select', datasets.map((item, i) => [text(item.id || i), text(item.name || item.title || 'Dataset ' + (i + 1))]));
        fields.type = field(controls, 'Graphic', 'type', 'select', TYPES);
        fields.unit = field(controls, 'Comparable unit', 'unit', 'select');
        const comparisonHelp = element('p', 'Each graphic uses one unit. Source observations in other units stay in the data table.', 'bw-vb-help'); controls.append(comparisonHelp);
        fields.title = field(controls, 'Headline', 'title'); fields.title.maxLength = 500;
        fields.subtitle = field(controls, 'Subtitle', 'subtitle', 'textarea'); fields.subtitle.maxLength = 1000;
        fields.source = field(controls, 'Source / credit', 'source', 'textarea'); fields.source.maxLength = 2000;
        fields.notes = field(controls, 'Notes / footnote', 'notes', 'textarea'); fields.notes.maxLength = 4000;
        const appearance = element('div', undefined, 'bw-vb-appearance');
        fields.color = field(appearance, 'Chart color', 'color'); fields.color.type = 'color';
        fields.highlight = field(appearance, 'Highlight', 'highlight', 'select'); controls.append(appearance);
        fields.limit = field(controls, 'Maximum ranked rows', 'limit', 'select', [5, 10, 20, 50, 100].map(value => [text(value), text(value)]));
        const zeroLabel = element('label', undefined, 'bw-vb-check'); fields.zero = element('input'); fields.zero.type = 'checkbox'; fields.zero.dataset.vbField = 'zero';
        zeroLabel.append(fields.zero, element('span', 'Include zero baseline')); controls.append(zeroLabel);
        fields.zero.setAttribute('aria-label', 'Include zero baseline');
        const geo = element('div', undefined, 'bw-vb-geo');
        const geoLabel = element('label', undefined, 'bw-vb-field'), geoFile = element('input'); geoFile.type = 'file'; geoFile.accept = '.geojson,.json,application/geo+json,application/json'; geoFile.dataset.vbField = 'geojson';
        geoFile.setAttribute('aria-label', 'GeoJSON geography');
        geoLabel.append(element('span', 'GeoJSON geography'), geoFile); geo.append(geoLabel, element('p', 'Match each label to a geographic feature name. Duplicate labels are left unfilled.', 'bw-vb-help'));
        fields.geoKey = field(geo, 'Feature name property', 'geoKey'); fields.geoSource = field(geo, 'Geography source / credit', 'geoSource'); controls.append(geo);
        const status = element('p', '', 'bw-vb-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
        const announce = (message, error = false) => { status.textContent = message; status.classList.toggle('is-error', error); };
        const dataDetails = element('details', undefined, 'bw-vb-data'); dataDetails.append(element('summary', 'Source observations'));
        const tableHost = element('div', undefined, 'bw-vb-table-wrap'); dataDetails.append(tableHost); preview.append(dataDetails);
        const pasteDetails = element('details', undefined, 'bw-vb-paste'); pasteDetails.append(element('summary', 'Paste CSV or TSV data'));
        pasteDetails.append(element('p', 'Start with date,value for a timeline or label,value for a ranking. Optional columns: series, unit, period, status, source, source_url, footnote. Blank values remain unavailable. Dates support YYYY, YYYY-MM, YYYY-Q1 and YYYY-MM-DD.', 'bw-vb-help'));
        const paste = field(pasteDetails, 'Source data', 'paste', 'textarea'); paste.rows = 7; paste.spellcheck = false; paste.placeholder = 'date,value,unit,source\n';
        const pasteButton = button(pasteDetails, 'Validate and apply data', 'paste'); preview.append(pasteDetails);
        main.append(controls, preview);
        function jump(target, focus) {
            const offset = Math.max(0, target.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop);
            if (typeof main.scrollTo === 'function') main.scrollTo({ top: offset, behavior: 'auto' }); else main.scrollTop = offset;
            focus.focus({ preventScroll: true });
        }
        previewJump.addEventListener('click', () => jump(preview, previewTitle));
        editReturn.addEventListener('click', () => jump(controls, fields.type));
        const footer = element('footer', undefined, 'bw-vb-footer'), drafts = element('div', undefined, 'bw-vb-draft-actions'), exports = element('div', undefined, 'bw-vb-export-actions');
        const saveButton = button(drafts, 'Save draft', 'save'), restoreButton = button(drafts, 'Restore saved draft', 'restore');
        button(exports, 'Export SVG', 'svg'); button(exports, 'Export PNG', 'png', 'bw-vb-primary');
        footer.append(status, drafts, exports); dialog.append(header, main, footer); document.body.append(dialog);
        function fillOptions(node, options) {
            node.replaceChildren(); options.forEach(([value, label]) => { const option = element('option', label); option.value = value; node.append(option); });
        }
        function sourceTable() {
            const rows = allRows(current), table = element('table'), thead = element('thead'), tr = element('tr');
            ['Series / label', 'Source period', 'Exact value', 'Unit', 'Status', 'Source', 'Notes'].forEach(label => { const th = element('th', label); th.scope = 'col'; tr.append(th); });
            thead.append(tr); table.append(thead); const tbody = element('tbody');
            rows.slice(0, 500).forEach(row => {
                const line = element('tr'), raw = row.display_value !== undefined && row.display_value !== '' ? text(row.display_value) : row.value === null ? row.invalidValue ? text(row.rawValue) + ' (invalid)' : 'Unavailable' : text(row.rawValue ?? row.value);
                const cells = [row.label, row.period || row.date || 'Undated', raw, row.unit || 'Unspecified', [statusLabel(row), row.invalidDate ? 'invalid date' : '', row.invalidValue ? 'invalid value' : ''].filter(Boolean).join(' · '), row.source || 'Not specified', row.footnote];
                cells.forEach((value, index) => {
                    const td = element('td', value);
                    if (index === 5 && /^https?:\/\//i.test(row.sourceUrl)) { const link = element('a', row.sourceUrl); link.href = row.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; td.append(element('br'), link); }
                    line.append(td);
                }); tbody.append(line);
            });
            table.append(tbody); tableHost.replaceChildren(element('p', `${rows.length} source observation${rows.length === 1 ? '' : 's'}${rows.length > 500 ? '; first 500 shown here. All records are retained in the draft and SVG metadata.' : '.'}`, 'bw-vb-help'), table);
        }
        function updateControls() {
            current = normalize(current);
            fillOptions(fields.unit, current.units.map(unit => [unit, unit || 'Unit not specified']));
            const highlightRows = ['horizontal', 'map'].includes(current.type) ? ranking(current, compatible(current)).map(row => [text(row.id || row.label), row.label]) : compatible(current).series.map(series => [series.id, series.name]);
            fillOptions(fields.highlight, [['', 'All values'], ...highlightRows]);
            if (current.highlight && !highlightRows.some(([id]) => id === current.highlight)) current.highlight = '';
            if (![...fields.limit.options].some(option => Number(option.value) === current.limit)) {
                const option = element('option', text(current.limit)); option.value = text(current.limit); fields.limit.append(option);
            }
            Object.entries(fields).forEach(([key, node]) => {
                if (key === 'dataset') { const option = [...node.options].find(option => option.value === current.id); if (option) node.value = option.value; }
                else if (key === 'zero') node.checked = current.zero;
                else node.value = text(current[key]);
            });
            fields.zero.disabled = ['area', 'bar', 'horizontal'].includes(current.type);
            [...fields.type.options].forEach(option => { option.disabled = ['line', 'area'].includes(option.value) && !current.series.length && current.rows.length > 0; });
            fields.limit.closest('label').hidden = current.type !== 'horizontal'; geo.hidden = current.type !== 'map';
            try { restoreButton.disabled = !readDraft(current); } catch (_) { restoreButton.disabled = false; }
            sourceTable();
        }
        function redraw() {
            try { render(stage, current); } catch (error) { announce(error.message, true); }
        }
        Object.entries(fields).forEach(([key, node]) => {
            if (key === 'dataset') {
                node.addEventListener('change', () => {
                    edits.set(current.id, current);
                    authoredByDataset.set(current.id, new Set(authoredFields));
                    const dataset = datasets.find((item, index) => text(item.id || index) === node.value);
                    if (dataset) { current = normalize(edits.get(text(dataset.id || node.value)) || { ...dataset, id: text(dataset.id || node.value) }); authoredFields = new Set(authoredByDataset.get(current.id) || []); updateControls(); redraw(); announce('Dataset selected. Source observations and credits updated.'); }
                });
            } else node.addEventListener(node.tagName === 'SELECT' || node.type === 'checkbox' ? 'change' : 'input', () => {
                authoredFields.add(key);
                current[key] = node.type === 'checkbox' ? node.checked : key === 'limit' ? Number(node.value) : node.value;
                if (key === 'type' || key === 'unit') updateControls();
                redraw(); announce('Preview updated. Save draft to keep these changes.');
            });
        });
        geoFile.addEventListener('change', async () => {
            const file = geoFile.files?.[0]; if (!file) return;
            if (file.size > 10000000) { announce('Use a GeoJSON file below 10 MB.', true); return; }
            try {
                const content = file.text ? await file.text() : await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsText(file); });
                const geojson = validateGeoJSON(JSON.parse(content)); current.geojson = geojson;
                if (!current.geoSource) current.geoSource = file.name; updateControls(); redraw(); announce('GeoJSON added. Match labels using the feature name property.');
            } catch (error) { announce('Geography was not applied: ' + error.message, true); }
        });
        pasteButton.addEventListener('click', () => {
            const result = parseData(paste.value);
            if (!result.ok) { announce('Data was not applied. ' + result.errors.join(' '), true); paste.setAttribute('aria-invalid', 'true'); paste.focus(); return; }
            paste.removeAttribute('aria-invalid');
            const imported = { id: current.id, title: authoredFields.has('title') ? current.title : 'Imported source observations',
                subtitle: authoredFields.has('subtitle') ? current.subtitle : '', color: current.color, zero: current.zero, limit: current.limit,
                width: current.width, ...result.spec };
            const compatibleTypes = result.spec.series.length ? ['line', 'area', 'bar', 'scatter'] : ['bar', 'scatter', 'horizontal', 'map'];
            if (authoredFields.has('type') && compatibleTypes.includes(current.type)) imported.type = current.type;
            if (imported.type === 'map') { imported.geojson = current.geojson; imported.geoKey = current.geoKey; imported.geoSource = current.geoSource; }
            current = normalize(imported); updateControls(); redraw();
            announce(`${result.count} source observations applied. ${result.warnings.join(' ')} Save draft to keep these changes.`);
        });
        saveButton.addEventListener('click', () => {
            try { saveDraft(current); restoreButton.disabled = false; announce('Draft saved in this browser. Source observations and geography included.'); }
            catch (_) { announce('Draft could not be saved. Browser storage may be unavailable or full. Your current graphic is still open.', true); }
        });
        restoreButton.addEventListener('click', () => {
            try { const draft = readDraft(current); if (!draft) { announce('No saved draft for this dataset.'); return; } current = normalize(draft.spec); authoredFields = new Set(['title', 'subtitle', 'type']); updateControls(); redraw(); announce('Saved draft restored from ' + new Date(draft.savedAt).toLocaleString() + '.'); }
            catch (_) { announce('The saved draft could not be restored. Current observations are still available.', true); }
        });
        exports.querySelector('[data-vb-action="svg"]').addEventListener('click', () => {
            const svg = stage.querySelector('svg'); if (!svg) return;
            download('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(serializeSVG(svg)), filename('svg')); announce('SVG exported with source credits, notes and exact observation metadata.');
        });
        exports.querySelector('[data-vb-action="png"]').addEventListener('click', async event => {
            const svg = stage.querySelector('svg'); if (!svg) return;
            event.currentTarget.disabled = true; const target = event.currentTarget; announce('Preparing PNG…');
            try { download(await png(svg), filename('png')); announce('PNG exported with headline, units, source credits and notes.'); }
            catch (error) { announce(error.message, true); } finally { target.disabled = false; }
        });
        function filename(extension) { return (current.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'benchmark-graphic') + '.' + extension; }
        let closed = false;
        function close() {
            if (closed) return;
            closed = true;
            if (dialog.isConnected) {
                if (dialog.open && typeof dialog.close === 'function') dialog.close(); dialog.remove();
                if (opener?.isConnected) opener.focus({ preventScroll: true });
            }
            if (active === controller) active = null;
            options.onClose?.();
        }
        closeButton.addEventListener('click', close);
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        dialog.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
            if (event.key === 'Tab' && typeof dialog.showModal !== 'function') {
                const nodes = [...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href]')].filter(node => !node.closest('[hidden]'));
                const first = nodes[0], last = nodes[nodes.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
        });
        controller = { dialog, close, getSpec: () => normalize(current), render: redraw, save: () => saveDraft(current), restore: () => { const draft = readDraft(current); if (draft) { current = normalize(draft.spec); authoredFields = new Set(['title', 'subtitle', 'type']); updateControls(); redraw(); } return draft; } };
        active = controller; updateControls(); redraw();
        if (typeof dialog.showModal === 'function') dialog.showModal(); else { dialog.setAttribute('open', ''); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); }
        fields.title.focus();
        try { if (readDraft(current)) announce('A saved draft is available. Restore it to continue; source data opened as supplied.'); }
        catch (_) { announce('A previous draft could not be read. Source data opened as supplied.', true); }
        return controller;
    }
    BW.VisualBuilder = { open, render, normalize, parseData, validateGeoJSON, serializeSVG, png, saveDraft, readDraft, close: () => active?.close() };
})();
