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

describe('Commodity chart settings selector scoping', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="chart-settings-modal">
                <button id="tab-appearance" class="chart-settings-tab">A</button>
                <button id="tab-tooltip" class="chart-settings-tab">T</button>
                <div id="content-appearance" class="chart-settings-content">A</div>
                <div id="content-tooltip" class="chart-settings-content hidden">T</div>
                <button class="theme-preset border-brand-black-60/10" data-theme="light">Light</button>
                <button class="theme-preset border-brand-black-60/10" data-theme="dark">Dark</button>
            </div>

            <div id="outside-scope">
                <button id="external-tab" class="chart-settings-tab keep-external">External Tab</button>
                <button id="external-theme" class="theme-preset keep-theme border-brand-black-60/10" data-theme="dark">External Theme</button>
            </div>
        `;

        global.BW = {};
        loadCommodityScript();
    });

    test('showChartSettingsTab does not mutate external chart-settings-tab elements', () => {
        const before = document.getElementById('external-tab').className;

        BW.Commodity.showChartSettingsTab('tooltip');

        expect(document.getElementById('external-tab').className).toBe(before);
        expect(document.getElementById('content-tooltip').classList.contains('hidden')).toBe(false);
    });

    test('syncThemePresetUI does not mutate external theme-preset elements', () => {
        BW.Commodity.chartSettings = {
            ...BW.Commodity.chartSettings,
            chartTheme: 'dark',
        };

        const before = document.getElementById('external-theme').className;

        BW.Commodity.syncThemePresetUI();

        expect(document.getElementById('external-theme').className).toBe(before);
        const scopedDark = document.querySelector('#chart-settings-modal .theme-preset[data-theme="dark"]');
        expect(scopedDark.getAttribute('aria-pressed')).toBe('true');
    });
});
