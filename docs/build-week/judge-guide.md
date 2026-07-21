# Beachcar judge guide

Beachcar is a personal car-finding agent built around a simple result: it learned Jon's unusually specific taste, found a pink 1960 Willys DJ-3A Surrey he did not know to search for, and Jon bought it.

The Build Week extension packages that path for another user. Local Codex interviews the user, researches with the browser the user already controls, and exchanges taste, evidence, feedback, and a small shortlist through Beachcar's user-scoped MCP. An optional weekly Garage Session can prepare one small local improvement, but it stops for the user's review before anything is sent or published.

## Fastest working-project path

Open the verified, no-login static replay:

**https://beachcar-build-week-demo.jon-cooper.workers.dev/demo**

Cloudflare Worker version `91ede9db-4ec2-458b-984f-6ecd0bdd37c5` serves only the static judge package. The root redirects to `/demo`; all five scene URLs were verified signed out with browser-style HTML requests on July 21. It has no Clerk binding, Worker code, database, storage, AI, schedule, route, workflow, or container.

The exact same replay also runs locally without a Beachcar account, auction login, TestFlight build, cloud secret, or paid service. The public submission branch is linked below; the Devpost entry carries the exact audited commit URL.

Prerequisite: [Bun](https://bun.sh/) installed.

```bash
git clone --branch codex/agent-connected-subscriptions --single-branch https://github.com/joncooper/beachcar.git
cd beachcar
bun install
bun run dev -- --port 5173 --strictPort
```

Then open:

```text
http://127.0.0.1:5173/demo?scene=proof
```

Use the on-screen controls, left/right arrows, number keys 1-5, or `R` to reset. The five stable local links are:

1. `http://127.0.0.1:5173/demo?scene=proof` - the real Surrey outcome and the replay's limits.
2. `http://127.0.0.1:5173/demo?scene=teach` - a plain-language taste interview becoming structured Beachcar memory.
3. `http://127.0.0.1:5173/demo?scene=research` - local Codex, GPT-5.6, the user's signed-in browser, and the MCP contract.
4. `http://127.0.0.1:5173/demo?scene=review` - a fixed, evidence-shaped shortlist rather than an endless feed.
5. `http://127.0.0.1:5173/demo?scene=learn` - Love and Never again becoming explicit input to the next plan.

The route is a deterministic replay: a fixed fixture designed to make the product contract easy to inspect. Its public hosting is verified, but it is not a recording of the run that found the Surrey, a live scrape, or a live MCP session.

## Optional repository checks

In a second terminal from the repository root:

```bash
bun run typecheck
bun run test
VITE_CLERK_PUBLISHABLE_KEY=pk_test_build_validation bun run build
```

The most relevant implementation and test files are:

- [Project README](../../README.md)
- [Build Week replay](../../src/client/build-week/BuildWeekDemo.tsx)
- [Replay fixture and exact MCP sequence](../../src/client/build-week/fixture.ts)
- [Beachcar MCP](../../src/worker/mcp.ts)
- [Local Beachcar skill](../../.agents/skills/beachcar-daily-run/SKILL.md)
- [Replay tests](../../tests/build-week-demo.test.ts)
- [MCP contract tests](../../tests/mcp-contract.test.ts)
- [Installer tests](../../tests/automation-install.test.ts)
- [Build Week eligibility changelog](changelog.md)

## What the full personal flow is designed to do

1. The user completes Beachcar taste setup and chooses **Connect your own agent**.
2. On desktop, the user installs the Beachcar skill and connects local Codex to the Beachcar MCP with a user-scoped, revocable token.
3. Codex asks a short taste interview and shows its summary before saving anything.
4. The user signs into auction sources directly in their own browser when a source requires it.
5. Codex researches, submits source-backed candidates, publishes a small shortlist, and verifies the published run.
6. The user reviews that shortlist in Beachcar and records feedback such as Love or Never again.
7. The next Codex plan receives those explicit signals.
8. Only after a successful supervised run may the user separately opt into recurring research or the weekly Garage Session.

This is the intended product sequence, not a claim that a clean-slate friend has completed every step. The friend TestFlight flow, one-run continuity across Codex/MCP/iPhone, a scheduled recurring run, and token-expiry behavior still require external end-to-end evidence.

## Authentication and recurring-work boundary

- The supported recurring path in the repository uses a hashed, revocable `bcauto_...` token with reduced scopes. Each user receives a separate token.
- The current OAuth authorization-code path is interactive only: its access token expires after one hour and Beachcar does not yet issue refresh tokens. Recurring OAuth is not claimed as working.
- A scheduled local run needs the user's Mac awake, Codex running, and any required marketplace browser sessions still signed in.
- Password, MFA, CAPTCHA, and consent prompts stay with the user. The skill forbids bypassing access controls.
- A browser login grants access, not republication rights. The skill tells Codex to keep factual metadata and original synthesis concise, link to the source, and omit copied prose, comments, usernames, and images unless reuse is permitted.
- Beachcar does not claim an official partnership or API integration with any auction marketplace.
- Beachcar does not need the user's auction passwords or OpenAI credential. Model use runs in the user's local Codex environment.

## Garage Session boundary

The installed skill defines the Garage Session as a separate opt-in after a successful Beachcar run. Each session may inspect a verified Beachcar checkout and prepare at most one small, generalizable improvement in an isolated worktree. It performs only local, credential-free checks and produces a review packet. It does not automatically push, open an issue or pull request, post a comment, deploy, or contact a maintainer. Fresh approval is required for any later external action.

That policy is inspectable in the skill. A real scheduled Garage Session completed by a new user is not yet presented as proven.

## Evidence ledger

| Claim | Current evidence | Boundary |
| --- | --- | --- |
| The Surrey outcome is real | Jon states that Beachcar found the 1960 Willys Surrey and that he bought it; the public [case-study listing](https://bringatrailer.com/listing/1960-jeep-dj-3a/) identifies the car | Beachcar did not bid or purchase; the discovery is a pre-Build Week case study |
| The judge replay is publicly reachable | The isolated static Worker serves `/demo`; root redirect and all five scene URLs passed signed-out checks on version `91ede9db...`; focused tests are included | Fixed replay, not live research or a production-account flow |
| The local-agent/MCP contract is implemented | Skill, installer, MCP tools, and contract tests in the public Build Week branch | No claim that a friend's full remote flow or live continuity has passed |
| Feedback can steer the next plan | Explicit feedback fields, fixture transformation, and tests | Replay evidence is deterministic, not a production capture |
| Garage Session is consent-first | Detailed skill policy with separate opt-in, isolation, review packet, and no-send gate | No claim of a completed scheduled friend session |
| Public video package exists locally | The local working tree contains a 100.83-second MP4 with a visible fixed Teach → Research replay, matching timing-reference SRT, and thumbnail | The local MP4 is not a submission link; use the public YouTube URL below after signed-out verification |
| Real-car photo use has a permission basis | Owner represents that the selling dealer granted permission for the selected images across the public film, thumbnail, deck, repository/site/demo, and cropped or animated derivatives, with no credit required | The written permission itself was not independently inspected |

## Submission access fields

- Public submission branch: https://github.com/joncooper/beachcar/tree/codex/agent-connected-subscriptions
- Submitted revision: use the exact commit URL attached to the Devpost entry
- Local working-project path: the commands and `127.0.0.1` URL above
- Working-project access: https://beachcar-build-week-demo.jon-cooper.workers.dev/demo
- Public YouTube URL: `[PRE-UPLOAD: paste after the final 100.83-second cut is public and playable]`
- Primary Codex task/session ID for the `/feedback` field: `019f8178-f7a2-7301-b9be-f5b0af997b70` - confirmed from the active task metadata on July 21

Do not substitute an unverified deployment, TestFlight invitation, or private URL for one of these fields.
