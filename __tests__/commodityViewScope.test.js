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
