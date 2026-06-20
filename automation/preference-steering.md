# Preference Steering

At the start of each run, fetch feedback memory:

```bash
curl -H "X-Publish-Token: $PUBLISH_TOKEN" \
  "$AUCTION_WATCH_URL/api/admin/feedback/export"
```

Interpret feedback as:

- `star`: the user is really into this listing. Prioritize exact/similar vehicles and inspect comparable finds more carefully.
- `hide`: suppress this exact listing unless price, condition, or context materially changed.
- `avoid`: suppress similar listings unless there is a strong reason to include one as a labeled exception.

Use avoid-similar as a taste signal from the title, tags, lane, why, and concerns. Do not reduce it to an exact URL block.

When feedback changes the run, mention it briefly in the report.

