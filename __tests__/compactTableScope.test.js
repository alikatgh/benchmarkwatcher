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

describe('Compact table selector scoping', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <table id="data-table">
                <tbody>
                    <tr>
                        <td data-col="price"><div id="table-price" class="price-value" data-raw="1000">1000</div></td>
                        <td data-col="pct"><div class="pct-cell" data-value="1.234">+1.23%</div></td>
                    </tr>
                </tbody>
            </table>

            <div id="outside-scope">
                <div id="external-price" class="price-value" data-raw="9999">9999</div>
                <div id="external-pct" class="pct-cell" data-value="9.99">+9.99%</div>
            </div>
        `;

        global.BW = {};
        loadCompactTableScript();
    });

    test('applyVisualSettings mutates only table-scoped cells', () => {
        BW.CompactTable.applyVisualSettings({
            commodity: { display: 'full' },
            price: { format: 'thousands', precision: '2', currency: 'below' },
            chg: { format: 'arrow', color: 'colored' },
            pct: { style: 'badge', decimals: '1' },
            updated: { format: 'iso' },
        });

        expect(document.getElementById('table-price').textContent).toBe('1,000.00');
        expect(document.getElementById('external-price').textContent).toBe('9999');

        // External pct should remain untouched (no badge classes added/removed by table apply pass)
        expect(document.getElementById('external-pct').textContent).toBe('+9.99%');
    });

    test('applyColumnVisibility only affects data-table cells', () => {
        const external = document.createElement('div');
        external.setAttribute('data-col', 'price');
        external.id = 'external-col-price';
        document.body.appendChild(external);

        BW.CompactTable.applyColumnVisibility('price', false);

        expect(document.querySelector('#data-table [data-col="price"]').style.display).toBe('none');
        expect(document.getElementById('external-col-price').style.display).toBe('');
    });
});
