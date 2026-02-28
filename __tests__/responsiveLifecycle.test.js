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

describe('BW.Responsive lifecycle safety', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '';

    delete window.__bwResponsiveDomReadyBound;

    Object.defineProperty(document, 'readyState', {
      configurable: true,
      get: () => 'complete'
    });

    global.BW = {
      CompactTable: {
        setColumnVisibility: jest.fn()
      }
    };

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation(() => ({ matches: false })),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('replaces prior ResizeObserver on repeated initAfterDOM calls', () => {
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      get: () => 'loading'
    });

    const observeMock1 = jest.fn();
    const disconnectMock1 = jest.fn();
    const observeMock2 = jest.fn();
    const disconnectMock2 = jest.fn();

    let instanceCount = 0;
    global.ResizeObserver = jest.fn().mockImplementation(() => {
      instanceCount += 1;
      if (instanceCount === 1) {
        return { observe: observeMock1, disconnect: disconnectMock1 };
      }
      return { observe: observeMock2, disconnect: disconnectMock2 };
    });

    loadResponsiveScript();

    BW.Responsive.initAfterDOM();
    BW.Responsive.initAfterDOM();

    expect(global.ResizeObserver).toHaveBeenCalledTimes(2);
    expect(disconnectMock1).toHaveBeenCalledTimes(1);
    expect(observeMock1).toHaveBeenCalledTimes(1);
    expect(observeMock2).toHaveBeenCalledTimes(1);
    expect(disconnectMock2).not.toHaveBeenCalled();
  });

  test('binds DOM-ready responsive init only once across duplicate script loads', () => {
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      get: () => 'complete'
    });

    const observeMock1 = jest.fn();
    const disconnectMock1 = jest.fn();
    const observeMock2 = jest.fn();
    const disconnectMock2 = jest.fn();

    let instanceCount = 0;
    global.ResizeObserver = jest.fn().mockImplementation(() => {
      instanceCount += 1;
      if (instanceCount === 1) {
        return { observe: observeMock1, disconnect: disconnectMock1 };
      }
      return { observe: observeMock2, disconnect: disconnectMock2 };
    });

    loadResponsiveScript();
    loadResponsiveScript();

    expect(global.ResizeObserver).toHaveBeenCalledTimes(1);
    expect(observeMock1).toHaveBeenCalledTimes(1);
    expect(disconnectMock1).not.toHaveBeenCalled();
    expect(observeMock2).not.toHaveBeenCalled();
  });
});
