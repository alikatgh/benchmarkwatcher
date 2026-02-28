/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

function loadBaseScript() {
  const scriptPath = path.join(__dirname, '..', 'app', 'static', 'js', 'base.js');
  const code = fs.readFileSync(scriptPath, 'utf8');
  window.eval(code);
}

describe('BW.Base initOnReady lifecycle idempotency', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="market-western" class="market-btn"></button>
      <div id="category-strip"></div>
    `;

    Object.defineProperty(document, 'readyState', {
      configurable: true,
      get: () => 'complete'
    });

    delete window.__bwBaseDomReadyBound;
    delete window.__bwBaseScrollHideBound;

    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      cb();
      return 1;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('does not duplicate click handlers or scroll listener when initOnReady is called repeatedly', () => {
    const addEventSpy = jest.spyOn(window, 'addEventListener');
    const setItemSpy = jest.spyOn(window.localStorage.__proto__, 'setItem');

    loadBaseScript();

    // Repeat init to simulate re-initialization paths
    BW.Base.initOnReady();
    BW.Base.initOnReady();

    const scrollAdds = addEventSpy.mock.calls.filter(([eventName]) => eventName === 'scroll');
    expect(scrollAdds.length).toBe(1);

    const btn = document.getElementById('market-western');
    btn.click();

    // One click should persist exactly once (no duplicated click listeners)
    const writes = setItemSpy.mock.calls.filter(([key]) => key === 'market-theme');
    expect(writes.length).toBe(1);
  });

  test('binds DOM-ready init only once across duplicate script loads', () => {
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      get: () => 'loading'
    });

    const addEventSpy = jest.spyOn(window, 'addEventListener');

    loadBaseScript();
    loadBaseScript();

    document.dispatchEvent(new Event('DOMContentLoaded'));

    const scrollAdds = addEventSpy.mock.calls.filter(([eventName]) => eventName === 'scroll');
    expect(scrollAdds.length).toBe(1);
  });
});
