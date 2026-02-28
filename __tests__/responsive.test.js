/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

function loadResponsiveScript() {
    const scriptPath = path.join(__dirname, '..', 'app', 'static', 'js', 'core', 'responsive.js');
    const code = fs.readFileSync(scriptPath, 'utf8');
    eval(code);
}

describe('BW.Responsive first-visit detection', () => {
    beforeEach(() => {
        document.documentElement.innerHTML = '';
        document.documentElement.dataset.deviceClass = '';

        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: jest.fn().mockImplementation(() => ({ matches: false })),
        });

        global.BW = {};
    });

    test('respects existing view preference from BW.Settings storage', () => {
        const setViewMode = jest.fn();
        const getRaw = jest.fn(() => 'compact');

        global.BW.Settings = {
            KEYS: { VIEW_MODE: 'view-mode' },
            _getRaw: getRaw,
            setViewMode,
        };

        Object.defineProperty(window, 'innerWidth', { writable: true, value: 390 });

        loadResponsiveScript();
        BW.Responsive.autoApply();

        expect(getRaw).toHaveBeenCalledWith('view-mode');
        expect(BW.Responsive.isFirstVisit()).toBe(false);
        expect(setViewMode).not.toHaveBeenCalled();
    });

    test('auto-selects view when BW.Settings has no saved preference', () => {
        const setViewMode = jest.fn();

        global.BW.Settings = {
            KEYS: { VIEW_MODE: 'view-mode' },
            _getRaw: jest.fn(() => null),
            setViewMode,
        };

        Object.defineProperty(window, 'innerWidth', { writable: true, value: 390 });

        loadResponsiveScript();
        BW.Responsive.autoApply();

        expect(BW.Responsive.isFirstVisit()).toBe(true);
        expect(setViewMode).toHaveBeenCalledWith('compact');
    });
});
