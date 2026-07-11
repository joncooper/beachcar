# Beachcar Source Quality v1 Plan

Last updated: 2026-07-09

## Implementation Status

Local implementation is complete on `codex/source-quality-v1-pilot` as of 2026-07-11.

- All 11 migrations apply to a fresh D1 database.
- The managed Agent/Workflow publishes a feedback-aware, user-scoped run with structured source diagnostics.
- Bring a Trailer discovery/cache fallback, honest Cars & Bids browser-session handling, opt-in Hemmings, runner-result validation/merge, location preservation, and image warmup are covered by the fresh Worker smoke.
- Runner results that finish before or after publication reconcile into normal listings; per-task diagnostics update atomically.
- Web onboarding presents managed research as the default. MCP, manual tokens, Containers, and BYOK aliases are Advanced paths.
- iOS surfaces source health, location/missing-location, no-image, cached/error/queued states, filtering, dossier actions, and undo.
- Verification is green: 87 unit tests, all TypeScript checks, a fresh end-to-end local Worker run with eight published listings and both runner-source merges, native iOS build, and 17/17 iOS UI tests.

Production rollout remains pending. The public deployed baseline passes 12 verifier checks with no failures, but migration `0011` and this Worker/client build have not been deployed because the local environment lacks Cloudflare non-interactive auth plus the production Clerk and AI Gateway deployment inputs.

## Goal

Ship a source-quality and iOS review upgrade that makes Beachcar daily runs publish richer, better validated listings from Bring a Trailer, working Cars & Bids candidates when an approved browser session exists, opt-in Hemmings discovery, and a native review surface that clearly shows source health, listing location, value, risks, images, and detail.

## Hard Decisions

- Bring a Trailer is the primary automated source. Improve it first.
- Listing location is a first-class requirement. Every pipeline stage must preserve it or explicitly report it missing.
- Cars & Bids is browser-session-required. Worker fetch should not pretend it can scrape the source.
- Hemmings should launch opt-in and sitemap-first, not broad search scraping.
- iOS work should follow the shared data contract work where possible, so the app can stop parsing core facts from prose.
- Runner results must merge into normal `listings`; source summaries are status metadata, not content.

## Milestone 0: Contract And Location Pipeline

Goal: make listing location survive every step from source page to iOS.

Tasks:

- Add structured location fields alongside the current display `location`:
  - `locationRaw`
  - `locationCity`
  - `locationRegion`
  - `locationCountry`
  - `distanceMiles`
  - `locationStatus`
- Preserve location through:
  - `SourceCandidate`
  - `AuctionListing`
  - DB import and run merge
  - source cache rows
  - MCP/public payloads
  - runner output
  - iOS decoding and display helpers
- Prefer detail-page location over card/search-page location.
- Add source diagnostics when a listing has no usable location:
  - `missingData: ["location"]`
  - source check messages that identify where location extraction failed.
- Add tests proving BaT, C&B, Hemmings, runner-imported listings, cached listings, and iOS fixtures keep source locations.

Acceptance:

- Every published listing either has a visible location or an explicit missing-location diagnostic.
- iOS feed, list, and detail show location consistently when source data included it.
- `Location pending` only appears when the source truly did not provide usable location data.

## Milestone 1: Source Module Foundation

Goal: make source discovery testable and source-specific without bloating `src/worker/workflows/source-discovery.ts`.

Tasks:

- Create source modules:
  - `src/worker/sources/bringatrailer.ts`
  - `src/worker/sources/cars-and-bids.ts`
  - `src/worker/sources/hemmings.ts`
- Add shared source helpers for:
  - money parsing and formatting
  - date/end-time parsing
  - canonical URL normalization
  - location parsing
  - image ranking and dedupe
  - diagnostics
  - challenge/bot-page detection
- Keep source scoring and workflow orchestration in `source-discovery.ts`.
- Type `RunSourceSummary` instead of treating it as `unknown`.
- Generalize source-route copy so non-BaT sources do not produce BaT-specific `why` text.

Acceptance:

- Existing source discovery behavior still passes current tests.
- New fixture tests can call parser functions directly.
- Shared types support source status, location status, missing data, and structured numeric values.

