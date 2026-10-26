# Meta Global AI Developer Hackathon — filled application

23 October 2026. **Submitted after the user's explicit eligibility confirmation and agreement to the event waiver and linked Meta terms.** The event page now shows **Pending**. This confirms submission, not acceptance into the hackathon. The entered answers were read back before submission.

## What do you want to build for this hackathon?

I want to build a filing analyst that shows its work: BenchmarkWatcher with Muse Spark. Independent researchers should be able to ask a question about a company's reported results without manually moving between long filings and spreadsheets—or trusting an AI-generated number they cannot verify.

A user could ask, 'How did revenue and operating margin change between these two fiscal years?' Muse Spark will interpret the question and follow-ups, then propose a structured query plan. The application will validate the metrics, units and periods and calculate the result deterministically. Muse Spark will explain the verified result using filing evidence. Each answer will expose the underlying figures, calculation and source links, and distinguish reported facts from interpretation. Missing data and incompatible comparisons will produce a clear limitation instead of an invented answer.

My existing BenchmarkWatcher code supplies historical data, calculations and source handling. The new hackathon work will be the Meta integration, the question-to-evidence workflow and an evaluation set covering numerical accuracy, citation support and appropriate abstention. I will keep the ten-day demo to a fixed set of public filings and a few useful metrics, showing a comparison, a follow-up and an unsupported question. This fits Build for Your World: turning public information into research people can inspect and trust.

Existing foundation: https://github.com/alikatgh/benchmarkwatcher

## Tell us about an AI project you recently built that showcases your technical skills

I develop Quenderin, an open-source assistant for running open models locally. The repository includes SwiftUI clients for macOS/iOS, a Kotlin/Jetpack Compose Android client, an Electron desktop client and a TypeScript CLI. Local conversations can run on the user's device without a hosted inference account.

The technical work includes streaming token generation, context/output limits, cancellation, model-fit checks and model-file integrity verification. Before loading a model, the desktop implementation checks the GGUF header, expected size when available and catalog-pinned SHA-256 hashes. Shared model definitions and regression fixtures help keep the different clients consistent.

The desktop/CLI agent adds a governed tool loop: workspace-scoped access, action previews, approval before changes, step limits, malformed-output recovery, cancellation and audit logging. Reversible file tasks have an undo journal. The model proposes an action; application code validates and governs its execution.

This project demonstrates the skills I will bring to the hackathon: integrating model runtimes, designing native and web interfaces, handling long-running inference, and separating model output from trusted execution. For BenchmarkWatcher, I will apply that same separation to query plans, calculations and evidence.

Code: https://github.com/alikatgh/quenderin
Product: https://quenderin.org

## Selected answers

- Track: Indie Dev Track (preserved from the user's form).
- Previously used Meta Model API: No (user confirmed).
- Likelihood of building with Meta Model API: Very likely, consistent with the proposed project.
- Overall opinion: Very favorable (user confirmed).
- Heard about the hackathon: X (Twitter) (user confirmed).
- Optional Meta marketing emails: No.
- Existing LinkedIn, X, GitHub, residence and workplace entries were preserved.

## Final consent

The form requires the event waiver and states that submitting also agrees to the linked Meta terms and shares application information with Meta. The waiver states that entrants retain ownership but grant broad perpetual, irrevocable rights to submitted materials. It includes liability release, indemnification, publicity rights and sponsor data sharing. Declining the separate marketing-email option does not remove the waiver's provisions.

- Event waiver: https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver
- Terms linked by the form: https://facebook.com/legal/terms
- Application: https://cerebralvalley.ai/e/meta-ai-developer-hackathon/apply

The event waiver was read in the browser. The linked Meta terms redirected the web reader to login, so their full text was not independently reviewed here. No claim is made that the new hackathon feature is already implemented or that selection or a prize is guaranteed.
