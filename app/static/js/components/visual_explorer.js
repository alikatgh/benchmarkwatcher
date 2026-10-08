/* Descriptive views of source observations, drawn only with D3. */
(function () {
    'use strict';
    const V = BW.Visuals, d = window.d3;
    const types = [['line', 'Line history'], ['area', 'Area history'], ['step', 'Step history'], ['bar', 'Observation bars'], ['scatter', 'Observation dots'], ['change', 'Change between observations'], ['histogram', 'Value distribution'], ['cumulative', 'Cumulative distribution'], ['box', 'Range & quartiles'], ['monthly', 'Monthly averages'], ['heatmap', 'Year × month heatmap'], ['coverage', 'Observation coverage']];
    let seq = 0;
    const redraws = new Map();
    function el(tag, text, className) { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; }
    function selector(parent, label, options) {
        const wrap = el('label', label), select = el('select');
        select.id = 'bw-visual-control-' + (++seq); wrap.htmlFor = select.id; select.setAttribute('aria-label', label);
        options.forEach(([value, text]) => { const option = el('option', text); option.value = value; select.append(option); });
        wrap.append(select); parent.append(wrap); return select;
    }
    function visualizationChooser(parent, options) {
        const wrap = el('div', '', 'bw-visual-chooser'), button = el('button', '', 'bw-visual-choice');
        const panel = el('div', '', 'bw-visual-options'), caption = el('span'), arrow = el('span', '⌄');
        const id = 'bw-visual-choice-' + (++seq), radioName = id + '-option';
        button.type = 'button'; button.value = options[0][0]; button.append(caption, arrow);
        arrow.setAttribute('aria-hidden', 'true'); panel.id = id;
        panel.setAttribute('popover', 'auto'); panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Choose visualization');
        button.setAttribute('aria-controls', id); button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-expanded', 'false');
        wrap.append(el('span', 'Visualization', 'bw-visual-choice-label'), button, panel); parent.append(wrap);
        let choices = options, fallbackOpen = false;
        const open = () => typeof panel.showPopover === 'function' ? panel.matches(':popover-open') : fallbackOpen;
        function position() {
            const bounds = button.getBoundingClientRect(), width = Math.min(410, window.innerWidth - 24);
            panel.style.width = width + 'px';
            panel.style.left = Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12)) + 'px';
            panel.style.top = Math.max(12, Math.min(bounds.bottom + 6, window.innerHeight - Math.min(panel.scrollHeight, 420) - 12)) + 'px';
        }
        function close(restore) {
            if (typeof panel.hidePopover === 'function' && open()) panel.hidePopover();
            fallbackOpen = false; panel.classList.remove('is-open'); button.setAttribute('aria-expanded', 'false');
            if (restore) button.focus();
        }
        button.sync = () => {
            const selected = choices.find(choice => choice[0] === button.value);
            caption.textContent = selected?.[1] || choices[0][1];
            button.setAttribute('aria-label', 'Visualization: ' + caption.textContent);
            panel.querySelectorAll('input').forEach(input => { input.checked = input.value === button.value; });
        };
        button.setOptions = options => {
            choices = options;
            if (!choices.some(choice => choice[0] === button.value)) button.value = choices[0][0];
            panel.replaceChildren();
            const groups = [
                ['History', ['line','area','step','bar','scatter','change']],
                ['Distribution', ['histogram','cumulative','box']],
                ['Timing', ['monthly','heatmap','coverage']],
                ['Overview', ['ranking','map','categories','dates']]
            ];
            const fieldset = el('fieldset'), legend = el('legend', 'Choose a view'); fieldset.append(legend);
            for (const [title, keys] of groups) {
                const rows = choices.filter(choice => keys.includes(choice[0])); if (!rows.length) continue;
                const section = el('div', '', 'bw-visual-choice-group'); section.append(el('h3', title));
                for (const [value, label] of rows) {
                    const item = el('label'), input = el('input'); input.type = 'radio'; input.name = radioName; input.value = value;
                    item.append(input, el('span', label)); section.append(item);
                    // Arrow navigation selects without closing the chooser; an
                    // explicit click or Enter commits and returns to the chart.
                    input.addEventListener('change', () => { button.value = value; button.sync(); button.dispatchEvent(new Event('change')); });
                    input.addEventListener('click', () => close(true));
                }
                fieldset.append(section);
            }
            panel.append(fieldset); button.sync();
        };
        button.addEventListener('click', () => {
            if (open()) { close(false); return; }
            if (typeof panel.showPopover === 'function') panel.showPopover();
            else { fallbackOpen = true; panel.classList.add('is-open'); }
            position(); button.setAttribute('aria-expanded', 'true');
            panel.querySelector('input:checked')?.focus();
        });
        panel.addEventListener('toggle', event => { button.setAttribute('aria-expanded', String(event.newState === 'open')); });
        panel.addEventListener('keydown', event => {
            // Browsers synthesize radio clicks for arrow navigation. Handle the
            // group here so browsing choices does not commit and close it.
            if (['ArrowLeft','ArrowUp','ArrowRight','ArrowDown','Home','End'].includes(event.key) && event.target.matches('input[type="radio"]')) {
                event.preventDefault(); event.stopPropagation();
                const inputs = [...panel.querySelectorAll('input[type="radio"]')], index = inputs.indexOf(event.target);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? inputs.length - 1 : (index + (['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1) + inputs.length) % inputs.length;
                const input = inputs[next]; input.checked = true; input.focus();
                input.dispatchEvent(new Event('change', { bubbles: true })); return;
            }
            if (event.key === 'Escape' || event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); close(true); }
        });
        document.addEventListener('pointerdown', event => { if (fallbackOpen && !wrap.contains(event.target)) close(false); });
        window.addEventListener('resize', () => { if (open()) position(); });
        button.setOptions(options); return button;
    }
    function valuesTable(parent, headers, rows) {
        parent.replaceChildren();
        const details = el('details', '', 'bw-visual-data'), table = el('table'), head = el('thead'), tr = el('tr');
        headers.forEach(label => { const th = el('th', label); th.scope = 'col'; tr.append(th); });
        head.append(tr); table.append(head);
        const body = el('tbody');
        rows.forEach(row => { const tr = el('tr'); row.forEach(value => tr.append(el('td', String(value)))); body.append(tr); });
        table.append(body); const wrap = el('div'); wrap.append(table);
        details.append(el('summary', `View exact values · ${rows.length} rows`), wrap); parent.append(details);
    }
    function titleMarks(selection, text) { selection.append('title').text(text); }
    const catalogTypes = [['ranking', 'Ranked historical changes'], ['map', 'Benchmark change map'], ['categories', 'Category coverage'], ['dates', 'Latest observation dates']];
    function catalogView(lab, records, range) {
        lab.stage.replaceChildren();
        const width = Math.max(320, lab.stage.clientWidth || 760), type = lab.select.value;
        const values = records.map(record => ({ ...record, change: V.numeric(record.change_percent) }));
        const available = values.filter(r => r.change !== null).sort((a,b) => b.change - a.change);
        lab.note.textContent = `${records.length} benchmarks · ${range === 'ALL' ? 'all available history' : range + ' observation window'}. Changes use each series’ own available endpoints; dates and units differ. `;
        let headers, tableRows;
        if (type === 'ranking') {
            const height = Math.max(200, available.length * 27 + 60), left = width < 500 ? 115 : 210;
            const svg = V.root(lab.stage, width, height, 'Ranked historical percentage changes. Exact dates and values below.');
            const x = d.scaleLinear().domain(V.domain(available.map(r => r.change), true)).range([left, width - 35]);
            const y = d.scaleBand().domain(available.map(r => r.id)).range([35, height - 25]).padding(.32);
            svg.append('g').attr('class','bw-d3-axis').attr('transform','translate(0,25)').call(d.axisTop(x).ticks(4).tickFormat(v => V.format(v) + '%'));
            svg.append('line').attr('x1',x(0)).attr('x2',x(0)).attr('y1',35).attr('y2',height-25).attr('stroke','var(--theme-border)');
            titleMarks(svg.selectAll('rect').data(available).join('rect').attr('x',r=>Math.min(x(0),x(r.change))).attr('y',r=>y(r.id)).attr('width',r=>Math.max(1,Math.abs(x(r.change)-x(0)))).attr('height',y.bandwidth()).attr('fill',r=>r.change<0?'#ac4461':'#237d83'), r=>`${r.name}: ${V.format(r.change)}% · ${r.date}`);
            svg.selectAll('text.bw-rank-name').data(available).join('text').attr('class','bw-rank-name').attr('x',left-10).attr('y',r=>y(r.id)+y.bandwidth()/2+4).attr('text-anchor','end').attr('fill','currentColor').text(r=>r.name.length > (width<500?16:30) ? r.name.slice(0,width<500?14:28)+'…' : r.name);
            lab.note.textContent += `${records.length - available.length} series without a usable change are omitted from the ranking.`;
        } else if (type === 'map') {
            const columns = Math.max(2, Math.floor(width / 150)), cellWidth = (width-12)/columns, cellHeight = 70, height = Math.ceil(values.length/columns)*cellHeight+12;
            const svg = V.root(lab.stage,width,height,'Benchmark map, colored by historical percentage change. Exact values below.');
            const limit = d.max(available,r=>Math.abs(r.change)) || 1;
            const fill = d.scaleDiverging(d.interpolateRdBu).domain([-limit,0,limit]);
            const cells = svg.selectAll('g.bw-map-item').data(values).join('g').attr('class','bw-map-item').attr('transform',(_,i)=>`translate(${6+(i%columns)*cellWidth},${6+Math.floor(i/columns)*cellHeight})`);
            cells.append('rect').attr('width',cellWidth-6).attr('height',cellHeight-6).attr('rx',3).attr('fill',r=>r.change===null?'var(--theme-border)':fill(r.change));
            cells.append('text').attr('x',9).attr('y',21).attr('fill',r=>r.change!==null&&Math.abs(r.change)>limit*.55?'white':'#172b3a').text(r=>r.name.length>19?r.name.slice(0,17)+'…':r.name);
            cells.append('text').attr('x',9).attr('y',44).attr('font-weight',600).attr('fill',r=>r.change!==null&&Math.abs(r.change)>limit*.55?'white':'#172b3a').text(r=>r.change===null?'Unavailable':V.format(r.change)+'%');
            titleMarks(cells,r=>`${r.name} · ${r.category} · ${V.format(r.change)}% · observed ${r.date}`);
            lab.note.textContent += `Equal-size tiles, one per benchmark. Red = decrease; blue = increase; neutral = near zero. Scale: −${V.format(limit)}% to +${V.format(limit)}%.`;
        } else if (type === 'categories') {
            const categories = d.rollups(records,rows=>rows.length,r=>r.category || 'Unspecified').map(([name,value])=>({name,value}));
            const svg=V.root(lab.stage,width,300,'Category coverage. Area represents the number of benchmarks.');
            const tree=d.hierarchy({children:categories}).sum(node=>node.value||0);
            d.treemap().size([width,300]).padding(4)(tree);
            const cells=svg.selectAll('g').data(tree.leaves()).join('g').attr('transform',node=>`translate(${node.x0},${node.y0})`);
            cells.append('rect').attr('width',node=>node.x1-node.x0).attr('height',node=>node.y1-node.y0).attr('fill',V.color()).attr('fill-opacity',.12).attr('stroke','var(--theme-border)');
            cells.append('text').attr('x',10).attr('y',25).attr('fill','currentColor').text(node=>node.data.name);
            cells.append('text').attr('x',10).attr('y',48).attr('fill','currentColor').attr('font-weight',600).text(node=>`${node.value} series`);
            titleMarks(cells,node=>`${node.data.name}: ${node.value} benchmarks`);
            headers=['Category','Benchmarks'];tableRows=categories.map(c=>[c.name,c.value]);
            lab.note.textContent += 'Tile area represents the count of benchmarks in each category, not price or economic weight.';
        } else {
            const rows=d.rollups(records,items=>items.length,r=>r.date||'Unknown').sort((a,b)=>a[0].localeCompare(b[0]));
            const height=Math.max(200,rows.length*30+60),svg=V.root(lab.stage,width,height,'Benchmark counts by latest observation date.');
            const x=d.scaleLinear().domain([0,d.max(rows,r=>r[1])||1]).range([110,width-35]),y=d.scaleBand().domain(rows.map(r=>r[0])).range([35,height-20]).padding(.25);
            svg.append('g').attr('class','bw-d3-axis').attr('transform','translate(0,25)').call(d.axisTop(x).ticks(4).tickFormat(d.format('d')));
            svg.append('g').attr('class','bw-d3-axis').attr('transform','translate(100,0)').call(d.axisLeft(y).tickSize(0));
            titleMarks(svg.selectAll('rect').data(rows).join('rect').attr('x',110).attr('y',r=>y(r[0])).attr('width',r=>x(r[1])-110).attr('height',y.bandwidth()).attr('fill',V.color()),r=>`${r[0]}: ${r[1]} benchmarks`);
            headers=['Latest observation date','Benchmarks'];tableRows=rows;
            lab.note.textContent += 'Counts by latest source observation date. Publication schedules differ; an older date does not establish a source failure.';
        }
        valuesTable(lab.table,headers||['Benchmark','Change %','Observed','Unit'],tableRows||values.map(r=>[r.name,V.format(r.change),r.date||'Unknown',[r.currency,r.unit].filter(Boolean).join(' / ')]));
    }
    function render(stage, rows, type, unit, note, table) {
        stage.replaceChildren();
        const points = V.history(rows), usable = points.filter(p => p.value !== null), values = usable.map(p => p.value);
        const width = Math.max(320, stage.clientWidth || 760), height = 320;
        let tableRows = points.map(p => [p.date, V.format(p.value)]), headers = ['Observation date', unit || 'Value'];
        const dates = usable.length ? `${usable[0].date} – ${usable[usable.length - 1].date}` : 'No observations';
        note.textContent = `${usable.length} usable observations · ${dates}. `;
        if (['line', 'area', 'step', 'bar', 'scatter', 'change'].includes(type)) {
            let chartPoints = points;
            if (type === 'change') {
                chartPoints = points.map((p, i) => ({ ...p, value: i && p.value !== null && points[i - 1].value > 0 ? (p.value / points[i - 1].value - 1) * 100 : null }));
                unit = '%'; tableRows = chartPoints.map(p => [p.date, V.format(p.value)]); headers = ['Observation date', 'Change %'];
                note.textContent += 'Change from the preceding available observation; intervals vary. A positive preceding value is required.';
            } else note.textContent += 'Actual observation dates. Extended gaps remain open. Use arrow keys to inspect values.';
            V.timeSeries(stage, [{ points: chartPoints, unit }], { type: type === 'change' ? 'bar' : type, height, zero: type === 'change', label: types.find(t => t[0] === type)[1] + '. Exact values below.' });
        } else {
            const svg = V.root(stage, width, height, types.find(t => t[0] === type)[1] + '. Exact values below.');
            if (!usable.length) V.empty(svg, width, height);
            else if (type === 'histogram') {
                const x = d.scaleLinear().domain(V.domain(values, false)).nice().range([70, width - 24]);
                const bins = d.bin().domain(x.domain()).thresholds(x.ticks(Math.min(20, Math.ceil(Math.sqrt(values.length)))))(values);
                const y = d.scaleLinear().domain([0, d.max(bins, b => b.length) || 1]).nice().range([height - 38, 24]);
                V.axes(svg, x, y, width, height, {yFormat: d.format('d')});
                titleMarks(svg.selectAll('rect').data(bins).join('rect').attr('class', 'bw-d3-bar').attr('x', b => x(b.x0) + 1).attr('width', b => Math.max(0, x(b.x1) - x(b.x0) - 2)).attr('y', b => y(b.length)).attr('height', b => y(0) - y(b.length)).attr('fill', V.color()).attr('opacity', .8), b => `${V.format(b.x0)} – ${V.format(b.x1)}: ${b.length} observations`);
                headers = ['Value from', 'Value to', 'Observations']; tableRows = bins.map(b => [V.format(b.x0), V.format(b.x1), b.length]);
                note.textContent += `Horizontal axis: ${unit}. Vertical axis: observation count. Each observation has equal weight.`;
            } else if (type === 'cumulative') {
                const sorted = [...values].sort(d.ascending), samples = sorted.map((value, i) => ({ value, share: (i + 1) / sorted.length }));
                const x = d.scaleLinear().domain(V.domain(values)).range([70, width - 24]), y = d.scaleLinear().domain([0, 1]).range([height - 38, 24]);
                V.axes(svg, x, y, width, height, { yFormat: d.format('.0%') });
                svg.append('path').datum(samples).attr('class', 'bw-d3-line').attr('d', d.line().x(p => x(p.value)).y(p => y(p.share)).curve(d.curveStepAfter)).attr('fill', 'none').attr('stroke', V.color()).attr('stroke-width', 2);
                headers = [unit || 'Value', 'Observations at or below'];
                tableRows = [...new Set(sorted)].map(value => [V.format(value), d.format('.1%')(d.bisectRight(sorted, value) / sorted.length)]);
                note.textContent += `Share of observations at or below each value (${unit}). Describes the selected sample only.`;
            } else if (type === 'box') {
                const sorted = [...values].sort(d.ascending), stats = [sorted[0], d.quantileSorted(sorted, .25), d.quantileSorted(sorted, .5), d.quantileSorted(sorted, .75), sorted[sorted.length - 1]];
                const x = d.scaleLinear().domain(V.domain(values)).range([70, width - 24]);
                svg.append('g').attr('class', 'bw-d3-axis').attr('transform', 'translate(0,240)').call(d.axisBottom(x).ticks(Math.max(3, Math.floor(width / 110))).tickFormat(d.format('~s')));
                svg.append('line').attr('x1', x(stats[0])).attr('x2', x(stats[4])).attr('y1', 145).attr('y2', 145).attr('stroke', V.color());
                svg.append('rect').attr('x', x(stats[1])).attr('width', Math.max(1, x(stats[3]) - x(stats[1]))).attr('y', 105).attr('height', 80).attr('fill', V.color()).attr('fill-opacity', .15).attr('stroke', V.color());
                stats.forEach((value, i) => svg.append('line').attr('x1', x(value)).attr('x2', x(value)).attr('y1', i === 2 ? 105 : 125).attr('y2', i === 2 ? 185 : 165).attr('stroke', V.color()).attr('stroke-width', i === 2 ? 3 : 1));
                ['Minimum', '25th percentile', 'Median', '75th percentile', 'Maximum'].forEach((label, i) => svg.append('title').text(label + ': ' + V.format(stats[i])));
                headers = ['Statistic', unit || 'Value']; tableRows = ['Minimum', '25th percentile', 'Median', '75th percentile', 'Maximum'].map((label, i) => [label, V.format(stats[i])]);
                note.textContent += 'Box spans the middle 50% of observations; whiskers show the full minimum and maximum. The center line is the median.';
            } else if (type === 'monthly') {
                const months = d.range(12).map(month => ({month, values: usable.filter(p => new Date(p.time).getUTCMonth() === month)}));
                months.forEach(m => { m.mean = d.mean(m.values, p => p.value); });
                const x = d.scaleBand().domain(d.range(12)).range([70, width - 24]).padding(.2), y = d.scaleLinear().domain(V.domain(months.map(m => m.mean), true)).range([height - 38, 24]);
                const monthName = m => d.utcFormat('%b')(new Date(Date.UTC(2000, m, 1)));
                V.axes(svg, x, y, width, height, {xValues: d.range(12).filter(m => width > 500 || m % 2 === 0), xFormat: monthName});
                titleMarks(svg.selectAll('rect').data(months.filter(m => m.mean !== undefined)).join('rect').attr('class', 'bw-d3-bar').attr('x', m => x(m.month)).attr('width', x.bandwidth()).attr('y', m => Math.min(y(0), y(m.mean))).attr('height', m => Math.abs(y(0) - y(m.mean))).attr('fill', V.color()), m => `${monthName(m.month)}: ${V.format(m.mean)} · ${m.values.length} observations`);
                headers = ['Calendar month', `Average (${unit})`, 'Observations']; tableRows = months.map(m => [monthName(m.month), m.mean === undefined ? 'Unavailable' : V.format(m.mean), m.values.length]);
                note.textContent += 'Arithmetic average of observations grouped by calendar month across the selected years. Uneven coverage can affect comparisons.';
            } else {
                const groups = d.rollup(usable, rows => ({ mean: d.mean(rows, p => p.value), count: rows.length }), p => p.date.slice(0, 7));
                const years = [...new Set(points.map(p => p.date.slice(0, 4)))];
                const h = Math.max(120, years.length * 25 + 70);
                svg.attr('viewBox', `0 0 ${width} ${h}`);
                const x = d.scaleBand().domain(d.range(1, 13)).range([58, width - 16]).padding(.08), y = d.scaleBand().domain(years).range([32, h - 30]).padding(.08);
                const measure = type === 'coverage' ? 'count' : 'mean';
                const extent = d.extent([...groups.values()], g => g[measure]);
                const fill = d.scaleSequential(d.interpolateBlues).domain(extent[0] === extent[1] ? [extent[0] - 1, extent[1] + 1] : extent);
                const cells = years.flatMap(year => d.range(1, 13).map(month => ({year, month, key: year + '-' + String(month).padStart(2, '0')})));
                const marks = svg.selectAll('rect').data(cells).join('rect').attr('class', 'bw-d3-cell').attr('x', c => x(c.month)).attr('y', c => y(c.year)).attr('width', x.bandwidth()).attr('height', y.bandwidth()).attr('rx', 2).attr('fill', c => groups.has(c.key) ? fill(groups.get(c.key)[measure]) : 'var(--theme-border,#e2e6ea)');
                titleMarks(marks, c => c.key + ': ' + (groups.has(c.key) ? V.format(groups.get(c.key)[measure]) + (measure === 'count' ? ' observations' : ' ' + unit) : 'No observations'));
                svg.append('g').attr('class', 'bw-d3-axis').attr('transform', 'translate(0,25)').call(d.axisTop(x).tickValues(d.range(1,13).filter(m => width > 500 || m % 2 === 1)).tickFormat(m => d.utcFormat('%b')(new Date(Date.UTC(2000, m - 1, 1)))).tickSize(0)).call(g => g.select('.domain').remove());
                svg.append('g').attr('class', 'bw-d3-axis').attr('transform', 'translate(52,0)').call(d.axisLeft(y).tickSize(0)).call(g => g.select('.domain').remove());
                headers = ['Month', `Average (${unit})`, 'Observations']; tableRows = cells.map(c => [c.key, groups.has(c.key) ? V.format(groups.get(c.key).mean) : 'Unavailable', groups.get(c.key)?.count || 0]);
                note.textContent += type === 'coverage' ? 'Darker blue means more observations in that month. Gray means no usable observations; it does not establish a source outage.' : `Darker blue means a higher monthly average (${unit}). Gray means no observations. Averages use available observations only.`;
                note.textContent += ` Color scale: ${V.format(extent[0])} to ${V.format(extent[1])}.`;
            }
        }
        valuesTable(table, headers, tableRows);
    }
    function createLab(parent, title) {
        const section = el('section', '', 'bw-visual-lab'), id = 'bw-lab-' + (++seq);
        const heading = el('h2', title); heading.id = id; section.setAttribute('aria-labelledby', id);
        section.append(heading, el('p', 'Explore historical observations from different angles. Every view includes its exact values.'));
        const controls = el('div', '', 'bw-visual-controls'), select = visualizationChooser(controls, types);
        const exportButton = el('button', 'Download PNG'); exportButton.type = 'button'; controls.append(exportButton);
        const stage = el('div', '', 'bw-visual-stage'), note = el('p', '', 'bw-visual-note'), table = el('div'); note.setAttribute('aria-live', 'polite');
        section.append(controls, stage, note, table); parent.append(section);
        const state = { rows: [], unit: '', section, controls, select, stage, note, table };
        if (BW.VisualBuilderSources) state.builderButton = BW.VisualBuilderSources.attach(controls, () => state.graphicSpec || {
            title:state.name || 'Historical observations', unit:state.unit, type:'line',
            source:state.source || '', notes:note.textContent,
            series:[{name:state.name || 'Observations',unit:state.unit,points:state.rows}]
        });
        state.draw = () => { select.sync(); render(stage, state.rows, select.value, state.unit, note, table); };
        select.addEventListener('change', () => state.draw());
        exportButton.addEventListener('click', async () => {
            const svg = stage.querySelector('svg'); if (!svg) return;
            exportButton.disabled = true;
            try { const link = el('a'); link.href = await V.png(svg); link.download = 'benchmark-' + select.value + '.png'; link.click(); }
            catch (_) { note.textContent = 'The image could not be created. Try again.'; }
            finally { exportButton.disabled = false; }
        });
        if (typeof ResizeObserver !== 'undefined') {
            let width = 0;
            new ResizeObserver(() => { if (stage.clientWidth > 0 && width !== stage.clientWidth) { width = stage.clientWidth; state.draw(); } }).observe(stage);
        }
        redraws.set(section, () => state.draw());
        return state;
    }
    let detailLab;
    function detail(rows, name, unit) {
        const chart = document.getElementById('priceChart'); if (!chart) return;
        if (!detailLab) {
            const host = el('div'); (chart.closest('.commodity-overview') || chart.closest('.chart-panel')).after(host); detailLab = createLab(host, 'Visual explorer');
            const context = el('div', '', 'bw-visual-context'), heading = detailLab.section.querySelector('h2');
            const introduction = heading.nextElementSibling;
            context.append(heading, introduction);
            context.append(detailLab.controls, detailLab.note);
            detailLab.section.prepend(context); detailLab.section.classList.add('bw-visual-detail');
            detailLab.table.classList.add('bw-visual-values');
            const wide = window.matchMedia('(min-width:1024px)');
            const adaptContext = () => { if (wide.matches) context.append(detailLab.note); else detailLab.stage.after(detailLab.note); };
            adaptContext(); wide.addEventListener('change', adaptContext);
            detailLab.select.value = 'histogram';
        }
        detailLab.rows = rows; detailLab.unit = unit; detailLab.draw();
        detailLab.name = name;
        const metadata = document.getElementById('bw-visual-source');
        if (metadata) { try { detailLab.source = JSON.parse(metadata.textContent).source; } catch (_) {} }
    }
    function workbooks() {
        document.querySelectorAll('[data-workbook-chart]').forEach(target => {
            if (target.dataset.d3Ready) return;
            const points = JSON.parse(target.dataset.points || '[]'); target.dataset.d3Ready = 'true';
            const controls = el('div', '', 'studio-chart-controls');
            const select = selector(controls, 'Chart type', [['line', 'Line'], ['area', 'Area'], ['bar', 'Bars'], ['scatter', 'Dots']]);
            const caption = target.closest('figure')?.querySelector('figcaption');
            if (caption) caption.append(controls); else target.before(controls);
            if (BW.VisualBuilderSources) BW.VisualBuilderSources.attach(controls, {
                id:['workbook',target.dataset.workbookVersion || location.pathname,target.dataset.workbookName,
                    target.closest('[data-analysis-id]')?.dataset.analysisId || '',target.dataset.label].join(':'),
                title:target.dataset.label, type:'bar', unit:target.dataset.unit, ordinal:true,
                source:'Saved workbook values' + (target.dataset.workbookName ? ' · ' + target.dataset.workbookName : '') + ' · source cells retained with each observation',
                notes:'Workbook periods are shown in source order. Values may include model assumptions; dates alone do not establish historical observations.',
                series:[{name:target.dataset.label,unit:target.dataset.unit,points:points.map(point=>({...point, value:V.numeric(point.value) === null ? null : V.numeric(point.value) * (point.percent ? 100 : 1)}))}]
            });
            function draw() {
                const width = Math.max(260, target.clientWidth || 760), height = 230, svg = V.root(target, width, height, target.dataset.label + '. Exact values in Source data.');
                const rows = points.map((p, index) => ({...p, index, value: p.value === null ? null : V.numeric(p.value) * (p.percent ? 100 : 1)}));
                const x = d.scalePoint().domain(rows.map(p => p.index)).range([8, width - 58]).padding(.2), y = d.scaleLinear().domain(V.domain(rows.map(p => p.value), select.value === 'bar')).range([192, 16]);
                V.axes(svg, x, y, width, height, {left:8, right:width - 58, finance:true, yAxisPosition:'right', yTicks:4, xValues: rows.filter((p, i) => i % Math.max(1, Math.ceil(rows.length / (width < 500 ? 3 : 6))) === 0 || i === rows.length - 1).map(p => p.index), xFormat: i => rows[i].period});
                const defined = p => p.value !== null;
                if (select.value === 'area') svg.append('path').datum(rows).attr('d', d.area().defined(defined).x(p => x(p.index)).y0(192).y1(p => y(p.value))).attr('fill', V.color()).attr('opacity', .12);
                if (['line', 'area'].includes(select.value)) svg.append('path').datum(rows).attr('d', d.line().defined(defined).x(p => x(p.index)).y(p => y(p.value))).attr('class', 'bw-d3-line').attr('fill', 'none').attr('stroke', V.color()).attr('stroke-width', 2);
                const valid = rows.filter(defined);
                if (select.value === 'bar') titleMarks(svg.selectAll('rect').data(valid).join('rect').attr('x', p => x(p.index) - 10).attr('width', Math.min(20, 500 / rows.length)).attr('y', p => Math.min(y(0), y(p.value))).attr('height', p => Math.abs(y(p.value) - y(0))).attr('fill', V.color()), p => p.period + ': ' + p.display + ' · ' + p.source);
                else titleMarks(svg.selectAll('circle').data(valid).join('circle').attr('cx', p => x(p.index)).attr('cy', p => y(p.value)).attr('r', select.value === 'scatter' ? 4 : 2.5).attr('fill', V.color()), p => p.period + ': ' + p.display + ' · ' + p.source);
            }
            select.addEventListener('change', draw); redraws.set(target, draw); draw();
            if (typeof ResizeObserver !== 'undefined') {
                let width = target.clientWidth;
                const observer = new ResizeObserver(() => {
                    if (!target.isConnected) { observer.disconnect(); return; }
                    if (target.clientWidth > 0 && target.clientWidth !== width) { width = target.clientWidth; draw(); }
                });
                observer.observe(target);
            }
        });
    }
    async function dashboard() {
        const parent = document.getElementById('bw-visual-explorer'); if (!parent) return;
        const lab = createLab(parent, 'Visual explorer');
        if (lab.builderButton) lab.builderButton.disabled = true;
        const benchmark = selector(lab.controls, 'Benchmark', []), range = selector(lab.controls, 'Observation range', [['1Y', 'Last available year'], ['5Y', 'Last available 5 years'], ['ALL', 'All available observations']]);
        lab.controls.prepend(benchmark.parentElement, range.parentElement);
        lab.select.value = 'heatmap';
        let request = 0, current = null, records = [];
        const seriesDraw = lab.draw;
        function configure(catalog) {
            const options = catalog ? catalogTypes : types;
            const selected = lab.select.value;
            lab.select.setOptions(options);
            lab.select.value = options.some(option=>option[0]===selected) ? selected : options[0][0];
            lab.select.sync();
            lab.draw = catalog ? () => { lab.select.sync(); catalogView(lab, records, range.value); } : seriesDraw;
            // Catalog percentage changes are precomputed by the API, which has no 5Y window.
            range.querySelector('option[value="5Y"]').disabled = catalog;
        }
        lab.select.addEventListener('change', () => { if (!current) { lab.stage.replaceChildren(); lab.table.replaceChildren(); lab.note.textContent = 'Select a benchmark to load observations.'; } });
        async function load() {
            const active = ++request; lab.note.textContent = 'Loading observations…'; lab.stage.setAttribute('aria-busy', 'true');
            current = null; lab.graphicSpec = null; lab.rows = []; lab.name = ''; lab.unit = '';
            if (lab.builderButton) lab.builderButton.disabled = true;
            try {
                const catalog = benchmark.value === '__catalog__';
                if (catalog && range.value === '5Y') range.value = 'ALL';
                const response = await fetch(catalog ? '/api/commodities?include_history=false&range=' + range.value : '/api/commodity/' + encodeURIComponent(benchmark.value));
                if (!response.ok) throw new Error('Unavailable');
                const payload = await response.json(); if (active !== request) return;
                current = payload.data || payload.commodity || payload;
                if (catalog) {
                    const category = new URLSearchParams(location.search).get('category');
                    records = category ? current.filter(record=>record.category === category) : current;
                    lab.graphicSpec = {id:'catalog-changes',title:'Historical benchmark changes',type:'ranking',unit:'%',
                        source:[...new Set(records.map(record=>record.source_name || record.source).filter(Boolean))].join('; '),
                        notes:'Changes over ' + (range.value === 'ALL' ? 'all saved history' : range.value) + '. Each series uses its own available endpoints; periods differ.',
                        rows:records.map(record=>({label:record.name,value:record.change_percent,period:record.date,unit:'%',source:[record.source_name || record.source,record.source_url].filter(Boolean).join(' · ')}))};
                    configure(true); lab.draw();
                }
                else { configure(false); drawRange(); }
            } catch (_) { if (active === request) { current = null; lab.rows = []; lab.stage.replaceChildren(); lab.table.replaceChildren(); lab.note.textContent = 'Could not load observations. Select a benchmark to retry.'; } }
            finally { if (active === request) { lab.stage.removeAttribute('aria-busy'); if (lab.builderButton) lab.builderButton.disabled = !current; } }
        }
        function drawRange() {
            if (!current) return;
            const points = V.history(current.history), last = points.at(-1)?.time, cutoff = new Date(last);
            if (range.value !== 'ALL') cutoff.setUTCFullYear(cutoff.getUTCFullYear() - (range.value === '5Y' ? 5 : 1));
            lab.rows = range.value === 'ALL' ? points : points.filter(p => p.time >= +cutoff);
            lab.unit = [current.currency, current.unit].filter(Boolean).join(' / '); lab.draw();
            lab.name = current.name;
            lab.graphicSpec = BW.VisualBuilderSources?.benchmark(current,lab.rows);
        }
        benchmark.addEventListener('change', load); range.addEventListener('change', () => benchmark.value === '__catalog__' ? load() : drawRange());
        try {
            const response = await fetch('/api/commodities?include_history=false'); if (!response.ok) throw new Error('Unavailable');
            const payload = await response.json(), records = Array.isArray(payload) ? payload : (payload.data || payload.commodities);
            const all = el('option','All benchmarks'); all.value='__catalog__'; benchmark.append(all);
            records.forEach(record => { const option = el('option', record.name); option.value = record.id; benchmark.append(option); });
            if (records.some(r => r.id === 'gold')) benchmark.value = 'gold';
            await load();
        } catch (_) { lab.note.textContent = 'The benchmark catalog could not be loaded. Reload the page to retry.'; }
    }
    BW.VisualExplorer = { detail, workbooks, render, refresh() {
        redraws.forEach((draw, node) => { if (node.isConnected) draw(); else redraws.delete(node); });
    } };
    document.addEventListener('DOMContentLoaded', () => { workbooks(); dashboard(); });
})();
