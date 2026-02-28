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

describe('Grid view bootstrap lifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="grid-cards-container"></div>
      <button id="grid-range-1W"></button>
    `;

    delete window.__bwGridViewDomReadyBound;

    global.BW = {
      GridView: undefined,
      Settings: {
        getGridSettings: jest.fn(() => ({ dataRange: 'ALL' })),
        saveGridSettings: jest.fn()
      }
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('DOMContentLoaded init runs once even when script is loaded twice', () => {
    loadGridViewScript();
    loadGridViewScript();

    const initSpy = jest.fn();
    BW.GridView.init = initSpy;

    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(initSpy).toHaveBeenCalledTimes(1);
  });
});
