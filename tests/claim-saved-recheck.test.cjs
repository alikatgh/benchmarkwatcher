const test = require('node:test');
const {validateSavedScope, compareProofs, saveEnvelope, openEnvelope, parseLinkedCompanies, rankShortfall, buildComparisonCsv, matchesCompany, SAVED_MAX} = require('../app/static/js/components/claim-proof.js');
const assert = require('node:assert/strict');

const proof = {claim_id: 'cash_keeps_pace', claim: 'Claim', periods: ['FY2024', 'FY2025'], comparison_basis: 'Each issuer fiscal year', sensitivity: {cash_ppe_adjustment_percent: '0'}, actual_counts: {supported: 1, contradicted: 0, unavailable: 0}, scenario_counts: {supported: 1, contradicted: 0, unavailable: 0}, companies: [{ticker: 'MSFT', actual_status: 'supported', scenario_status: 'supported', actual_growth: '1.00', scenario_growth: '1.00', revenue_growth: '0.50', facts: [{id: 'f1', value: '1', source_sha256: 'aaa'}]}]};
const scope = {companies: ['MSFT'], claim_id: 'cash_keeps_pace', adjustment: '0'};
function store() {
  const data = new Map();
  return {getItem: key => (data.has(key) ? data.get(key) : null), setItem: (key, value) => { data.set(key, String(value)); }};
}

test('save then reopen restores scope and proof without mutation', () => {
  const backend = store();
  const envelope = saveEnvelope(backend, ' Cash vs sales ', scope, proof);
  assert.equal(envelope.name, 'Cash vs sales');
  const reopened = openEnvelope(backend, 'Cash vs sales');
  assert.deepEqual(reopened.scope, scope);
  assert.deepEqual(reopened.proof, proof);
});

test('invalid scope and mismatched proof never overwrite saved work', () => {
  const backend = store();
  saveEnvelope(backend, 'keep', scope, proof);
  for (const bad of [{...scope, companies: ['UNKNOWN']}, {...scope, companies: ['MSFT', 'MSFT']}, {...scope, claim_id: 'profit_keeps_pace', adjustment: '5'}, {...scope, adjustment: '51'}]) {
    assert.throws(() => saveEnvelope(backend, 'bad', bad, proof), /Saved scope is invalid/);
  }
  assert.throws(() => saveEnvelope(backend, 'bad', {...scope, companies: ['AAPL']}, proof), /does not match its scope/);
  assert.throws(() => saveEnvelope(backend, '   ', scope, proof), /1–80 characters/);
  assert.deepEqual(openEnvelope(backend, 'keep').proof, proof);
});

test('saved investigations are capped and corrupt data stays rejected', () => {
  const backend = store();
  for (let index = 0; index < SAVED_MAX; index++) saveEnvelope(backend, `slot-${index}`, scope, proof);
  assert.throws(() => saveEnvelope(backend, 'overflow', scope, proof), new RegExp(`limited to ${SAVED_MAX}`));
  saveEnvelope(backend, 'slot-0', scope, proof);
  const raw = store();
  raw.setItem('benchmarkwatcher.claim-proof.v1', '{corrupt');
  assert.throws(() => openEnvelope(raw, 'slot-0'), /invalid/i);
});

test('identical evidence compares clean and changed rows are named', () => {
  assert.deepEqual(compareProofs(proof, structuredClone(proof)), []);
  const flipped = structuredClone(proof);
  flipped.companies[0].actual_status = 'contradicted';

  flipped.companies[0].facts[0].value = '2';
  const diffs = compareProofs(proof, flipped);
  assert.ok(diffs.some(line => line.includes('MSFT') && line.includes('actual_status')));
  assert.ok(diffs.some(line => line.includes('MSFT') && line.includes('f1')));
});

