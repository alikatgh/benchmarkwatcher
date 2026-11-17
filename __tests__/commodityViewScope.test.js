/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

function loadCommodityScript() {
    const scriptPath = path.join(__dirname, '..', 'app', 'static', 'js', 'components', 'commodity.js');
    const code = fs.readFileSync(scriptPath, 'utf8');
    window.eval(code);
}

describe('Commodity chart view button scoping', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <button id="view-price" class="view-btn">Price</button>
            <button id="view-percent" class="view-btn">%</button>

            <button id="view-grid" class="view-btn keep-grid">Grid</button>
            <button id="view-compact" class="view-btn keep-compact">Compact</button>
        `;

        global.BW = {};
        loadCommodityScript();
    });

    test('updates only chart view buttons and does not mutate global settings view buttons', () => {
        const gridBefore = document.getElementById('view-grid').className;
        const compactBefore = document.getElementById('view-compact').className;

        BW.Commodity.currentViewMode = 'percent';
        BW.Commodity.updateViewButtons();

        const priceBtn = document.getElementById('view-price');
        const percentBtn = document.getElementById('view-percent');
        expect(priceBtn.className).toContain('view-btn');
        expect(percentBtn.className).toContain('theme-surface');

        expect(document.getElementById('view-grid').className).toBe(gridBefore);
        expect(document.getElementById('view-compact').className).toBe(compactBefore);
    });
});

describe('Global appearance updates the detail chart', () => {
    test('updates chart colors after applying the page theme without resetting other chart options', () => {
        document.body.innerHTML = `
            <div id="priceChart"></div>
            <button id="view-price" class="view-btn">Price</button>
            <button id="view-percent" class="view-btn">%</button>
        `;
        document.documentElement.removeAttribute('data-theme');
        document.documentElement.removeAttribute('data-theme-preference');
        document.documentElement.classList.remove('dark');
        localStorage.clear();
        Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'complete' });
        global.BW = {};
        // Use the actual page appearance path. D3 owns chartElement; the old
        // canvas ctx and a mocked applyTheme bypass the shared theme controller.
        ['base.js', 'core/settings.js', 'theme.js'].forEach(file => {
            window.eval(fs.readFileSync(path.join(__dirname, '..', 'app/static/js', file), 'utf8'));
        });
        loadCommodityScript();
        const commodity = BW.Commodity;
        commodity.chartElement = document.getElementById('priceChart');
        commodity.chartSettings.lineWidth = 4;
        commodity.updateChart = jest.fn();
        commodity.populateSettingsUI = jest.fn();
        commodity.applySettingsToDOM = jest.fn();
        commodity.saveChartSettings = jest.fn();
        window.eval(fs.readFileSync(path.join(__dirname, '..', 'app/static/js/components/settings_modal.js'), 'utf8'));
        BW.SettingsModal.updateUI = jest.fn();
        BW.SettingsModal.setTheme('dark');
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(commodity.chartSettings.lineColor).toBe(commodity.themes.dark.lineColor);
        expect(commodity.chartSettings.lineWidth).toBe(4);
        expect(commodity.updateChart).toHaveBeenCalled();
        commodity.currentViewMode = 'price';
        commodity.updateViewButtons();
        expect(document.getElementById('view-price').getAttribute('aria-pressed')).toBe('true');
    });
});
