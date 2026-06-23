# Clerk Auth

Beachcar uses Clerk in the browser and verifies Clerk session JWTs in the Worker.

Required local build env:

- `VITE_CLERK_PUBLISHABLE_KEY`

Required Worker secrets:

- `CLERK_SECRET_KEY`
- `CLERK_JWT_ISSUER`

Required Worker var:

- `ALLOWED_EMAIL`

The Worker verifies the session JWT, fetches the Clerk user with `CLERK_SECRET_KEY`, and rejects any user whose primary email does not match `ALLOWED_EMAIL`.

For local development without Clerk secrets, non-production localhost requests may fall back to `ALLOWED_EMAIL`.

## Native iOS

The SwiftUI app uses ClerkKit and ClerkKitUI with the prebuilt `AuthView()` sheet and `UserButton(signedOutContent:)`. It sends the native Clerk session token as `Authorization: Bearer <token>` to the same Worker API used by the PWA.

Native setup also requires Clerk Native API and an Associated Domains entitlement:

```text
webcredentials:{YOUR_FRONTEND_API_URL}
```
