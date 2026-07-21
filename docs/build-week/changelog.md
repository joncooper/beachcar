# Build Week challenge work

Beachcar is an existing project. This document separates the pre-challenge product from the extension being judged for OpenAI Build Week 2026.

## Eligible baseline

- Challenge opened: July 13, 2026 at 9:00 a.m. PT / noon ET.
- Baseline commit: [`e8321d0`](https://github.com/joncooper/beachcar/commit/e8321d0c27edd0d21aca2936ef04ae601e0ef4af)
- Baseline time: July 13, 2026 at 10:48 a.m. ET, before the challenge opened.
- Baseline subject: `Add invite-only managed research pilot`.

The baseline already included a native review product, user taste/profile state, source-backed auction dossiers, a React PWA, Cloudflare storage, feedback gestures, and an MCP concept. Those are context, not claimed as new Build Week work.

## Meaningful Build Week extension

| Before | Built during Build Week |
| --- | --- |
| Agent connectivity existed as a technical option. | A coached iPhone-to-desktop onboarding makes local Codex the explicit product path. |
| Setup relied on technical documentation. | A downloadable Beachcar skill, desktop coach, MCP config, taste interview, confirmation step, and starter prompt turn setup into product UX. |
| Basic profile/filter state. | Nuanced taste calibration and explicit steering travel through MCP into later research. |
| Research architecture emphasized owner-funded cloud inference and scraping. | Research moves to the user's local Codex, GPT-5.6, and signed-in browser; Beachcar stores no marketplace or OpenAI credentials. |
| MCP could expose product state. | The canonical loop reads setup, plans, submits candidates, publishes, and verifies the exact run shown to the user. |
| Review feedback existed in the app. | The judge experience makes Love and Never again visibly change the next research plan. |
| Generic beach-car visual identity. | The real pink Surrey outcome becomes a distinctive, moon-free identity across app, web, and submission. |
| No competition proof package. | A deterministic judge replay, automated golden-path proof, rights-safe collateral, timed narration, deck, and video package document the result. |

## Codex collaboration

Primary Codex task ID: `019f8178-f7a2-7301-b9be-f5b0af997b70`

Codex was used to:

- inspect the pre-existing architecture and identify story/implementation contradictions;
- design the local-agent boundary and scoped MCP workflow;
- implement web, Worker, and SwiftUI changes;
- drive the browser and iOS simulator during visual validation;
- write and run cross-platform tests;
- generate and refine the Surrey-led identity;
- audit competition rules and produce the judge/video package.

Human decisions included abandoning the owner-funded cloud-AI default, keeping credentials in the user's browser, making the shortlist deliberately small, defining feedback semantics, selecting the Surrey as honest proof, and deciding what claims were not yet earned.

## GPT-5.6 contribution

GPT-5.6 has two inspectable roles:

1. **Inside the product:** local Codex uses GPT-5.6 to turn nuanced taste and messy auction evidence into a research plan, candidate comparison, evidence-backed dossier, risk summary, and explicit uncertainty.
2. **During the build:** this primary Codex task used GPT-5.6 to reason across the repository, implement and test the challenge extension, drive the product, and build the submission package.

The demo and README must name both roles. “AI-powered” is not sufficient evidence.

## Challenge commits

This table is completed as each of the three passes lands.

| Pass | Commit | Scope |
| --- | --- | --- |
| 1 — narrative | Pending | Truthful README, competition plan, judge guide, submission copy, and claim boundary. |
| 2 — proof | Pending | Deterministic judge experience, local-run truth, recurring token setup, polling, and golden-path tests. |
| 3 — collateral | Pending | Surrey identity, fresh captures, storyboard, narration, deck, and playable rough cut. |
