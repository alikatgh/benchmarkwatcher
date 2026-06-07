/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

function loadIndexScript() {
  const scriptPath = path.join(__dirname, '..', 'app', 'static', 'js', 'components', 'index.js');
  const code = fs.readFileSync(scriptPath, 'utf8');
  window.eval(code);
}

describe('Index view mode normalization', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="index-page-state" data-active-view=""></div>
      <div id="grid-view"></div>
      <div id="compact-view" class="hidden"></div>
      <button id="view-grid"></button>
      <button id="view-compact"></button>
      <span id="view-indicator"></span>
    `;

    global.BW = {
      Responsive: { autoApply: jest.fn() },
      Settings: {
        getViewMode: jest.fn(),
        setViewMode: jest.fn()
      }
    };

    loadIndexScript();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('falls back to grid when stored/server view is invalid', () => {
    BW.Settings.getViewMode.mockReturnValue('weird-mode');

    BW.Index.init();

    expect(BW.Settings.setViewMode).toHaveBeenCalledWith('grid');
    expect(document.getElementById('grid-view').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('compact-view').classList.contains('hidden')).toBe(true);
  });

  test('valid explicit query view takes precedence', () => {
    BW.Settings.getViewMode.mockReturnValue('grid');

    const originalHref = window.location.href;
    window.history.pushState({}, '', '/?view=compact');

    BW.Index.init();

    expect(BW.Settings.setViewMode).toHaveBeenCalledWith('compact');
    expect(document.getElementById('compact-view').classList.contains('hidden')).toBe(false);

    window.history.pushState({}, '', originalHref);
  });
});

describe('Index market pulse summary', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="market-pulse-headline"></div>
      <div id="market-pulse-range"></div>
      <span id="market-pulse-total"></span>
      <span id="market-pulse-up"></span>
      <span id="market-pulse-down"></span>
      <span id="market-pulse-breadth"></span>
      <span id="market-pulse-flat"></span>
      <span id="market-pulse-latest-date"></span>
      <span id="market-pulse-latest-count"></span>
      <span id="market-pulse-daily"></span>
      <span id="market-pulse-monthly"></span>
      <a id="market-pulse-all-link"></a>
      <div id="market-pulse-movers"></div>
      <div id="market-pulse-categories"></div>
    `;

    global.BW = {
      Utils: { isDailyCommodity: commodity => commodity.is_daily === true },
      Responsive: { autoApply: jest.fn() },
      Settings: {
        getViewMode: jest.fn().mockReturnValue('grid'),
        setViewMode: jest.fn()
      }
    };

    loadIndexScript();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('summarizes commodity arrays and updates mover links', () => {
    BW.Index.updateMarketPulse([
      {
        id: 'gold',
        name: 'Gold',
        category: 'precious',
        change_percent: 2.345,
        change: 45,
        date: '2024-01-10',
        is_daily: true
      },
      {
        id: 'corn',
        name: 'Corn',
        category: 'agricultural',
        change_percent: -1.2,
        change: -0.05,
        date: '2024-01-09',
        is_daily: false
      }
    ], { range: '1M' });

    expect(document.getElementById('market-pulse-headline').textContent).toBe('Benchmarks were evenly split');
    expect(document.getElementById('market-pulse-range').textContent).toBe('Recent observations');
    expect(document.getElementById('market-pulse-total').textContent).toBe('2');
    expect(document.getElementById('market-pulse-up').textContent).toBe('1');
    expect(document.getElementById('market-pulse-down').textContent).toBe('1');
    expect(document.getElementById('market-pulse-breadth').textContent).toBe('50');
    expect(document.getElementById('market-pulse-flat').textContent).toBe('0');
    expect(document.getElementById('market-pulse-latest-date').textContent).toBe('2024-01-10');
    expect(document.getElementById('market-pulse-daily').textContent).toBe('1');
    expect(document.getElementById('market-pulse-monthly').textContent).toBe('1');
    const riseLink = document.getElementById('market-pulse-rise-link');
    expect(riseLink.getAttribute('href')).toBe('/commodity/gold');
    expect(riseLink.textContent).toContain('Gold');
    expect(riseLink.textContent).toContain('+2.35%');
    const dropLink = document.getElementById('market-pulse-drop-link');
    expect(dropLink.getAttribute('href')).toBe('/commodity/corn');
    expect(dropLink.textContent).toContain('Corn');
    expect(dropLink.textContent).toContain('-1.2%');
    expect(document.querySelectorAll('#market-pulse-categories a')).toHaveLength(2);
    expect(document.querySelector('#market-pulse-categories a').textContent).toContain('Agriculture');
    expect(document.querySelector('#market-pulse-categories a').textContent).toContain('0 / 0 / 1');
    expect(document.querySelector('#market-pulse-categories [aria-label]').getAttribute('aria-label')).toContain('distribution');
    expect(document.getElementById('market-pulse-all-link').getAttribute('href')).toBe('/?range=1M&view=grid');
  });

  test('uses API summary payloads without recomputing them', () => {
    BW.Index.updateMarketPulse({
      total: 7,
      up_count: 5,
      down_count: 2,
      flat_count: 0,
      breadth_percent: 71.4,
      daily_count: 3,
      monthly_count: 4,
      latest_date: '2024-02-01',
      latest_count: 6,
      headline: 'More benchmarks rose than fell',
      biggest_up: null,
      biggest_down: null,
      categories: [
        {
          slug: 'energy',
          name: 'Energy',
          total: 3,
          up_count: 2,
          down_count: 1,
          flat_count: 0,
          breadth_percent: 66.7,
          flat_percent: 0,
          down_percent: 33.3
        }
      ]
    }, { range: 'ALL' });

    expect(document.getElementById('market-pulse-headline').textContent).toBe('More benchmarks rose than fell');
    expect(document.getElementById('market-pulse-total').textContent).toBe('7');
    expect(document.getElementById('market-pulse-breadth').textContent).toBe('71.4');
    expect(document.getElementById('market-pulse-movers').textContent).toContain('No positive moves');
    expect(document.getElementById('market-pulse-movers').textContent).toContain('No negative moves');
    expect(document.getElementById('market-pulse-rise-link')).toBeNull();
    expect(document.querySelector('#market-pulse-categories a').getAttribute('href')).toBe('/?category=energy&range=ALL&view=grid');
  });

  test('builds category links from the current view before settings fallback', () => {
    const originalHref = window.location.href;

    try {
      BW.Settings.getViewMode.mockReturnValue('grid');
      window.history.pushState({}, '', '/?view=compact&range=1M');

      expect(BW.Index.buildCategoryUrl('energy', '1M')).toBe('/?category=energy&range=1M&view=compact');

      window.history.pushState({}, '', '/?range=1M');
      expect(BW.Index.buildCategoryUrl('precious', 'ALL')).toBe('/?category=precious&range=ALL&view=grid');
    } finally {
      window.history.pushState({}, '', originalHref);
    }
  });

  test('keeps clear-filter and active category links in sync after live updates', () => {
    const originalHref = window.location.href;

    try {
      window.history.pushState({}, '', '/?category=energy&range=ALL&view=compact');

      BW.Index.updateMarketPulse({
        total: 3,
        up_count: 2,
        down_count: 1,
        daily_count: 2,
        monthly_count: 1,
        latest_date: '2024-02-01',
        latest_count: 3,
        headline: 'More benchmarks rose than fell',
        biggest_up: null,
        biggest_down: null,
        categories: [
          {
            slug: 'energy',
            name: 'Energy',
            total: 3,
            up_count: 2,
            down_count: 1,
            flat_count: 0,
            breadth_percent: 66.7,
            flat_percent: 0,
            down_percent: 33.3
          }
        ]
      }, { range: '1M' });

      const allLink = document.getElementById('market-pulse-all-link');
      const categoryLink = document.querySelector('#market-pulse-categories a');

      expect(allLink.getAttribute('href')).toBe('/?range=1M&view=compact');
      expect(allLink.hasAttribute('aria-current')).toBe(false);
      expect(categoryLink.getAttribute('aria-current')).toBe('page');
      expect(categoryLink.className).toContain('border-brand-oxford');
    } finally {
      window.history.pushState({}, '', originalHref);
    }
  });
});

