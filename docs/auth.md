# Clerk Auth

Beachcar uses Clerk in the browser and verifies Clerk session JWTs in the Worker.

Required local build env:

- `VITE_CLERK_PUBLISHABLE_KEY`

Required Worker secrets:

- `CLERK_SECRET_KEY`
- `CLERK_JWT_ISSUER`

Private-pilot configuration:

- Keep `VITE_MANAGED_RESEARCH_CHECKOUT_ENABLED=false`.
- Set the optional Worker secret `BEACHCAR_MANAGED_PILOT_EMAILS` to a comma-separated list of approved tester emails. Bootstrap owners receive pilot access automatically.
- Do not enable Clerk Billing, connect production Stripe, or configure `CLERK_WEBHOOK_SIGNING_SECRET` yet.

Before deployment, put Clerk values in `.deploy.env` and run:

```bash
bun run deploy:env:check
```

The checker validates presence and key shape without printing values.

Required Worker var:

- `BOOTSTRAP_OWNER_EMAILS` or legacy `ALLOWED_EMAIL`

`BOOTSTRAP_OWNER_EMAILS` accepts a comma-separated list and overrides the legacy single `ALLOWED_EMAIL` fallback. The first configured owner is the legacy-data owner; every configured owner is automatically activated on first sign-in. The Worker verifies the session JWT, fetches the Clerk user with `CLERK_SECRET_KEY`, normalizes the user's primary email, and maps it to a stable beta user id: `email:<normalized email>`.

Authorization is handled in D1:

- Bootstrap owners matching `BOOTSTRAP_OWNER_EMAILS`, `ALLOWED_EMAILS`, or legacy `ALLOWED_EMAIL` are automatically active.
- Other signed-in users are created with `invited` status.
- Invited users can only call `/api/me` and `POST /api/invites/accept` until they accept an invite code.
- Active users can read/write only their own profile, latest run, feedback, and preference events.
- Active users can update per-user source toggles with `PUT /api/source-settings`.
- Active users can choose free agent-connected curation with `PUT /api/research-settings`. Selecting `managed` requires either private-pilot access or the future Clerk `managed_research` feature.
- Manual hosted runs, managed schedule synchronization, scheduled callbacks, and Workflow inference all recheck Managed Research access. MCP publication remains available to active users without hosted access.
- Active users can export their account data with `GET /api/account/export`.
- Active users can delete their private account data with `DELETE /api/account` after confirming their email. This deletes profile, source settings, research settings, billing entitlements, AI settings, AI usage events, runner tasks, feedback, preference events, user-scoped runs, and Agent run history, then marks the user row `disabled`. Shared listing and image cache rows are preserved.
- Disabled users can still call `/api/me` to see account status, but other user routes return `Account disabled`.
- Admin/publisher routes still require `PUBLISH_TOKEN`.

For local development without Clerk secrets, non-production localhost requests may fall back to the first configured bootstrap owner.

Admin invite routes:

- `POST /api/admin/invites`
- `GET /api/admin/users`

User invite route:

- `POST /api/invites/accept`

## Managed Research authorization

During the private pilot, the Worker grants `managed_research` to bootstrap owners and emails in the `BEACHCAR_MANAGED_PILOT_EMAILS` secret. The entitlement is persisted in D1 with source `pilot_allowlist`, so background schedules use the same gate as foreground requests. Removing an email revokes access the next time that user calls the Worker. There is no checkout and no payment method is collected.

### Commercial launch later

The public Clerk B2C plan should carry the feature slug `managed_research`. Clerk session-v2 `fea` and `pla` claims provide immediate request-time authorization. `ensureUser` mirrors those claims into D1 whenever a signed-in user calls the Worker.

When production checkout is deliberately enabled, background schedules do not have a browser session, so Clerk billing events must also be delivered to:

```text
POST /api/webhooks/clerk
```

Subscribe that endpoint to `subscription.*`, `subscriptionItem.*`, and `paymentAttempt.*` billing events. The Worker verifies the Standard Webhooks signature with `CLERK_WEBHOOK_SIGNING_SECRET`, fetches the current user subscription through the Clerk Backend SDK, and persists only whether an active plan contains `managed_research`, its plan slug, and period end. A lost entitlement stops new manual runs immediately and cancels the Durable Object schedule at its next callback.

See [Managed Research pricing](pricing.md) for the plan definition and launch assumptions.

## Native iOS

The SwiftUI app uses ClerkKit and ClerkKitUI with the prebuilt `AuthView()` sheet and `UserButton(signedOutContent:)`. It sends the native Clerk session token as `Authorization: Bearer <token>` to the same Worker API used by the PWA. In this beta slice, iOS is a review client for users who have already accepted an invite and completed onboarding on the web.

Native setup also requires Clerk Native API and an Associated Domains entitlement:

```text
webcredentials:{YOUR_FRONTEND_API_URL}
```
