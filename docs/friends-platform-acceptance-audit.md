# Friends Platform Acceptance Audit

Date: 2026-06-26

This audit maps the original request to current worktree evidence. It intentionally separates local completion from remote/deployed validation because no production deploys were allowed for this build.

## Proven Locally

| Requirement | Evidence |
| --- | --- |
| Website lets friends use the app | Invite gate, onboarding, preferences, admin invite console, run controls, run-detail sheet, and account export/delete are implemented in `src/client/App.tsx`; local smoke previously exercised invite acceptance, onboarding, run creation, export, and delete. |
| Friends configure initial preferences | `PUT /api/profile`, `PUT /api/source-settings`, and `PUT /api/ai-settings` are implemented; PWA and iOS onboarding save profile/source/AI settings; PWA onboarding and Preferences now include structured taste-calibration archetypes plus freeform notes. |
| Invite-only multi-user access | `users`, `invites`, user-scoped `runs`, `feedback`, `preference_events`, `source_settings`, and `user_ai_settings` were added; `/api/me` derives identity server-side. |
| Production auth does not fall back to test headers | `tests/auth.test.ts` now covers that `X-Beachcar-Test-Email` works only for localhost fallback and is rejected on remote hostnames even when `ENVIRONMENT` is missing or set to `development`. |
| No raw OpenAI key is stored in D1 | AI settings save only a `gatewayKeyRef`; onboarding/preferences now block raw-looking provider keys before the API call, and the Worker rejects the same shapes before D1 writes. Fast tests cover `sk-`, `sk_`, `sk-proj-`, and session-token shapes. |
| Cloudflare Agents / Workflows path | `BeachcarAgent` Durable Object and `BeachcarRunWorkflow` are wired in `wrangler.jsonc`; local smoke previously published a user-scoped run through the Workflow path. |
| Codex SDK / browser-heavy runner boundary | `runner/` includes a Container runner with `@openai/codex-sdk`; Worker bridge can now start the Container in deterministic default mode or explicit `BEACHCAR_RUNNER_MODE=codex`. |
| Per-user mobile support | iOS decodes `/api/me`, gates invite/onboarding/disabled states, caches latest runs per user, uses cached remote images, and shows Agent run status. |
| Image resizing/cache/preload | Worker serves `thumb`, `deck`, and `full` variants with immutable cache headers; PWA service worker caches image endpoints only in a bounded image cache; PWA and iOS prefetch nearby images. Unit tests now simulate the service worker and prove authenticated JSON is not cached, repeated image requests hit the dedicated image cache, and the cache trims to 180 entries. |
| Public source cache | Bring a Trailer public RSS candidates are ingested into D1 through `source_items` and `source_ingestion_runs`; cron/admin/MCP paths refresh and search the cache; the admin console shows freshness, item counts, latest ingest status, and manual refresh controls. |
| Remote MCP OAuth | Hosted MCP supports scoped manual tokens plus local-first OAuth authorization-code + PKCE. `/mcp` advertises protected-resource metadata, `/.well-known/oauth-protected-resource/mcp` lists this Worker as an authorization server, `/.well-known/oauth-authorization-server` advertises register/authorize/token/revoke endpoints, and OAuth access tokens are short-lived, revocable, audience-bound to `/mcp`, and visible/revocable in Preferences. |
| Friend cloud-agent skill | `.agents/skills/beachcar-daily-run/SKILL.md` and the generated website bundle instruct cloud agents to connect to hosted MCP, prefer BaT cache tools, record AI/browser usage, publish/verify runs, and stop rather than substituting local MCP or untracked API calls. |
| Daily automation compatibility | Existing admin import remains, plus user-specific import and runner-task claim/complete/fail APIs. |
| Admin operational visibility | `GET /api/admin/ops-summary` and the admin console summarize user counts, onboarding, runs, Agent run states, runner-task backlog, image original/variant counts and bytes, AI spend/events, and BaT cache status. |
| Repeatable local verification | `bun run preflight` runs typecheck, Vitest, container syntax, runner simulator syntax, service-worker syntax, non-deploying readiness reporting, and client build. `bun run preflight:local` previously passed the full local Worker smoke. |
| Non-deploying rollout readiness check | `bun run deploy:check` inspects local Cloudflare config, migrations, script wiring, and env hints without network calls or secret output. |
| Deploy secret handoff | `.deploy.env.example` plus `bun run deploy:env:check` give a git-ignored place to provide Clerk/PUBLISH_TOKEN/AI Gateway values and validate their shapes without printing secrets. |
| Guarded Cloudflare rollout bootstrap | `bun run cloudflare:bootstrap` inspects the logged-in Cloudflare account, can write discovered D1 ids and owner emails into local config, and can run a strict deployment dry run. Direct remote mutation flags are disabled; `bun run deploy:remote -- --execute --yes` is the sole production mutation path. |
| Local/remote deployed-surface verifier | `bun run cloudflare:verify` checks a local or deployed Worker URL for app shell delivery, MCP server metadata, OAuth protected-resource metadata, unauthenticated MCP challenge behavior, and remote rejection of local test-auth headers without mutating Cloudflare resources. |
| PWA screen visual verification | In-app browser audit covered invite, onboarding, admin, preferences, and Run Detail demo routes at desktop and 390px mobile widths with no horizontal overflow; Run Detail screenshots are saved in `docs/screenshots/friends-platform/`. |

