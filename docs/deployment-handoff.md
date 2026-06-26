# Beachcar Deployment Handoff

This branch is ready for a deliberate remote rollout once Clerk values and explicit mutation approval are available.

## Current Cloudflare Target

- Account: `b8873e78bf5e48fcdc91e87f2324cf55`
- Worker: `beachcar-watch`
- D1: `beach-car-watch` (`2860a6be-7cf0-4fc0-821f-166e78521154`)
- R2: `beachcar-watch-images`
- Bootstrap owners: `jon.cooper@gmail.com`, `jon@dockett.ai`

Read-only inspection showed the D1 has migrations `0001`-`0004` applied. Remote migrations `0005`-`0010` are pending.

## Values Needed

Create `.deploy.env` from the template:

```bash
cp .deploy.env.example .deploy.env
```

Fill these required values:

- `VITE_CLERK_PUBLISHABLE_KEY`
- `PUBLISH_TOKEN`
- `CLERK_SECRET_KEY`
- `CLERK_JWT_ISSUER`

Optional after first deploy:

- `BEACHCAR_DEPLOY_URL`
- `BEACHCAR_CLERK_TOKEN`
- `BEACHCAR_MCP_TOKEN`

Optional for managed AI scoring proof:

- `BEACHCAR_AI_GATEWAY_TOKEN` or `CLOUDFLARE_API_TOKEN`
- `BEACHCAR_AI_GATEWAY_BASE_URL`, or `CLOUDFLARE_ACCOUNT_ID` plus `BEACHCAR_AI_GATEWAY_ID`

Validate without printing values:

```bash
bun run deploy:env:check
```

## Approval Needed

Use this exact approval when ready:

```text
I approve applying remote D1 migrations, setting Worker secrets, deploying the beachcar-watch Worker, and running remote verification.
```

## Remote Rollout Commands

After approval and `.deploy.env` is filled, run the guarded orchestrator:

```bash
bun run deploy:remote -- --dry-run
bun run deploy:remote -- --execute --yes
```

The orchestrator validates `.deploy.env`, builds the production client, dry-runs the Worker bundle, applies remote D1 migrations, deploys the Worker, sets Worker secrets through a temporary `wrangler secret bulk` JSON file, and runs remote verification.

The underlying manual commands are:

```bash
bun run db:migrate:remote
bunx wrangler secret put PUBLISH_TOKEN
bunx wrangler secret put CLERK_SECRET_KEY
bunx wrangler secret put CLERK_JWT_ISSUER
bun run cloudflare:bootstrap -- --dry-run-deploy
bun run cloudflare:bootstrap -- --yes --migrate --dry-run-deploy --deploy
```

Then set `BEACHCAR_DEPLOY_URL` and verify:

```bash
bun run cloudflare:verify
bun run cloudflare:check
```
