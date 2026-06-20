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

The server assigns stable listing and image keys, stores the run in D1, and queues image records for R2 copying.

## Admin Endpoints

- `GET /api/admin/feedback/export`: returns steering memory for the next AI run.
- `POST /api/admin/import`: imports the normalized daily run.
- `PUT /api/admin/images/:listingKey/:imageKey`: stores already-fetched image bytes in R2.
- `POST /api/admin/mirror-image`: asks the Worker to fetch and mirror a single image URL.

All admin endpoints require `X-Publish-Token: <secret>`.

