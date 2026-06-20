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

## Output

Write normalized JSON to `outputs/daily-run-YYYY-MM-DD.json` using the `AuctionListing` shape documented in `docs/publishing.md`.

Then publish:

```bash
DAILY_JSON=outputs/daily-run-YYYY-MM-DD.json npm run publish:daily
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
