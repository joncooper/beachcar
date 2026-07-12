# Beachcar

Beachcar is a managed, mobile-first auction scout. A friend sets their taste, budget, region, and sources; Beachcar researches listings each day, applies their feedback, and publishes a private shortlist to the web and iOS apps.

The friend-facing default requires no provider key, automation token, MCP client, or agent setup. Those capabilities remain available as advanced options for operators and technical users. The default niche is beach cars and runabouts; other collector niches can reuse the same system later.

## What It Includes

- Cloudflare Worker serving a React PWA and JSON API.
- D1 database for invited users, profiles, source settings, AI settings, daily runs, listings, image metadata, usage events, runner tasks, and per-user feedback memory.
- R2 image cache with generated `thumb`, `deck`, and `full` variant URLs so listing photos stay fast on mobile.
- Clerk authentication with bootstrap owner emails and invite-only friend access.
- Cloudflare Agents and Workflows for per-user run requests, schedule state, source discovery, image warmup, and run-status reporting.
- Cloudflare Container runner scaffold for Codex SDK/browser-heavy source work that should not run inside a Worker.
- Native SwiftUI iOS app for invite/onboarding states, cached image-first review, and run-status visibility.
- Feedback actions:
  - Like: show more like this without pinning it as a favorite.
  - Love it: prioritize this listing and similar future finds (`star` in the API).
  - Pass: remove this exact listing from the default view (`hide` in the API).
  - Never again: suppress similar listings unless unusually compelling (`avoid` in the API).
- Admin import, invite, user, AI usage, Agent run, and runner-task APIs for the daily automation and friend beta.
- Advanced hosted MCP integration with scoped automation tokens, OAuth, user-visible events, and a downloadable skill for people who intentionally run their own cloud agent.
- Agent playbooks for Codex, Claude, or another browser-capable AI operator.

## Native iOS Preview

The native app is a one-listing-at-a-time research surface for daily auction finds. Each find is a vertically scrolling dossier. Swipe right to Like, far right to Love it, left to Pass, or far left for Never again; tap the cover to inspect a separate, zoomable photo gallery. An explicit `FIND x OF y` counter distinguishes listings from photos, while Today's Finds provides search, filtering, sorting, and direct navigation.

These are actual iPhone simulator screenshots from the current SwiftUI app:

<p>
  <img src="docs/screenshots/ios-deck.png" alt="Beachcar iOS deck view" width="220">
  <img src="docs/screenshots/ios-list.png" alt="Beachcar iOS list view" width="220">
  <img src="docs/screenshots/ios-filters.png" alt="Beachcar iOS filters view" width="220">
  <img src="docs/screenshots/ios-details.png" alt="Beachcar iOS detail back view" width="220">
</p>

## Canonical Product Workflow

The friend beta has one primary workflow: **Beachcar-managed daily research**.

1. A friend accepts an invite and sets taste, budget, region, and enabled sources. They do not configure an AI provider or agent.
2. A managed schedule or signed-in **Run now** request starts that user's Cloudflare Agent and durable Workflow.
3. The Workflow loads that user's profile, source settings, feedback, and preference events; searches enabled sources; and evaluates the candidates.
4. It publishes the user-scoped shortlist, warms image variants, and records normal-language run/source status.
5. The friend reviews it in the PWA or iOS app and leaves like/star/hide/avoid feedback.
6. The next managed Workflow run uses that feedback to improve the shortlist.

The operator-owned automation in `automation/codex-daily-run.md` remains a quality reference and fallback publisher when source research needs intervention. It is not a second friend setup path.

The hosted MCP, manual automation tokens, OAuth, AI Gateway aliases, and BYOK mode are **advanced, optional paths**. They are useful for operator tooling and technical users who deliberately want to run their own agent, but they are not part of normal onboarding.

## Local Setup

```bash
bun install
cp .env.example .env.local
cp .publish.env.example .publish.env
```

Fill in `.env.local` with your Clerk keys and desired app name.

```bash
bun run typecheck
bun run test
set -a; source .env.local; set +a
bun run build
```

Run the repeatable local preflight:

```bash
bun run preflight
```

The quick preflight includes the non-deploying readiness report below, but leaves known rollout todos non-fatal.

To exercise the Agent/Workflow/D1/R2 path locally, make sure `.dev.vars` or `.publish.env` has `PUBLISH_TOKEN`, then run:

```bash
bun run preflight:local
```

The local preflight starts `wrangler dev --local`, waits for it to become ready, runs `bun run smoke:local-worker`, and stops the local Worker afterward.

For the larger local gate that also builds the native app:

```bash
bun run preflight:full
```

Before any intentional deploy rehearsal, run the non-deploying readiness check:

```bash
bun run deploy:check
```

