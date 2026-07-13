# Beachcar Deployment Handoff

This branch is ready for a deliberate agent-connected subscriptions rollout after the production account passes the strict read-only gate and remote D1 state is confirmed.

## Production Target

- Account: `b8873e78bf5e48fcdc91e87f2324cf55`
- Worker: `beachcar-watch`
- D1: `beach-car-watch` (`2860a6be-7cf0-4fc0-821f-166e78521154`)
- R2: `beachcar-watch-images`
- URL: `https://beachcar-watch.jon-cooper.workers.dev`
- Bootstrap owners: `jon.cooper@gmail.com`, `jon@dockett.ai`

`wrangler.jsonc` is the source of truth for these bindings. Authenticate with a user or API token that has access to the production account, then run:

```bash
export CLOUDFLARE_ACCOUNT_ID=b8873e78bf5e48fcdc91e87f2324cf55
bunx wrangler whoami --account "$CLOUDFLARE_ACCOUNT_ID" --json
bun scripts/check-cloudflare-resources.mjs --strict
```

Do not continue if the account or any configured resource differs.

The remote migration ledger is authoritative:

```bash
bunx wrangler d1 migrations list beach-car-watch --remote
```

The rollout accepts no pending migrations or only the reviewed additive set: `0011_source_cache_listing_fields.sql`, `0012_product_events.sql`, and `0013_agent_connected_subscriptions.sql`. Stop if the command reports any other pending migration.

## Deployment Environment

Create the ignored local handoff file:

```bash
cp .deploy.env.example .deploy.env
```

`VITE_CLERK_PUBLISHABLE_KEY` is required for the production client build. `CLOUDFLARE_ACCOUNT_ID` must remain the production account above.

The following are required Worker secret names but their local values may remain empty when the remote Worker already has the correct values:

- `PUBLISH_TOKEN`
- `CLERK_SECRET_KEY`
- `CLERK_JWT_ISSUER`
- `CLERK_WEBHOOK_SIGNING_SECRET`

Supply a local value only when creating or rotating that secret. Supplied secret values are included atomically in the one Worker deployment through `wrangler deploy --secrets-file`; omitted secrets are preserved. The rollout does not run `wrangler secret bulk` after deployment.

Optional verifier credentials:

- `BEACHCAR_CLERK_TOKEN`
- `BEACHCAR_MCP_TOKEN`
- `PUBLISH_TOKEN`, when it is available locally for the admin check

Required before enabling Clerk's paid `managed_research` feature (not required for free agent-connected MCP curation):

- `BEACHCAR_AI_GATEWAY_TOKEN`
- `BEACHCAR_AI_GATEWAY_BASE_URL`, or `CLOUDFLARE_ACCOUNT_ID` plus `BEACHCAR_AI_GATEWAY_ID`

Reserve `CLOUDFLARE_API_TOKEN` exclusively for Wrangler authentication. Do not use it as the Worker runtime AI credential and do not upload it to the Worker; runtime AI uses `BEACHCAR_AI_GATEWAY_TOKEN`.

Validate without printing values:

```bash
bun run deploy:env:check
```

## Approval Needed

Use this exact approval when ready:

```text
I approve capturing rollback artifacts, applying the verified remote D1 migration, atomically deploying the beachcar-watch Worker and any supplied Worker secrets, and running remote verification.
```

## Guarded Remote Rollout

Rehearse first:

```bash
bun run deploy:remote -- --dry-run
```

After approval:

```bash
bun run deploy:remote -- --execute --yes
```

Before migration, the orchestrator creates a random private `/tmp/beachcar-rollout-*` directory with mode `0700`. It writes the following recovery evidence with mode `0600`:

- Current Worker deployments.
- Current Worker versions and the single active 100%-traffic version needed for a code rollback.
- Minimal rollback evidence containing the active version id, timestamps, and remote Durable Object migration tag. The tag must already match configured `v2`; otherwise rollout stops before D1 backup or mutation because a code rollback would not be proven available.
- A pre-migration D1 Time Travel bookmark.
- The pending-migration report, which must be empty or list only reviewed migrations `0011`, `0012`, and `0013`.
- A full pre-migration D1 SQL export and its SHA-256 digest.

Keep the printed directory until verification is complete, then move the artifacts to durable, access-controlled storage according to the project retention policy. Cloudflare auth tokens and headers, full service metadata, plain variable values, secret values, and the separate temporary Worker-secret staging directory are kept out of these artifacts.

The remaining execution order is: require the configured D1 name and UUID to identify the same remote database; prove rollback availability; capture recovery state; run an exact `wrangler deploy --strict --keep-vars --dry-run` with any supplied secrets; apply only the verified pending migrations; require the Source Quality, product-event, research-mode, and billing-entitlement schemas plus `PRAGMA quick_check=ok`; deploy code and supplied secrets together once with `--strict --keep-vars`; run verification; and repeat the strict resource check. Strict mode stops remote configuration conflicts, while `--keep-vars` preserves audited dashboard-only plain vars. A failed schema gate leaves the old Worker live with the additive migrations applied. There is no post-deploy secret-only release.

