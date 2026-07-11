# Operator Research Fallback Runbook

You are operating Beachcar's intervention/quality-reference path when the canonical Agent/Workflow run needs source help or a managed result needs comparison. The friend consumes the shortlist in Beachcar; they do not run this prompt, create an automation token, configure MCP, or provide a model key.

Each execution must be pinned to exactly one Beachcar user. Load only that user's profile and feedback, publish only to that user's run history, and verify the published run before moving to another user. The simple commands below use the legacy owner-compatible admin routes; a multi-user scheduler must use `GET /api/admin/users/:userId/feedback/export` and `POST /api/admin/users/:userId/runs/import` (or the equivalent user-scoped orchestration contract).

## Setup

Load `.publish.env` for:

- `AUCTION_WATCH_URL`
- `PUBLISH_TOKEN`

Fetch steering memory:

```bash
curl -H "X-Publish-Token: $PUBLISH_TOKEN" \
  "$AUCTION_WATCH_URL/api/admin/feedback/export"
```

## Task

Find active or newly listed items that plausibly match the user's profile. Start broad, then apply feedback:

- stars: prioritize exact/similar
- hide: suppress exact repeats unless materially changed
- avoid: suppress similar unless unusually compelling
- modern Jeeps/Wranglers: include only when clearly within a few hundred miles of the user's coastal CT/Northeast base, or when the user explicitly asks to reopen generic modern Jeeps
- summaries: do not reuse boilerplate across vehicles; customize `why`, `currentTake`, and `dossier.summary` from the listing's actual details, condition, location, timing, and use-case fit

Use `automation/auction-source-playbook.md`, `automation/preference-steering.md`, and `automation/valuation-guide.md`.

If you are using the beach-car starter profile, also read `automation/source-profile.beach-cars.md`.

Run the first-class Cars & Bids targeted scrape before final curation when the source is enabled:

```bash
bun run cab:scrape:targeted
```

If Cars & Bids reports a browser challenge or missing session, run `bun run cab:login` locally, complete the browser verification/sign-in, then retry the targeted scrape. The scraper writes `outputs/cars-and-bids-candidates-YYYY-MM-DD.json`; treat those candidates as source material for the normalized daily JSON, not as auto-approved matches.

Do not switch Cars & Bids to Lightpanda as a drop-in replacement. The 2026-06-29 Lightpanda spike reached Cloudflare Turnstile/403 on the search page, and a captured signed C&B JSON endpoint also returned 403 without the trusted browser session. Lightpanda may still be useful for lighter rendered sources that do not require interactive verification.

## Output

Write normalized JSON to `outputs/daily-run-YYYY-MM-DD.json` using the `AuctionListing` shape documented in `docs/publishing.md`.

Then publish:

```bash
BEACHCAR_USER_ID=<target-user-id> DAILY_JSON=outputs/daily-run-YYYY-MM-DD.json bun run publish:daily
```

Return a concise report with:

- app link
- publish status
- feedback effects
- strong fits
- worth a look
- curiosities/stretch listings
- solo runabouts
- skips/market notes

Also make one small presentation or data-quality improvement when useful.
