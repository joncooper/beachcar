# Cloudflare Setup Notes

Beachcar uses one Cloudflare Worker with Static Assets, D1, and R2.

Production target:

- Account: `b8873e78bf5e48fcdc91e87f2324cf55`.
- Worker: `beachcar-watch`.
- D1: `beach-car-watch` (`2860a6be-7cf0-4fc0-821f-166e78521154`).
- R2: `beachcar-watch-images`.
- URL: `https://beachcar-watch.jon-cooper.workers.dev`.

`wrangler.jsonc` is the source of truth for the Worker and binding configuration. The production rollout expects `CLOUDFLARE_ACCOUNT_ID` to equal the account above. A Wrangler login or API token for another account is not safe, even if similarly named resources exist there.

## Authenticate and Check the Target

Prefer Wrangler's interactive login. If automation requires a token, reserve `CLOUDFLARE_API_TOKEN` for Wrangler authentication and inject it securely; never upload it as a Worker runtime secret. Runtime AI calls use `BEACHCAR_AI_GATEWAY_TOKEN` instead.

Before any remote mutation, run the strict account and resource check:

```bash
export CLOUDFLARE_ACCOUNT_ID=b8873e78bf5e48fcdc91e87f2324cf55
bunx wrangler whoami --account "$CLOUDFLARE_ACCOUNT_ID" --json
bun scripts/check-cloudflare-resources.mjs --strict
```

Stop if the authenticated account does not match, or if the configured Worker, D1 name and ID, or R2 bucket cannot be verified. The check is read-only.

## Migration State

The remote D1 migration ledger is authoritative:

```bash
bunx wrangler d1 migrations list beach-car-watch --remote
```

For the Source Quality v1 rollout, the expected state is that only `0011_source_cache_listing_fields.sql` is pending. Do not infer remote state from an older handoff note. Stop and investigate if any other migration is pending or the remote database identity differs from `wrangler.jsonc`.

The bootstrap helper remains available for read-only inspection and explicit, guarded resource work:

```bash
bun run cloudflare:bootstrap
```

Default mode is read-only. Remote changes require `--yes` and the matching action flag:

```bash
bun run cloudflare:bootstrap -- --yes --apply-resources --write-config
bun run cloudflare:bootstrap -- --yes --migrate --dry-run-deploy
bun run cloudflare:bootstrap -- --yes --migrate --dry-run-deploy --deploy
```

Set production bootstrap owner emails with:

```bash
bun run cloudflare:bootstrap -- --write-config --owner-emails "owner@example.com"
```

`BOOTSTRAP_OWNER_EMAILS` accepts a comma-separated owner list and overrides the legacy single `ALLOWED_EMAIL` var. The first owner is used for legacy-data compatibility; every listed owner is activated automatically on first sign-in.

If a differently named D1 database already exists in the account, inspect its identity, tables, and remote migration ledger before reusing it. Do not point `wrangler.jsonc` at a non-empty legacy database unless its schema matches this repository.

## Guarded Remote Rollout

Prepare the ignored local handoff file and rehearse without remote mutations:

```bash
cp .deploy.env.example .deploy.env
bun run deploy:env:check
bun run deploy:remote -- --dry-run
```

After explicit approval:

```bash
bun run deploy:remote -- --execute --yes
```

The guarded rollout:

1. Strictly verifies the authenticated production account and configured resources.
2. Validates the deployment environment, builds the production client, and dry-runs the Worker bundle.
3. Creates a private `/tmp/beachcar-rollout-*` directory with mode `0700` and captures the current Worker deployments, Worker versions, pending D1 migration output, a D1 Time Travel bookmark, and a full remote D1 export plus SHA-256 digest before migration. Artifact files use mode `0600`; retain the printed directory for rollback or move it to durable, access-controlled storage.
4. Stops unless the pending set is empty or exactly `0011_source_cache_listing_fields.sql`, then applies migrations.
5. Before deploying, verifies that D1 has all 12 migration-0011 columns, all three new indexes, and `PRAGMA quick_check=ok`. A failure leaves the old Worker live.
6. Deploys the Worker once.
7. Runs deployment verification and a final strict resource check.

With `BEACHCAR_RUNNER_MODE=deterministic`, the rollout passes `--containers-rollout none`, so Cloudflare Container image publishing is not required. Add `--deploy-containers` only when intentionally updating the Container image for `BEACHCAR_RUNNER_MODE=codex`.

### Worker secrets

The required remote secret names are:

- `PUBLISH_TOKEN`
- `CLERK_SECRET_KEY`
- `CLERK_JWT_ISSUER`

Local values for these secrets are optional when those names already exist on the remote Worker and their values do not need to change. The rollout checks remote secret names without reading their values.

When local secret values are supplied, the rollout writes only the supplied Worker secrets to a private temporary file and passes it to `wrangler deploy --secrets-file`. Code and secret changes therefore become one Worker version. Secrets omitted from the file are preserved remotely. There is no post-deploy `wrangler secret bulk` step and no second secret-only deployment.

## Verification

Verify the public Worker surface with:

```bash
bun scripts/verify-cloudflare-deploy.mjs \
  --url https://beachcar-watch.jon-cooper.workers.dev \
  --strict
```

`--strict` makes failures in the public core checks fatal: the app shell, MCP discovery and OAuth metadata, unauthenticated MCP challenge, and rejection of local test authentication on the deployed host. Missing optional credentials do not by themselves fail this public-core verification.

Use explicit requirements when the corresponding credentials have been loaded securely into the environment:

- `--require-clerk` requires `BEACHCAR_CLERK_TOKEN` and the signed-in API plus OAuth authorization-code/S256 PKCE checks.
- `--require-publish` requires `PUBLISH_TOKEN` and the admin source-cache status check.
- `--require-mcp` requires `BEACHCAR_MCP_TOKEN` and authenticated MCP `tools/list`.
- `--require-authenticated` requires all token-gated verification suites.

For full production verification:

```bash
bun scripts/verify-cloudflare-deploy.mjs \
  --url https://beachcar-watch.jon-cooper.workers.dev \
  --strict \
  --require-authenticated
```

Do not put token values on the command line. The verifier is read-only and does not create, migrate, or deploy resources. Use `--json` for machine-readable output.

After deployment, prove the actual friend-facing managed path once with the protected Clerk sign-in ticket in `.env.local`:

```bash
bun run cloudflare:verify-managed -- --execute --yes
```

This is intentionally not a read-only rehearsal. The ticket may be single-use. The verifier runs public/admin preflight first, exchanges the ticket without printing or persisting the short-lived JWT, queues one real managed Workflow run, follows the exact Agent/run ids, and validates enabled-source diagnostics, direct discovery, shortlist publication, Beachcar deck-image cache hits, and budget status.

If a post-deploy problem appears after the new scheduler has resynchronized any user profile, prefer a forward fix or a bridge release. The timezone-aware scheduler writes one-shot Durable Object schedules that the old Worker does not renew or reconcile, so a direct rollback to the `0010` Worker can cause a one-time duplicate followed by lost daily scheduling. The additive D1 migration itself may remain applied.

The read-only account inspector and rehearsal-plan generator remain available:

```bash
bun scripts/check-cloudflare-resources.mjs --strict
bun run cloudflare:plan
bun run cloudflare:plan --json
```

Worker vars:

- `BOOTSTRAP_OWNER_EMAILS` or legacy `ALLOWED_EMAIL`
- `ENVIRONMENT`
