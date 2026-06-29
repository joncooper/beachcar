# Codex Daily Run Prompt

You are running the daily auction watch for this Beachcar deployment.

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

Use `automation/auction-source-playbook.md`, `automation/preference-steering.md`, and `automation/valuation-guide.md`.

If you are using the beach-car starter profile, also read `automation/source-profile.beach-cars.md`.

Run the first-class Cars & Bids targeted scrape before final curation when the source is enabled:

```bash
bun run cab:scrape:targeted
```

If Cars & Bids reports a browser challenge or missing session, run `bun run cab:login` locally, complete the browser verification/sign-in, then retry the targeted scrape. The scraper writes `outputs/cars-and-bids-candidates-YYYY-MM-DD.json`; treat those candidates as source material for the normalized daily JSON, not as auto-approved matches.

## Output

Write normalized JSON to `outputs/daily-run-YYYY-MM-DD.json` using the `AuctionListing` shape documented in `docs/publishing.md`.

Then publish:

```bash
DAILY_JSON=outputs/daily-run-YYYY-MM-DD.json bun run publish:daily
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
