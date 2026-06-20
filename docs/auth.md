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

