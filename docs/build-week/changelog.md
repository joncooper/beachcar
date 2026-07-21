# Build Week challenge changelog

Beachcar is an existing project. This record separates the pre-challenge product and real-world case study from the extension submitted for OpenAI Build Week 2026.

## Eligibility boundary

- Challenge start: **July 13, 2026 at 9:00 a.m. PT / noon ET**.
- Last committed baseline before the start: `e8321d0`, July 13 at 10:48:21 a.m. ET, `Add invite-only managed research pilot`.
- First commit after the start: `16bf7ec`, July 13 at 12:24:11 p.m. ET, `Use GPT-4.1 mini for managed research`.
- Previous audited artifact commit: `bb7645d5ae52da946baa5f16e0f9736841d0ec45`, July 21, `Publish the Beachcar judge demo handoff`.
- Final publicly submitted revision: use the exact commit URL attached to the Devpost entry.

Repository visibility is not the same as submission visibility. The public repository still defaults to an older `main`, so the submission uses the public [`codex/agent-connected-subscriptions`](https://github.com/joncooper/beachcar/tree/codex/agent-connected-subscriptions) branch and the exact release commit linked from Devpost. Judges should not be sent to the repository root alone.

The timestamp boundary establishes what was committed when. Eligibility is narrower than chronology: only the meaningful extension described below is presented as Build Week work.

## What already existed

Before the challenge opened, Beachcar already had:

- a native iPhone review product and React web experience;
- persisted user profile, lanes, source settings, and taste/filter state;
- auction dossiers, source links, and feedback gestures;
- Cloudflare-backed storage and an early agent/MCP direction;
- experiments with managed research and owner-funded cloud inference.

The pink 1960 Willys DJ-3A Surrey discovery and purchase are also treated as prior case-study proof. Beachcar found the car; Jon made the decision and bought it. The submission does not claim that an event-period run found or purchased the Surrey.

## Meaningful Build Week extension

| Before the challenge | Meaningful extension built after the start |
| --- | --- |
| Agent connectivity was a technical option | Local Codex became the explicit product agent, with a coached iPhone-to-desktop handoff |
| Setup depended on technical documentation | A packaged Beachcar skill, installer, starter prompt, taste interview, confirmation step, and scoped connection turn setup into user experience |
| Profile and filter state existed | Nuanced taste calibration and explicit Love/Never again steering are carried into later research planning |
| Research emphasized managed cloud inference and scraping | The intended path moved to the user's local Codex and signed-in browser; marketplace and OpenAI credentials remain with the user |
| MCP exposed product state | The canonical contract reads setup, saves confirmed taste, plans research, submits candidates, publishes, verifies, and exposes audit events |
| Feedback existed in the review app | The judge experience makes decisive feedback visibly alter the next plan |
| No judge-safe product surface | A five-scene deterministic local replay makes the product contract inspectable without accounts or auction credentials |
| No contribution workflow | The skill defines an optional weekly Garage Session with separate consent, one bounded local improvement, isolation, a review packet, and no automatic external action |
| Generic submission identity and no competition package | The actual Surrey leads a rights-tracked identity, narrated film, captions, thumbnail, deck, judge guide, and honest claim ledger |

## Committed event-period evidence

| Commit | Time (ET) | What it contributes | Claim boundary |
| --- | --- | --- | --- |
| `16bf7ec` | Jul 13, 12:24 p.m. | Managed-research model configuration and tests | Post-start maintenance, not the local-agent thesis |
| `89d261e` | Jul 13, 12:32 p.m. | Production Clerk browser-loader fix and tests | Authentication maintenance only |
| `88868b9` | Jul 13, 12:37 p.m. | Google sign-in through Clerk | Interactive sign-in, not recurring MCP OAuth proof |
| `158c7bc` | Jul 13, 12:51 p.m. | Signed-in Clerk rendering fix and tests | Authentication maintenance only |
| `1a549c5` | Jul 20, 11:26 p.m. | Local-Codex product story, eligibility record, judge guide, submission plan, and claim boundary | Narrative and documentation, not live-product proof |
| `ec284a8` | Jul 20, 11:52 p.m. | Installable skill, reduced-scope recurring token path, expanded MCP contract, five-scene replay, and tests | Deterministic/local proof; no friend E2E or public deployment claim |
| `2358146` | Jul 21, 12:51 a.m. | Setup ZIP, friend test plan, rights checklist, handoff UI, deck, rough cut, and supporting tests | Package and test plan; not evidence that a friend completed it |
| `fbc9969` | Jul 21, 12:54 p.m. | Chris-narrated final-cut builder, timed narration source, internal captions, and artifact documentation | Build source; public YouTube upload still external |
| `87b54ef` | Jul 21, 3:22 p.m. | Final-film build source and verified local-master metadata, captions, thumbnail, final deck, deterministic judge replay, local skill, installer hardening, native identity assets, tests, and release documentation | Audited artifact commit; the ignored MP4 remains a local upload artifact. The static demo is deployed separately from this tree; public branch push and YouTube upload remain external |
| `bb7645d` | Jul 21 | Public static judge demo handoff and release links | Public Build Week branch baseline; the final release commit is linked from Devpost |

Any later local or uncommitted work counts only after it is reviewed, committed, pushed, and included in the exact repository revision submitted to judges. A local artifact is not evidence of a public deployment or completed external flow.

## Codex collaboration

Primary Codex task/session ID: `019f8178-f7a2-7301-b9be-f5b0af997b70`. It was confirmed from the active task metadata on July 21. The [official FAQ](https://openai.devpost.com/details/faqs) calls this the `/feedback` Session ID; in Codex Desktop, `/status` can display the same task identifier when `/feedback` opens the feedback dialog.

Codex with GPT-5.6 helped:

- inspect the pre-existing architecture and identify contradictions between the hosted-AI plan and the desired personal-agent experience;
- design and implement the local-agent, user-controlled-browser, and scoped MCP boundaries;
- build and test the coached setup, deterministic replay, feedback steering, installer, and judge package;
- run component-level browser and iPhone Simulator validation without treating it as live end-to-end continuity;
- define the Garage Session consent, isolation, and review gates;
- create and refine the Surrey-led presentation, narration, and film build.

Human decisions included moving away from Beachcar-funded cloud AI as the primary path, keeping marketplace credentials with the user, limiting the shortlist, defining feedback semantics, using the Surrey as prior honest proof, and refusing claims not supported by end-to-end evidence.

## GPT-5.6 roles

1. **Inside the intended product:** GPT-5.6 in local Codex turns nuanced taste and imperfect listing evidence into targeted research, comparative judgment, concise dossiers, risks, and explicit uncertainty.
2. **During Build Week:** GPT-5.6 in the primary Codex task reasoned across the repository, implemented and tested the extension, drove product validation, and assembled submission artifacts.

The repository demonstrates these roles through code, prompts, skill policy, fixtures, and tests. It does not claim a captured production run or paid cloud inference as judge proof.

## Deterministic replay boundary

The local `/demo` route is intentionally deterministic. It uses fixed data to demonstrate:

- the taste interview and structured memory;
- the exact six-tool MCP sequence;
- the shape of a deliberately small shortlist;
- Love and Never again becoming explicit next-plan signals.

It does **not** demonstrate a live scrape, a live remote MCP session, the historical Surrey discovery, a matching run on iPhone, or a completed friend TestFlight journey. The same fixed fixture is now publicly reachable at `https://beachcar-build-week-demo.jon-cooper.workers.dev/demo` on isolated static Worker version `91ede9db-4ec2-458b-984f-6ecd0bdd37c5`. Committed tests cover the fixture and contracts; even a green suite or public hosting does not turn the fixture into live continuity evidence.

## Not claimed as complete

- public YouTube upload and final URL;
- clean-slate friend TestFlight end-to-end completion;
- one live run ID observed across local Codex, MCP verification, and iPhone;
- unattended recurring OAuth or refresh-token support;
- a completed scheduled Garage Session or deployed extension;
- independent inspection of the dealer/photographer's written photo license or credit terms.

These remain external validation or release tasks. They are not silently promoted into Build Week achievements.
