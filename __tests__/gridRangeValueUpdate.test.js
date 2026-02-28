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

describe('Grid range updates card change values', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      get: () => 'loading'
    });

    document.body.innerHTML = `<div id="grid-cards-container"></div>`;

    global.BW = {
      Settings: {
        getGridSettings: jest.fn(() => ({ dataRange: '1M' })),
        saveGridSettings: jest.fn()
      },
      Utils: {
        isDailyCommodity: jest.fn(() => false),
        escapeHtml: jest.fn((value) => String(value ?? '')),
      }
    };

    loadGridViewScript();
  });

  test('uses range-filtered history instead of static API change fields', () => {
    BW.GridView.updateCards([
      {
        id: 'aluminum',
        name: 'Aluminum',
        category: 'Metal',
        price: 130,
        currency: 'USD',
        unit: 'metric ton',
        date: '2026-01-01',
        change: 999,
        change_percent: 999,
        history: [
          { date: '2025-10-01', price: 100 },
          { date: '2025-12-01', price: 120 },
          { date: '2026-01-01', price: 130 },
        ]
      }
    ]);

    const pctText = document.querySelector('.bw-grid-change-pct')?.textContent || '';
    const absText = document.querySelector('.bw-grid-change-abs')?.textContent || '';

    expect(pctText).toContain('+8.33%');
    expect(absText).toContain('+10');
    expect(pctText).not.toContain('999');
  });
});