Direct remote migration and bootstrap mutation commands are disabled. `bun run deploy:remote -- --execute --yes` is the sole production mutation entrypoint. If `BEACHCAR_AI_GATEWAY_TOKEN` is unavailable locally and remotely, the free MCP path can still deploy, but the paid managed feature must remain disabled; `CLOUDFLARE_API_TOKEN` is never substituted as a runtime AI credential.

The orchestrator requires an explicit `BEACHCAR_RUNNER_MODE=deterministic|codex` in `.deploy.env` and reads the effective mode back after deployment. `deterministic` skips Cloudflare Container image publishing with `--containers-rollout none`. To intentionally use `codex`, supply its `OPENAI_API_KEY` in `.deploy.env` (never only in the ambient shell) and run:

```bash
bun run deploy:remote -- --execute --yes --deploy-containers
```

## Verification

Public-core production verification:

```bash
bun scripts/verify-cloudflare-deploy.mjs \
  --url https://beachcar-watch.jon-cooper.workers.dev \
  --strict
```

`--strict` covers the public app and MCP/OAuth surface. Add explicit gates for token-protected surfaces after loading their credentials securely:

- `--require-clerk`: signed-in APIs and the Clerk-backed OAuth authorization-code/S256 PKCE flow.
- `--require-publish`: admin source-cache status.
- `--require-mcp`: authenticated MCP `tools/list`.
- `--require-authenticated`: all token-gated suites.

Full production verification:

```bash
bun scripts/verify-cloudflare-deploy.mjs \
  --url https://beachcar-watch.jon-cooper.workers.dev \
  --strict \
  --require-authenticated

bun scripts/check-cloudflare-resources.mjs --strict
```

Do not place credentials on the command line. A public-core pass is not proof that token-gated flows passed unless the matching requirement flags were present.

For the friend-pilot managed-path proof, use the protected single-use Clerk ticket already stored in `.env.local` only after the deployment and public/admin preflight have passed:

```bash
bun run cloudflare:verify-managed -- --execute --yes
```

The verifier fails closed before ticket exchange unless the target, deployed Clerk key, exact protected pilot id, active/onboarded state, `managed_research` entitlement, budget, managed mode, BaT/C&B/Hemmings settings, and AI Gateway runtime are ready. The recognized legacy ticket URL is never visited: only its single `__clerk_ticket` value is extracted in memory and redeemed on `BEACHCAR_DEPLOY_URL`. It sends a persisted UUID `requestId`, follows the exact Agent/Workflow/published-run ids, proves exact Run-detail identity and same-origin image bytes/cache headers, and synchronizes plus validates the exact next timezone-aware schedule occurrence last.

Use `--configure-pilot` only to select managed research and repair the three required source settings after Clerk already grants the feature; the verifier cannot grant billing access. The default runner gate waits for C&B candidates to merge and for Hemmings to merge candidates or terminate honestly empty/blocked. `--allow-runner-handoff-only` reports exact task ids for non-release diagnostics but does not qualify as release evidence. The UUID request gets bounded idempotent retry only inside the same authenticated process. As soon as the Clerk session exists, the consumed token and both ticket URLs are atomically cleared from `.env.local` while token id/user/email remain; `.tmp/managed-production-verification.json` contains only non-secret evidence. Do not run the verifier as a rehearsal.

## Rollback

If post-deploy verification fails, use the `activeWorkerVersionId` recorded in `manifest.json`. The rollout creates that manifest only after proving the active Worker already has migration tag `v2`, so this deploy does not add an intervening Durable Object migration:

```bash
bunx wrangler rollback <activeWorkerVersionId> \
  --name beachcar-watch \
  --message "Rollback Source Quality v1"
```

Migrations `0011`–`0013` are additive, so a failed code upload can leave them applied while the old Worker remains live. However, after the new release has resynchronized a profile schedule, do **not** roll directly back to the old `0010` Worker: the new scheduler creates timezone-aware one-shot Durable Object schedules that the old code neither renews nor reconciles. Prefer a forward hotfix or a bridge/reconciliation release. A direct code rollback is only a safe option before the new scheduler has touched production schedule state.

Only use D1 Time Travel for confirmed database corruption. It is destructive and discards writes after the chosen bookmark. First stop writes and roll back the Worker, then restore deliberately from the saved bookmark and retain the undo bookmark Cloudflare returns:

```bash
bunx wrangler d1 time-travel restore beach-car-watch \
  --bookmark <PRE_MIGRATION_BOOKMARK>
```
