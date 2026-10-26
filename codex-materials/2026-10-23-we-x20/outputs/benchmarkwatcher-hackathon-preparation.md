# BenchmarkWatcher: a filing analyst you can audit

Prepared 23 October 2026 · Indie Dev · Build for Your World

The demo should turn one financial question into a result a researcher can check: the original figures, a reproducible calculation, and the precise evidence supporting each claim. Muse Spark interprets questions and explains verified results; application code controls arithmetic and evidence. A useful refusal is part of the demonstration.

## The three-question demo

Use Microsoft, consolidated FY2024 and FY2025, with fiscal years ending 30 June. Label this a fixed historical dataset, not the latest available results. The questions below are rehearsal prompts; the final video length and submission format remain subject to the competition rules.

| Step | Question to ask | What the judge should see |
| --- | --- | --- |
| 1 · Compare | **“Compare Microsoft's FY2024 and FY2025 revenue and operating margin. Show your calculation.”** | Revenue rises **14.93%**; operating margin moves **44.64% → 45.62%**, an increase of **0.98 percentage points**. Expand a calculation and open its source row. |
| 2 · Follow up | **“For those same years, did free cash flow keep pace? Define it as operating cash flow minus cash additions to property and equipment.”** | Calculated FCF falls **3.32%**. Show the cash bridge: operating cash flow increased by **$17.614bn**, cash PP&E additions by **$20.074bn**, leaving FCF **$2.460bn lower**. Retain company and periods from the preceding turn. |
| 3 · Find the limit | **“Exactly how much of that FY2025 cash PP&E spending was specifically for AI?”** | Explain that the selected consolidated rows do not identify an AI-only amount. Show the coverage limit and relevant cash-flow source; offer the supported aggregate. Do not invent a percentage or relabel all PP&E spending as AI. |

These are calculated expectations from the official reports below, not recorded model results. The cash bridge is an arithmetic explanation, not proof of a single economic cause.

For a three-minute internal rehearsal: 20 seconds on the research problem, 50 on question 1, 50 on the follow-up, 30 on the limitation, and 30 on the evidence checks and new Meta work. Adapt this to the eventual official video limit. Keep the source panel visible long enough to read; a live number changing should never substitute for showing its origin.

## Source pack and reference figures

