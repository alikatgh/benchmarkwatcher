(function () {
  'use strict';
  function percent(value) {
    if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) return 'Unavailable';
    return new Intl.NumberFormat('en-US', {maximumFractionDigits: 2, minimumFractionDigits: 2}).format(Number(value)) + '%';
  }
  function safeSource(value) {
    try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'www.sec.gov' && !u.username && !u.password ? u.href : null; } catch (_) { return null; }
  }
  // Muse Spark draft, revised after review; backend status remains authoritative.
  function describeVerdict(card, claimId, scenario = false) {
    const prefix = scenario ? 'Hypothetical scenario for ' : '';
    const company = card && typeof card.company === 'string' && card.company.trim() !== '' ? card.company.trim() : 'Company';
    if (!card || typeof card !== 'object' || Array.isArray(card) || !['cash_keeps_pace', 'profit_keeps_pace'].includes(claimId)) {
      return prefix + company + ': verdict is unavailable. Unsupported claim.';
    }
    if (scenario && claimId !== 'cash_keeps_pace') {
      return prefix + company + ': verdict is unavailable. Scenario applies only to cash claim as hypothetical.';
    }
    const verdict = scenario ? card.scenario_status : card.actual_status;
    const unavailable = prefix + company + ': verdict is unavailable. Required growth inputs are missing.';
    if (verdict !== 'supported' && verdict !== 'contradicted') return unavailable;
    const growth = percent(scenario ? card.scenario_growth : card.actual_growth);
    const revenue = percent(card.revenue_growth);
    if (growth === 'Unavailable' || revenue === 'Unavailable') return unavailable;
    const measure = claimId === 'cash_keeps_pace' ? 'Calculated free cash flow' : 'Operating income';
    return prefix + company + ': the claim is ' + verdict + '. ' + measure + ' growth was ' + growth + ' versus revenue ' + revenue + '.';
  }
  // Cohort presentation follows Muse Spark's reviewed design; counts remain server-owned.
  function describeCohort(proof, scenario = false) {
    const label = scenario ? 'Hypothetical PP&E scenario' : 'Reported filings';
    const unavailable = label + ': comparison counts are unavailable.';
    if (!proof || !['cash_keeps_pace', 'profit_keeps_pace'].includes(proof.claim_id)
        || !Array.isArray(proof.companies) || proof.companies.length < 1 || proof.companies.length > 3) return unavailable;
    const count = proof.companies.length;
    const counts = scenario ? proof.scenario_counts : proof.actual_counts;
    const keys = ['supported', 'contradicted', 'unavailable'];
    if (!counts || keys.some(key => !Number.isInteger(counts[key]) || counts[key] < 0 || counts[key] > count)
        || keys.reduce((total, key) => total + counts[key], 0) !== count) return unavailable;
    let title = label;
    if (scenario) {
      const adjustment = proof.sensitivity && proof.sensitivity.cash_ppe_adjustment_percent;
      if (proof.claim_id !== 'cash_keeps_pace' || percent(adjustment) === 'Unavailable' || Math.abs(Number(adjustment)) > 50) return unavailable;
      title += ' (' + percent(adjustment) + ')';
    }
    return title + ': ' + keys.map(key => counts[key] + ' ' + key).join(', ') + ' across ' + count + ' selected ' + (count === 1 ? 'company.' : 'companies.');
  }
  function buildProofExport(proof) {
    const fail = () => { throw new Error('The proof is unavailable or exceeds the download limit. Recalculate it first.'); };
    const fields = ['claim_id','claim','periods','comparison_basis','sensitivity','actual_counts','scenario_counts','companies'];
    if (!proof || typeof proof !== 'object' || Array.isArray(proof) || Object.keys(proof).length !== fields.length || fields.some(key => !Object.hasOwn(proof,key))) return fail();
    if (!['cash_keeps_pace','profit_keeps_pace'].includes(proof.claim_id) || JSON.stringify(proof.periods) !== '["FY2024","FY2025"]') return fail();
    if (!Array.isArray(proof.companies) || proof.companies.length < 1 || proof.companies.length > 3) return fail();
    const companies = proof.companies.map(company => company && company.ticker);
    if (new Set(companies).size !== companies.length || companies.some(ticker => !['MSFT','AAPL','GOOGL','AMZN','META','TSLA'].includes(ticker))) return fail();
    const adjustment = proof.sensitivity && proof.sensitivity.cash_ppe_adjustment_percent;
    if (typeof adjustment !== 'string' || !/^-?\d+(?:\.\d{1,24})?$/.test(adjustment) || !Number.isFinite(Number(adjustment)) || Math.abs(Number(adjustment)) > 50 || (proof.claim_id === 'profit_keeps_pace' && Number(adjustment) !== 0)) return fail();
    let text;
    try {
      text = JSON.stringify({format:'benchmarkwatcher-claim-proof',version:1,
        scope:{companies,claim_id:proof.claim_id,adjustment},
        caveat:'Retained FY2024/FY2025 filing snapshot. Not a signature, current source verification or the latest filings. Recalculate against matching source records before relying on this file.',
        evidence:proof}, null, 2);
    } catch (_) { return fail(); }
    if (new TextEncoder().encode(text).length > 262144) return fail();
    return {filename:'benchmarkwatcher-proof-' + proof.claim_id + '.json',text};
  }
  // Muse Spark implementation 4059b0de, reviewed and formatted locally.
  function buildInvestigationBrief(proof) {
    buildProofExport(proof);
    function escaped(value) {
      if (typeof value !== 'string' || !value) return 'Unavailable';
      return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/[\r\n]+/g, ' ').replace(/[\x00-\x1F\x7F]/g, ' ')
        .replace(/([\\`*_{}\[\]()#+\-.!|])/g, '\\$1');
    }
    function sourceLink(value) {
      const url = safeSource(value);
      if (typeof url !== 'string' || !url || /[<>\s]/.test(url)) return 'Unavailable';
      return '[SEC filing](' + url.replace(/\(/g, '%28').replace(/\)/g, '%29') + ')';
    }
    function records(value) {
      if (!Array.isArray(value) || value.some(record => !record || typeof record !== 'object' || Array.isArray(record))) throw new Error('Invalid evidence records.');
      return value;
    }
    const claimId = proof.claim_id, adjustment = proof.sensitivity.cash_ppe_adjustment_percent;
    const showScenario = claimId === 'cash_keeps_pace' && Number(adjustment) !== 0;
    const lines = [
      '# BenchmarkWatcher investigation brief', '',
      'Selected tickers: ' + proof.companies.map(card => escaped(card.ticker)).join(', '),
      'FY scope: ' + escaped(proof.periods.join(', ')),
      'Claim: ' + escaped(proof.claim),
      'Comparison basis: ' + escaped(proof.comparison_basis), '',
      'Retained historical snapshot, not current or latest verification. Each comparison uses the issuer’s own fiscal years; dates may differ. Selected sample only, not a market-wide conclusion. Displayed percentages are rounded; exact backend arithmetic determines the verdict. A hypothetical scenario is arithmetic on retained figures. No investment advice.', '',
      '## Reported cohort', escaped(describeCohort(proof))
    ];
    for (const card of records(proof.companies)) {
      lines.push('', '## ' + escaped(card.ticker) + ' — ' + escaped(card.company), escaped(describeVerdict(card, claimId)));
      for (const period of records(card.period_details)) lines.push('- ' + escaped(period.id) + ': ' + escaped(period.start) + ' to ' + escaped(period.end));
      if (card.measurement_note) lines.push('Caveat: ' + escaped(card.measurement_note));
      if (claimId === 'cash_keeps_pace' && typeof card.break_even_adjustment_percent === 'string') lines.push('Equal-growth PP&E adjustment: ' + escaped(percent(card.break_even_adjustment_percent)) + ' ' + escaped(card.break_even_note));
      for (const formula of records(card.formulas)) {
        if (typeof formula.hypothetical !== 'boolean') throw new Error('Invalid formula scope.');
        if (!formula.hypothetical) lines.push('- Formula ' + escaped(formula.label) + ': ' + escaped(formula.value) + ' ' + escaped(formula.unit) + ' ' + escaped(formula.formula));
      }
    }
    if (showScenario) {
      lines.push('', '## Hypothetical PP&E scenario (retained figures only)', 'Adjustment: ' + escaped(percent(adjustment)), escaped(describeCohort(proof, true)));
      for (const card of proof.companies) {
        lines.push('', '### Hypothetical ' + escaped(card.ticker), escaped(describeVerdict(card, claimId, true)));
        for (const formula of card.formulas) if (formula.hypothetical) lines.push('- Hypothetical formula ' + escaped(formula.label) + ': ' + escaped(formula.value) + ' ' + escaped(formula.unit) + ' ' + escaped(formula.formula));
      }
    } else lines.push('', 'No adjusted scenario selected.');
    lines.push('', '## Evidence appendix');
    for (const card of proof.companies) {
      lines.push('', '### ' + escaped(card.ticker) + ' evidence');
      const facts = records(card.facts);
      if (!facts.length) lines.push('Unavailable');
      for (const fact of facts) lines.push('- Fact ' + escaped(fact.id) + ' reported ' + escaped(fact.reported_value) + ' ' + escaped(fact.reported_unit)
        + ' normalized ' + escaped(fact.value) + ' ' + escaped(fact.unit) + ' start ' + escaped(fact.start) + ' end ' + escaped(fact.end)
        + ' filed ' + escaped(fact.filed) + ' accession ' + escaped(fact.accession) + ' hash ' + escaped(fact.source_sha256) + ' ' + sourceLink(fact.url));
    }
    const text = lines.join('\n');
    if (new TextEncoder().encode(text).length > 65536) throw new Error('The brief exceeds its download limit.');
    return {filename:'benchmarkwatcher-brief-' + claimId + '.md', text};
  }
  function parseLinkedCompanies(search) {
    try {
      return (new URLSearchParams(search || '').get('companies') || '').split(',').map(ticker => ticker.trim().toUpperCase()).filter((ticker, index, all) => KNOWN_TICKERS.includes(ticker) && all.indexOf(ticker) === index).slice(0, 3);
    } catch (_) { return []; }
  }
  const SAVED_KEY = 'benchmarkwatcher.claim-proof.v1', SAVED_FORMAT = 'benchmarkwatcher-claim-investigation', SAVED_MAX = 10, SAVED_MAX_BYTES = 1048576;
  const KNOWN_TICKERS = ['MSFT', 'AAPL', 'GOOGL', 'AMZN', 'META', 'TSLA'];
  function validateSavedScope(scope) {
    if (!scope || typeof scope !== 'object' || Array.isArray(scope)) throw new Error('Saved scope is invalid. Existing saved work was preserved.');
    const {companies, claim_id: claimId, adjustment} = scope;
    if (!Array.isArray(companies) || companies.length < 1 || companies.length > 3 || new Set(companies).size !== companies.length || companies.some(ticker => !KNOWN_TICKERS.includes(ticker))) throw new Error('Saved scope is invalid. Existing saved work was preserved.');
    if (!['cash_keeps_pace', 'profit_keeps_pace'].includes(claimId)) throw new Error('Saved scope is invalid. Existing saved work was preserved.');
    if (typeof adjustment !== 'string' || !/^[+-]?(?:0|[1-9][0-9]?)(?:\.\d{1,24})?$/.test(adjustment) || !Number.isFinite(Number(adjustment)) || Math.abs(Number(adjustment)) > 50 || (claimId === 'profit_keeps_pace' && Number(adjustment) !== 0)) throw new Error('Saved scope is invalid. Existing saved work was preserved.');
    return {companies: [...companies], claim_id: claimId, adjustment};
  }
  function compareProofs(saved, fresh) {
    const diffs = [];
    const fail = () => { throw new Error('Saved evidence could not be compared. The original result was preserved.'); };
    if (!saved || !fresh || typeof saved !== 'object' || typeof fresh !== 'object') return fail();
    for (const key of ['actual_counts', 'scenario_counts']) {
      for (const status of ['supported', 'contradicted', 'unavailable']) {
        if ((saved[key] || {})[status] !== (fresh[key] || {})[status]) diffs.push(`${key}.${status}: ${JSON.stringify((saved[key] || {})[status])} → ${JSON.stringify((fresh[key] || {})[status])}`);
      }
    }
    const freshByTicker = new Map((Array.isArray(fresh.companies) ? fresh.companies : []).map(card => [card && card.ticker, card]));
    for (const card of Array.isArray(saved.companies) ? saved.companies : fail()) {
      const other = freshByTicker.get(card.ticker);
      if (!other) { diffs.push(`${card.ticker}: missing from rechecked evidence`); continue; }
      for (const field of ['actual_status', 'scenario_status', 'actual_growth', 'scenario_growth', 'revenue_growth']) {
        if (card[field] !== other[field]) diffs.push(`${card.ticker} ${field}: ${JSON.stringify(card[field])} → ${JSON.stringify(other[field])}`);
      }
      const savedFacts = Array.isArray(card.facts) ? card.facts : [], freshFacts = Array.isArray(other.facts) ? other.facts : [];
      if (savedFacts.length !== freshFacts.length) { diffs.push(`${card.ticker} facts: ${savedFacts.length} → ${freshFacts.length}`); continue; }
      savedFacts.forEach((fact, index) => {
        const match = freshFacts[index] || {};
        if (fact.id !== match.id || fact.value !== match.value || fact.source_sha256 !== match.source_sha256) diffs.push(`${card.ticker} fact ${fact.id || index}: changed`);
      });
    }
    return diffs;
  }
  function loadStore(store) {
    const raw = store.getItem(SAVED_KEY);
    if (raw === null || raw === undefined) return {};
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { throw new Error('Saved investigations are invalid. Existing browser data was preserved.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Saved investigations are invalid. Existing browser data was preserved.');
    return parsed;
  }
  function saveEnvelope(store, name, scope, proof) {
    const label = typeof name === 'string' ? name.trim() : '';
    if (!label || label.length > 80) throw new Error('Name this investigation (1–80 characters) before saving.');
    const validScope = validateSavedScope(scope);
    buildProofExport(proof);
    if (proof.claim_id !== validScope.claim_id || JSON.stringify([...proof.companies.map(card => card.ticker)].sort()) !== JSON.stringify([...validScope.companies].sort()) || (proof.sensitivity && proof.sensitivity.cash_ppe_adjustment_percent) !== validScope.adjustment) throw new Error('The proof does not match its scope. Recalculate before saving.');
    const kept = loadStore(store);
    const names = Object.keys(kept);
    if (!Object.hasOwn(kept, label) && names.length >= SAVED_MAX) throw new Error(`Saved investigations are limited to ${SAVED_MAX}. Remove one before saving another.`);
    const envelope = {format: SAVED_FORMAT, version: 1, name: label, saved_at: new Date().toISOString(), scope: validScope, proof};
    const next = {...kept, [label]: envelope};
    const text = JSON.stringify(next);
    if (new TextEncoder().encode(text).length > SAVED_MAX_BYTES) throw new Error('Saved investigations exceed the 1 MiB browser limit.');
    store.setItem(SAVED_KEY, text);
    return envelope;
  }
  function openEnvelope(store, name) {
    const kept = loadStore(store);
    const envelope = kept[name];
    if (!envelope || typeof envelope !== 'object' || envelope.format !== SAVED_FORMAT || envelope.version !== 1) throw new Error('That saved investigation is unavailable. Existing results were preserved.');
    const scope = validateSavedScope(envelope.scope);
    buildProofExport(envelope.proof);
    return {scope, proof: envelope.proof, name: envelope.name};
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {percent, safeSource, describeVerdict, describeCohort, buildProofExport, buildInvestigationBrief, validateSavedScope, compareProofs, saveEnvelope, openEnvelope, parseLinkedCompanies, SAVED_KEY, SAVED_FORMAT, SAVED_MAX, SAVED_MAX_BYTES, KNOWN_TICKERS};
  if (typeof document === 'undefined') return;
  const root = document.getElementById('claim-proof');
  if (!root) return;
  const form = document.getElementById('cp-form'), results = document.getElementById('cp-results'), status = document.getElementById('cp-status');
  const claim = document.getElementById('cp-claim'), adjustment = document.getElementById('cp-adjustment');
  const submit = form.querySelector('[type=submit]');
  let generation = 0, active = null;
  function el(tag, text, className) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; }
  function feedback(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
  let currentScope = null, currentProof = null, saveButton = null, recheckButton = null;
  function invalidate() {
    generation++; if (active) active.abort(); active = null; submit.disabled = false; results.setAttribute('aria-busy', 'false');
    results.querySelectorAll('.cp-download').forEach(button => { button.disabled = true; });
    if (saveButton) saveButton.disabled = true;
    if (recheckButton) recheckButton.disabled = true;
    currentScope = null; currentProof = null;
    feedback('Selection changed. Test the claim to update the results below.');
  }
  function metric(label, value) { const box = el('div'); box.append(el('dt', label), el('dd', percent(value))); return box; }
  function details(label) { const node = el('details'); node.append(el('summary', label)); return node; }
  function render(proof) {
    const fragment = document.createDocumentFragment(), summary = el('header', undefined, 'cp-summary');
    const title = el('div'); const n = proof.actual_counts.contradicted;
    title.append(el('h2', n ? `${n} ${n === 1 ? 'company contradicts' : 'companies contradict'} the claim` : proof.actual_counts.supported ? 'No counterexample among the available comparisons' : 'The claim could not be tested'));
    title.append(el('p', proof.claim)); summary.append(title); fragment.append(summary);
    const actions = el('div', undefined, 'cp-actions');
    function downloadAction(label, builder, mime, message) {
      const button = el('button', label, 'cp-download'); button.type = 'button';
      button.addEventListener('click', () => {
        let url;
        try {
          const artifact = builder(proof);
          url = URL.createObjectURL(new Blob([artifact.text], {type:mime}));
          const link = el('a'); link.href = url; link.download = artifact.filename;
          root.append(link); link.click(); link.remove(); feedback(message);
        } catch (_) { feedback('The download could not be prepared. Recalculate the proof and try again.',true); }
        finally { if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); }
      });
      return button;
    }
    actions.append(
      downloadAction('Download brief', proof => buildInvestigationBrief(proof), 'text/markdown;charset=utf-8', 'Investigation brief prepared as Markdown, with reported results, hypothetical assumptions and filing references.'),
      downloadAction('Download proof', buildProofExport, 'application/json', 'Proof download prepared. It contains this calculation and its retained filing evidence.')
    );
    summary.append(actions);
    const comparison = el('div', undefined, 'cp-cohort');
    comparison.append(el('p', describeCohort(proof)));
    if (proof.claim_id === 'cash_keeps_pace' && Number(proof.sensitivity.cash_ppe_adjustment_percent) !== 0) comparison.append(el('p', describeCohort(proof, true)));
    comparison.append(el('p', 'Selected companies only. Each comparison uses the issuer’s own fiscal years; this does not establish a market-wide result.', 'cp-cohort-note'));
    fragment.append(comparison);
    const grid = el('div', undefined, 'cp-results-grid');
    for (const card of proof.companies) {
      const article = el('article', undefined, 'cp-result'); article.dataset.verdict = card.actual_status;
      article.append(el('h3', card.company), el('span', {supported:'Claim supported',contradicted:'Claim contradicted',unavailable:'Evidence unavailable'}[card.actual_status] || 'Evidence unavailable', 'cp-verdict'));
      const metrics = el('dl', undefined, 'cp-metrics'); metrics.append(metric(proof.claim_id === 'cash_keeps_pace' ? 'Calculated FCF growth' : 'Operating income growth', card.actual_growth), metric('Revenue growth', card.revenue_growth)); article.append(metrics);
      article.append(el('p', describeVerdict(card, proof.claim_id), 'cp-explanation'));
      if (card.reason) article.append(el('p', card.reason));
      if (proof.claim_id === 'cash_keeps_pace') {
        const sensitivity = el('div', undefined, 'cp-sensitivity');
        if (Number(proof.sensitivity.cash_ppe_adjustment_percent) !== 0) sensitivity.append(el('p', `Hypothetical PP&E change: ${percent(proof.sensitivity.cash_ppe_adjustment_percent)}.`), el('p', describeVerdict(card, proof.claim_id, true)));
        if (card.break_even_adjustment_percent !== null && card.break_even_adjustment_percent !== undefined) sensitivity.append(el('p', `Equal-growth PP&E adjustment: ${percent(card.break_even_adjustment_percent)}${card.break_even_within_scenario_range ? '.' : ' (outside the supported scenario range).'} ${card.break_even_note || ''}`));
        article.append(sensitivity);
      }
      for (const period of card.period_details) article.append(el('p', `${period.id}: ${period.start} to ${period.end}`));
      if (card.measurement_note) article.append(el('p', card.measurement_note));
      const arithmetic = details('Inspect the calculation');
      arithmetic.append(el('p', 'The verdict uses exact source arithmetic. Displayed percentages are rounded.'), el('code', card.actual_comparison_formula || 'No valid comparison available.'));
      for (const formula of card.formulas) { arithmetic.append(el('p', `${formula.label}: ${formula.value === null ? 'Unavailable' : formula.value} ${formula.unit}`), el('code', formula.formula)); }
      article.append(arithmetic);
      const sources = details(`Inspect ${card.facts.length} filing facts`);
      for (const fact of card.facts) {
        const row = el('div', undefined, 'cp-fact');
        row.append(el('strong', fact.id), el('span', fact.row), el('span', `${fact.reported_value} ${fact.reported_unit} reported`, 'cp-value'), el('span', `${fact.start} to ${fact.end}`), el('span', `Filed ${fact.filed} · ${fact.accession}`), el('span', `Normalized: ${fact.value} ${fact.unit} (${fact.normalization})`));
        const url = safeSource(fact.url); if (url) { const link = el('a', 'Open SEC filing'); link.href=url; link.target='_blank'; link.rel='noopener noreferrer'; row.append(link); }
        row.append(el('span', `Retained source hash: ${fact.source_sha256}`)); sources.append(row);
      }
      article.append(sources); grid.append(article);
    }
    fragment.append(grid); results.replaceChildren(fragment);
  }
  form.addEventListener('change', event => {
    if (event.target === claim) { adjustment.disabled = claim.value !== 'cash_keeps_pace'; if (adjustment.disabled) adjustment.value = '0'; }
    invalidate();
  });
  adjustment.addEventListener('input', invalidate);
  document.getElementById('cp-reset').addEventListener('click', () => { adjustment.value = '0'; invalidate(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const companies = Array.from(form.querySelectorAll('[name=company]:checked'), item => item.value);
    if (!companies.length || companies.length > 3) { feedback('Choose one to three companies, then test the claim.', true); return; }
    if (!form.reportValidity()) return;
    const current = ++generation; if (active) active.abort(); active = new AbortController();
    results.querySelectorAll('.cp-download').forEach(button => { button.disabled = true; });
    const controller = active, timeout = setTimeout(() => controller.abort(), 10000);
    submit.disabled = true; results.setAttribute('aria-busy','true'); feedback('Checking the retained filings…');
    try {
      const response = await fetch(root.dataset.endpoint, {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json','X-CSRF-Token':root.dataset.csrf}, body:JSON.stringify({companies,claim_id:claim.value,adjustment:adjustment.value}), signal:controller.signal});
      const body = await response.json(); if (current !== generation) return;
      if (!response.ok) throw new Error(body.error || 'The proof could not be calculated. Check your selection and try again.');
      render(body); currentScope = {companies, claim_id: claim.value, adjustment: body.sensitivity.cash_ppe_adjustment_percent}; currentProof = body;
      if (saveButton) saveButton.disabled = false;
      if (recheckButton) recheckButton.disabled = false;
      feedback('Evidence recalculated from the retained filings. No model request was made.');
    } catch (error) {
      if (current === generation) feedback(error.name === 'AbortError' ? 'The check timed out. Your previous results remain below; try again when ready.' : error.message, true);
    } finally {
      clearTimeout(timeout); if (current === generation) { active=null; submit.disabled=false; results.setAttribute('aria-busy','false'); }
    }
  });
  saveButton = document.getElementById('cp-save');
  const savedSelect = document.getElementById('cp-saved'), reopenButton = document.getElementById('cp-reopen'), savename = document.getElementById('cp-savename'), savedStatus = document.getElementById('cp-saved-status'), diffBox = document.getElementById('cp-diff');
  recheckButton = document.getElementById('cp-recheck');
  function savedFeedback(text, error = false) { if (savedStatus) { savedStatus.textContent = text; savedStatus.dataset.error = String(error); } }
  function refreshSaved() {
    if (!savedSelect) return;
    let kept = {};
    try { kept = loadStore(localStorage); } catch (_) { savedFeedback('Saved investigations are invalid. Existing results were preserved.', true); return; }
    const previous = savedSelect.value;
    savedSelect.replaceChildren();
    for (const name of Object.keys(kept).sort()) { const option = document.createElement('option'); option.value = name; option.textContent = name; savedSelect.append(option); }
    if (Object.hasOwn(kept, previous)) savedSelect.value = previous;
    if (!savedSelect.value && savedSelect.options.length) savedSelect.selectedIndex = 0;
  }
  function showProof(scope, proof) {
    for (const box of form.querySelectorAll('[name=company]')) box.checked = scope.companies.includes(box.value);
    claim.value = scope.claim_id;
    adjustment.disabled = scope.claim_id !== 'cash_keeps_pace';
    adjustment.value = scope.adjustment;
    render(proof); currentScope = scope; currentProof = proof;
    if (saveButton) saveButton.disabled = false;
    if (recheckButton) recheckButton.disabled = false;
  }
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.addEventListener('click', () => {
      if (!currentScope || !currentProof) { savedFeedback('Test the claim before saving an investigation.', true); return; }
      try {
        const envelope = saveEnvelope(localStorage, savename.value, currentScope, currentProof);
        refreshSaved(); savedSelect.value = envelope.name;
        savedFeedback(`Saved “${envelope.name}”. Reopening it makes no model request.`);
      } catch (error) { savedFeedback(error.message || 'The investigation could not be saved.', true); }
    });
  }
  if (reopenButton) reopenButton.addEventListener('click', () => {
    if (!savedSelect || !savedSelect.value) { savedFeedback('Choose a saved investigation to reopen.', true); return; }
    try {
      const {scope, proof, name} = openEnvelope(localStorage, savedSelect.value);
      if (diffBox) diffBox.replaceChildren();
      showProof(scope, proof);
      feedback('Reopened a saved investigation. No model request was made.');
      savedFeedback(`Reopened “${name}”.`);
    } catch (error) { savedFeedback(error.message || 'That saved investigation is unavailable.', true); }
  });
  if (recheckButton) {
    recheckButton.disabled = true;
    recheckButton.addEventListener('click', async () => {
      if (!currentScope || !currentProof) { savedFeedback('Test the claim before checking the evidence.', true); return; }
      recheckButton.disabled = true; savedFeedback('Rechecking against the retained filing snapshots…');
      const timeout = setTimeout(() => savedFeedback('The recheck is taking too long. The original result below is unchanged.', true), 10000);
      try {
        const response = await fetch(root.dataset.recheckEndpoint, {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json', 'X-CSRF-Token': root.dataset.csrf}, body: JSON.stringify(currentScope)});
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'The evidence could not be rechecked.');
        const diffs = compareProofs(currentProof, body.result);
        diffBox.replaceChildren();
        if (!diffs.length) { diffBox.append(el('p', 'Evidence matches the retained filing snapshots. The original result below is unchanged.', 'cp-recheck-match')); savedFeedback('Evidence matches the retained snapshots. No model request was made.'); }
        else {
          const list = el('div', undefined, 'cp-recheck-diffs');
          list.append(el('p', `${diffs.length} ${diffs.length === 1 ? 'difference was' : 'differences were'} found. The original result below is unchanged.`));
          const items = el('ul'); for (const line of diffs.slice(0, 50)) items.append(el('li', line)); list.append(items);
          diffBox.append(list); savedFeedback(`${diffs.length} ${diffs.length === 1 ? 'difference was' : 'differences were'} found against the retained snapshots.`, true);
        }
      } catch (error) { savedFeedback(error.message || 'The evidence could not be rechecked.', true); }
      finally { clearTimeout(timeout); if (currentProof) recheckButton.disabled = false; }
    });
  }
  const linked = parseLinkedCompanies(location.search);
  if (linked.length) for (const box of form.querySelectorAll('[name=company]')) box.checked = linked.includes(box.value);
  refreshSaved();
  try { const initial = JSON.parse(document.getElementById('cp-initial').textContent); const chosen = Array.from(form.querySelectorAll('[name=company]:checked'), item => item.value); const served = initial.companies.map(card => card.ticker); if (linked.length && JSON.stringify([...chosen].sort()) !== JSON.stringify([...served].sort())) { if (typeof form.requestSubmit === 'function') form.requestSubmit(); else form.dispatchEvent(new Event('submit', {cancelable: true})); } else { showProof({companies: chosen, claim_id: claim.value, adjustment: initial.sensitivity.cash_ppe_adjustment_percent}, initial); } feedback('Showing reported figures for the selected companies.'); }
  catch (_) { feedback('The initial proof could not be displayed. Test the claim to load it again.', true); }
}());
