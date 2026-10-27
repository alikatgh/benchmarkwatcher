/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../app/static/js/components/company_research.js'), 'utf8');
const idleStatus = 'SEC-reporting companies · No API key needed';
const noMatches = 'No matching SEC-listed company. Try its full name or a different ticker.';
const company = { cik: '0000789019', ticker: 'MSFT', name: 'Microsoft Corp', exchange: 'Nasdaq' };
const originalFetch = global.fetch;
const $ = selector => document.querySelector(selector);
const response = (companies, extra = {}) => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ companies, ...extra }) });
function boot({ failedSearch = false } = {}) {
  document.body.innerHTML = `<div data-company-workspace>
    <input type="hidden" name="csrf" value="test-csrf">
    <form id="company-search" action="/workspace/" data-search-url="/workspace/companies/search" data-open-url="/workspace/companies/open">
      <input id="company-query" name="q" type="search"><button type="submit">Search</button>
    </form>
    <p id="company-search-status" role="status"></p>
    <p id="company-search-recovery"><a href="/workspace/" data-company-clear>Clear search</a></p>
    <div id="company-results"></div>
  </div>`;
  $('#company-query').value = failedSearch ? 'Unknown company' : '';
  $('#company-search-status').textContent = failedSearch ? noMatches : idleStatus;
  $('#company-search-recovery').hidden = !failedSearch;
  window.eval(source);
}
function input(value) {
  $('#company-query').value = value;
  $('#company-query').dispatchEvent(new Event('input', { bubbles: true }));
}
function clearSearch() {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  $('[data-company-clear]').dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
}
function expectCleared() {
  expect($('#company-query').value).toBe('');
  expect(document.activeElement).toBe($('#company-query'));
  expect($('#company-results').children).toHaveLength(0);
  expect($('#company-search-status').textContent).toBe(idleStatus);
  expect($('#company-search-recovery').hidden).toBe(true);
}
beforeEach(() => { jest.useFakeTimers(); global.fetch = jest.fn(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); global.fetch = originalFetch; });

test('an empty search exposes a recovery action that clears locally and restores input focus', async () => {
  fetch.mockResolvedValue(response([]));
  boot();
  input('No matching company');
  await jest.advanceTimersByTimeAsync(250);
  expect($('#company-search-status').textContent).toBe(noMatches);
  expect($('#company-search-recovery').hidden).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
  clearSearch();
  expectCleared();
  await jest.runAllTimersAsync();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('the server-rendered failed search can be cleared without any search or report request', () => {
  boot({ failedSearch: true });
  clearSearch();
  expectCleared();
  expect(fetch).not.toHaveBeenCalled();
});

test('clearing cancels a queued debounce before it can send a new search', async () => {
  boot({ failedSearch: true });
  input('Microsoft');
  expect($('#company-search-recovery').hidden).toBe(false);
  clearSearch();
  await jest.advanceTimersByTimeAsync(1000);
  expectCleared();
  expect(fetch).not.toHaveBeenCalled();
});

test('clearing aborts an in-flight request and ignores a late success even if it does not honor abort', async () => {
  let resolve;
  fetch.mockImplementation(() => new Promise(done => { resolve = done; }));
  boot({ failedSearch: true });
  input('Microsoft');
  await jest.advanceTimersByTimeAsync(250);
  const signal = fetch.mock.calls[0][1].signal;
  expect(signal.aborted).toBe(false);
  clearSearch();
  expect(signal.aborted).toBe(true);
  resolve(response([company]));
  await jest.advanceTimersByTimeAsync(0);
  expectCleared();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('a late request failure cannot replace the cleared idle status', async () => {
  let reject;
  fetch.mockImplementation(() => new Promise((resolve, fail) => { reject = fail; }));
  boot({ failedSearch: true });
  input('Microsoft');
  await jest.advanceTimersByTimeAsync(250);
  clearSearch();
  reject(new Error('Delayed network failure'));
  await jest.advanceTimersByTimeAsync(0);
  expectCleared();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('matching companies retain search and report form semantics and hide empty-results recovery', async () => {
  fetch.mockResolvedValue(response([company]));
  boot({ failedSearch: true });
  input(' MSFT ');
  $('#company-search').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await jest.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith('/workspace/companies/search?q=MSFT', expect.objectContaining({ headers: { Accept: 'application/json' } }));
  expect($('#company-search-recovery').hidden).toBe(true);
  const form = $('#company-results .company-open');
  expect(form.getAttribute('method')).toBe('post');
  expect(form.getAttribute('action')).toBe('/workspace/companies/open');
  expect(form.querySelector('[name="csrf"]').value).toBe('test-csrf');
  expect(form.querySelector('[name="cik"]').value).toBe(company.cik);
  expect(form.textContent).toContain(company.name);
  expect(form.textContent).toContain(company.ticker);
  $('#company-query').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  expect(document.activeElement).toBe(form.querySelector('button'));
  await jest.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('blank searches remain local and keep recovery hidden', async () => {
  boot();
  input('  ');
  await jest.advanceTimersByTimeAsync(250);
  expect($('#company-search-status').textContent).toBe(idleStatus);
  expect($('#company-search-recovery').hidden).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});