| Filing | Official reading copy | SEC identity |
| --- | --- | --- |
| FY2024, ended 2024-06-30 | [Microsoft 2024 annual report](https://www.microsoft.com/investor/reports/ar24/index.html), Income Statements and Cash Flows Statements | [10-K index, filed 2024-07-30](https://www.sec.gov/Archives/edgar/data/789019/000095017024087843/0000950170-24-087843-index.htm); accession `0000950170-24-087843` |
| FY2025, ended 2025-06-30 | [Microsoft 2025 annual report](https://www.microsoft.com/investor/reports/ar25/index.html), Income Statements and Cash Flows Statements | [10-K index, filed 2025-07-30](https://www.sec.gov/Archives/edgar/data/789019/000095017025100235/0000950170-25-100235-index.htm); accession `0000950170-25-100235` |

All inputs are **USD millions**. PP&E is a cash outflow in the statements; the table uses its positive magnitude.

| Input or calculation | FY2024 | FY2025 | Basis |
| --- | ---: | ---: | --- |
| Revenue | 245,122 | 281,724 | Reported |
| Operating income | 109,433 | 128,528 | Reported |
| Operating cash flow | 118,548 | 136,162 | Reported |
| Cash PP&E additions | 44,477 | 64,551 | Reported outflow magnitude |
| Operating margin | 44.6442995733% | 45.6219562409% | Operating income / revenue × 100 |
| Calculated FCF | 74,071 | 71,611 | Operating cash flow − cash PP&E additions |

Compute before rounding. Growth is `(new − old) / old × 100` when the old value is positive; margin change is the difference between unrounded margins, expressed in **percentage points**. Divide USD millions by 1,000 to display billions. At the existing application's USD boundary, multiply the fixture's monetary inputs by 1,000,000 exactly once.

FCF here is a defined analyst calculation, not a GAAP statement row or total capital investment. It does not subtract noncash finance-lease additions or separately deduct finance-lease financing cash flows. Do not say it excludes every purchase financed by borrowing. The relevant distinction is cash-flow classification. [FY2025 report, Note 13—Leases](https://www.microsoft.com/investor/reports/ar25/index.html).

The dataset supports reported consolidated comparisons, not organic growth, constant-currency growth or segment comparisons. Freeze explicit dates: FY2024 is 2023-07-01 through 2024-06-30; FY2025 is 2024-07-01 through 2025-06-30. Missing values remain missing. A question about calendar 2025 cannot silently become FY2025.

The companion [evaluation fixture](./benchmarkwatcher-hackathon-evaluation.json) contains eight source facts, exact expected calculations, source IDs and 26 proposed checks. It is a portable specification, not an application test runner. Source identity and table values were checked online; full filings were not downloaded or ingested into BenchmarkWatcher. During implementation, save the permitted bounded evidence and its retrieval date/hash so a later source refresh cannot silently alter a demonstration.

## Existing foundation and work to claim honestly

The reviewed public baseline is [commit dd870e2](https://github.com/alikatgh/benchmarkwatcher/commit/dd870e202f9aeadeba3a548d8ca25f159ae84d8e). This is a source snapshot, not proof of the production deployment or runtime behavior.

| Already present at that revision | Proposed hackathon addition |
| --- | --- |
| SEC company research, fiscal periods, reported metrics and provenance | A frozen two-year demo dataset with independently checked answers |
| Deterministic operating margin, FCF and comparisons | A Muse Spark query planner constrained to allowed metrics, periods and operations |
| Local question handling and existing Jev/DeepSeek paths | A Meta adapter and a question-to-calculation-to-explanation flow |
| Source links, bounded evidence and citation-ID syntax checks | Selection of the actual operand evidence and validation of each factual claim |
| Existing company workspace and numerical displays | A concise answer with expandable calculation, source row and limitations |

Relevant seams: [company_answers.py](https://github.com/alikatgh/benchmarkwatcher/blob/dd870e202f9aeadeba3a548d8ca25f159ae84d8e/app/company_answers.py#L89), [company_financials.py](https://github.com/alikatgh/benchmarkwatcher/blob/dd870e202f9aeadeba3a548d8ca25f159ae84d8e/app/company_financials.py#L245), and [company research documentation](https://github.com/alikatgh/benchmarkwatcher/blob/dd870e202f9aeadeba3a548d8ca25f159ae84d8e/docs/COMPANY_RESEARCH.md).

The present commentary path takes recent periods and accession-level sources and checks citation IDs. A valid source ID alone does not establish that a claim is supported. The new path should select evidence by the requested periods and every calculation operand, retaining row, dates, unit, value and accession. This is a concrete improvement to demonstrate and measure.

Preserve the existing numerical charts and exact-value/source disclosures. This preparation follows the prior recorded preference for D3 numerical displays; recheck the current UI before implementation. A new charting stack, mobile client, arbitrary-web research agent and general forecasting system are outside this ten-day scope.

## Smallest credible implementation

1. Resolve the user's company, fiscal periods and metric intent. Keep conversational state explicit. Ask a short clarification when “margin” or a period is ambiguous.
2. Let Muse Spark propose only an allowlisted plan. Validate company, metric IDs, period IDs, operation, units and duration before calling the existing calculator. Model text must not execute code, fetch arbitrary URLs or replace financial facts.
3. Return a result object with raw operands, formulas, exact periods, units and source-fact IDs. For the cash bridge, calculate the two deltas and reconcile them to the FCF delta in application code.
4. Ask Muse Spark to explain those results with claim IDs. Fill numerical placeholders from the result object; reject new quantities, unsupported source mappings and invented causal claims. For this narrow demo, allow only supported comparison/bridge explanations and explicit coverage limitations. General semantic citation verification is not a ten-day guarantee.
5. Render reported facts, calculated results and interpretation distinctly. Source interaction opens the matching table/row or a precise local excerpt with the official link. If the model fails, retain the verified calculation and label the explanation unavailable.

Proposed workload bounds, to implement and test before live use: at most **two model requests per user turn**, **zero automatic retries**, **30 seconds per request / 60 seconds total**, **70,000 bytes of serialized evidence**, **2,048 generated tokens per request**, and **one in-flight turn per demo session**. Reject over-limit input before inference. Pin the actual available Muse Spark model ID after acceptance; do not assume an SDK or structured-output feature is supported.

These are application limits, not a spending cap. Before the first real request, verify the account's included allowance, all relevant meters, no automatic recharge and a provider-enforced maximum within authorized spending. An event credit offer does not prove overages stop. Until that is established, use the local calculator and fake provider responses. The runtime credential must have no billing-admin powers. No spending, provider activation, deployment or product code changes occurred during this preparation.

## Pass/fail contract

| Check | Passing evidence |
| --- | --- |
| Numerical correctness | All sourced arithmetic cases match the fixture. Money is exact at input precision; ratios agree within `1e-8` percentage units. Rounded answers preserve sign, scale and percentage-point meaning. |
| Citation support | Every financial quantity maps to its source facts; every derived result maps to all operands and the formula. A real but irrelevant citation fails. Zero fabricated or unsupported factual claims in the checked answers. |
| Coverage and restraint | Unknown fiscal periods, missing operands, incompatible currencies/durations and AI-only spending requests receive the specified limitation or clarification. Zero invented substitute values. |
| Conversation | The follow-up retains Microsoft and both fiscal periods; changing company/period explicitly replaces that state. No cross-user state reuse. |
| Resilience and privacy | Invalid plans, source-text instructions, timeout, duplicate sends and exhausted budget do not bypass checks or launch uncontrolled requests. Required per-send consent remains enforced. |
| Demo quality | All three paths work from a fresh session; calculation/source expansion and error recovery are inspected in the rendered interface. Record actual latency and disclose any replay. |

The 26 cases in the JSON are **not run against the application**. Today’s completed checks are source verification, independent arithmetic, fixture structure and reference consistency. A green fixture-validation check does not mean Muse Spark or BenchmarkWatcher has passed these cases.

For model evaluation, freeze prompts and expected outcomes before running. Reserve a small holdout of unseen paraphrases and ambiguous follow-ups; report its results separately from development prompts. Log model ID, application commit, evidence version, prompt version, response, latency and usage without credentials or private user content. Fail the demo release for any wrong number or fabricated claim. Scope claims to the sample actually evaluated; do not advertise a general accuracy percentage from three rehearsed questions.

Impact evidence should be modest and real: time the same filing-comparison task manually and through the prototype, retain the task/result, and report who performed it. Do not invent users, testimonials or time savings. Highlight Meta's actual role with successful and rejected query plans, not a logo alone.

## Ten-day build plan

Dates below follow the event's October 26–November 4 calendar. Schedule local work blocks after the actual kickoff. Each day has a concrete stopping point.

| Day | Event date | Deliverable and completion check |
| --- | --- | --- |
| 1 | Oct 26 | Confirm acceptance, read final rules and permitted reuse, record exact kickoff/deadline/video requirements. Preserve the pre-event commit and disclose this preparation. Create an isolated work branch only after the allowed start. Verify available Meta model and cost controls before real calls. |
| 2 | Oct 27 | Freeze the two filings, eight facts and provenance. Import only supported rows; reconcile all inputs, signs, units and fiscal dates to the fixture. |
| 3 | Oct 28 | Build the bounded Meta adapter and validated planner. Test malformed output, unsupported IDs, request limits and failure with fakes. |
| 4 | Oct 29 | Connect the existing calculator and cash bridge. Pass comparison, margin, sign, missing-data, zero-base and unit/date checks. |
| 5 | Oct 30 | Add constrained explanation and claim-to-source mapping. Reject wrong-row citations and invented numbers/causes; preserve deterministic results on failure. |
| 6 | Oct 31 | Complete the three user journeys and source panel. Inspect desktop and narrow-screen rendering, follow-up state, keyboard access and recovery. |
| 7 | Nov 1 | Run the offline fixture and relevant existing regressions. Obtain fresh independent review of the changed provider/validation/privacy paths; resolve material findings. |
| 8 | Nov 2 | If account controls permit, run a finite live evaluation and holdout. Proposed maximum: 40 turns / 80 requests, further reduced by the verified allowance. Record results and actual task timing; fix failures before expanding scope. |
| 9 | Nov 3 | Rehearse the complete demo and record the video to the published limit. Prepare README with setup, new-vs-existing work, limitations and reproduced evidence. Verify the exact demonstration revision. |
| 10 | Nov 4 | Freeze features, rerun only affected checks, verify all submission links from a fresh session, and submit the required package with time to recover from portal errors. Retain the receipt and submitted revision. |

If official rules disallow existing project reuse, do not claim the old application as new work. Re-scope to an allowed standalone demonstration and disclose pre-event research/fixtures as required. If the smaller scope cannot meet the rules or the schedule, revise the submission rather than conceal reuse.

## Dates and unresolved requirements

The [event page](https://cerebralvalley.ai/e/meta-ai-developer-hackathon), checked 23 October, still says final rules will be published before October 26. Existing-code reuse, exact deliverables and video duration therefore remain unverified. The live application was previously confirmed **Pending** after submission; this pack is preparation, not acceptance.

- Approval notification is listed by **October 26, 9 a.m. ET = October 26, 9 p.m. Ulaanbaatar**.
- Project deadline is **November 4, 9 p.m. ET = November 5, 10 a.m. Ulaanbaatar**. The conversion accounts for the US daylight-saving change.
- Internal targets: freeze at **November 4, 8 p.m. Ulaanbaatar**; aim to finish submission by **November 5, 8 a.m. Ulaanbaatar**, two hours before the listed deadline.
- Recheck the official page and accepted-participant instructions because dates may change. The event header's “EST” label is inconsistent with October daylight time; use the confirmed kickoff invitation rather than guessing its local time.

No reminder or background monitor has been created. The next task after acceptance is the Day 1 rules-and-access check, followed by implementation within the confirmed competition window.
