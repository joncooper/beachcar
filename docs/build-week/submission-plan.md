# Beachcar Build Week submission plan

Last updated: July 21, 2026

Deadline: **July 21, 2026 at 5:00 p.m. PDT / 8:00 p.m. EDT**

Category: **Apps for Your Life**

## Winning thesis

**BEACHCAR - your codex - your taste - your car**

Beachcar begins where filters fail: with the feeling of the car a person wants. Local Codex learns that taste, searches in the browser the user already uses, and sends Beachcar a handful of cars worth opening. The proof is unusually concrete: Beachcar found the pink 1960 Willys Surrey Jon did not know to search for, and Jon bought it.

One-sentence story: **I needed a weird little car for my family, could not name it, and my Codex found the pink Surrey I bought.**

## Official delivery requirements

The governing references are the [OpenAI Build Week page](https://openai.com/build-week/), [Devpost challenge page](https://openai.devpost.com/), [official rules](https://openai.devpost.com/rules), and [FAQ](https://openai.devpost.com/details/faqs).

The final entry must include:

- a public YouTube demo under three minutes;
- clear audio explaining what was built, how Codex was used to build it, and how GPT-5.6 is used;
- a repository URL with setup, testing, and project documentation;
- working-project access for judges;
- the primary Codex task ID for `/feedback`;
- only the meaningful post-start extension presented as Build Week work;
- media the entrant is authorized to publish.

The current final cut is 100.83 seconds (1:40.83), with a matching timing-reference SRT and thumbnail.

## Judge story and proof

| Beat | What the viewer should understand | Honest proof shown |
| --- | --- | --- |
| One or two miles at a time | This began with a specific family need | Real car details and the creator's narration |
| I did not know what it was called | Keyword search cannot solve unnamed taste | Taste choices and plain-language framing |
| My Codex goes hunting | The user's agent and browser do the open-ended work | Product captures plus narration; implementation in the public repository |
| Then this appeared | The outcome is delightful and real | Full 1960 Willys Surrey reveal, followed by "I bought it" |
| Built with Codex and GPT-5.6 | The model is part of both product judgment and the build process | Spoken explanation and repository evidence |
| You see every change first | Optional improvement remains human-controlled | Garage Session consent and review policy in the installed skill |
| Now go looking for yours | One personal result becomes a reusable product idea | Close on the actual car and the Beachcar identity |

## Current evidence status

| Item | Status on July 21 | Submission treatment |
| --- | --- | --- |
| Actual 1960 Willys Surrey purchase | Owner states that Beachcar found the car and that he bought it; the public listing identifies the car | Use as a pre-Build Week case study. Never say Beachcar bid or purchased |
| Public repository | The Build Week branch is public at `codex/agent-connected-subscriptions`; `bb7645d` is the previous audited implementation commit | Push the final release revision and attach its exact commit URL to Devpost; do not send judges to the older default `main` |
| Exact local judge path | Implemented at `/demo?scene=...`; no account or secret required | Lead judges through the commands in `judge-guide.md` |
| Deterministic replay | Implemented as a five-scene fixed fixture with focused tests | Label it as replay, not live research or the original Surrey run; rerun the suite after final identity changes |
| Local Codex skill and Beachcar MCP | Implemented in the repository with scoped tools and tests | Describe the contract and supported token path without claiming a friend completed it |
| Explicit feedback steering | Implemented in the fixture, product state, and tests | Demonstrate Love and Never again changing the next plan |
| Garage Session policy | Implemented in the skill as separate opt-in, isolated local work, and a review gate | Do not claim a scheduled clean-slate user session has passed |
| Final video package | Local 100.83-second MP4, SRT, thumbnail, narration, and build source exist; strict decode, A/V, caption, privacy, and independent visual-story audits passed on exact SHA-256 `1d8246ac...`; the cut visibly moves the fixed local replay from Teach to Research without covering its page copy | Upload the exact frozen master and verify the public URL; do not attach the SRT to this burned-caption master |
| Hosted working-project URL | `https://beachcar-build-week-demo.jon-cooper.workers.dev/demo` is live on isolated static Worker version `91ede9db...`; root redirect, all five scenes, Beachcar title/manifest, and the exact hero-photo hash passed signed-out verification | Use this URL as working-project access; never deploy the production Worker config for this purpose |
| Friend TestFlight full end-to-end | Test plan exists; completed pass not established | Do not list as proof or require it for the fast judge path |
| Live Codex -> MCP -> iPhone continuity | Intended and testable; a matching live run receipt is not established | Do not imply the video or replay proves it |
| Recurring authentication | Revocable reduced-scope automation token path is supported; OAuth lacks refresh tokens | Describe OAuth as interactive only; do not claim recurring OAuth |
| Public/deployed Garage Session extension | No completed external contribution or deployment established | Present the consent-first local workflow, not a shipped extension |
| Dealer photo permission | Owner confirms that the selling dealer's permission covers the selected images in the public film, thumbnail, deck, repository/site/demo, and cropped or animated derivatives; no credit is required | Public disclosure still notes that the written permission itself was not independently inspected |
| `/feedback` task ID | `019f8178-f7a2-7301-b9be-f5b0af997b70` was confirmed from the active task metadata on July 21 | Enter this exact value in the submission form |

## How this addresses the judging criteria

| Criterion | Beachcar's strongest case |
| --- | --- |
| Technical implementation | Local Codex combines GPT-5.6 judgment, user-controlled browsing, a specialized skill, a scoped MCP contract, durable feedback, publication, and verification. The repository exposes the exact contract and tests. |
| Design and UX | A plain-language taste interview becomes a deliberately small shortlist with reasons, risks, market context, and expressive feedback instead of another infinite feed. |
| Potential impact | It solved a real family's difficult-to-name search and led to an actual purchase. The architecture moves account access and model use toward the user rather than a costly hosted scraper. |
| Idea quality | Beachcar treats personal taste as durable, inspectable memory while Codex handles open-ended research in the environment the user already controls. |

## Product boundary in plain language

Safe to say:

- Local Codex is the intended research agent.
- GPT-5.6 supplies comparative judgment inside Codex.
- The user signs into sources directly and keeps control of credentials.
- Beachcar's MCP stores and exchanges scoped taste, source settings, feedback, candidate evidence, and published shortlists.
- Beachcar found the Surrey; Jon made the decision and bought it.
- The local replay is deterministic and the underlying skill/MCP contract is inspectable.
- The Garage Session requires a separate opt-in and stops at user review.

Do not say without new evidence:

- that a friend completed the entire TestFlight -> desktop -> Codex -> MCP -> iPhone journey;
- that a live run ID was observed continuously across Codex, MCP verification, and iPhone;
- that OAuth survives an unattended recurring run;
- that cloud scraping or Beachcar-funded AI is part of the demonstrated path;
- that Beachcar has an official marketplace partnership or a right to republish source images, prose, comments, or user identities;
- that the Garage Session pushed, opened, deployed, or contacted anything;
- that written dealer/photographer license terms were reviewed;
- that the Build Week replay found the Surrey.

## Deterministic replay wording

Use this exact description whenever space permits:

> The judge surface is a fixed local replay of Beachcar's product contract. It demonstrates taste, the MCP tool sequence, shortlist structure, and feedback steering without requiring a judge to expose an auction login. It is not a captured production run, a live scrape, or evidence that this Build Week run found the Surrey.

Avoid the shorter phrase "working demo" on its own, because it can sound like live external research. Pair it with **deterministic replay** and link to the local startup instructions.

## Build Week eligibility boundary

The challenge began July 13, 2026 at 9:00 a.m. PT / noon ET. Commit `e8321d0` at 10:48 a.m. ET is the last committed baseline before the start; `16bf7ec` at 12:24 p.m. ET is the first post-start commit.

The baseline already contained the Beachcar project, native and web review experiences, stored taste/profile state, feedback gestures, Cloudflare-backed data, and an early agent/MCP direction. The Surrey discovery and purchase are also treated as prior proof, not event-period work.

The competition claim is the meaningful extension after that boundary: coached local-Codex onboarding, the installable skill, signed-in local-browser research policy, the expanded scoped MCP workflow, explicit taste calibration and feedback steering, the judge replay, the consent-first Garage Session policy, and the film/judge package. See [changelog.md](changelog.md) for commit evidence.

## Deadline execution order

1. Keep the owner-confirmed seven-image scope, public uses, derivative permission, and no-credit requirement recorded in `photo-permissions.md`; do not broaden it.
2. Freeze and push the final repository revision. Recheck that the submitted public revision contains the promised setup and test paths.
3. Run the judge path from a clean public clone, open all five scene links, and make the focused replay/MCP/installer tests green.
4. Watch the local production master `docs/build-week/Beachcar-Build-Week-final.mp4` once with sound, inspect captions, confirm the 1:40.83 duration, and verify the fixed Teach → Research interaction remains legible.
5. Upload the exact burned-caption master to YouTube as Public with the description, chapters, and thumbnail in [submission-copy.md](submission-copy.md). Do not attach the SRT unless a separate captionless master is exported. Verify playback in a signed-out window.
6. Fill the public YouTube URL and final pushed commit. Working-project access, rights scope, and no-credit status are already verified.
7. Enter the confirmed task/session ID `019f8178-f7a2-7301-b9be-f5b0af997b70` with the repository URL, working access, and category in Devpost.
8. Read the written entry once for the forbidden claims above, then submit before **5:00 p.m. PDT**.
9. Reopen the entry and every public link immediately after submission.

## External-only blockers

- public YouTube upload and final playback verification;
- push or merge of the final Build Week revision and verification from a public fresh clone;
- clean-slate friend TestFlight end-to-end evidence;
- live same-run continuity across Codex, Beachcar MCP, and iPhone;
- a real scheduled recurring run and refresh-capable OAuth proof;
- any actual Garage Session contribution or deployment.

The public upload, pushed revision, and working-project access affect the immediate submission package. The remaining product validations should stay labeled future work rather than being rushed into a claim.
