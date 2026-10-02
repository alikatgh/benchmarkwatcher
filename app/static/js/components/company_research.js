(function () {
    'use strict';
    const workspace = document.querySelector('[data-company-workspace]');
    if (!workspace) return;
    const $ = selector => workspace.querySelector(selector);
    const csrf = $('input[name=csrf]').value;
    const node = (tag, text, attributes = {}) => {
        const element = document.createElement(tag);
        if (text !== undefined) element.textContent = text;
        Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
        return element;
    };
    const format = (value, unit, compact = true) => {
        if (value === null || value === undefined) return '—';
        if (unit === '%') return value.toLocaleString(undefined, { maximumFractionDigits: 1 }) + '%';
        if (compact && !unit.includes('/share')) {
            for (const [size, suffix] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
                if (Math.abs(value) >= size) return (value / size).toLocaleString(undefined, { maximumFractionDigits: 2 }) + suffix;
            }
        }
        return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    };
    async function jsonFetch(url, options = {}) {
        const response = await fetch(url, { ...options, headers: { Accept: 'application/json' }, signal: options.signal || AbortSignal.timeout(90000) });
        if (response.redirected || response.headers.get('content-type')?.includes('text/html')) throw new Error('Your session may have expired. Reload this page and sign in again.');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || (response.status === 429 ? 'Too many requests. Please wait a minute and try again.' : 'The request could not be completed. Try again.'));
        return data;
    }
    let opening = false;
    workspace.addEventListener('submit', async event => {
        const form = event.target.closest('.company-open');
        if (!form) return;
        event.preventDefault();
        if (opening) return;
        opening = true;
        const button = form.querySelector('button'), original = button.textContent;
        button.disabled = true; button.textContent = 'Reading SEC filings…';
        const status = $('#company-search-status') || form.appendChild(node('p', '', { role: 'status' }));
        status.textContent = 'Preparing financial statements and filing sources. The first report can take a moment.';
        try { const result = await jsonFetch(form.action, { method: 'POST', body: new FormData(form) }); window.location.assign(result.url); }
        catch (error) { status.textContent = error.message; button.disabled = false; button.textContent = original; opening = false; }
    });
    const search = $('#company-search');
    if (search) {
        const input = $('#company-query'), results = $('#company-results'), status = $('#company-search-status');
        let timer, controller, sequence = 0;
        async function lookup() {
            controller?.abort(); controller = new AbortController();
            const current = ++sequence, query = input.value.trim();
            results.replaceChildren();
            if (!query) { status.textContent = 'SEC-reporting companies · No API key needed'; return; }
            status.textContent = 'Searching SEC company listings…';
            try {
                const data = await jsonFetch(search.dataset.searchUrl + '?q=' + encodeURIComponent(query), { signal: controller.signal });
                if (current !== sequence) return;
                status.textContent = (data.companies.length ? 'Choose a company to open its financial report.' : 'No matching SEC-listed company. Try its full name or a different ticker.') + (data.stale ? ' Using the last cached company directory.' : '');
                data.companies.forEach(company => {
                    const form = node('form', undefined, { method: 'post', action: search.dataset.openUrl, class: 'company-open' });
                    form.append(node('input', undefined, { type: 'hidden', name: 'csrf', value: csrf }), node('input', undefined, { type: 'hidden', name: 'cik', value: company.cik }));
                    const button = node('button', undefined, { type: 'submit' }), detail = node('span');
                    detail.append(node('strong', company.name), node('small', company.exchange + (company.suggested ? ' · Similar ticker' : '')));
                    button.append(node('span', company.ticker, { class: 'company-symbol' }), detail, node('span', '↗', { 'aria-hidden': 'true' }));
                    form.append(button); results.append(form);
                });
            } catch (error) { if (error.name !== 'AbortError' && current === sequence) status.textContent = error.message; }
        }
        search.addEventListener('submit', event => { event.preventDefault(); clearTimeout(timer); lookup(); });
        input.addEventListener('input', () => { controller?.abort(); ++sequence; clearTimeout(timer); results.replaceChildren(); timer = setTimeout(lookup, 250); });
        input.addEventListener('keydown', event => { if (event.key === 'ArrowDown' && results.querySelector('button')) { event.preventDefault(); results.querySelector('button').focus(); } });
        results.addEventListener('keydown', event => {
            const buttons = [...results.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
            if (event.key === 'Escape') input.focus();
            if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus(); }
        });
        return;
    }
    const report = JSON.parse($('#company-report-data').textContent), metrics = new Map(report.metrics.map(m => [m.id, m]));
    let frequency = 'annual', section = report.metrics.some(m => m.section === 'income') ? 'income' : report.metrics[0].section;
    let chart, frame, lastWidth, inspectedDate;
    const selectedPeriods = () => {
        const periods = report.periods.filter(p => p.frequency === frequency).sort((a, b) => a.end.localeCompare(b.end));
        return $('#company-range').value === 'all' ? periods : periods.slice(frequency === 'annual' ? -6 : -12);
    };
    function renderChart() {
        const metric = metrics.get($('#company-metric').value), periods = selectedPeriods();
        if (!metric || !window.BW?.Visuals) return;
        chart?.destroy();
        const readout = $('#company-chart-readout');
        readout.replaceChildren(node('strong', 'Unavailable'), node('span', 'No values in this range'));
        chart = window.BW.Visuals.timeSeries($('#company-chart'), [{ name: metric.label, unit: metric.unit, gapDays: frequency === 'annual' ? 390 : 115,
            points: periods.map(p => ({ date: p.end, value: metric.values[p.id]?.value ?? null, period: p.label, id: p.id })) }], {
            width: $('#company-chart').clientWidth, height: $('#company-chart').clientHeight, type: $('#company-chart-type').value,
            finance: true, externalReadout: true, yAxisPosition: 'right', dots: false, lineWidth: 2,
            initialDate: inspectedDate,
            yFormat: value => format(value, metric.unit),
            label: metric.label + ', ' + frequency + ' financial history. Use left and right arrow keys to inspect values; source details are in the table.',
            onInspect(point, series, state) { if (!point) return; inspectedDate = state.active ? point.date : null; readout.replaceChildren(node('strong', format(point.value, metric.unit) + (metric.unit === '%' ? '' : ' ' + metric.unit)), node('span', metric.label + ' · ' + (frequency === 'annual' ? 'FY ' : '') + point.period + ' · Ended ' + point.date)); }
        });
        $('#company-chart-caption').textContent = (metric.definition ? metric.definition + ' ' : '') + (frequency === 'ttm' ? 'Trailing year: four consecutive quarters; balances at period end. ' : 'Company fiscal calendar. ') + 'Missing periods remain gaps.';
    }
    function renderTable() {
        const table = $('#company-table'), periods = selectedPeriods(), rows = report.metrics.filter(m => m.section === section);
        const empty = $('#company-table-empty');
        const hasValues = rows.some(m => periods.some(p => m.values[p.id]));
        table.parentElement.hidden = !hasValues;
        empty.hidden = hasValues;
        empty.replaceChildren();
        if (!hasValues) {
            empty.append(node('p', 'No ' + (frequency === 'ttm' ? 'trailing-year' : frequency) + ' values for ' + report.sections[section].toLowerCase() + ' in this range.'));
            for (const [key, label] of [['annual', 'annual'], ['quarterly', 'quarterly'], ['ttm', 'trailing-year']]) {
                if (key !== frequency && rows.some(m => report.periods.some(p => p.frequency === key && m.values[p.id]))) {
                    empty.append(node('button', 'View ' + label + ' values', { type: 'button', 'data-frequency': key }));
                }
            }
            if ($('#company-range').value !== 'all' && rows.some(m => report.periods.some(p => p.frequency === frequency && m.values[p.id]))) {
                empty.append(node('button', 'Show all periods', { type: 'button', 'data-all-periods': '' }));
            }
        }
        const head = node('thead'), heading = node('tr'); heading.append(node('th', 'Metric', { scope: 'col' }));
        periods.forEach(p => {
            const label = p.label.replace(/^TTM /, ''), parts = label.split(' ');
            const cell = node('th', frequency === 'annual' ? label : parts[0], { scope: 'col', 'aria-label': (frequency === 'annual' ? 'FY ' : '') + p.label });
            if (parts.length > 1) { cell.append(document.createTextNode(' '), node('small', parts.slice(1).join(' '))); }
            heading.append(cell);
        });
        head.append(heading); const body = node('tbody');
        const groups = new Map();
        rows.forEach(metric => { const key = section === 'business' ? metric.axis || 'Other disclosures' : ''; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(metric); });
        groups.forEach((group, axis) => {
          if (axis) { const groupRow = node('tr', undefined, { class: 'company-table-group' }); groupRow.append(node('th', axis, { colspan: periods.length + 1 })); body.append(groupRow); }
          group.forEach(metric => {
            const row = node('tr'), label = node('th', metric.label, { scope: 'row' }); label.append(node('small', metric.unit)); row.append(label);
            periods.forEach(period => {
                const cell = node('td'), value = metric.values[period.id];
                cell.append(value ? node('button', format(value.value, metric.unit), { type: 'button', 'data-source-metric': metric.id, 'data-source-period': period.id, 'aria-label': metric.label + ', ' + period.label + ': ' + format(value.value, metric.unit) + '. View source' }) : node('span', '—', { 'aria-label': 'Unavailable' }));
                row.append(cell);
            });
            body.append(row);
          });
        });
        table.replaceChildren(node('caption', report.sections[section] + ', ' + frequency, { class: 'sr-only' }), head, body);
        $('#company-table-note').textContent = (frequency === 'ttm' ? 'Trailing-year values' : frequency === 'annual' ? 'Fiscal years' : 'Fiscal quarters') + ' · B = billion · M = million · K = thousand · — = unavailable' + (section === 'business' ? '. Disclosure groups overlap; do not add across groups.' : '');
    }
    workspace.addEventListener('click', event => {
        const frequencyButton = event.target.closest('[data-frequency]'), sectionButton = event.target.closest('[data-section]'), metricButton = event.target.closest('[data-chart-metric]');
        if (frequencyButton) { frequency = frequencyButton.dataset.frequency; workspace.querySelectorAll('.company-periods [data-frequency]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.frequency === frequency))); renderChart(); renderTable(); if (!frequencyButton.isConnected) $(`.company-periods [data-frequency="${frequency}"]`).focus({ preventScroll: true }); }
        if (event.target.closest('[data-all-periods]')) { $('#company-range').value = 'all'; renderChart(); renderTable(); $('#company-range').focus({ preventScroll: true }); }
        if (sectionButton) { section = sectionButton.dataset.section; workspace.querySelectorAll('[data-section]').forEach(b => b.setAttribute('aria-pressed', String(b === sectionButton))); renderTable(); }
        if (metricButton) { $('#company-metric').value = metricButton.dataset.chartMetric; renderChart(); }
        const sourceButton = event.target.closest('[data-source-metric]');
        if (sourceButton) {
            const metric = metrics.get(sourceButton.dataset.sourceMetric), pid = sourceButton.dataset.sourcePeriod, point = metric?.values[pid];
            if (!point) return;
            const content = $('#company-source-content'), period = report.periods.find(p => p.id === pid);
            $('#company-source-title').textContent = metric.label;
            content.replaceChildren(node('p', period.label + ' · ' + (point.start ? point.start + ' to ' : 'As of ') + point.end), node('strong', format(point.value, metric.unit, false) + ' ' + metric.unit), node('p', point.method));
            if (metric.axis) content.append(node('p', 'Disclosure axis: ' + metric.axis));
            if (metric.definition) content.append(node('p', metric.definition));
            const list = node('ol');
            point.sources.forEach(source => {
                const item = node('li'); item.append(node('a', source.form + ' · Filed ' + source.filed + ' ↗', { href: source.url, target: '_blank', rel: 'noopener noreferrer' }), node('small', source.tag), node('small', format(source.value, source.unit, false) + ' ' + source.unit + ' · ' + (source.start ? source.start + ' to ' : 'As of ') + source.end)); list.append(item);
            });
            content.append(list); $('#company-source').showModal();
        }
    });
    $('#company-source-close').addEventListener('click', () => $('#company-source').close());
    $('#company-metric').addEventListener('change', renderChart); $('#company-chart-type').addEventListener('change', renderChart);
    $('#company-range').addEventListener('change', () => { renderChart(); renderTable(); });
    const scheduleChart = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(renderChart); };
    new ResizeObserver(entries => { const width = entries[0].contentRect.width; if (width !== lastWidth) { lastWidth = width; scheduleChart(); } }).observe($('#company-chart'));
    new MutationObserver(scheduleChart).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    renderChart(); renderTable();
    const chat = $('#company-chat'), opener = $('#company-chat-open'), form = $('#company-chat-form'), question = $('#company-question');
    const desktop = window.matchMedia('(min-width:1100px)');
    let analysisScroll = 0;
    function showChat(open, focus = true) {
        if (open && chat.hidden && !desktop.matches) analysisScroll = window.scrollY;
        chat.hidden = !open;
        $('.company-report-layout').classList.toggle('conversation-open', open);
        opener.setAttribute('aria-expanded', String(open));
        if (!desktop.matches && focus) window.scrollTo({ top: open ? 0 : analysisScroll, behavior: 'instant' });
        if (focus) (open ? question : opener).focus({ preventScroll: true });
    }
    showChat(desktop.matches, false);
    desktop.addEventListener('change', () => showChat(desktop.matches, chat.contains(document.activeElement)));
    opener.addEventListener('click', () => showChat(chat.hidden)); $('#company-chat-close').addEventListener('click', () => showChat(false));
    chat.addEventListener('keydown', event => { if (event.key === 'Escape') showChat(false); });
    $('#company-provider').addEventListener('change', () => { const remote = $('#company-provider').value !== 'local'; $('#company-consent').hidden = !remote; form.elements.consent.required = remote; form.elements.consent.checked = false; });
    $('#company-new-topic').addEventListener('click', () => { form.elements.previous.value = ''; const status = $('#company-chat-status'); status.classList.remove('sr-only'); status.textContent = 'New topic. Name the metric you want to explore.'; question.focus(); });
    chat.addEventListener('click', event => { const suggestion = event.target.closest('[data-question]'); if (suggestion) { question.value = suggestion.dataset.question; question.focus(); } });
    function answerCharts() {
        chat.querySelectorAll('.company-answer-data').forEach(details => {
            if (details.dataset.bound) return; details.dataset.bound = 'true';
            const target = details.querySelector('.company-answer-chart'), calc = JSON.parse(target.dataset.calculation);
            let answerChart, answerFrame;
            const draw = () => {
                if (!details.open || !target.clientWidth) return;
                answerChart?.destroy();
                answerChart = window.BW.Visuals.timeSeries(target, [{ name: calc.metric, unit: calc.unit, gapDays: calc.frequency === 'annual' ? 390 : 115, points: calc.points.map(p => ({ date: p.end, value: p.value })) }], { height: 180, width: target.clientWidth, finance: true, yAxisPosition: 'right', yFormat: value => format(value, calc.unit), label: calc.metric + ' calculation history' });
            };
            const schedule = () => { cancelAnimationFrame(answerFrame); answerFrame = requestAnimationFrame(draw); };
            details.addEventListener('toggle', schedule);
            new ResizeObserver(schedule).observe(target);
            new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
        });
    }
    answerCharts();
    let asking = false;
    form.addEventListener('submit', async event => {
        event.preventDefault(); if (asking) return; asking = true;
        const button = form.querySelector('[type=submit]'), status = $('#company-chat-status'), data = new FormData(form), provider = $('#company-provider');
        button.disabled = true; question.readOnly = true; provider.disabled = true; status.classList.remove('sr-only'); status.textContent = 'Preparing your answer…';
        try {
            const result = await jsonFetch(form.action, { method: 'POST', body: data });
            $('#company-conversation').querySelector('.company-chat-intro')?.remove();
            const template = document.createElement('template'); template.innerHTML = result.html;
            $('#company-conversation').append(template.content); form.elements.previous.value = result.id; question.value = ''; form.elements.consent.checked = false;
            status.textContent = 'Answer saved.'; status.classList.add('sr-only'); answerCharts(); $('#company-conversation').scrollTop = $('#company-conversation').scrollHeight;
        } catch (error) { status.classList.remove('sr-only'); status.textContent = error.message; }
        finally { button.disabled = false; question.readOnly = false; provider.disabled = false; asking = false; question.focus(); }
    });
    question.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); } });
}());
