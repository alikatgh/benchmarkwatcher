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

function loadSparklineScript() {
  const scriptPath = path.join(__dirname, '..', 'app', 'static', 'js', 'components', 'sparkline.js');
  const code = fs.readFileSync(scriptPath, 'utf8');
  window.eval(code);
}

describe('Index and Sparkline bootstrap lifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="index-page-state" data-active-view="grid"></div>
      <div id="grid-view"></div>
      <div id="compact-view" class="hidden"></div>
      <button id="view-grid"></button>
      <button id="view-compact"></button>
      <span id="view-indicator"></span>
      <canvas data-sparkline="[1,2,3]"></canvas>
    `;

    delete window.__bwIndexDomReadyBound;
    delete window.__bwSparklineDomReadyBound;

    Object.defineProperty(document, 'readyState', {
      configurable: true,
      get: () => 'loading'
    });

    global.BW = {
      Index: { init: jest.fn() },
      Responsive: { autoApply: jest.fn() },
      Settings: {
        getViewMode: jest.fn(() => 'grid'),
        setViewMode: jest.fn()
      }
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('Index init runs once when script is loaded twice', () => {
    loadIndexScript();
    loadIndexScript();

    const initSpy = jest.fn();
    BW.Index.init = initSpy;

    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(initSpy).toHaveBeenCalledTimes(1);
  });

  test('Sparkline renderAll runs once when script is loaded twice', () => {
    loadSparklineScript();
    loadSparklineScript();

    const renderSpy = jest.fn();
    BW.Sparkline.renderAll = renderSpy;

    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(renderSpy).toHaveBeenCalledTimes(1);
  });
});
