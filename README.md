# Beachcar

Beachcar is a mobile-first auction watch app for people who want a daily AI agent to research listings, apply taste/preferences, estimate values, copy listing images, and publish a private shortlist.

The default example is a beach-car/runabout watchlist, but the app is intentionally reusable for other collector niches.

## What It Includes

- Cloudflare Worker serving a React PWA and JSON API.
- D1 database for daily runs, listings, image metadata, and feedback memory.
- R2 image cache so listing photos keep working on mobile.
- Clerk authentication restricted to one configured email.
- Native SwiftUI iOS app scaffold for an image-first swipe/deck review flow.
- Feedback actions:
  - Like: show more like this without pinning it as a favorite.
  - Star: prioritize this listing and similar future finds.
  - Hide: remove this exact listing from the default view.
  - Avoid: suppress similar listings unless unusually compelling.
- Admin import API for an AI daily automation.
- Agent playbooks for Codex, Claude, or another browser-capable AI operator.

## Native iOS Preview

The native app is an image-first review surface for daily auction finds. The primary mode is a one-listing deck: swipe photos horizontally, move through vehicles vertically, like/hide/star/avoid with card gestures, tap for the back-of-card detail view, or jump into list and filter modes when scanning.

These are actual iPhone simulator screenshots from the current SwiftUI app:

<p>
  <img src="docs/screenshots/ios-deck.png" alt="Beachcar iOS deck view" width="220">
  <img src="docs/screenshots/ios-list.png" alt="Beachcar iOS list view" width="220">
  <img src="docs/screenshots/ios-filters.png" alt="Beachcar iOS filters view" width="220">
  <img src="docs/screenshots/ios-details.png" alt="Beachcar iOS detail back view" width="220">
</p>

## Operating Model

Beachcar expects a daily AI automation to do the research work:

1. Fetch feedback memory from `GET /api/admin/feedback/export`.
2. Search/scrape auction sites using the user's own browser/session/API access.
3. Evaluate listings against the user's profile and prior feedback.
4. Estimate fair value and a practical bid ceiling.
5. Collect useful image URLs.
6. Emit normalized JSON.
7. Publish to `POST /api/admin/import`.
8. Copy images into R2 through the publish flow.

The app is the hosted review and memory surface. The agent is the collector, analyst, and publisher.

## Local Setup

```bash
npm install
cp .env.example .env.local
cp .publish.env.example .publish.env
```

Fill in `.env.local` with your Clerk keys and desired app name.

```bash
npm run typecheck
npm test
set -a; source .env.local; set +a
npm run build
```

## Native iOS App

The native app lives in `ios/` and is generated from `ios/project.yml` with XcodeGen, so you can work without opening Xcode. It uses Clerk with Google auth, talks to the same Worker API as the PWA, and supports TestFlight builds from the command line.

```bash
npm run ios:generate
npm run ios:resolve
npm run ios:build
```

Useful commands:

```bash
npm run ios:sim
npm run ios:test-ui
npm run ios:archive
npm run ios:testflight
```

Use `npm run ios:release` when shipping app changes; it archives, uploads to App Store Connect, waits for the new build to appear, and assigns it to the configured internal TestFlight group.

See `docs/ios.md` for the native UX model, Clerk setup, and simulator/device notes.

## Cloudflare Setup

Create resources:

```bash
npx wrangler d1 create beachcar-watch
npx wrangler r2 bucket create beachcar-watch-images
```

Copy the D1 `database_id` into `wrangler.jsonc`, then set your allowed email:

```jsonc
"vars": {
  "ALLOWED_EMAIL": "you@example.com",
  "ENVIRONMENT": "production"
}
```

Apply migrations and set Worker secrets:

```bash
npm run db:migrate:remote
npx wrangler secret put PUBLISH_TOKEN
npx wrangler secret put CLERK_SECRET_KEY
npx wrangler secret put CLERK_JWT_ISSUER
npm run deploy
```

`CLERK_JWT_ISSUER` is your Clerk issuer URL, usually like `https://your-instance.clerk.accounts.dev`.

## Publishing A Daily Run

Configure `.publish.env`:

```bash
AUCTION_WATCH_URL=https://beachcar-watch.<your-workers-subdomain>.workers.dev
PUBLISH_TOKEN=<same value configured as Worker secret>
```

Publish sample data:

```bash
npm run publish:daily
```

Publish a real daily run:

```bash
DAILY_JSON=outputs/daily-run-2026-06-20.json npm run publish:daily
```

The publish script imports the run first, then copies queued listing images to R2 through the admin image API.

## AI Automation

Start with:

- `automation/codex-daily-run.md`
- `automation/claude-daily-run.md`
- `automation/auction-source-playbook.md`
- `automation/preference-steering.md`
- `automation/valuation-guide.md`
- `automation/source-profile.beach-cars.md`

The automation instructions are intentionally explicit because auction pages change. A browser-capable AI agent should inspect pages live, adapt extraction, and keep producing the stable import JSON shape documented in `docs/publishing.md`.

## Compliance

You are responsible for how your automation accesses third-party sites. Use your own credentials where needed, respect rate limits and site terms, do not bypass access controls, and do not publish copied images beyond your intended private/internal use unless you have rights to do so.

## Project Status

This is a starter repo extracted from a working personal deployment. Expect to tailor the profile, sources, valuation logic, and UI language to your niche.
