/* Shared saved-history experience, extracted from the benchmark detail panel.
 * Reads supplied observations only; no fetching, refresh jobs or export permissions.
 */
(function () {
    'use strict';
    window.BW = window.BW || {};
    const dateValue = value => {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
        const time = Date.parse(value + 'T00:00:00Z');
        return Number.isFinite(time) && new Date(time).toISOString().slice(0,10) === value ? time : null;
    };
    const numeric = value => ['number','string'].includes(typeof value) && String(value).trim() && Number.isFinite(Number(value)) ? Number(value) : null;
    function controls(context) {
        const {state,byId,history,rangeWindow,redrawChart,saveChartSettings,element,button}=context;
        const sourceDate = context.dateValue || dateValue;
    function ranges() {
        const controls = element('div', 'benchmark-detail-ranges');
        controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', 'History range');
        ['1M', '3M', '6M', 'YTD', '1Y', '5Y', 'ALL', 'CUSTOM'].forEach(range => {
            const control = button(range === 'ALL' ? 'All' : range === 'CUSTOM' ? 'Custom' : range, () => {
                if (range === 'CUSTOM') {
                    state.settingsOpen = true; byId('benchmark-chart-settings').open = true;
                    const handle = byId('benchmark-range-start');
                    (handle && !handle.disabled && !handle.parentElement.hidden ? handle : byId('benchmark-exact-dates').querySelector('summary')).focus({ preventScroll: true });
                    byId('benchmark-chart-settings').scrollIntoView?.({block:'nearest'}); return;
                }
                state.range = range; redrawChart('[data-detail-range="' + range + '"]');
            });
            control.dataset.detailRange = range;
            control.setAttribute('aria-pressed', String(range === state.range)); controls.append(control);
        });
        return controls;
    }
    function rangeSlider(dates, window) {
        const wrap = element('div', 'benchmark-detail-date-slider');
        const readout = element('div', 'benchmark-detail-range-dates');
        const from = element('output'), to = element('output');
        const track = element('div', 'benchmark-detail-range-track'), selected = element('span'); track.append(selected);
        const controls = element('div', 'benchmark-detail-range-handles');
        const maximum = Math.max(0, dates.length - 1);
        const empty = !dates.some(date => sourceDate(date) >= window.start && sourceDate(date) <= window.end);
        let first = dates.findIndex(date => sourceDate(date) >= window.start);
        if (first < 0) first = maximum;
        let last = dates.length - 1;
        while (last > 0 && sourceDate(dates[last]) > window.end) last -= 1;
        first = Math.min(Math.max(0, first), Math.max(0, last));
        const start = element('input'), end = element('input');
        [start, end].forEach((input, index) => {
            input.type = 'range'; input.min = '0'; input.max = String(maximum); input.step = '1';
            input.id = index ? 'benchmark-range-end' : 'benchmark-range-start';
            input.setAttribute('aria-label', index ? 'Range end' : 'Range start');
            input.disabled = dates.length < 2 || empty;
        });
        start.value = String(first); end.value = String(Math.max(0, last));
        from.htmlFor = start.id; to.htmlFor = end.id;
        const label = date => date ? new Date(date + 'T00:00:00Z').toLocaleDateString(undefined, {day:'numeric', month:'short', year:'numeric', timeZone:'UTC'}) : 'No dates';
        let collapsedAnchor = null, pointerValue = null;
        function preview(input, committing = false) {
            if (collapsedAnchor !== null && input) {
                const value = committing && pointerValue !== null ? pointerValue : +input.value;
                pointerValue = value;
                start.value = String(Math.min(value, collapsedAnchor)); end.value = String(Math.max(value, collapsedAnchor));
            }
            if (input === start && +start.value > +end.value) start.value = end.value;
            if (input === end && +end.value < +start.value) end.value = start.value;
            const left = dates[+start.value], right = dates[+end.value];
            from.textContent = label(left); to.textContent = label(right);
            start.setAttribute('aria-valuetext', left || 'No source dates'); end.setAttribute('aria-valuetext', right || 'No source dates');
            wrap.style.setProperty('--range-start', (maximum ? +start.value / maximum * 100 : 0) + '%');
            wrap.style.setProperty('--range-end', (maximum ? +end.value / maximum * 100 : 100) + '%');
            // At the last date, expose the start handle so a collapsed range can reopen.
            start.style.zIndex = +start.value === maximum ? '3' : '1';
        }
        [start, end].forEach(input => {
            // An overlapping thumb expands toward the drag, including earlier dates.
            input.addEventListener('pointerdown', () => { collapsedAnchor = +start.value === +end.value ? +start.value : null; pointerValue = collapsedAnchor; });
            input.addEventListener('keydown', () => { collapsedAnchor = pointerValue = null; });
            input.addEventListener('pointercancel', () => { collapsedAnchor = pointerValue = null; if (input.isConnected) redrawChart('#' + input.id); });
            input.addEventListener('input', () => preview(input));
            function commit() {
                if (dates.length < 2 || empty || !input.isConnected) return;
                preview(input, true);
                const focus = collapsedAnchor !== null && pointerValue < collapsedAnchor ? start.id : input.id;
                state.custom = {start: dates[+start.value], end: dates[+end.value]};
                state.range = 'CUSTOM'; state.settingsOpen = true;
                redrawChart('#' + focus);
            }
            input.addEventListener('change', commit);
            // Moving the other endpoint can leave the captured input unchanged.
            input.addEventListener('pointerup', () => { if (collapsedAnchor !== null && pointerValue !== collapsedAnchor) commit(); });
        });
        preview();
        if (Number.isFinite(window.start)) from.textContent = label(new Date(window.start).toISOString().slice(0, 10));
        if (Number.isFinite(window.end)) to.textContent = label(new Date(window.end).toISOString().slice(0, 10));
        readout.append(from, element('span', '', '–'), to); controls.append(track, start, end);
        controls.hidden = empty; wrap.append(readout, controls);
        if (empty) wrap.append(element('p', 'benchmark-detail-chart-note', 'No source dates in this interval. Choose a preset or change exact dates.'));
        return wrap;
    }
    function chartSettings() {
        const details = element('details', 'benchmark-detail-settings');
        details.id = 'benchmark-chart-settings'; details.open = state.settingsOpen;
        details.append(element('summary', '', 'Chart settings'));
        details.addEventListener('toggle', () => { if (details.isConnected) state.settingsOpen = details.open; });
        const form = element('form', 'benchmark-detail-date-form');
        const startLabel = element('label', '', 'From'); startLabel.htmlFor = 'benchmark-chart-start';
        const endLabel = element('label', '', 'To'); endLabel.htmlFor = 'benchmark-chart-end';
        const start = element('input'); start.type = 'date'; start.id = startLabel.htmlFor; start.required = true;
        const end = element('input'); end.type = 'date'; end.id = endLabel.htmlFor; end.required = true;
        const all = context.sourceDates || [...new Set(state.records.filter(record => !record.error).flatMap(record => history(record)).map(point => point.date))].sort();
        const window = rangeWindow(state.records);
        start.value = Number.isFinite(window.start) ? new Date(window.start).toISOString().slice(0, 10) : all[0] || '';
        end.value = Number.isFinite(window.end) ? new Date(window.end).toISOString().slice(0, 10) : all[all.length - 1] || '';
        const startGroup = element('div'); startGroup.append(startLabel, start);
        const endGroup = element('div'); endGroup.append(endLabel, end);
        const apply = button('Apply dates', () => {}); apply.type = 'submit'; apply.id = 'benchmark-chart-apply';
        const error = element('p', 'benchmark-detail-date-error'); error.id = 'benchmark-chart-date-error'; error.setAttribute('role', 'alert'); error.hidden = true;
        [start, end].forEach(input => input.setAttribute('aria-describedby', error.id)); form.noValidate = true;
        form.addEventListener('submit', event => {
            event.preventDefault();
            const from = dateValue(start.value), to = dateValue(end.value);
            const invalid = from === null || to === null || from > to;
            [start, end].forEach(input => input.setAttribute('aria-invalid', String(invalid)));
            if (invalid) {
                error.textContent = from === null || to === null ? 'Enter valid start and end dates.' : 'Start date must be on or before end date.';
                error.hidden = false; (from === null || from > to ? start : end).focus(); return;
            }
            state.custom = { start: start.value, end: end.value }; state.range = 'CUSTOM'; state.settingsOpen = true; state.exactDatesOpen = true;
            redrawChart('#benchmark-chart-apply');
        });
        form.append(startGroup, endGroup, apply, error);
        const exact = element('details', 'benchmark-detail-exact-dates'); exact.id = 'benchmark-exact-dates'; exact.open = state.exactDatesOpen;
        exact.append(element('summary', '', 'Exact dates'), form);
        exact.addEventListener('toggle', () => { if (exact.isConnected) state.exactDatesOpen = exact.open; });
        const presentation = element('div', 'benchmark-detail-presentation');
        const styleControl = element('div', 'benchmark-detail-style-control');
        const styleLabel = element('label', '', 'Chart type'); styleLabel.htmlFor = 'benchmark-chart-style';
        const select = element('select'); select.id = styleLabel.htmlFor;
        [['line', 'Line'], ['area', 'Area'], ['step', 'Step'], ['scatter', 'Dots'], ['bar', 'Bars']].forEach(([value, label]) => { const option = element('option', '', label); option.value = value; select.append(option); });
        select.value = state.chartStyle;
        select.addEventListener('change', () => { state.chartStyle = select.value; state.settingsOpen = true; saveChartSettings(); redrawChart('#benchmark-chart-style'); });
        const dotsLabel = element('label', 'benchmark-detail-dots');
        const dots = element('input'); dots.type = 'checkbox'; dots.id = 'benchmark-chart-dots'; dots.checked = state.showDots;
        dots.addEventListener('change', () => { state.showDots = dots.checked; state.settingsOpen = true; saveChartSettings(); redrawChart('#benchmark-chart-dots'); });
        dotsLabel.append(dots, document.createTextNode('Observation dots'));
        styleControl.append(styleLabel, select); presentation.append(styleControl, dotsLabel);
        details.append(rangeSlider(all, window), element('p', 'benchmark-detail-chart-note benchmark-detail-range-help', 'Drag handles to source dates; release to apply. Exact dates include both endpoints; source gaps stay open.'), exact, presentation);
        return details;
    }
        return {ranges,chartSettings};
    }
    function mount(host, record, options = {}) {
        if (!host || !BW.Visuals) return null;
        const state = options.state || {range:'1Y',custom:{start:'',end:''},chartStyle:'line',showDots:false,settingsOpen:false,exactDatesOpen:false,inspectedDate:null};
        state.records = [record];
        let chart = null, drawChart = null, frame = null, destroyed = false, lastWidth = 0;
        const preferenceKey = options.preferenceKey;
        if (preferenceKey) {
            try {
                const saved = JSON.parse(localStorage.getItem(preferenceKey) || 'null');
                if (saved?.version === 1) {
                    if (['line','area','step','scatter','bar'].includes(saved.style)) state.chartStyle = saved.style;
                    if (typeof saved.dots === 'boolean') state.showDots = saved.dots;
                }
            } catch (_) { /* Unavailable preferences never prevent viewing saved history. */ }
        }
        const prefix = options.idPrefix || 'benchmark';
        const resolveId = id => prefix === 'benchmark' ? id : id.replace(/^benchmark/,prefix);
        const byId = id => host.querySelector('#' + resolveId(id));
        const pane = () => options.scrollContainer || host;
        const element = (tag,className,content) => {
            const node = document.createElement(tag);
            if (className) node.className = className;
            if (content !== undefined) node.textContent = String(content);
            return node;
        };
        const button = (label,action,className) => {const node = element('button',className,label); node.type='button'; node.addEventListener('click',action); return node;};
        const format = options.format || (value => value === null ? 'Unavailable' : Number(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}));
        const exact = point => options.sourcePeriods ? String(point.display_value ?? point.price ?? 'Unavailable') : format(point.price);
        const unit = () => options.unit || [record.currency,record.unit].filter(Boolean).join(' / ') || 'Unit not supplied';
        const cadence = () => (record.is_daily || record.frequency === 'daily') ? 'Daily observations' : record.frequency ? record.frequency[0].toUpperCase() + record.frequency.slice(1) + ' observations' : record.is_daily === false ? 'Monthly observations' : 'Cadence not supplied';
        // Normalize once per mounted record. Range changes search the sorted source dates.
        const observations = new Map();
        (Array.isArray(record.history) ? record.history : []).forEach(point => {
            const time = point && dateValue(point.date);
            if (time !== null && time !== undefined) observations.set(point.date,{...point,time,price:numeric(point.price ?? point.value)});
        });
        const allPoints = [...observations.values()].sort((a,b) => a.time-b.time);
        const history = () => allPoints;
        const sourceDates = allPoints.map(point => point.date), sourceTimes = new Map(allPoints.map(point => [point.date,point.time]));
        const bisect = window.d3.bisector(point => point.time);
        const lowerBound = (value, after) => after ? bisect.right(allPoints,value) : bisect.left(allPoints,value);
        function rangeWindow() {
            const latest = allPoints[allPoints.length-1]?.time;
            if(state.range==='CUSTOM') return {start:dateValue(state.custom.start),end:dateValue(state.custom.end)};
            if(latest===undefined || state.range==='ALL')return {start:-Infinity,end:Infinity};
            const date=new Date(latest);
            if(state.range==='YTD')return {start:Date.UTC(date.getUTCFullYear(),0,1),end:latest};
            const day=date.getUTCDate(); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth()-({'1M':1,'3M':3,'6M':6,'1Y':12,'5Y':60}[state.range]||12));
            date.setUTCDate(Math.min(day,new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate()));
            return {start:+date,end:latest};
        }
        function chartData() {const range=rangeWindow();return [{record,points:allPoints.slice(lowerBound(range.start),lowerBound(range.end,true))}];}
        function disposeChart() {if(frame!==null)window.cancelAnimationFrame(frame);frame=null;drawChart=null;chart?.destroy();chart=null;}
        function scheduleResize() {if(destroyed || frame!==null)return;frame=window.requestAnimationFrame(()=>{frame=null;if(!destroyed && host.isConnected)drawChart?.();});}
        function redrawChart(selector) {
            if(destroyed)return;
            const scroll=pane().scrollTop, expanded=host.querySelector('.benchmark-detail-observations')?.open;
            render();
            if(expanded && host.querySelector('.benchmark-detail-observations'))host.querySelector('.benchmark-detail-observations').open=true;
            if(selector)host.querySelector(selector.replace(/#benchmark/g,'#'+prefix))?.focus({preventScroll:true});
            pane().scrollTop=scroll;
        }
        function saveChartSettings(){
            options.saveSettings?.(state);
            if (preferenceKey) {
                try {localStorage.setItem(preferenceKey,JSON.stringify({version:1,style:state.chartStyle,dots:state.showDots}));}
                catch (_) { /* Keep the selected presentation in this tab. */ }
            }
        }
        const ui=controls({state,byId,history,rangeWindow,redrawChart,saveChartSettings,element,button,sourceDates,dateValue:date=>sourceTimes.get(date) ?? dateValue(date)});
    function svgNode(tag, attrs, content) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
        Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
        if (content !== undefined) node.textContent = content;
        return node;
    }
    function plot(series, indexed, onInspect) {
        if (!series.some(item => item.points.some(point => point.value !== null))) return element('p', 'benchmark-detail-empty', 'No usable observations in this range. Try a wider range or view the source.');
        const svg = svgNode('svg', {class: 'benchmark-detail-plot benchmark-detail-finance'});
        const data = series.map(item => ({name: record.name || record.id, color:'var(--theme-accent,#1967d2)',
            unit: unit(record), gapDays: options.gapDays || ({daily:7,weekly:10,monthly:62,quarterly:115,annual:400}[record.frequency] || (record.is_daily ? 7 : 62)), points:item.points}));
        lastWidth = 0;
        drawChart = force => {
            if (destroyed) return;
            const width = Math.round(svg.clientWidth || host.clientWidth || options.fallbackWidth || 480);
            if (!force && lastWidth === width) return;
            lastWidth = width; chart?.destroy();
            chart = BW.Visuals.timeSeries(svg, data, {width:Math.max(240,width), height: width < 420 ? 230 : 270,
                type:state.chartStyle, dots:state.showDots, lineWidth:2, pointRadius:2,
                finance:true, externalReadout:true, yAxisPosition:'right', yTicks:4, axisFontSize:11,
                initialDate:state.inspectedDate, onInspect, animation:0,
                xValues:(record.frequency === 'daily' || record.is_daily) && data[0].points.length <= 7 ? data[0].points.map(point => new Date(point.date + 'T00:00:00Z')) : undefined,
                tooltipDate:point => point.period || point.date,
                label:'Reference history. Use left and right arrow keys to inspect observations. Exact source values and dates are available in the observation table.'});
            svg.classList.add('benchmark-detail-plot','benchmark-detail-finance');
        };
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
        ['Date', 'Reference value'].concat(indexed ? [indexed === 'percent' ? '% change' : 'Index'] : []).forEach(label => {
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
                row.append(element('td', '', point.date), element('td', '', exact(point)));
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
    function render() {
        const container = host;
        if (destroyed) return;
        disposeChart();
        const record = state.records[0];
        const series = chartData([record])[0];
        const points = series.points.map(point => ({ ...point, value: point.price }));
        const usable = points.filter(point => point.price !== null);
        const indices = new Map(usable.map((point, index) => [point.date, index]));
        const heading = element('div', 'benchmark-detail-chart-head');
        heading.append(element('h3', '', 'Reference history'), element('span', 'benchmark-detail-muted', cadence(record)));
        container.replaceChildren(heading, ui.ranges());
        if (usable.length) {
            const readout = element('output', 'benchmark-detail-readout');
            readout.htmlFor = 'benchmark-detail-observation';
            readout.setAttribute('aria-live', 'off');
            const valueGroup = element('div');
            const date = element('div', 'benchmark-detail-readout-date');
            const valueRow = element('div', 'benchmark-detail-readout-value');
            const value = element('strong');
            valueRow.append(value, element('span', '', unit(record)));
            valueGroup.append(date, valueRow);
            const change = element('div', 'benchmark-detail-range-change');
            const delta = element('strong');
            change.append(delta, element('span', '', 'vs first in range'));
            readout.append(valueGroup, change);
            const input = element('input');
            input.id = 'benchmark-detail-observation'; input.type = 'range'; input.min = '0'; input.max = String(usable.length - 1); input.step = '1';
            input.disabled = usable.length === 1;
            const update = (point, series, inspection) => {
                if (!point) return;
                state.inspectedDate = inspection?.active ? point.date : null;
                input.value = String(indices.get(point.date) ?? 0);
                const text = (point.period || point.date) + ' · ' + exact(point) + ' ' + unit(record);
                input.setAttribute('aria-valuetext', text);
                value.textContent = exact(point);
                date.textContent = (inspection?.active ? 'Selected' : 'Latest') + ' · ' + (options.sourcePeriods ? (point.period || point.date) : new Date(point.time).toLocaleDateString('en', {day:'numeric', month:'short', year:'numeric', timeZone:'UTC'})) + (point.status ? ' · Source flag ' + point.status : '');
                const baseline = usable[0].price, difference = point.price - baseline;
                change.hidden = usable.length < 2;
                change.dataset.direction = difference > 0 ? 'up' : difference < 0 ? 'down' : 'flat';
                const sign = difference > 0 ? '+' : '';
                delta.textContent = sign + format(difference) + (baseline !== 0 && baseline > 0 ? ' (' + sign + Number(difference / baseline * 100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) + '%)' : '');
            };
            const chartSurface = element('div', 'benchmark-detail-chart-surface');
            chartSurface.append(readout, plot([{record, points, color:'var(--theme-accent,#1967d2)'}], false, update));
            const picker = element('div', 'benchmark-detail-point');
            const label = element('label', '', 'Explore an observation'); label.htmlFor = input.id;
            const hint = element('span', '', 'Drag or use ← →'); hint.id = 'benchmark-detail-chart-help';
            input.setAttribute('aria-describedby', hint.id);
            input.addEventListener('input', () => chart?.inspectDate(usable[Number(input.value)].date));
            picker.append(label, hint, input); chartSurface.append(picker);
            const extent = element('div', 'benchmark-detail-chart-extent');
            extent.append(element('span', '', usable[0].date + ' – ' + usable[usable.length - 1].date), element('span', '', usable.length + ' observations'));
            chartSurface.append(extent);
            container.append(chartSurface);
            scheduleResize();
            container.append(element('p', 'benchmark-detail-chart-note', (state.range === 'CUSTOM' ? 'Custom window: ' + state.custom.start + ' to ' + state.custom.end + '. ' : 'Range ends at the latest published observation. ') + (usable.length === 1 ? 'Only one observation; no change is calculated.' : 'Extended gaps are left open.')));
        } else container.append(plot([{record, points}], false));
        container.append(ui.chartSettings());
        if (options.showTable !== false) container.append(observationTable(record, points, false));
        if (options.quickVisual) {
            const quick = button('Quick visual', () => options.quickVisual(points, state.chartStyle, quick), 'bw-create-graphic');
            heading.append(quick);
        }
        // Measure after insertion; detached SVG widths would trigger a duplicate draw.
        drawChart?.();
    }
        const resize = typeof ResizeObserver === 'function' && options.observeResize !== false ? new ResizeObserver(scheduleResize) : null;
        resize?.observe(host);
        const theme = typeof MutationObserver === 'function' ? new MutationObserver(() => {if(!destroyed)drawChart?.(true);}) : null;
        theme?.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
        function destroy(){if(destroyed)return;destroyed=true;disposeChart();resize?.disconnect();theme?.disconnect();}
        // Rewrite IDs once after each render so independent instances do not share controls.
        const renderContent=render;
        render=function(){renderContent(); if(prefix!=='benchmark')host.querySelectorAll('[id],[for],[aria-describedby]').forEach(node=>{
            if(node.id)node.id=resolveId(node.id);
            for(const attr of ['for','aria-describedby'])if(node.hasAttribute(attr))node.setAttribute(attr,node.getAttribute(attr).split(' ').map(resolveId).join(' '));
        });host.dataset.rendered='true';};
        host.classList.add('bw-reference-history'); render();
        return {destroy,resize:scheduleResize,getState:()=>({...state}),getPoints:()=>chartData()[0].points};
    }
    BW.ReferenceHistory={mount,controls};
})();
