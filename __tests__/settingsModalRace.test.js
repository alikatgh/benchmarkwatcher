/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

function loadSettingsModalScript() {
  const scriptPath = path.join(__dirname, '..', 'app', 'static', 'js', 'components', 'settings_modal.js');
  const code = fs.readFileSync(scriptPath, 'utf8');
  window.eval(code);
}

describe('Settings modal delayed focus lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();

    document.body.innerHTML = `
      <button id="settings-button">Settings</button>
      <main id="main-content">Main</main>
      <div id="settings-modal" class="opacity-0 pointer-events-none" aria-hidden="true">
        <div>
          <button id="first-focusable">First</button>
        </div>
      </div>
    `;

    global.BW = {};
    loadSettingsModalScript();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('does not move focus into hidden modal after immediate close', () => {
    const trigger = document.getElementById('settings-button');
    const modal = document.getElementById('settings-modal');

    trigger.focus();

    BW.SettingsModal.toggle(); // open (schedules delayed focus)
    BW.SettingsModal.toggle(); // close immediately before timeout runs

    expect(document.activeElement).toBe(trigger);

    jest.runOnlyPendingTimers();

    expect(modal.classList.contains('opacity-0')).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });
});
