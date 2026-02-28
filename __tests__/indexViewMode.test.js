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
