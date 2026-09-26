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

  test.each(['minimal', 'dense', 'card'])('preserves %s style, hidden fields and sorting after refresh', (cardStyle) => {
    document.body.insertAdjacentHTML('afterbegin', `
      <input id="grid-show-category" type="checkbox" checked />
      <input id="grid-show-change-pct" type="checkbox" checked />
      <input id="grid-show-change-abs" type="checkbox" checked />
      <input id="grid-show-date" type="checkbox" checked />
      <input id="grid-show-unit" type="checkbox" checked />
      <input id="grid-show-freq-badge" type="checkbox" checked />
      <select id="grid-columns"><option value="2">2</option></select>
      <select id="grid-sort"><option value="price-desc">Price descending</option></select>
      <select id="grid-card-style">
        <option value="card">Full Card</option>
        <option value="minimal">Minimal Row</option>
        <option value="dense">Dense Grid</option>
      </select>
    `);
    const settings = { dataRange: '1M' };
    BW.Settings.getGridSettings.mockReturnValue(settings);
    const commodities = [
      { id: 'aluminum', name: 'Aluminum', price: 130 },
      { id: 'gold', name: 'Gold', price: 2000 }
    ].map(commodity => ({
      ...commodity,
      category: 'Metal',
      currency: 'USD',
      unit: 'metric ton',
      date: '2026-01-01',
      change: 10,
      change_percent: 1
    }));

    BW.GridView.updateCards(commodities);
    document.getElementById('grid-card-style').value = cardStyle;
    document.querySelectorAll('input:not(#grid-show-freq-badge)').forEach(input => {
      input.checked = false;
    });
    BW.GridView.updateSettings();

    const container = document.getElementById('grid-cards-container');
    const selectedCard = container.querySelector('.bw-grid-card');
    const expectedCardClass = selectedCard.className;
    const expectedDisplay = selectedCard.style.display;

    settings.dataRange = '1W';
    BW.GridView.updateCards(commodities.map(commodity => ({ ...commodity, price: commodity.price + 5 })));

    const cards = Array.from(container.querySelectorAll('a.block.group'));
    expect(cards.map(card => card.dataset.id)).toEqual(['gold', 'aluminum']);
    expect(cards.map(card => card.dataset.price)).toEqual(['2005', '135']);
    cards.forEach(card => {
      expect(card.querySelector('.bw-grid-card').className).toBe(expectedCardClass);
      expect(card.querySelector('.bw-grid-card').style.display).toBe(expectedDisplay);
      ['.bw-grid-category-row', '.bw-grid-change-pct', '.bw-grid-change-abs', '.bw-grid-unit', '.bw-grid-footer'].forEach(selector => {
        expect(card.querySelector(selector).style.display).toBe('none');
      });
    });
    expect(document.getElementById('grid-card-style').value).toBe(cardStyle);
    expect(settings.dataRange).toBe('1W');
  });
});