## Verified This Pass

- `bun run test`: 5 files, 20 tests passed.
- `bun run typecheck`: client, Worker, and tests passed.
- `bun run preflight`: passed with typecheck, Vitest, runner syntax checks, service-worker syntax, non-deploying readiness report, and client build.
- `bun run preflight:local`: passed with local Wrangler, D1/R2/Workflow smoke, MCP automation calls, and BaT cache search.
- `node --check public/sw.js`: passed.
- `bun run deploy:check`: passed in report mode and identified 5 expected rollout todos: production D1 id, real bootstrap owner email, Clerk secret, Clerk issuer, and AI Gateway remote scoring credentials.
- `bun run deploy:env:check`: added to validate Clerk/PUBLISH_TOKEN/optional AI Gateway deployment values without printing secrets. It currently reports missing Clerk values until `.deploy.env` is filled.
- Browser verification: Worker static app mounted; Vite settings demo rendered Connect automation with an MCP endpoint and no demo API 404.
- Curl verification: local source-cache status returned 20 BaT RSS items, manual ingest returned a 20-item ingestion, and the scheduled test endpoint returned successfully.
- Browser verification: Worker admin page rendered the Source cache panel, BaT feed URL, Refresh status and Ingest BaT RSS controls with no horizontal overflow at desktop or 390px mobile widths.
- Browser verification: Vite onboarding/settings demos rendered Taste calibration controls, six default selections, and a state-changing checkbox interaction with no page errors or horizontal overflow at desktop or 390px mobile widths. The in-app browser bridge timed out before reaching Vite, so this check used the local `agent-browser` helper.
- Local MCP OAuth metadata verification: `bun run preflight:local` proved the well-known route, metadata body, and unauthenticated MCP `WWW-Authenticate` challenge; `bunx wrangler deploy --dry-run` passed after adding `/.well-known/*` to `assets.run_worker_first`.
- Browser verification: Vite settings demo rendered both `/mcp` and `/.well-known/oauth-protected-resource/mcp` endpoints with no page errors or horizontal overflow at desktop or 390px mobile widths.
- Cloudflare resource inspection: `bun run cloudflare:check` ran read-only against account `b8873e78bf5e48fcdc91e87f2324cf55`; it found the configured R2 bucket exists, the configured Worker is not deployed yet, and the configured D1 name/id are not ready because only the similar legacy `beach-car-watch` database exists.
- Cloudflare deployment plan: `bun run cloudflare:plan` and `bun run cloudflare:plan --json` generated an ordered rehearsal plan from the read-only account inspection, separating read-only, file-edit, and mutating steps without executing D1 creation, migrations, secrets, or deploys.
- Cloudflare rollout bootstrap: `bun run cloudflare:bootstrap` ran read-only against account `b8873e78bf5e48fcdc91e87f2324cf55`, confirmed R2 `beachcar-watch-images` exists, and printed explicit apply/migrate/deploy commands without mutating Cloudflare.
- D1 reuse decision: read-only inspection showed existing D1 `beach-car-watch` (`2860a6be-7cf0-4fc0-821f-166e78521154`) is non-empty, active, and has migrations `0001`-`0004` applied, matching the pre-friend-beta schema. `wrangler.jsonc` now points at that database instead of creating a fresh one.
- Production resource mutation attempt: `bunx wrangler d1 create beachcar-watch` was not run because the approval reviewer rejected remote D1 creation as a real Cloudflare account mutation after the earlier no-deploy constraint; the repo now avoids that blocker by targeting the existing compatible D1.
- Cloudflare deployed-surface verifier: `bun run cloudflare:verify -- --url http://127.0.0.1:8787` verified a local Worker app shell, MCP metadata, OAuth protected-resource metadata, unauthorized MCP challenge, local test auth, and admin source-cache status via `.dev.vars`. Optional signed-in and authenticated MCP-token checks were reported as warnings because no real Clerk or automation token was supplied for this command.
- Friend skill validation: `uv run --with PyYAML python /Users/jdc/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/beachcar-daily-run` passed after adding hosted-MCP setup, source fallback, usage-accounting, and done-definition guidance to both the repo skill and generated bundle.
- Local MCP OAuth authorization-code verification: `bun run cloudflare:verify -- --url http://127.0.0.1:8787` dynamically registered a public client, completed authorization-code + S256 PKCE with local test auth, exchanged for a short-lived OAuth access token, used it for MCP `tools/list`, revoked it, and verified the revoked token was rejected.
- `bunx wrangler deploy --dry-run`: built Worker assets and the Bun-based Container image without deploying.
- Browser verification: Worker settings demo rendered OAuth connections, the registered client name, fallback tokens, and OAuth PKCE endpoint text with no console errors or horizontal overflow at desktop or 390px mobile widths.

