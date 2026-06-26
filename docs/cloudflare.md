# Cloudflare Setup Notes

Beachcar uses one Cloudflare Worker with Static Assets, D1, and R2.

Resources:

- Worker: `beachcar-watch` by default.
- D1: `beachcar-watch`.
- R2: `beachcar-watch-images`.

You may rename these, but keep `package.json` scripts and `wrangler.jsonc` in sync.

After running `bunx wrangler d1 create beachcar-watch`, copy the returned `database_id` into `wrangler.jsonc`.

If a differently named D1 database already exists in the account, inspect its tables and applied migrations before reusing it. Do not point `wrangler.jsonc` at a non-empty legacy database unless the schema matches the migrations in this repo.

Before a deployment rehearsal, run the read-only account inspector:

```bash
bun run cloudflare:check
```

This command uses Wrangler to inspect the logged-in account without creating, changing, or deploying resources. It checks the configured Worker name, remote D1 databases, R2 buckets, and Worker secret names. Use `--strict` to make missing remote resources exit non-zero:

```bash
bun scripts/check-cloudflare-resources.mjs --strict
```

To turn those findings into an ordered rehearsal plan without executing the mutating steps, run:

```bash
bun run cloudflare:plan
```

The plan labels each step as read-only, file-edit, or mutating. It includes the exact Wrangler commands for D1 creation/migration, first deploy, secret entry, AI Gateway follow-up, and post-deploy verification, but it does not execute them.

Machine-readable output is available for automation or review:

```bash
bun run cloudflare:plan --json
```

After a local or remote Worker is running, verify the public app and MCP surface with:

```bash
BEACHCAR_DEPLOY_URL=https://beachcar-watch.<your-subdomain>.workers.dev bun run cloudflare:verify
```

The verifier does not create, migrate, or deploy anything. It checks the app shell, `GET /mcp`, OAuth protected-resource metadata, authorization-server metadata, the unauthenticated MCP `WWW-Authenticate` challenge, and remote rejection of `X-Beachcar-Test-Email`. Against localhost, or against a deployed URL with `BEACHCAR_CLERK_TOKEN`, it also runs a full dynamic-client registration + authorization-code + S256 PKCE + MCP `tools/list` + revoke smoke. Optional environment variables extend the smoke:

- `BEACHCAR_CLERK_TOKEN`: verifies signed-in `/api/me` and `/api/automation/status`.
- `PUBLISH_TOKEN`: verifies admin source-cache status.
- `BEACHCAR_MCP_TOKEN`: verifies authenticated MCP `tools/list`.

Use `--json` for machine-readable output and `--strict` to make missing optional tokens fail the command.

Current read-only account findings from 2026-06-26:

- Logged in account: `b8873e78bf5e48fcdc91e87f2324cf55`.
- Configured Worker `beachcar-watch` is not deployed yet, so remote Worker secrets cannot be inspected.
- Configured R2 bucket `beachcar-watch-images` exists.
- Configured D1 name `beachcar-watch` does not exist yet; a similar legacy database `beach-car-watch` exists with id `2860a6be-7cf0-4fc0-821f-166e78521154`.
- `wrangler.jsonc` still uses the placeholder D1 `database_id`; choose whether to create `beachcar-watch` or intentionally reuse/migrate the legacy database before deploying.

Worker secrets:

- `PUBLISH_TOKEN`
- `CLERK_SECRET_KEY`
- `CLERK_JWT_ISSUER`

Worker vars:

- `ALLOWED_EMAIL`
- `ENVIRONMENT`
