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

describe('Commodity chart settings UI parity', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="chart-settings-modal" class="hidden" aria-hidden="true">
                <button id="tab-appearance" class="chart-settings-tab"></button>
                <button id="tab-tooltip" class="chart-settings-tab"></button>

                <div id="content-appearance" class="chart-settings-content"></div>
                <div id="content-tooltip" class="chart-settings-content hidden"></div>

                <button class="theme-preset border-brand-black-60/10" data-theme="light"></button>
                <button class="theme-preset border-brand-black-60/10" data-theme="dark"></button>
            </div>
        `;

        global.BW = {};
        loadCommodityScript();

        BW.Commodity.chartSettings = {
            ...BW.Commodity.chartSettings,
            chartTheme: 'dark',
        };
    });

    test('populateSettingsUI re-applies active theme preset indicator', () => {
        BW.Commodity.populateSettingsUI();

        const darkBtn = document.querySelector('.theme-preset[data-theme="dark"]');
        const lightBtn = document.querySelector('.theme-preset[data-theme="light"]');

        expect(darkBtn.classList.contains('border-brand-oxford')).toBe(true);
        expect(darkBtn.getAttribute('aria-pressed')).toBe('true');
        expect(lightBtn.getAttribute('aria-pressed')).toBe('false');
    });

    test('openChartSettings restores last active tab', () => {
        BW.Commodity.showChartSettingsTab('tooltip');

        BW.Commodity.openChartSettings();

        expect(BW.Commodity.activeSettingsTab).toBe('tooltip');
        expect(document.getElementById('content-tooltip').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('content-appearance').classList.contains('hidden')).toBe(true);
    });
});