## Not Proven In This Environment

| Item | Why not proven | Required evidence before real friend use |
| --- | --- | --- |
| Production deploy | Earlier no-deploy/no-real-mutation constraint still blocks remote D1 migrations, secrets, and Worker deploy without explicit follow-up approval. | Remote D1 migrations, Worker secrets, Worker deploy, `bun run cloudflare:verify` against the deployed URL, remote `/api/me`, invite, onboarding, run, export/delete smoke. |
| Deployed Container runner | Cloudflare Container was scaffolded locally but not deployed. | Deployed `BEACHCAR_RUNNER_CONTAINER` handles a runner task and records usage. |
| Credentialed Codex SDK run | Codex mode is now configurable, but no real Codex/OpenAI credentialed run was executed. | Configure `BEACHCAR_RUNNER_MODE=codex` and credentials, run a non-sensitive public-source task, verify normalized JSON/blocked result. |
| Real AI Gateway spend policy | Local adapter and usage ledger are implemented; remote Gateway budget/BYOK policy was not exercised. | Gateway request with user/run metadata, BYOK alias if used, budget enforcement/logging in Cloudflare. |
| Remote MCP OAuth with real client | Authorization-code + PKCE is implemented and verified locally, but not against a deployed Worker, real Clerk bearer session, or real cloud MCP client. | Deployed OAuth authorization-code + PKCE flow issues a scoped token audience-bound to `/mcp`, then a cloud MCP client connects without a manually copied automation token. |
| Remote image transform behavior | Local smoke warmed image variants; deployed Worker/Images behavior was not exercised. | Remote image variant creation for large real listing photos, cache headers, and R2 variant rows. |
| iOS UI tests | CoreSimulator timed out in this environment. | `bun run ios:test-ui` passes invite, onboarding, and active deck fixtures. |

## Current Recommendation

The worktree is locally ready for a deliberate deployment rehearsal, but not yet proven for inviting real friends. The next step is explicit approval for `bun run deploy:remote -- --execute --yes`, which gates the production account, coupled D1 identity, rollback availability, recovery artifacts, pending migration, schema, strict configuration, atomic secrets, and verification. The first friend pilot may use explicit deterministic/heuristic mode; owner-managed AI Gateway remains optional and should use tight caps when enabled.
