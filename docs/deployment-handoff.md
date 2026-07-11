# Beachcar Deployment Handoff

This branch is ready for a deliberate Source Quality v1 rollout after the production account passes the strict read-only gate and remote D1 state is confirmed.

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

The expected Source Quality v1 state is that only `0011_source_cache_listing_fields.sql` is pending. Stop if the command reports any other pending migration.

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

Supply a local value only when creating or rotating that secret. Supplied secret values are included atomically in the one Worker deployment through `wrangler deploy --secrets-file`; omitted secrets are preserved. The rollout does not run `wrangler secret bulk` after deployment.

Optional verifier credentials:

- `BEACHCAR_CLERK_TOKEN`
- `BEACHCAR_MCP_TOKEN`
- `PUBLISH_TOKEN`, when it is available locally for the admin check

Optional managed AI runtime configuration:

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
- Current Worker versions, including the pre-rollout version needed for a code rollback.
- A pre-migration D1 Time Travel bookmark.
- The pending-migration report, which must be empty or list only `0011_source_cache_listing_fields.sql`.
- A full pre-migration D1 SQL export and its SHA-256 digest.

Keep the printed directory until verification is complete, then move the artifacts to durable, access-controlled storage according to the project retention policy.

The remaining execution order is: apply the verified pending migration; require all 12 migration-0011 columns, all three indexes, and `PRAGMA quick_check=ok`; deploy code and any supplied secrets together as one Worker version; run verification; and repeat the strict resource check. A failed schema gate leaves the old Worker live with the additive migration applied. There is no post-deploy secret-only release.

While `BEACHCAR_RUNNER_MODE=deterministic`, the orchestrator skips Cloudflare Container image publishing with `--containers-rollout none`. To intentionally build or update the Container image for Codex-backed runner work, run:

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

This verifier performs its public/admin gates before exchanging the ticket, keeps the resulting short-lived Clerk JWT in memory, queues exactly one real managed Workflow run, polls that Agent run by id, fetches the exact published run by id, and checks enabled-source diagnostics, direct discovery, the shortlist, Beachcar deck-image cache headers, and the budget ledger. Do not run it as a rehearsal: the ticket may be single-use and the command intentionally creates a production run.

## Rollback

If post-deploy verification fails, use the pre-rollout Worker version recorded in the private artifact directory:

```bash
bunx wrangler rollback <PREVIOUS_VERSION_ID> \
  --name beachcar-watch \
  --message "Rollback Source Quality v1"
```

Migration `0011` is additive, so a failed code upload can leave `0011` applied while the old Worker remains live. However, after the new release has resynchronized a profile schedule, do **not** roll directly back to the old `0010` Worker: the new scheduler creates timezone-aware one-shot Durable Object schedules that the old code neither renews nor reconciles. Prefer a forward hotfix or a bridge/reconciliation release. A direct code rollback is only a safe option before the new scheduler has touched production schedule state.

Only use D1 Time Travel for confirmed database corruption. It is destructive and discards writes after the chosen bookmark. First stop writes and roll back the Worker, then restore deliberately from the saved bookmark and retain the undo bookmark Cloudflare returns:

```bash
bunx wrangler d1 time-travel restore beach-car-watch \
  --bookmark <PRE_MIGRATION_BOOKMARK>
```
