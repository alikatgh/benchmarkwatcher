/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../app/static/js/components/commodity.js'), 'utf8');

beforeAll(() => {
    window.BW = window.BW || {};
    window.eval(source);
});

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = `
      <section id="change-badge-section" data-pct1="-16.67" data-abs1="-2.5" data-pct30="" data-pct365="0" data-prev-price="15" data-currency="USD" data-date="2025-05-01" data-prev-date="2025-04-01">
        <div id="change-badge-bg"></div><span id="change-pct-display"></span><span id="change-arrow-display"></span>
        <span id="tooltip-change-line"></span><span id="change-period-label"></span><span id="change-tooltip-title"></span>
        <div id="tooltip-prev-row"></div><span id="tooltip-prev-label"></span><span id="tooltip-prev-price"></span>
        <button id="period-btn-1"></button><button id="period-btn-30"></button><button id="period-btn-365"></button>
      </section>`;
});

test('a negative historical change keeps its sign in the badge and tooltip', () => {
    window.setChangePeriod('1');
    expect(document.getElementById('change-pct-display').textContent).toBe('-16.67%');
    expect(document.getElementById('tooltip-change-line').textContent).toBe('-2.5 USD (-16.67%)');
});

test('an unavailable period stays unavailable when selected or restored', () => {
    window.setChangePeriod('30');
    expect(document.getElementById('change-pct-display').textContent).toBe('Unavailable');
    expect(document.getElementById('change-arrow-display').textContent).toBe('—');
    expect(document.getElementById('tooltip-change-line').textContent).toBe('Unavailable');
});

test('a real zero remains a value and missing previous observations are not copied as zero', () => {
    window.setChangePeriod('365');
    expect(document.getElementById('change-pct-display').textContent).toBe('+0.00%');
    const section = document.getElementById('change-badge-section');
    section.dataset.pct1 = ''; section.dataset.abs1 = ''; section.dataset.prevPrice = '';
    window.setChangePeriod('1');
    expect(document.getElementById('tooltip-change-line').textContent).toBe('Change unavailable');
    expect(document.getElementById('tooltip-prev-price').textContent).toBe('Unavailable');
});
