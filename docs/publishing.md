# Publishing Contract

The daily AI automation publishes one JSON object to `POST /api/admin/import` with the `X-Publish-Token` header.

## Request

```json
{
  "generatedAt": "2026-06-20T12:00:00.000Z",
  "reportMarkdown": "Optional human-readable report.",
  "sourceSummary": {
    "sourcesChecked": ["Bring a Trailer", "Cars & Bids"],
    "publisher": "codex"
  },
  "listings": []
}
```

`listings` may also be posted as `items` for compatibility.

## Listing Fields

Required:

- `section`: daily report bucket such as `Strong fits`, `Worth a look`, `Curiosities/stretch listings`, or `Solo runabouts`.
- `lane`: `family`, `solo`, or `curiosity`.
- `site`, `title`, `url`.
- `bid`: current bid, ask, or status text.
- `total`: current estimated total excluding shipping.
- `why`: concise fit rationale.
- `concerns`: diligence questions.
- `images`: array of remote image URLs.

Recommended:

- `location`
- `endsAt`, `timeLeft`
- `bids`, `bidders`, `comments`
- `fair`, `ceiling`, `conf`
- `currentTake`

### `dossier` (optional rich detail)

An optional nested object that powers the app's full per-car detail view. Every field is optional and forward-compatible — runs that omit it (or omit sub-fields) degrade gracefully in the clients. Only include detail actually present on the listing page; never invent it.

```json
"dossier": {
  "summary": "One-paragraph vehicle summary.",
  "specs": { "odometer": "", "engine": "", "transmission": "", "drivetrain": "", "exterior": "", "interior": "", "title": "", "seller": "", "lot": "" },
  "listing": ["Full seller writeup, paragraph by paragraph."],
  "equipment": ["Highlight bullets"],
  "service": ["Recent service bullets"],
  "bidLog": [{ "bidder": "username", "amount": "$8,500", "ago": "2h" }],
  "comments": [{ "user": "username", "body": "Comment text", "ago": "3h", "seller": false }],
  "beachUse": { "body": "", "location": "", "people": "", "paperwork": "" },
  "valueScore": 0.18
}
```

- `valueScore` is a `0..1` position on the CHEAP..RICH value meter; it is clamped on import. The built-in agent derives one from bid-vs-fair when not supplied.
- All sub-fields are optional; invalid types are dropped during normalization rather than rejected.
- See `examples/daily-run.sample.json` for a full worked example.

The server assigns stable listing and image keys, stores the run in D1, and queues image records for R2 copying.

## Admin Endpoints

- `GET /api/admin/feedback/export`: returns steering memory for the next AI run.
- `POST /api/admin/import`: imports the normalized daily run.
- `PUT /api/admin/images/:listingKey/:imageKey`: stores already-fetched image bytes in R2.
- `POST /api/admin/mirror-image`: asks the Worker to fetch and mirror a single image URL.

All admin endpoints require `X-Publish-Token: <secret>`.

