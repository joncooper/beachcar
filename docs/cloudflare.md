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
