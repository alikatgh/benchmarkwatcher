/* Ranked shortfall list as a React island (React 18 UMD + htm, no build step).
 *
 * Presentational only: props carry the validated proof; all fetching,
 * state, saving and budget guards stay in the vanilla controller, which
 * mounts this island per recalculation. Class names match claim-proof.css,
 * so the visual system does not change with the renderer.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  const React = window.React;
  const html = window.htm && window.htm.bind
    ? window.htm.bind(React.createElement)
    : null;

  const VERDICTS = {
    supported: 'Claim supported',
    contradicted: 'Claim contradicted',
    unavailable: 'Evidence unavailable',
  };

  function Metric({ label, value, helpers }) {
    return html`
      <div>
        <dt>${label}</dt><dd>${helpers.percent(value)}</dd>
      </div>
    `;
  }

  function Arithmetic({ card, breakEven }) {
    const pretty = (value, unit) => {
      if (value === null || value === undefined) return 'Unavailable';
      const numeric = Number(value);
      return Number.isFinite(numeric)
        ? numeric.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' ' + unit
        : String(value) + ' ' + unit;
    };
    return html`
      <details>
        <summary>Inspect the calculation</summary>
        <p>The verdict uses exact source arithmetic. Displayed percentages are rounded.</p>
        ${breakEven ? html`<p>${breakEven}</p>` : null}
        <table className="cp-calc">
          <caption>Exact inputs; rounded display</caption>
          <thead><tr><th scope="col">Calculation</th><th scope="col">Result</th><th scope="col">Formula</th></tr></thead>
          <tbody>
            <tr>
              <th scope="row">Verdict comparison</th>
              <td className="cp-calc-number">${card.actual_comparison_formula ? 'See formula' : 'Unavailable'}</td>
              <td><code>${card.actual_comparison_formula || 'No valid comparison available.'}</code></td>
            </tr>
            ${card.formulas.map(formula => html`
              <tr key=${formula.id || formula.label}>
                <th scope="row">${formula.label}</th>
                <td className="cp-calc-number" title=${formula.value === null ? 'Unavailable' : String(formula.value) + ' ' + formula.unit}>
                  ${pretty(formula.value, formula.unit)}
                </td>
                <td><code>${formula.formula || 'No valid comparison available.'}</code></td>
              </tr>
            `)}
          </tbody>
        </table>
      </details>
    `;
  }

  function FilingSources({ card, helpers }) {
    const human = value => {
      if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return value;
      return Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
    };
    const groups = [];
    const byAccession = new Map();
    for (const fact of card.facts) {
      const key = fact.accession || fact.id;
      if (!byAccession.has(key)) byAccession.set(key, []);
      byAccession.get(key).push(fact);
    }
    let groupIndex = 0;
    for (const items of byAccession.values()) {
      const first = items[0];
      const url = helpers.safeSource(first.url);
      groups.push(html`
        <div className="cp-filing" key=${'g' + (groupIndex++)}>
          <div className="cp-filing-head">
            <strong>${first.start} to ${first.end}</strong>
            <span className="cp-note">Filed ${first.filed} · ${first.accession}</span>
            ${url ? html`<a href=${url} target="_blank" rel="noopener noreferrer">Open SEC filing</a>` : null}
            <span className="cp-note">Source hash ${String(first.source_sha256).slice(0, 16)}…</span>
          </div>
          ${items.map(fact => {
            const negative = typeof fact.value === 'string' && fact.value.trimStart().startsWith('-');
            return html`
              <div className="cp-fact" key=${fact.id}>
                <strong>${fact.id}</strong>
                <span>${fact.row}</span>
                <span className="cp-value" title=${fact.reported_value + ' ' + fact.reported_unit}>
                  ${human(fact.reported_value)} ${fact.reported_unit} reported
                </span>
                <span className=${'cp-normalized' + (negative ? '' : '')} data-sign=${negative ? 'negative' : null} title=${fact.value + ' ' + fact.unit}>
                  Normalized ${human(fact.value)} ${fact.unit} (${fact.normalization})
                </span>
              </div>
            `;
          })}
        </div>
      `);
    }
    return html`
      <details>
        <summary>Inspect ${card.facts.length} filing facts</summary>
        ${groups}
      </details>
    `;
  }

  function RankCard({ card, rank, proof, helpers, scenario }) {
    const measureLabel = proof.claim_id === 'cash_keeps_pace'
      ? (scenario ? 'Hypothetical FCF growth' : 'Calculated FCF growth')
      : 'Operating income growth';
    const growthKey = scenario ? 'scenario_growth' : 'actual_growth';
    const statusKey = scenario ? 'scenario_status' : 'actual_status';
    const status = card[statusKey];
    const gap = (() => {
      for (const key of [growthKey, 'revenue_growth']) {
        if (typeof card[key] !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(card[key]) || !Number.isFinite(Number(card[key]))) return null;
      }
      return Number(card.revenue_growth) - Number(card[growthKey]);
    })();
    const breakEven = proof.claim_id === 'cash_keeps_pace'
      && card.break_even_adjustment_percent !== null
      && card.break_even_adjustment_percent !== undefined
      ? `Equal-growth PP&E adjustment: ${helpers.percent(card.break_even_adjustment_percent)}${card.break_even_within_scenario_range ? '.' : ' (outside the supported scenario range).'} ${card.break_even_note || ''}`
      : null;
    return html`
      <li className="cp-rank" data-verdict=${status} data-ticker=${card.ticker}>
        <div className="cp-rank-head">
          <span className="cp-rank-num">${rank}</span>
          <div className="cp-rank-who">
            <h3>${card.company}</h3>
            <span className="cp-verdict">${(scenario ? 'Hypothetical: ' : '') + (VERDICTS[status] || VERDICTS.unavailable)}</span>
          </div>
          <span className="cp-rank-gap">${gap === null ? 'Growth gap unavailable' : `${scenario ? 'Hypothetical gap' : 'Shortfall'} ${helpers.percent(String(gap))}`}</span>
        </div>
        <dl className="cp-metrics">
          <${Metric} label=${measureLabel} value=${card[growthKey]} helpers=${helpers} />
          <${Metric} label="Revenue growth" value=${card.revenue_growth} helpers=${helpers} />
        </dl>
        ${status !== 'supported' && status !== 'contradicted'
          ? html`<p className="cp-explanation">${helpers.describeVerdict(card, proof.claim_id, scenario)}</p>` : null}
        ${card.reason ? html`<p>${card.reason}</p>` : null}
        ${breakEven && card.break_even_within_scenario_range ? html`<p className="cp-note">${breakEven}</p>` : null}
        <p className="cp-note">${card.period_details.map(period => `${period.id}: ${period.start} to ${period.end}`).join(' · ')}</p>
        ${card.measurement_note ? html`<p className="cp-note">${card.measurement_note}</p>` : null}
        <${Arithmetic} card=${card} helpers=${helpers} breakEven=${breakEven && !card.break_even_within_scenario_range ? breakEven : null} />
        <${FilingSources} card=${card} helpers=${helpers} />
      </li>
    `;
  }

  function RankList({ proof, helpers }) {
    const adjustment = proof.sensitivity && proof.sensitivity.cash_ppe_adjustment_percent;
    const scenario = proof.claim_id === 'cash_keeps_pace'
      && typeof adjustment === 'string' && /^-?\d+(?:\.\d+)?$/.test(adjustment)
      && Math.abs(Number(adjustment)) <= 50 && Number(adjustment) !== 0;
    const order = helpers.rankShortfall(proof, scenario);
    const byTicker = new Map(proof.companies.map(card => [card.ticker, card]));
    return html`
      ${scenario ? html`<p className="cp-note cp-scenario-note">Hypothetical PP&E scenario (${helpers.percent(adjustment)}). Arithmetic on retained figures, not a forecast.</p>` : null}
      <ol className="cp-ranking">
        ${order.map(({ ticker }, index) => html`
          <${RankCard} key=${ticker} card=${byTicker.get(ticker)} rank=${index + 1} proof=${proof} helpers=${helpers} scenario=${scenario} />
        `)}
      </ol>
    `;
  }

  const roots = new WeakMap();

  function mount(container, proof, helpers) {
    if (!window.ReactDOM || !html) throw new Error('The ranking renderer is unavailable.');
    unmount(container);
    const root = window.ReactDOM.createRoot(container);
    roots.set(container, root);
    root.render(html`<${RankList} proof=${proof} helpers=${helpers} />`);
  }

  function unmount(container) {
    const root = roots.get(container);
    if (root) {
      try { root.unmount(); } catch (_) { /* A torn-down container never blocks the next render. */ }
      roots.delete(container);
    } else {
      container.replaceChildren();
    }
  }

  window.BWClaimRanking = { mount, unmount };
})();
