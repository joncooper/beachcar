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

The bootstrap helper remains available for read-only inspection, local config updates, and strict deploy dry-run validation:

```bash
bun run cloudflare:bootstrap
```

It cannot create resources, apply remote migrations, accept a secrets file, or deploy. Those former direct flags now fail before Wrangler can mutate anything. `deploy:remote` is the sole production mutation path:

```bash
bun run cloudflare:bootstrap -- --dry-run-deploy
bun run deploy:remote -- --dry-run
bun run deploy:remote -- --execute --yes
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

1. Validates the deployment environment, builds the production client, and runs a strict Worker dry run.
2. Strictly verifies the authenticated production account, Worker, R2 bucket, required secret names, and that the configured D1 name and UUID identify the same remote database.
3. Requires exactly one active Worker version at 100% traffic and reads the remote Worker service metadata in memory. The remote Durable Object migration tag must already equal the final configured tag (`v2`), so this release cannot introduce a rollback-blocking DO migration or overwrite an in-progress split deployment.
4. Creates a private `/tmp/beachcar-rollout-*` directory with mode `0700`. It stores only minimal Worker rollback evidence (active deployments/versions, active version id, migration tag and timestamps), a D1 Time Travel bookmark, pending migration output, and a full D1 export plus SHA-256 digest. Authentication tokens, auth headers, full Worker service metadata, plain variable values, secret values, and the separately staged Worker-secret file are never written to these artifacts.
5. Stops unless the pending D1 set is empty or exactly `0011_source_cache_listing_fields.sql`.
6. Runs a second exact `wrangler deploy --strict --keep-vars --dry-run`, including any protected local secrets, before changing D1. `--strict` stops remote config conflicts; `--keep-vars` preserves audited dashboard-only plain vars. Existing omitted Worker secrets remain inherited.
7. Applies the gated D1 migration, then requires all 12 migration-0011 columns, all three new indexes, and `PRAGMA quick_check=ok`. A failure leaves the old Worker live.
8. Runs one strict `--keep-vars` Worker deploy, then verifies the effective non-secret runtime mode and deployment surface before a final strict resource check.

Execution requires `BEACHCAR_RUNNER_MODE=deterministic|codex` explicitly in `.deploy.env`. With `deterministic`, the rollout passes `--containers-rollout none`, so Cloudflare Container image publishing is not required. `codex` requires `--deploy-containers` and an `OPENAI_API_KEY` supplied in `.deploy.env`; an ambient shell key is never uploaded.

### Worker secrets

The required remote secret names are:

- `PUBLISH_TOKEN`
- `CLERK_SECRET_KEY`
- `CLERK_JWT_ISSUER`

Local values for these secrets are optional when those names already exist on the remote Worker and their values do not need to change. The rollout checks remote secret names without reading their values.

When local secret values are supplied, the rollout writes only the supplied Worker secrets to a separate private temporary directory and passes the file to `wrangler deploy --secrets-file`. That directory is never the preserved recovery bundle and is removed after deploy or failure. Code and secret changes therefore become one Worker version. Secrets omitted from the file are preserved remotely. There is no post-deploy `wrangler secret bulk` step and no second secret-only deployment.

`BEACHCAR_AI_GATEWAY_TOKEN` remains optional for the first friend pilot. The rollout explicitly reports either Gateway-backed scoring or heuristic-only mode. `CLOUDFLARE_API_TOKEN` is Wrangler authentication only and is never used as a Worker runtime AI credential.

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

This is intentionally not a read-only rehearsal. The ticket may be single-use. Before exchange, the verifier proves the exact HTTPS target, deployed Clerk key, protected Clerk user id, and effective Gateway/heuristic mode, then uses the admin API to fail closed on pilot identity/state/budget/configuration drift. It extracts the ticket only from the exact current or configured legacy origin and redeems it on the current deployment, sends a UUID-idempotent run request, follows the exact Agent/Workflow/published-run ids, validates all three source diagnostics plus accepted terminal C&B/Hemmings results, direct discovery, nonempty same-origin image bytes/cache hits, exact Run-detail identity, scoring provenance, and a healthy budget. Exact next-occurrence schedule synchronization and status readback occur last.

`--configure-pilot` explicitly repairs managed mode and the three required source settings when the preflight reports drift. By default the pre-ticket admin gate auto-selects the effective AI Gateway or heuristic proof; `--require-ai-gateway` and `--require-heuristic` pin that expectation. Terminal runner evidence is the default release gate. `--allow-runner-handoff-only` accepts queued/running handoffs for diagnostics only and is not release evidence. The UUID request is retried idempotently only inside the live authenticated process. Once that session exists, the consumed ticket/token URLs are cleared from `.env.local` with a private atomic replacement; `.tmp/managed-production-verification.json` retains only non-secret correlation and task evidence.

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
