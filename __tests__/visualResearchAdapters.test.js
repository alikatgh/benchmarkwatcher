/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const companySource = read('app/static/js/components/company_research.js');
const researchSource = read('app/static/js/components/research_workspace.js');
const researchMarkup = read('app/templates/components/research_workspace.html');
const builderSource = read('app/static/js/components/visual_builder.js');
const filing = { form: '10-K', filed: '2025-03-01', tag: 'us-gaap:Revenue', url: 'https://www.sec.gov/Archives/example', value: 7, unit: 'USD', end: '2024-12-28' };
const calculation = { company: 'Example Inc', metric_id: 'revenue', metric: 'Revenue', unit: 'USD', frequency: 'annual', operation: 'series', basis: 'Historical filed evidence.', points: [{ period: 'FY 2024', end: '2024-12-28', value: 7, method: 'Reported', sources: [filing] }, { period: 'FY 2025', end: '2025-12-27', value: null, method: 'Unavailable', sources: [] }] };
const answerMarkup = calc => '<details class="company-answer-data"><summary>Revenue</summary><div class="company-answer-chart" data-calculation="' + JSON.stringify(calc).replaceAll('&', '&amp;').replaceAll('"', '&quot;') + '"></div></details>';
let open, normalizeGraphic;

function bootCompany() {
    const annual = Array.from({ length: 7 }, (_, i) => ({ id: 'FY' + (2019 + i), label: 'Fiscal ' + (2019 + i), frequency: 'annual', end: (2019 + i) + '-12-28' }));
    const report = { cik: '1', company: 'Example Inc', checked: '2026-01-10T00:00:00Z', sections: { income: 'Income statement' }, basis: 'Historical SEC evidence. Missing disclosures are never zero-filled.', periods: [...annual, { id: 'Q1', label: 'Q1 2025', frequency: 'quarterly', end: '2025-03-29' }], metrics: [{ id: 'revenue', label: 'Revenue', unit: 'USD', section: 'income', definition: 'Reported revenue.', values: { FY2019: { value: 1, method: 'Reported', sources: [filing] }, FY2024: { value: 7, method: 'Reported', sources: [filing] }, Q1: { value: 0, method: 'Derived quarter', sources: [filing] } } }, { id: 'margin', label: 'Margin', unit: '%', section: 'income', values: { Q1: { value: 2, method: 'Calculated ratio', sources: [filing] } } }] };
    document.body.innerHTML = `<div data-company-workspace><input name="csrf" value="token"><div class="company-report-layout"></div>
        <div class="company-chart-toolbar"><div class="company-periods"><button data-frequency="annual">Annual</button><button data-frequency="quarterly">Quarterly</button></div><select id="company-range"><option value="recent">Recent</option><option value="all">All</option></select></div>
        <select id="company-metric"><option value="revenue">Revenue</option><option value="margin">Margin</option></select><select id="company-chart-type"><option value="line">Line</option><option value="area">Area</option></select>
        <div id="company-chart"></div><div id="company-chart-readout"></div><p id="company-chart-caption"></p><div><table id="company-table"></table></div><div id="company-table-empty"></div><p id="company-table-note"></p>
        <dialog id="company-source"><button id="company-source-close"></button><h2 id="company-source-title"></h2><div id="company-source-content"></div></dialog><button id="company-chat-open"></button>
        <aside id="company-chat"><button id="company-chat-close"></button><div id="company-conversation">${answerMarkup(calculation)}</div><form id="company-chat-form" action="/ask"><input name="previous"><input name="consent" type="checkbox"><select id="company-provider"><option value="local">Local</option></select><div id="company-consent"></div><textarea id="company-question" name="question"></textarea><button id="company-new-topic" type="button"></button><button type="submit">Send</button></form><p id="company-chat-status"></p></aside>
        <script id="company-report-data" type="application/json">${JSON.stringify(report)}</script></div>`;
    window.eval(companySource);
    return report;
}
function bootResearch() { document.body.innerHTML = researchMarkup; window.eval(researchSource); return window.BW.ResearchWorkspace; }
function clickGraphic(host) { host.querySelector('.bw-create-graphic').click(); return open.mock.calls.at(-1)[0]; }
function observationCount(spec) { const normalized = normalizeGraphic(spec); return normalized.rows.length + normalized.series.reduce((count, series) => count + series.points.length, 0); }