## Milestone 2: Bring a Trailer Quality Upgrade

Goal: make BaT the reliable baseline source.

Tasks:

- Move BaT parsing into `src/worker/sources/bringatrailer.ts`.
- Add fixture-backed tests before changing behavior:
  - live listing cards
  - RSS feed
  - detail page with nested markup
  - detail page with bid/comment rows
  - location variants from cards, specs, and prose
  - blocked/challenge page
  - malformed page
- Expand discovery coverage:
  - configured seed pages
  - `/auctions/`
  - RSS
  - bounded pagination or discovered next links
  - profile/source-note-driven seeds
- Enrich a broader candidate pool before final scoring, for example top 20 title/RSS/card candidates, then publish top 8.
- Parse and preserve:
  - current bid and `bidCents`
  - end time and status
  - no-reserve/reserve status when visible
  - location
  - seller, lot, title status, mileage, drivetrain, VIN where visible
  - bid/comment excerpts
  - richer dossier fields
- Rank images before import:
  - hero
  - exterior
  - interior
  - underbody
  - engine bay
- Upgrade D1 source cache preservation:
  - `bid_num`
  - `location`
  - `ends_at`
  - `no_reserve`
  - `published_at`
  - `last_detail_at`
  - `detail_status`
  - `detail_error`
  - `is_live`
  - `dossier`
- Make the Workflow use D1 BaT cache fallback when live BaT fetch fails or is blocked.

Acceptance:

- BaT listings commonly include location, bid, end time, images, no-reserve/status where visible, and useful dossier data.
- Thin RSS candidates can be detail-enriched before final ranking.
- Workflow can publish from cache fallback with clear source diagnostics.
- Source summary reports page-level candidate counts, selector hits, detail attempts, blocked URLs, and stale-cache fallback state.

## Milestone 3: Cars & Bids Working Path

Goal: make Cars & Bids either actually produce listings or honestly report why it cannot.

Tasks:

- Split `scripts/scrape-cars-and-bids.mjs` into importable modules for:
  - URL normalization
  - API extraction
  - DOM extraction
  - detail extraction
  - image/gallery scoping
  - ranking
  - output shaping
- Add fixtures from current debug/output artifacts:
  - signed `/v2/autos/auctions` live response
  - closed response with `total > count`
  - detail-page DOM snapshot
  - blocked Cloudflare page
- Replace broad DOM image collection with scoped gallery extraction:
  - prefer API main photo and detail gallery containers
  - reject recommendation/sidebar/footer images
  - preserve one coherent media root/group per listing
- Add pagination/load-more handling:
  - track `count` and `total`
  - scroll or click load-more where needed
  - capture cursor/offset requests with hard caps
- Add explicit output statuses:
  - `ok`
  - `empty`
  - `blocked`
  - `failed`
- Add polite scrape controls:
  - per-page delay
  - max discovery URLs
  - max API records
  - 403/429/challenge classification
  - retry/headed suggestion
- Parse and preserve C&B location from API responses and detail DOM.
- Add richer C&B detail/dossier extraction where visible.
- Decide product truth:
  - local/browser-session-only unless hosted runner has an approved session strategy
  - hosted path must either run a real browser-capable scraper or clearly report local-session-required.

Acceptance:

- Local authenticated C&B scrape produces normalized candidates with title, URL, location, bid/status, images, and useful diagnostics.
- C&B scraper never reports `ok` for a zero-candidate challenge or parser failure.
- Runner output can be validated and imported into normal `listings`.
- iOS sees C&B candidates as ordinary listings, with source status in `sourceSummary`.

## Milestone 4: Hemmings Opt-In Source

Goal: add Hemmings safely and narrowly.

Tasks:

- Add disabled-by-default `hemmings` source setting.
- Use robots/sitemap-derived seeds, not broad query search.
- Avoid disallowed `/search/` and query scraping.
- Seed from high-intent sitemap/category/model/year pages:
  - 4x4s
  - convertibles
  - motorcycles
  - under-budget pages
  - Volkswagen 181/Thing and Type 2/Westfalia
  - Suzuki Samurai/Sidekick/Vitara/Jimny
  - Mini/Moke where present
  - Jeep CJ/Wrangler/Scrambler
