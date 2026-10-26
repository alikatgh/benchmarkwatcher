# Meta Global AI Developer Hackathon — application draft

Prepared 23 October 2026. **Not submitted.** The application currently awaits Cerebral Valley email verification. These answers are ready to adapt to the form's exact questions and limits once signed in.

## Recommended application

**Proposed project:** BenchmarkWatcher — verifiable answers from company filings.

**Theme:** Build for Your World.

**Working track:** Indie Developer, subject to confirming the applicant's team/founder status. No teammates have been identified or invented.

**Past AI project:** Quenderin.

This choice combines a narrow, demonstrable ten-day project with public source code that reviewers can inspect. BenchmarkWatcher already has historical calculations and cited commentary; the hackathon contribution should be a clearly identified new Meta integration and evaluation, with pre-existing work disclosed. The final Official Rules must be checked for their treatment of existing projects.

## Proposed-project answer

I want to build a research assistant that answers questions about company filings and makes each calculation and source easy to inspect. The problem is practical: people spend time moving between reports and spreadsheets, while a fluent AI explanation can conceal a wrong number, an incompatible reporting period, or missing evidence.

I will build on BenchmarkWatcher's existing historical-data and calculation foundation. During the hackathon, I plan to integrate Muse Spark to turn a question into a bounded, validated query plan. Application code will calculate the result from reported data, and the model will explain it using linked evidence. The interface will distinguish reported figures, calculated values and interpretation.

The ten-day scope is deliberately small: a fixed set of public company filings, a few financial metrics, two-period comparisons and follow-up questions. The demo will show a correct answer, its supporting calculation and filing, and an unsupported question that the assistant declines. I will evaluate numerical correctness, citation support and handling of missing data. This is historical research, without trading actions or price predictions.

## Past-AI-project answer

One of my AI projects is Quenderin, an open-source assistant for running open models locally. The repository includes native SwiftUI clients for Apple platforms, a Kotlin/Jetpack Compose Android client, an Electron desktop client and a TypeScript CLI.

The engineering goes beyond a chat interface. It includes streaming generation, context and output limits, model downloads checked against GGUF headers and catalog integrity metadata, and a tool-execution loop with permission checks and previews. The CLI supports workspace-scoped tasks, approval before changes, and a local history of actions.

My focus is making AI behavior inspectable and controlled: the user chooses the model, can see what a tool intends to do, and keeps local conversations on the device. This project gives me relevant experience with model integration, inference lifecycles and interfaces for reviewing AI actions. I distinguish implemented source features from validated release behavior; I am not claiming unmeasured performance or validation of every recently added model.

## Links for the application

- GitHub profile: https://github.com/alikatgh
- Proposed project's existing foundation: https://github.com/alikatgh/benchmarkwatcher
- Past AI project: https://github.com/alikatgh/quenderin
- Quenderin product website: https://quenderin.org

## Evidence checked

Read-only GitHub review; no software was run or deployed for this application.

- BenchmarkWatcher historical calculations, bounded metrics/periods, citation checks and current provider paths: https://github.com/alikatgh/benchmarkwatcher/blob/main/app/company_answers.py
- BenchmarkWatcher company research documentation: https://github.com/alikatgh/benchmarkwatcher/blob/main/docs/COMPANY_RESEARCH.md
- Quenderin platform scope and explicit validation limits: https://github.com/alikatgh/quenderin/blob/main/README.md
- Quenderin GGUF/header, optional expected-size and pinned-hash verification: https://github.com/alikatgh/quenderin/blob/main/src/services/modelIntegrity.ts
- Quenderin local generation: https://github.com/alikatgh/quenderin/blob/main/src/services/localTokenGeneration.ts
- Quenderin governed agent loop: https://github.com/alikatgh/quenderin/blob/main/src/services/capability/capabilityAgent.ts

The review also considered AgentWatcher, Lantern, le-cli, Sakha LLM, OpenScience and PDF Retypeset. No private source code or private project documents were submitted to the organizers.

## Remaining application inputs

- Complete the email verification in Cerebral Valley; do not paste the code into this document or chat.
- Read the full signed-in form and adapt the draft to its exact prompts and character limits.
- Confirm the applicant's actual full name, residence, age/eligibility and team status where the form requests them. A repository profile or browser timezone does not prove these facts.
- Review and explicitly approve the event waiver before accepting it. Do not treat this draft as acceptance.
- Verify the submitted application confirmation after the final authorized action.

## Deadline and terms

The event's Key Dates section gives **25 October 2026, 11:59 p.m. ET**, which is **26 October, 11:59 a.m. in Ulaanbaatar** using New York time. Applications may close earlier when 20,000 participants are accepted. The waiver body inconsistently says EST; use the earlier ET cutoff and apply promptly.

The waiver states that participants keep ownership of their submissions but grant organizers a broad, perpetual, irrevocable licence to use and modify them. It also includes sponsor marketing/data sharing, publicity rights, liability release and indemnification. Official Rules are due before 26 October and must also be accepted by selected participants. This is a factual summary of the displayed terms, not legal advice.

- Application: https://cerebralvalley.ai/e/meta-ai-developer-hackathon/apply
- Event and dates: https://cerebralvalley.ai/e/meta-ai-developer-hackathon
- Application overview and waiver: https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver
