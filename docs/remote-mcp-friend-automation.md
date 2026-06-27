# Beachcar Remote MCP Friend Automation

Date: 2026-06-25

## Goal

Let a friend configure Beachcar in the website, create a scoped automation credential, give that credential plus a downloadable skill to a cloud agent of their choice, and have that agent gather listings, publish a user-scoped run, record AI usage, and verify the app without running any local MCP server.

This is a preview implementation. It now supports both revocable manually issued bearer tokens and a local-first OAuth authorization-code + PKCE flow for hosted MCP clients. Production still needs remote Clerk-session validation with a real MCP client after deployment, but the token scopes, event model, and tool contracts are shared.

## Architecture

```mermaid
flowchart LR
  Friend["Friend in Beachcar PWA"] --> Settings["Preferences: Connect Automation"]
  Settings --> Token["Scoped automation token shown once"]
  Settings --> Skill["Download Beachcar skill"]
  Agent["Codex / Claude / cloud agent"] --> MCP["Worker /mcp JSON-RPC"]
  MCP --> Auth["manual or OAuth token hash check"]
  MCP --> Events["automation_events"]
  MCP --> D1["D1 user profile, feedback, runs, AI usage"]
  MCP --> R2["R2 image cache via publish_run"]
  MCP --> BaT["BaT public RSS source tool"]
  Web["PWA"] --> Latest["/api/runs/latest"]
  iOS["iOS app"] --> Latest
  Latest --> D1
```

## Implemented Surface

Website routes:

- `GET /api/automation/status`: returns MCP endpoint, OAuth status, default scopes, redacted manual/OAuth tokens, and recent automation events.
- `POST /api/automation/tokens`: creates a token, returns the secret once, stores only a hash.
- `DELETE /api/automation/tokens/:id`: revokes one token for the signed-in user.
- `DELETE /api/automation/oauth-tokens/:id`: revokes one OAuth connection for the signed-in user without requiring the raw bearer token.
- `GET /api/automation/events`: returns recent user-scoped automation events.
- `GET /api/automation/bundle`: returns a generated `SKILL.md` with the current MCP endpoint filled in.

Remote MCP route:

- `GET /mcp`: returns server/tool metadata for setup.
- `POST /mcp`: accepts JSON-RPC requests with `Authorization: Bearer <automation-token>`.

OAuth discovery routes:

- `GET /.well-known/oauth-protected-resource/mcp`: returns OAuth protected-resource metadata for the hosted `/mcp` endpoint.
- `GET /.well-known/oauth-protected-resource`: returns the same metadata as a host-level compatibility fallback.
- Unauthorized `/mcp` JSON-RPC requests return `WWW-Authenticate: Bearer resource_metadata="..."` so MCP clients can discover the protected-resource metadata URL.

OAuth authorization-server routes:

- `GET /.well-known/oauth-authorization-server`: returns authorization server metadata, including authorization, token, registration, and revocation endpoints.
- `POST /oauth/register`: dynamically registers a public OAuth client with HTTPS or localhost redirect URIs.
- `GET /oauth/authorize`: issues authorization codes for signed-in active Beachcar users. The local verifier uses `X-Beachcar-Test-Email`; remote deploys should use a real Clerk bearer session.
- `POST /oauth/token`: exchanges an authorization code plus S256 PKCE verifier for a short-lived `bcoauth_...` access token audience-bound to `/mcp`.
- `POST /oauth/revoke`: revokes an OAuth access token.

MCP methods:

- `initialize`
- `tools/list`
- `tools/call`

MCP tools:

- `get_setup_context`
- `plan_daily_research`
- `search_bat_cache`: searches D1-cached Bring a Trailer public RSS candidates and refreshes the cache when empty or stale.
- `submit_candidates`
- `publish_run`
- `record_usage`
- `verify_latest_run`
- `list_automation_events`

`submit_candidates` and `publish_run` accept the full listing shape from `docs/publishing.md`, including the optional nested `dossier` object (rich per-car detail: specs, full writeup, equipment, service, bid log, comments, beach-use fit, and a 0..1 `valueScore`). All dossier fields are optional and are coerced/validated on import.

## Token Model

Manual automation tokens are user-owned and revocable:

- Secret format: `bcauto_<token-id>.<random-secret>`
- Stored value: SHA-256 hash of the whole token.
- Token metadata: label, scopes, created time, last used time, revoked time.
- Default scopes: `setup:read`, `sources:read`, `runs:publish`, `usage:write`, `events:read`.
- Every MCP call touches `last_used_at`; tools also write `automation_events`.

OAuth access tokens are also user-owned:

- Secret format: `bcoauth_<token-id>.<random-secret>`
- Stored value: SHA-256 hash of the whole token.
- Token metadata: client id, scopes, `/mcp` resource audience, created time, last used time, expiry, and revoked time.
- Authorization codes expire after 10 minutes and are single-use.
- Access tokens expire after 1 hour and are rejected unless their resource audience exactly matches the hosted `/mcp` endpoint.
- The Preferences panel lists active/revoked OAuth connections by registered client name and can revoke them by id.
- OAuth-authenticated MCP tool events set `token_id` to `null` and include `authKind`, `oauthAccessTokenId`, and `oauthClientId` in event metadata.

No raw provider/model key is accepted by this system. AI cost attribution is recorded through `record_usage`; actual model payment depends on the friend or owner automation setup.

## App Screen

Preferences now includes **Connect automation**:

- Shows the absolute `/mcp` endpoint.
- Creates a token for a friend cloud agent.
- Displays the token once with copy affordance.
- Downloads the Beachcar daily-run skill.
- Lists recent active/revoked manual tokens and OAuth connections.
- Revokes OAuth connections by id without showing or storing raw access tokens.
- Shows recent automation events.
- Shows OAuth discovery and authorization-server endpoints while retaining scoped tokens for fallback clients.

## Skill

The canonical repo skill lives at:

- `.agents/skills/beachcar-daily-run/SKILL.md`

The website bundle route emits the same workflow with the current deployment's MCP endpoint inserted. The skill tells a cloud agent to use the hosted MCP tools, gather candidates, publish through `publish_run`, call `record_usage`, and verify with `verify_latest_run`.

The skill now includes explicit setup guidance for hosted MCP clients:

- connect to the hosted `/mcp` endpoint and authenticate with OAuth or the fallback Beachcar automation token as a bearer token,
- use OAuth protected-resource discovery and authorization-code + PKCE when the client supports it, or fall back to scoped tokens,
- stop rather than inventing an API fallback if hosted MCP tools are unavailable,
- use `search_bat_cache` before direct BaT browsing,
- record zero-cost cached source reads and paid AI/browser-harness work through `record_usage`,
- write blocked sources or manual-check caveats into `sourceSummary`,
- finish only after `publish_run` and `verify_latest_run` agree on the run id and listing count.

## Image Handling

`publish_run` reuses the existing import path. That path stores listing/image metadata in D1, queues image warmup through `ctx.waitUntil(prewarmImportedImages(...))`, mirrors source images into R2, and serves `thumb`, `deck`, and `full` variants through `/api/images/:imageKey?variant=...`.

That means runs published by a friend's cloud agent should behave the same as Workflow or admin-import runs in both the PWA and iOS app.

## Source Cache

Bring a Trailer RSS ingestion is persisted in D1:

- `source_items` stores deduped listing/feed candidates by URL.
- `source_ingestion_runs` records every scheduled/manual refresh.
- A 15-minute Worker cron refreshes the BaT public auctions RSS feed.
- Admins can inspect and refresh the cache through `/api/admin/source-cache/status` and `/api/admin/source-cache/ingest`.
- The admin console surfaces that same status with freshness, item counts, latest ingestion result, and a manual BaT RSS ingest control.

## OAuth Follow-Up

Local authorization-code + PKCE is implemented and verified through `bun run cloudflare:verify`. Remaining work before broader use:

1. Validate the OAuth flow on a deployed Worker with a real Clerk bearer session and at least one real MCP client.
2. Decide whether refresh tokens are useful; the first implementation intentionally issues short-lived access tokens only.
3. Preserve `automation_events` as the user-visible activity log.
4. Keep `publish_run`, `record_usage`, and source tools unchanged so cloud agents do not need a new workflow.
