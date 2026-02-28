/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

function loadGridViewScript() {
    const scriptPath = path.join(__dirname, '..', 'app', 'static', 'js', 'components', 'grid_view.js');
    const code = fs.readFileSync(scriptPath, 'utf8');
    window.eval(code);
}

describe('Grid frequency badge selector scoping', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <input id="grid-show-category" type="checkbox" checked />
            <input id="grid-show-change-pct" type="checkbox" checked />
            <input id="grid-show-change-abs" type="checkbox" checked />
            <input id="grid-show-date" type="checkbox" checked />
            <input id="grid-show-unit" type="checkbox" checked />
            <input id="grid-show-freq-badge" type="checkbox" />
            <select id="grid-columns"><option value="auto" selected>auto</option></select>
            <select id="grid-sort"><option value="name" selected>name</option></select>
            <select id="grid-card-style"><option value="card" selected>card</option></select>

            <div id="grid-cards-container">
                <span id="grid-freq" class="freq-badge">D</span>
            </div>

            <table id="data-table">
                <tbody>
                    <tr><td><span id="table-freq" class="freq-badge">M</span></td></tr>
                </tbody>
            </table>
        `;

        global.BW = {
            Settings: {
                getGridSettings: jest.fn(() => ({})),
                saveGridSettings: jest.fn(),
            },
        };

        loadGridViewScript();
    });

    test('updateSettings only toggles freq badges within grid container', () => {
        const checkbox = document.getElementById('grid-show-freq-badge');
        checkbox.checked = false;

        BW.GridView.updateSettings();

        expect(document.getElementById('grid-freq').style.display).toBe('none');
        expect(document.getElementById('table-freq').style.display).toBe('');
    });
});
