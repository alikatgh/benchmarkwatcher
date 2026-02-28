/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

function loadCompactTableScript() {
    const scriptPath = path.join(__dirname, '..', 'app', 'static', 'js', 'components', 'compact_table.js');
    const code = fs.readFileSync(scriptPath, 'utf8');
    window.eval(code);
}

describe('Compact table frequency badge toggle', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <input id="table-show-freq-badge" type="checkbox" checked />
            <table id="data-table">
                <tbody id="table-body">
                    <tr>
                        <td><span class="freq-badge">D</span></td>
                    </tr>
                </tbody>
            </table>
        `;

        global.BW = {};

        loadCompactTableScript();

        jest.spyOn(BW.CompactTable, 'getSettings').mockReturnValue({});
        jest.spyOn(BW.CompactTable, 'saveSettings').mockImplementation(() => {});
    });

    test('hides badges and persists setting when unchecked', () => {
        const checkbox = document.getElementById('table-show-freq-badge');
        checkbox.checked = false;

        window.toggleFreqBadge();

        const badge = document.querySelector('.freq-badge');
        expect(badge.style.display).toBe('none');
        expect(BW.CompactTable.saveSettings).toHaveBeenCalledWith({ showFreqBadge: false });
    });

    test('shows badges and persists setting when checked', () => {
        const checkbox = document.getElementById('table-show-freq-badge');
        checkbox.checked = true;

        window.toggleFreqBadge();

        const badge = document.querySelector('.freq-badge');
        expect(badge.style.display).toBe('');
        expect(BW.CompactTable.saveSettings).toHaveBeenCalledWith({ showFreqBadge: true });
    });
});