test('deep links accept one to fourteen known tickers, nothing else', () => {
  assert.deepEqual(parseLinkedCompanies('?companies=msft'), ['MSFT']);
  assert.deepEqual(parseLinkedCompanies('?companies=MSFT,aapl,GOOGL,TSLA'), ['MSFT', 'AAPL', 'GOOGL', 'TSLA']);
  assert.deepEqual(parseLinkedCompanies('?companies=MSFT,MSFT'), ['MSFT']);
  assert.equal(parseLinkedCompanies('?companies=' + ['MSFT','AAPL','GOOGL','AMZN','META','TSLA','NFLX','AMD','NOW','PLTR','AMGN','HON','UNP','BKNG','EXTRA'].join(',')).length, 14);
  for (const search of ['', '?companies=', '?companies=UNKNOWN', '?companies=<script>', null, undefined]) assert.deepEqual(parseLinkedCompanies(search), []);
});

test('shortfall ranking orders by revenue-minus-measure gap, unknowns last', () => {
  const {rankShortfall} = require('../app/static/js/components/claim-proof.js');
  const proof = {companies: [
    {ticker: 'AAPL', actual_growth: '-9.23', revenue_growth: '6.43'},
    {ticker: 'MSFT', actual_growth: '-3.32', revenue_growth: '14.93'},
    {ticker: 'GOOGL', actual_growth: null, revenue_growth: '15.09'},
  ]};
  assert.deepEqual(rankShortfall(proof).map(row => row.ticker), ['MSFT', 'AAPL', 'GOOGL']);
  assert.equal(rankShortfall({}).length, 0);
});

test('spreadsheet export ranks rows with exact scope and spreadsheet-safe cells', () => {
  const proof = {claim_id: 'cash_keeps_pace', claim: 'Claim', periods: ['FY2024', 'FY2025'], comparison_basis: 'Each issuer fiscal year', sensitivity: {cash_ppe_adjustment_percent: '0'}, actual_counts: {supported: 0, contradicted: 2, unavailable: 0}, scenario_counts: {supported: 0, contradicted: 2, unavailable: 0}, companies: [
    {ticker: 'AAPL', company: 'Apple, Inc.', actual_status: 'contradicted', actual_growth: '-9.23', revenue_growth: '6.43', facts: [], formulas: [], period_details: [{id: 'FY2024', start: '2023-10-01', end: '2024-09-28'}, {id: 'FY2025', start: '2024-09-29', end: '2025-09-27'}]},
    {ticker: 'MSFT', company: 'Microsoft', actual_status: 'contradicted', actual_growth: '-3.32', revenue_growth: '14.93', facts: [], formulas: [], period_details: [{id: 'FY2024', start: '2023-07-01', end: '2024-06-30'}, {id: 'FY2025', start: '2024-07-01', end: '2025-06-30'}]}]};
  const artifact = buildComparisonCsv(proof);
  assert.equal(artifact.filename, 'benchmarkwatcher-comparison-cash_keeps_pace.csv');
  const rows = artifact.text.trim().split('\r\n');
  assert.equal(rows.length, 3);
  assert.ok(rows[0].startsWith('rank,ticker,company,verdict'));
  assert.ok(rows[1].startsWith('1,MSFT,Microsoft,contradicted,-3.32,14.93,18.25'));
  assert.ok(rows[2].includes('"Apple, Inc."'));
  assert.throws(() => buildComparisonCsv({}), /unavailable or exceeds/);
});

test('company filter matches tickers and names, never hides everything on empty', () => {
  const {matchesCompany} = require('../app/static/js/components/claim-proof.js');
  assert.equal(matchesCompany('net', 'NFLX', 'Netflix, Inc.'), true);
  assert.equal(matchesCompany('NFLX', 'NFLX', 'Netflix, Inc.'), true);
  assert.equal(matchesCompany('soft', 'MSFT', 'Microsoft Corporation'), true);
  assert.equal(matchesCompany('zzz', 'MSFT', 'Microsoft Corporation'), false);
  assert.equal(matchesCompany('', 'MSFT', 'Microsoft Corporation'), true);
});

test('frontend revision mismatch flags a stale page', () => {
  const {frontendStale, FRONTEND_REV} = require('../app/static/js/components/claim-proof.js');
  assert.equal(typeof FRONTEND_REV, 'string');
  assert.equal(frontendStale({dataset: {frontend: FRONTEND_REV}}), false);
  assert.equal(frontendStale({dataset: {frontend: '2000-01-01.1'}}), true);
  assert.equal(frontendStale({dataset: {}}), true);
  assert.equal(frontendStale(null), true);
});
