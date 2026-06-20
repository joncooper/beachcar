# Cloudflare Setup Notes

Beachcar uses one Cloudflare Worker with Static Assets, D1, and R2.

Resources:

- Worker: `beachcar-watch` by default.
- D1: `beachcar-watch`.
- R2: `beachcar-watch-images`.

You may rename these, but keep `package.json` scripts and `wrangler.jsonc` in sync.

After running `npx wrangler d1 create beachcar-watch`, copy the returned `database_id` into `wrangler.jsonc`.

Worker secrets:

- `PUBLISH_TOKEN`
- `CLERK_SECRET_KEY`
- `CLERK_JWT_ISSUER`

Worker vars:

- `ALLOWED_EMAIL`
- `ENVIRONMENT`