- Parse accessible category/model/year pages into candidates.
- Detail-enrich only top candidates.
- Parse and preserve Hemmings location from:
  - listing cards
  - detail page fields
  - meta tags
  - JSON-LD where available
- Treat Cloudflare/challenge pages as blocked and queue `browser_source`.
- Keep Hemmings cache out of v1 unless parser output proves useful; the generic DB cache can be extended later.

Acceptance:

- Hemmings can be enabled from source settings.
- Accessible Hemmings fixture listings normalize to standard listings with location and images.
- Blocked Hemmings pages produce clear source checks and runner tasks.
- iOS requires no Hemmings-specific code.

## Milestone 5: Runner Merge And Publication

Goal: make browser-source work show up in the app.

Tasks:

- Persist runner `normalizedCandidates`.
- Validate runner candidates against the shared listing contract.
- Merge runner candidates into the published run or patch after publication.
- Support pending runner candidates that finish before the Workflow has a published run id.
- Run normal DB normalization, dedupe, image import, and image warmup on merged candidates.
- Keep `sourceSummary.runnerTasks` as status metadata only.
- Add merge diagnostics to source summary:
  - task id
  - source
  - status
  - normalized candidate count
  - imported count
  - rejected count and reasons

Acceptance:

- C&B and Hemmings runner candidates appear in `/api/runs/latest`.
- Runner-imported listings preserve location and image status.
- Duplicate listings merge by canonical URL/listing key.
- Failed or blocked runner tasks remain visible without polluting `listings`.

## Milestone 6: iOS Review UX

Goal: make the app reflect source quality and listing completeness.

Tasks:

- Make `ShadeSurface` use store-filtered listings, not raw run listings.
- Restore:
  - hide/avoid filtering
  - undo
  - stale-cache display
  - error display
  - queued preference note status
- Add source health/status badges to feed, list, and detail.
- Expand `ShadeListOverlay` scan controls:
  - search
  - lane
  - source
  - starred/saved
  - wildcard
  - ending soon
  - image-ready
  - show hidden
  - sort by agent rank, ending soon, current bid, under-fair value, source, and distance/location
- Improve no-image and missing-location states:
  - shrink or rebalance photo band when no image exists
  - show explicit missing-location status when source omitted it
  - show image count and image cache status where useful
- Rework detail hierarchy:
  - explicit close button
  - sticky feedback rail
  - persistent Open Listing link
  - swipeable gallery with aspect-fit inspection
  - bid/value/ends near the top
  - agent verdict
  - risks/watch-outs
  - beach-use fit
  - specs
  - listing text/equipment/service
  - bidding/comments
  - teach-the-agent

Acceptance:

- Hidden/avoided listings disappear immediately from the active Shade feed.
- Undo works in the active Shade surface.
- Source status is visible without opening admin UI.
- Feed, list, and detail show listing location consistently.
- Missing location is explicit, not silent.
- Detail can be closed normally and supports open-listing and feedback actions.

## Milestone 7: Verification And Release

Goal: prove the whole pipeline before release.

Checks:

- `bun run typecheck`
- `bun run test`
- source fixture tests for BaT, C&B, and Hemmings
- source cache tests for BaT field preservation and fallback
- runner merge tests
- local Worker smoke proving:
  - source discovery
  - run publication
  - image import/warmup
  - location round-trip
  - runner candidate merge
- iOS UI tests for:
  - active Shade filtering
  - undo
  - location display
  - missing-location display
  - source status badges
  - detail close/open-listing/action rail

Acceptance:

- Source Quality v1 can be demoed from a fresh local run through iOS display.
- Known blocked sources are reported as blocked, not silently omitted.
- Known accessible fixtures produce listings with locations.
- No core iOS sorting/filtering depends on parsing prose when structured fields exist.

## Recommended Build Start

Start with Milestone 0 plus the BaT location fixtures. That addresses the current location bug directly and creates the contract the rest of the scraper, runner, and iOS work should rely on.