beforeEach(() => {
    jest.useFakeTimers(); localStorage.clear();
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
    window.ResizeObserver = class { observe() {} disconnect() {} };
    window.MutationObserver = class { observe() {} disconnect() {} };
    window.requestAnimationFrame = jest.fn(() => 1); window.cancelAnimationFrame = jest.fn();
    window.matchMedia = jest.fn(() => ({ matches: false, addEventListener() {} })); window.scrollTo = jest.fn();
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    open = jest.fn();
    window.BW = { VisualBuilder: { open }, Visuals: { numeric: value => typeof value === 'number' && Number.isFinite(value) ? value : null, timeSeries: jest.fn(() => ({ destroy: jest.fn() })) }, VisualBuilderSources: { attach: jest.fn((host, spec) => {
        if (!host._graphicButton) { const button = document.createElement('button'); button.type = 'button'; button.className = 'bw-create-graphic'; button.textContent = 'Create graphic'; button.addEventListener('click', () => open(typeof host._graphicSpec === 'function' ? host._graphicSpec() : host._graphicSpec)); host.append(button); host._graphicButton = button; }
        host._graphicSpec = spec; return host._graphicButton;
    }) } };
    window.eval(builderSource); normalizeGraphic = window.BW.VisualBuilder.normalize; window.BW.VisualBuilder.open = open;
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); delete window.fetch; });

test('company report graphics read the current metric, frequency and range with fiscal labels and filing evidence', () => {
    bootCompany(); const host = document.querySelector('.company-chart-toolbar');
    let spec = clickGraphic(host);
    expect(spec.series[0].points).toHaveLength(6);
    expect(spec.rows).toBeUndefined(); expect(observationCount(spec)).toBe(6);
    expect(spec.series[0].gapDays).toBe(390);
    expect(spec.series[0].points.at(-1)).toMatchObject({ period: 'Fiscal 2025', value: null, status: 'Unavailable' });
    expect(spec.series[0].points.at(-2).source).toContain(filing.url);
    expect(spec.series[0].sourceUrl).toBe(filing.url);
    const range = document.getElementById('company-range'); range.value = 'all'; range.dispatchEvent(new Event('change'));
    expect(clickGraphic(host).series[0].points).toHaveLength(7);
    document.querySelector('[data-frequency="quarterly"]').click();
    spec = clickGraphic(host);
    expect(spec.series[0]).toMatchObject({ frequency: 'quarterly', gapDays: 115 });
    expect(spec.series[0].points[0]).toMatchObject({ value: 0, period: 'Q1 2025', status: 'Derived quarter' });
    document.getElementById('company-metric').value = 'margin'; document.getElementById('company-metric').dispatchEvent(new Event('change'));
    document.getElementById('company-chart-type').value = 'area';
    expect(clickGraphic(host)).toMatchObject({ title: 'Example Inc · Margin', unit: '%', type: 'area' });
    expect(host.querySelectorAll('.bw-create-graphic')).toHaveLength(1);
});