It inspects local config, migrations, script wiring, and env hints without contacting Cloudflare or printing secret values. Add `-- --strict` when you want missing deploy/friend-rollout items to fail CI.

## Native iOS App

The native app lives in `ios/` and is generated from `ios/project.yml` with XcodeGen, so you can work without opening Xcode. It uses Clerk with Google auth, talks to the same Worker API as the PWA, and supports TestFlight builds from the command line.

```bash
bun run ios:generate
bun run ios:resolve
bun run ios:build
```

Useful commands:

```bash
bun run ios:sim
bun run ios:test-ui
bun run ios:archive
bun run ios:testflight
```

Use `bun run ios:release` when shipping app changes; it archives, uploads to App Store Connect, waits for the new build to appear, and assigns it to the configured internal TestFlight group.

See `docs/ios.md` for the native UX model, Clerk setup, and simulator/device notes.

## Cloudflare Setup

Inspect the logged-in Cloudflare account without changing anything:

```bash
bun run cloudflare:bootstrap
```

This branch is configured to reuse the existing compatible D1 database `beach-car-watch` (`2860a6be-7cf0-4fc0-821f-166e78521154`). Remote migrations `0001`-`0010` have been applied for the friend beta.

Set the bootstrap owner email list in config:

```bash
bun run cloudflare:bootstrap -- --write-config --owner-emails "owner@example.com"
```

`BOOTSTRAP_OWNER_EMAILS` accepts a comma-separated owner list and overrides the legacy single `ALLOWED_EMAIL` var. The first owner is the legacy-data owner; all listed owners bootstrap as active. Other signed-in users are created as `invited` and must accept an invite code before they can load runs or save feedback.

Prepare local deploy values:

```bash
cp .deploy.env.example .deploy.env
bun run deploy:env:check
bun run deploy:remote -- --dry-run
```

After explicit approval, the guarded rollout command couples the production D1 name and UUID, proves the active Worker is a single 100%-traffic version already on Durable Object migration tag `v2`, captures private Worker/D1 recovery artifacts, runs a strict configuration dry run, validates and applies the expected migration, deploys code plus locally supplied secret changes once with `--strict --keep-vars`, and verifies the deployed Worker. Recovery artifacts never contain the separate temporary Worker-secret staging file. Existing remote secrets and audited dashboard-only plain vars omitted locally are preserved:

```bash
bun run deploy:remote -- --execute --yes
```

Execution requires an explicit `BEACHCAR_RUNNER_MODE=deterministic|codex` in `.deploy.env`, and the effective mode is read back after deploy. The friend pilot uses `deterministic`, which skips Cloudflare Container image publishing with Wrangler's `--containers-rollout none` option. To intentionally build or update the deployed Container image for Codex-backed runner work, set `codex`, place its `OPENAI_API_KEY` in `.deploy.env` (ambient shell keys are never uploaded), and run:

```bash
bun run deploy:remote -- --execute --yes --deploy-containers
```

Direct bootstrap mutation and `db:migrate:remote` shortcuts are disabled because they could bypass the identity, rollback, backup, and pending-migration gates. `bun run deploy:remote -- --execute --yes` is the sole production mutation entrypoint; repair or extend that guarded path instead of substituting a manual migration/deploy sequence.

After the public/admin deployment checks pass, use the stored single-use Clerk ticket once to prove the real managed pilot path:

```bash
bun run cloudflare:verify-managed -- --execute --yes
```

The verifier binds the stored ticket to an exact trusted origin, redeems it only on the configured deployment, and fails its public/admin pilot-state gates before ticket exchange. The admin preflight selects the effective Gateway or heuristic scoring mode before consuming the ticket; `--require-ai-gateway` and `--require-heuristic` can pin either expectation. It sends a persisted idempotency UUID with bounded same-process retry, follows the exact Agent/Workflow/published-run ids, proves all three source diagnostics plus accepted terminal C&B/Hemmings results, location completeness, same-origin image bytes/cache hits, exact signed-in Run-detail identity, a healthy budget, and finally the exact next timezone-aware schedule occurrence. Use `--configure-pilot` only for an explicit managed/source repair. Terminal runner evidence is required by default; `--allow-runner-handoff-only` exists for non-release diagnostics and cannot produce release proof. Once the browser session exists, consumed ticket fields are atomically cleared from `.env.local`; the non-secret `.tmp/managed-production-verification.json` remains as evidence. Do not use it as an auth-only rehearsal.

`CLERK_JWT_ISSUER` is your Clerk issuer URL, usually like `https://your-instance.clerk.accounts.dev`.
`bun run deploy:env:check` hides secret values and reports only missing or malformed deployment inputs. Use `-- --strict` to make missing required values fail.

## Operator Fallback: Publishing A Daily Run

The managed Agent/Workflow is the primary publisher. For an operator intervention or quality comparison, configure `.publish.env` with the target user's Beachcar id:

