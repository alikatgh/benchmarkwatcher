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
});