test('saved and dynamically inserted company answers open graphics from their own calculation evidence', async () => {
    bootCompany(); let spec = clickGraphic(document.querySelector('.company-answer-graphics'));
    expect(spec.series[0].points).toMatchObject([{ date: '2024-12-28', period: 'FY 2024', value: 7 }, { date: '2025-12-27', period: 'FY 2025', value: null }]);
    expect(spec.notes).toContain('Historical filed evidence.');
    expect(spec.series[0].points[0].source).toContain(filing.url);
    expect(spec.rows).toBeUndefined(); expect(observationCount(spec)).toBe(2);
    window.AbortSignal.timeout = jest.fn(() => new AbortController().signal);
    window.fetch = jest.fn(async () => ({ ok: true, redirected: false, headers: { get: () => 'application/json' }, json: async () => ({ id: 'answer-2', html: answerMarkup({ ...calculation, metric: 'New answer metric', unit: '%', points: [{ ...calculation.points[0], value: 12.345678 }] }) }) }));
    document.getElementById('company-chat-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await jest.advanceTimersByTimeAsync(0);
    expect(document.querySelectorAll('.company-answer-graphics')).toHaveLength(2);
    spec = clickGraphic(document.querySelectorAll('.company-answer-graphics')[1]);
    expect(spec.title).toBe('Example Inc · New answer metric');
    expect(spec.series[0].points[0]).toMatchObject({ value: 12.345678, display_value: '12.345678', period: 'FY 2024', sourceUrl: filing.url });
    expect(normalizeGraphic(spec).series[0].points[0].display_value).toBe('12.345678');
});

test('Research groups compatible immutable snapshots and offers only numeric properties without drafts', () => {
    const research = bootResearch();
    research.state.properties.push({ id: 'p_lag', name: 'Reporting lag', type: 'number', unit: 'days' }, { id: 'p_cost', name: 'Cost', type: 'number', unit: 'USD/t' }, { id: 'p_text', name: 'Text number', type: 'text', unit: '' });
    const snapshot = { id: 'copper', name: 'Copper', unit: 'USD/t', currency: 'USD', date: '2026-01-01', source: 'Public source', sourceUrl: 'https://example.com/source', price: 0 };
    const first = research.createEntry(snapshot), second = research.createEntry({ ...snapshot, date: '2026-02-01', price: null }), other = research.createEntry({ ...snapshot, id: 'copper-eur', name: 'Copper EUR', unit: 'EUR/t', currency: 'EUR', price: 8 });
    first.title = 'January'; first.values = { p_lag: 2, p_cost: 30, p_text: '99' }; first.citations = 'https://example.com/personal\njavascript:alert(1)';
    second.title = 'February'; second.values = { p_lag: 12.5 }; second.drafts = { p_lag: '-' };
    other.title = 'Other unit'; other.values = { p_lag: 4 }; other.status = 'Reviewed';
    research.state.entries.push(first, second, other); research.scheduleSave(); research.flush(); research.render();
    const host = document.querySelector('.rw-toolbar-actions'), spec = clickGraphic(host);
    expect(spec.datasets.filter(dataset => dataset.source === 'Read-only linked benchmark snapshots')).toHaveLength(2);
    const copper = spec.datasets.find(dataset => dataset.title === 'Copper · Research snapshots');
    expect(copper.unit).toBe('USD/t');
    expect(copper.series[0].points).toEqual(expect.arrayContaining([expect.objectContaining({ date: '2026-01-01', value: 0 }), expect.objectContaining({ date: '2026-02-01', value: null })]));
    expect(copper.series[0].sourceUrl).toBe('https://example.com/source');
    expect(copper.rows).toBeUndefined(); expect(observationCount(copper)).toBe(2);
    const lag = spec.datasets.find(dataset => dataset.name === 'Reporting lag · days');
    expect(lag.type).toBe('ranking');
    expect(lag.series).toBeUndefined(); expect(observationCount(lag)).toBe(3);
    expect(lag.rows.find(row => row.label === 'February')).toMatchObject({ value: null, period: '2026-02-01', status: 'Numeric draft excluded' });
    expect(lag.rows.find(row => row.label === 'January').source).toContain('https://example.com/personal');
    expect(lag.rows.find(row => row.label === 'January').source).not.toContain('javascript:');
    expect(lag.notes).toContain('your own values and assumptions');
    expect(spec.datasets.some(dataset => dataset.name.includes('Text number'))).toBe(false);
    research.updateView({ status: 'Reviewed' });
    expect(clickGraphic(host).datasets.find(dataset => dataset.name === 'Reporting lag · days').rows).toHaveLength(1);
    expect(host.querySelectorAll('.bw-create-graphic')).toHaveLength(1);
    expect(document.querySelector('#rw-table-body .bw-create-graphic')).toBeNull();
});

test('Research numeric drafts alone cannot enable a graphic, and missing optional builder leaves existing behavior intact', () => {
    const research = bootResearch();
    research.state.properties.push({ id: 'p_number', name: 'Number', type: 'number', unit: '' });
    const entry = research.createEntry(); entry.values.p_number = 12; entry.drafts.p_number = '-'; research.state.entries.push(entry); research.render();
    expect(document.querySelector('.rw-toolbar-actions .bw-create-graphic').disabled).toBe(true);
    delete window.BW.VisualBuilderSources;
    expect(() => research.render()).not.toThrow();
    delete window.BW.ResearchWorkspace;
    expect(() => bootCompany()).not.toThrow();
});
