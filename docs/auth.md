# Clerk Auth

Beachcar uses Clerk in the browser and verifies Clerk session JWTs in the Worker.

Required local build env:

- `VITE_CLERK_PUBLISHABLE_KEY`

Required Worker secrets:

- `CLERK_SECRET_KEY`
- `CLERK_JWT_ISSUER`

Required Worker var:

- `ALLOWED_EMAIL`

`ALLOWED_EMAIL` is now the bootstrap owner, not the only allowed account. The Worker verifies the session JWT, fetches the Clerk user with `CLERK_SECRET_KEY`, normalizes the user's primary email, and maps it to a stable beta user id: `email:<normalized email>`.

Authorization is handled in D1:

- The bootstrap owner matching `ALLOWED_EMAIL` is automatically active.
- Other signed-in users are created with `invited` status.
- Invited users can only call `/api/me` and `POST /api/invites/accept` until they accept an invite code.
- Active users can read/write only their own profile, latest run, feedback, and preference events.
- Active users can update per-user source toggles with `PUT /api/source-settings`.
- Active users can export their account data with `GET /api/account/export`.
- Active users can delete their private account data with `DELETE /api/account` after confirming their email. This deletes profile, source settings, AI settings, AI usage events, runner tasks, feedback, preference events, user-scoped runs, and Agent run history, then marks the user row `disabled`. Shared listing and image cache rows are preserved.
- Disabled users can still call `/api/me` to see account status, but other user routes return `Account disabled`.
- Admin/publisher routes still require `PUBLISH_TOKEN`.

For local development without Clerk secrets, non-production localhost requests may fall back to `ALLOWED_EMAIL`.

Admin invite routes:

- `POST /api/admin/invites`
- `GET /api/admin/users`

User invite route:

- `POST /api/invites/accept`

## Native iOS

The SwiftUI app uses ClerkKit and ClerkKitUI with the prebuilt `AuthView()` sheet and `UserButton(signedOutContent:)`. It sends the native Clerk session token as `Authorization: Bearer <token>` to the same Worker API used by the PWA. In this beta slice, iOS is a review client for users who have already accepted an invite and completed onboarding on the web.

Native setup also requires Clerk Native API and an Associated Domains entitlement:

```text
webcredentials:{YOUR_FRONTEND_API_URL}
```
