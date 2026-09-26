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
        Object.defineProperty(document, 'readyState', {
            configurable: true,
            get: () => 'loading'
        });

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

describe('Compact table CSV export helpers', () => {
    beforeEach(() => {
        Object.defineProperty(document, 'readyState', {
            configurable: true,
            get: () => 'loading'
        });

        document.body.innerHTML = `
            <table id="data-table">
                <tbody>
                    <tr data-currency="USD">
                        <td><div class="commodity-name">Gold</div><div class="commodity-category">Precious</div></td>
                        <td><div class="price-value" data-raw="2000"></div><div class="price-currency">USD</div></td>
                        <td><div class="chg-cell" data-value="20"></div></td>
                        <td><div class="pct-cell" data-value="1.01"></div></td>
                        <td><div class="updated-cell" data-raw="2024-01-10"></div></td>
                    </tr>
                    <tr class="quick-find-hidden" style="display: none;" data-currency="USD">
                        <td><div class="commodity-name">Corn</div><div class="commodity-category">Agriculture</div></td>
                        <td><div class="price-value" data-raw="4.2"></div><div class="price-currency">USD</div></td>
                        <td><div class="chg-cell" data-value="-0.1"></div></td>
                        <td><div class="pct-cell" data-value="-2.33"></div></td>
                        <td><div class="updated-cell" data-raw="2024-01-09"></div></td>
                    </tr>
                </tbody>
            </table>
        `;

        global.BW = {};
        loadCompactTableScript();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('uses only rows visible after quick find', () => {
        const rows = BW.CompactTable.getExportRows(document.getElementById('data-table'));

        expect(rows).toHaveLength(1);
        expect(rows[0].querySelector('.commodity-name').textContent).toBe('Gold');
    });

    test('builds escaped CSV content with row currency', () => {
        const rows = BW.CompactTable.getExportRows(document.getElementById('data-table'));
        const csv = BW.CompactTable.buildCsvContent(rows);

        expect(csv).toContain('Commodity,Category,Price,Currency,Change,Change %,Date');
        expect(csv).toContain('"Gold","Precious","2000","USD","20","1.01","2024-01-10"');
        expect(csv).not.toContain('Corn');
    });

    test('exports AJAX-refreshed rows that only have data-date', () => {
        const updatedCell = document.querySelector('.updated-cell');
        updatedCell.removeAttribute('data-raw');
        updatedCell.dataset.date = '2024-01-10';

        const rows = BW.CompactTable.getExportRows(document.getElementById('data-table'));
        const csv = BW.CompactTable.buildCsvContent(rows);

        expect(csv).toContain('"Gold","Precious","2000","USD","20","1.01","2024-01-10"');
    });

    test.each([
        [20, 1.01, '+20', '+1.01'],
        [-20, -1.01, '-20', '-1.01'],
        [0, 0, '0', '0']
    ])('exports change values after rebuilding rows (%s, %s)', (change, changePercent, expectedChange, expectedPercent) => {
        const utilsPath = path.join(__dirname, '..', 'app', 'static', 'js', 'core', 'utils.js');
        window.eval(fs.readFileSync(utilsPath, 'utf8'));
        jest.spyOn(BW.CompactTable, 'getSettings').mockReturnValue({
            ...BW.CompactTable.defaultSettings,
            chg: { format: 'plain', color: 'neutral' },
            pct: { style: 'plain', decimals: '0' }
        });
        jest.spyOn(BW.CompactTable, 'initSparklines').mockImplementation(() => {});

        BW.CompactTable.updateTableData([{
            id: 'gold',
            name: 'Gold',
            category: 'Precious',
            price: 2000,
            currency: 'USD',
            date: '2024-01-10',
            change,
            change_percent: changePercent
        }]);

        const rows = BW.CompactTable.getExportRows(document.getElementById('data-table'));
        const csv = BW.CompactTable.buildCsvContent(rows);

        expect(csv).toContain(`"Gold","PRECIOUS","2000","USD","${expectedChange}","${expectedPercent}","2024-01-10"`);
    });

    test('leaves missing change values empty in the export', () => {
        document.querySelector('.chg-cell').removeAttribute('data-value');
        document.querySelector('.pct-cell').removeAttribute('data-value');

        const rows = BW.CompactTable.getExportRows(document.getElementById('data-table'));
        const csv = BW.CompactTable.buildCsvContent(rows);

        expect(csv).toContain('"Gold","Precious","2000","USD","","","2024-01-10"');
    });
});