describe('Index quick find', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section id="quick-find">
        <input id="quick-find-input" />
        <button data-quick-filter="all" class="quick-filter-btn" aria-pressed="true">All</button>
        <button data-quick-filter="up" class="quick-filter-btn" aria-pressed="false">Rising</button>
        <button data-quick-filter="down" class="quick-filter-btn" aria-pressed="false">Falling</button>
        <button data-quick-filter="daily" class="quick-filter-btn" aria-pressed="false">Daily</button>
        <div id="quick-find-count"></div>
        <button id="quick-find-reset" class="hidden"></button>
        <button id="quick-find-export"></button>
        <div id="quick-find-summary">
          <span id="quick-find-up"></span>
          <span id="quick-find-down"></span>
          <span id="quick-find-daily"></span>
          <span id="quick-find-monthly"></span>
        </div>
        <div id="quick-find-empty" class="hidden"></div>
      </section>
      <div id="grid-view">
        <div id="grid-cards-container">
          <a data-id="gold" data-name="Gold" data-category="Precious" data-price="2000" data-currency="USD" data-unit="oz" data-date="2024-01-10" data-frequency="daily" data-direction="up" data-change-pct="2.5" data-change-abs="50"></a>
          <a data-id="corn" data-name="Corn" data-category="Agriculture" data-price="4.2" data-currency="USD" data-unit="bushel" data-date="2024-01-09" data-frequency="monthly" data-direction="down" data-change-pct="-1.2" data-change-abs="-0.05"></a>
          <a data-id="index" data-name="Index Level" data-category="Index" data-price="100" data-currency="points" data-unit="index" data-date="2024-01-08" data-frequency="monthly" data-direction="flat" data-change-pct="0" data-change-abs="0"></a>
        </div>
      </div>
      <div id="compact-view" class="hidden">
        <table><tbody id="table-body"></tbody></table>
      </div>
    `;

    global.BW = {
      Responsive: { autoApply: jest.fn() },
      Settings: {
        getViewMode: jest.fn().mockReturnValue('grid'),
        setViewMode: jest.fn()
      }
    };

    loadIndexScript();
    BW.Index.initQuickFind();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('filters visible grid cards by search text', () => {
    const input = document.getElementById('quick-find-input');
    input.value = 'gold';
    input.dispatchEvent(new Event('input'));

    const cards = document.querySelectorAll('#grid-cards-container > a');
    expect(cards[0].style.display).toBe('');
    expect(cards[1].style.display).toBe('none');
    expect(cards[2].style.display).toBe('none');
    expect(document.getElementById('quick-find-count').textContent).toBe('1/3 shown');
    expect(document.getElementById('quick-find-up').textContent).toBe('1');
    expect(document.getElementById('quick-find-down').textContent).toBe('0');
    expect(document.getElementById('quick-find-daily').textContent).toBe('1');
    expect(document.getElementById('quick-find-reset').classList.contains('hidden')).toBe(false);
  });

  test('filters by movement or cadence and can reset', () => {
    document.querySelector('[data-quick-filter="down"]').click();

    const cards = document.querySelectorAll('#grid-cards-container > a');
    expect(cards[0].style.display).toBe('none');
    expect(cards[1].style.display).toBe('');
    expect(document.querySelector('[data-quick-filter="down"]').getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('quick-find-count').textContent).toBe('1/3 shown');
    expect(document.getElementById('quick-find-export').disabled).toBe(false);

    document.getElementById('quick-find-reset').click();

    expect(Array.from(cards).every(card => card.style.display === '')).toBe(true);
    expect(document.getElementById('quick-find-count').textContent).toBe('3 shown');
    expect(document.querySelector('[data-quick-filter="all"]').getAttribute('aria-pressed')).toBe('true');
  });

  test('builds a visible-set CSV from quick find results', () => {
    document.querySelector('[data-quick-filter="down"]').click();

    const csv = BW.Index.buildQuickFindCsvContent(BW.Index.getVisibleQuickFindItems());

    expect(csv).toContain('ID,Benchmark,Category,Price,Currency,Change,Change %,Date,Frequency,Direction');
    expect(csv).toContain('"corn","Corn","Agriculture","4.2","USD","-0.05","-1.2","2024-01-09","monthly","down"');
    expect(csv).not.toContain('Gold');
  });

  test('disables CSV export when no items are visible', () => {
    const input = document.getElementById('quick-find-input');
    input.value = 'nope';
    input.dispatchEvent(new Event('input'));

    expect(document.getElementById('quick-find-export').disabled).toBe(true);
    expect(document.getElementById('quick-find-export').getAttribute('aria-disabled')).toBe('true');
  });
});