```bash
AUCTION_WATCH_URL=https://beachcar-watch.<your-workers-subdomain>.workers.dev
PUBLISH_TOKEN=<same value configured as Worker secret>
BEACHCAR_USER_ID=<target-user-id>
```

Publish sample data:

```bash
bun run publish:daily
```

Publish a real daily run:

```bash
DAILY_JSON=outputs/daily-run-2026-06-20.json bun run publish:daily
```

The publish script imports the run into that user's history first, then copies queued listing images to R2 through the admin image API. If `BEACHCAR_USER_ID` is absent, it warns and uses the legacy bootstrap-owner route.
It also warms `deck` and `thumb` image variants by default so the iOS/PWA review flow does not pay the first-view transform cost. Set `SKIP_IMAGE_WARM=1` to skip that step, or tune it with `IMAGE_WARM_VARIANTS`, `IMAGE_WARM_CONCURRENCY`, and `IMAGE_WARM_LIMIT`.

Backfill variants for an already published run:

```bash
bun run images:warm -- --execute
```

Use `bun run images:warm -- --all --execute` to backfill every copied image in the deployed D1/R2 cache.

## Friend Beta Flow

1. Sign in as the bootstrap owner.
2. Open the admin console from the PWA and create an invite.
3. Friend signs in with Clerk, enters the invite code, and completes onboarding.
4. Managed daily research uses the saved profile and source toggles; no key, token, or external agent is required from the friend.
5. Friend reviews their own latest run in the PWA or iOS app and leaves feedback for the next run.
6. Feedback, preference events, AI usage, Agent runs, remote automation events, and account export/delete stay scoped to that user.
7. Optional for technical users only: Preferences > Advanced > Connect your own agent exposes OAuth/manual tokens and the downloadable Beachcar skill.

Friends do not need to paste raw OpenAI keys for the beta. The default is Beachcar-managed research with operator-owned cost controls. If an advanced BYOK path is deliberately enabled, store the provider key in Cloudflare AI Gateway/Secrets Store and save only the gateway key reference in Beachcar.

The Container runner stays deterministic unless explicitly configured. To test a deployed Codex-backed runner intentionally, set `BEACHCAR_RUNNER_MODE=codex`, optionally set `BEACHCAR_CODEX_MODEL`, provide the runner credential as a Worker secret such as `OPENAI_API_KEY`, and deploy with `--deploy-containers`. Do not store friend-provided raw keys in D1.

## Advanced: Remote MCP Automation

This is not a friend-beta setup step. It lets a technical user or operator intentionally replace the managed researcher with Codex, Claude, or another cloud agent without running a local MCP server:

1. Complete onboarding and source preferences.
2. Open Preferences > Advanced: connect your own agent.
3. Create a token and download the Beachcar skill.
4. Configure the cloud agent to use `/mcp` with the token as Bearer auth.
5. Have the agent call `get_setup_context`, gather candidates, `publish_run`, `record_usage`, and `verify_latest_run`.

The integration stores only token hashes in D1, supports revocation, and logs automation events. Prefer OAuth when the MCP client supports it; scoped manual tokens remain a fallback.

See `docs/remote-mcp-friend-automation.md`.

## Operator Fallback And Research Playbooks

When the managed Workflow needs source intervention or a quality comparison, start with:

- `.agents/skills/beachcar-daily-run/SKILL.md`
- `automation/codex-daily-run.md`
- `automation/claude-daily-run.md`
- `automation/auction-source-playbook.md`
- `automation/preference-steering.md`
- `automation/valuation-guide.md`
- `automation/source-profile.beach-cars.md`

The automation instructions are intentionally explicit because auction pages change. A browser-capable operator job should inspect pages live, adapt extraction, and keep producing the stable import JSON shape documented in `docs/publishing.md`. This is an operational fallback and quality harness; friends consume the result and do not operate it.

## Compliance

You are responsible for how your automation accesses third-party sites. Use your own credentials where needed, respect rate limits and site terms, do not bypass access controls, and do not publish copied images beyond your intended private/internal use unless you have rights to do so.

## Project Status

The hosted beta surface is deployed at `https://beachcar-watch.jon-cooper.workers.dev`; the last confirmed production baseline has D1 migrations `0001`-`0010` applied and passed public app-shell, MCP/OAuth metadata, auth-bypass rejection, and admin source-cache verification. `docs/cloudflare.md` is the deployment source of truth.

The current Source Quality v1 worktree, including migration `0011`, still needs a deliberate rollout and a signed-in end-to-end run before a friend pilot. Real Clerk-session onboarding/run checks, remote image variants, and the selected managed execution path should be reverified after that rollout. Advanced Container, MCP-client, and BYOK validation do not block the default friend experience unless those optional paths are enabled.
