# Friends Platform Acceptance Audit

Date: 2026-06-25

This audit maps the original request to current worktree evidence. It intentionally separates local completion from remote/deployed validation because no production deploys were allowed for this build.

## Proven Locally

| Requirement | Evidence |
| --- | --- |
| Website lets friends use the app | Invite gate, onboarding, preferences, admin invite console, run controls, run-detail sheet, and account export/delete are implemented in `src/client/App.tsx`; local smoke previously exercised invite acceptance, onboarding, run creation, export, and delete. |
| Friends configure initial preferences | `PUT /api/profile`, `PUT /api/source-settings`, and `PUT /api/ai-settings` are implemented; PWA and iOS onboarding save profile/source/AI settings. |
| Invite-only multi-user access | `users`, `invites`, user-scoped `runs`, `feedback`, `preference_events`, `source_settings`, and `user_ai_settings` were added; `/api/me` derives identity server-side. |
| Production auth does not fall back to test headers | `tests/auth.test.ts` now covers that `X-Beachcar-Test-Email` works only for localhost fallback and is rejected on remote hostnames even when `ENVIRONMENT` is missing or set to `development`. |
| No raw OpenAI key is stored in D1 | AI settings save only a `gatewayKeyRef`; onboarding/preferences now block raw-looking provider keys before the API call, and the Worker rejects the same shapes before D1 writes. Fast tests cover `sk-`, `sk_`, `sk-proj-`, and session-token shapes. |
| Cloudflare Agents / Workflows path | `BeachcarAgent` Durable Object and `BeachcarRunWorkflow` are wired in `wrangler.jsonc`; local smoke previously published a user-scoped run through the Workflow path. |
| Codex SDK / browser-heavy runner boundary | `runner/` includes a Container runner with `@openai/codex-sdk`; Worker bridge can now start the Container in deterministic default mode or explicit `BEACHCAR_RUNNER_MODE=codex`. |
| Per-user mobile support | iOS decodes `/api/me`, gates invite/onboarding/disabled states, caches latest runs per user, uses cached remote images, and shows Agent run status. |
| Image resizing/cache/preload | Worker serves `thumb`, `deck`, and `full` variants with immutable cache headers; PWA service worker caches image endpoints only in a bounded image cache; PWA and iOS prefetch nearby images. Unit tests now simulate the service worker and prove authenticated JSON is not cached, repeated image requests hit the dedicated image cache, and the cache trims to 180 entries. |
| Daily automation compatibility | Existing admin import remains, plus user-specific import and runner-task claim/complete/fail APIs. |
| Repeatable local verification | `npm run preflight` runs typecheck, Vitest, container syntax, runner simulator syntax, service-worker syntax, non-deploying readiness reporting, and client build. `npm run preflight:local` previously passed the full local Worker smoke. |
| Non-deploying rollout readiness check | `npm run deploy:check` inspects local Cloudflare config, migrations, script wiring, and env hints without network calls or secret output. |
| PWA screen visual verification | In-app browser audit covered invite, onboarding, admin, preferences, and Run Detail demo routes at desktop and 390px mobile widths with no horizontal overflow; Run Detail screenshots are saved in `docs/screenshots/friends-platform/`. |

## Verified This Pass

- `npm test`: 5 files, 20 tests passed.
- `npm run typecheck`: client, Worker, and tests passed.
- `npm run preflight`: passed with typecheck, Vitest, runner syntax checks, service-worker syntax, non-deploying readiness report, and client build.
- `node --check public/sw.js`: passed.
- `npm run deploy:check`: passed in report mode and identified 5 expected rollout todos: production D1 id, real bootstrap owner email, Clerk secret, Clerk issuer, and AI Gateway remote scoring credentials.

## Not Proven In This Environment

| Item | Why not proven | Required evidence before real friend use |
| --- | --- | --- |
| Production deploy | User explicitly prohibited real deploys. | Intentional deploy, remote D1 migrations, remote `/api/me`, invite, onboarding, run, export/delete smoke. |
| Deployed Container runner | Cloudflare Container was scaffolded locally but not deployed. | Deployed `BEACHCAR_RUNNER_CONTAINER` handles a runner task and records usage. |
| Credentialed Codex SDK run | Codex mode is now configurable, but no real Codex/OpenAI credentialed run was executed. | Configure `BEACHCAR_RUNNER_MODE=codex` and credentials, run a non-sensitive public-source task, verify normalized JSON/blocked result. |
| Real AI Gateway spend policy | Local adapter and usage ledger are implemented; remote Gateway budget/BYOK policy was not exercised. | Gateway request with user/run metadata, BYOK alias if used, budget enforcement/logging in Cloudflare. |
| Remote image transform behavior | Local smoke warmed image variants; deployed Worker/Images behavior was not exercised. | Remote image variant creation for large real listing photos, cache headers, and R2 variant rows. |
| iOS UI tests | CoreSimulator timed out in this environment. | `npm run ios:test-ui` passes invite, onboarding, and active deck fixtures. |

## Current Recommendation

The worktree is locally ready for a deliberate deployment rehearsal, but not yet proven for inviting real friends. The next non-deploy step is to re-run `npm run preflight:local` when the local Wrangler approval/usage gate is available again, then clear the `npm run deploy:check` todos. The first deploy rehearsal should use managed AI Gateway budgets and deterministic Container mode before enabling credentialed Codex mode.
