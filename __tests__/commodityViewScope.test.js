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
        global.BW = {};
        loadCommodityScript();
        const commodity = BW.Commodity;
        commodity.ctx = {};
        commodity.chartSettings.lineWidth = 4;
        commodity.updateChart = jest.fn();
        commodity.populateSettingsUI = jest.fn();
        commodity.applySettingsToDOM = jest.fn();
        commodity.saveChartSettings = jest.fn();
        window.eval(fs.readFileSync(path.join(__dirname, '..', 'app/static/js/components/settings_modal.js'), 'utf8'));
        BW.SettingsModal.applyTheme = jest.fn(() => document.documentElement.setAttribute('data-theme', 'dark'));
        BW.SettingsModal.updateUI = jest.fn();
        BW.SettingsModal.setTheme('dark');
        expect(commodity.chartSettings.lineColor).toBe(commodity.themes.dark.lineColor);
        expect(commodity.chartSettings.lineWidth).toBe(4);
        expect(commodity.updateChart).toHaveBeenCalled();
        commodity.currentViewMode = 'price';
        commodity.updateViewButtons();
        expect(document.getElementById('view-price').getAttribute('aria-pressed')).toBe('true');
    });
});
