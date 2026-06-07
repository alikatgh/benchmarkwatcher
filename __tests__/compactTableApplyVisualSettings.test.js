/**
 * @jest-environment jsdom
 *
 * Guards a structural-consistency bug in applyVisualSettings. The compact table
 * renders in two shapes:
 *   - server template: data-value lives ON .chg-cell / .pct-cell
 *   - JS re-render:     .chg-cell / .pct-cell are positioning WRAPPERS; data-value
 *                       moves to an inner div, with a tooltip as a sibling.
 * applyVisualSettings was written for the server shape, so after a range refresh
 * (JS shape) it read data-value off the wrapper, hit NaN, and silently skipped
 * percent rounding/decimals and the change colour. These tests pin both shapes.
 */

const fs = require('fs');
const path = require('path');

function loadCompactTableScript() {
    const code = fs.readFileSync(
        path.join(__dirname, '..', 'app', 'static', 'js', 'components', 'compact_table.js'),
        'utf8'
    );
    window.eval(code);
}

function setup(innerHTML) {
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' });
    document.body.innerHTML = `<table id="data-table"><tbody id="table-body">${innerHTML}</tbody></table>`;
    global.BW = {};
    loadCompactTableScript();
}

afterEach(() => { jest.restoreAllMocks(); });

describe('applyVisualSettings — percent rounding on both render shapes', () => {
    test('JS re-render shape: rounds to the configured decimals and keeps the tooltip', () => {
        setup(`
            <tr><td>
                <div class="pct-cell relative group/pct">
                    <div class="inline-flex px-2 py-1 rounded-lg" data-value="5.621805792163545">+5.621805792163545%</div>
                    <div class="pct-tooltip">range tooltip</div>
                </div>
            </td></tr>
        `);

        BW.CompactTable.applyVisualSettings({ pct: { style: 'badge', decimals: 2 } });

        const value = document.querySelector('.pct-cell [data-value]');
        expect(value.textContent).toBe('+5.62%');
        // The tooltip is a sibling of the value div — it must survive textContent.
        expect(document.querySelector('.pct-tooltip')).not.toBeNull();
    });

    test('JS re-render shape: honours a 0-decimals setting', () => {
        setup(`
            <tr><td><div class="pct-cell relative">
                <div class="inline-flex" data-value="5.62">+5.62%</div>
            </div></td></tr>
        `);

        // Form/select values arrive as strings; '0' is truthy so it is honoured.
        BW.CompactTable.applyVisualSettings({ pct: { style: 'plain', decimals: '0' } });

        expect(document.querySelector('.pct-cell [data-value]').textContent).toBe('+6%');
    });

    test('server shape: still rounds correctly (no regression)', () => {
        setup(`
            <tr><td>
                <div class="pct-cell inline-flex px-2 py-1 rounded-lg" data-value="1.0099">+1.0099%</div>
            </td></tr>
        `);

        BW.CompactTable.applyVisualSettings({ pct: { style: 'badge', decimals: 2 } });

        expect(document.querySelector('.pct-cell').textContent).toBe('+1.01%');
    });
});

describe('applyVisualSettings — change colour on the JS re-render shape', () => {
    test('neutral colour lands on the inner value element, not the wrapper', () => {
        setup(`
            <tr><td>
                <div class="chg-cell relative group/chg">
                    <div class="inline-flex" data-value="20" style="color: var(--color-up);">
                        <span class="chg-arrow">▲</span><span class="chg-value">+20</span>
                    </div>
                    <div class="chg-tooltip">tt</div>
                </div>
            </td></tr>
        `);

        BW.CompactTable.applyVisualSettings({ chg: { color: 'neutral', format: 'arrow' } });

        const valueEl = document.querySelector('.chg-cell [data-value]');
        expect(valueEl.classList.contains('text-brand-black-80')).toBe(true);
    });
});
