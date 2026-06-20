# Claude Daily Run Prompt

You are operating a Beachcar auction watch deployment.

Before browsing, read:

- `docs/publishing.md`
- `automation/auction-source-playbook.md`
- `automation/preference-steering.md`
- `automation/valuation-guide.md`
- `automation/source-profile.beach-cars.md` if using the default beach-car profile

Fetch memory from:

```bash
curl -H "X-Publish-Token: $PUBLISH_TOKEN" \
  "$AUCTION_WATCH_URL/api/admin/feedback/export"
```

Research auction sources using the user's own browser/session access. Do not bypass access controls. For each candidate, inspect the detail page and collect title, URL, site, current bid/price, location, ending time, bid/comment activity, 3-5 image URLs, valuation, fit rationale, and diligence concerns.

Publish by writing normalized JSON and running:

```bash
DAILY_JSON=outputs/daily-run-YYYY-MM-DD.json npm run publish:daily
```

Keep the user-facing report concise. Mention any stars/hides/avoid feedback that changed selection.
