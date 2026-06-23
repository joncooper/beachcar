import { imageKeyFor, inferTags, listingKeyFor, normalizeAction, normalizeListing, r2KeyFor } from "../shared/normalize";
import type { AuctionListing, FeedbackExport, FeedbackRecord, ImageStatus, ImportPayload, PreferenceEvent, RunPayload } from "../shared/types";

interface ImageRow {
  image_key: string;
  listing_key: string;
  source_url: string;
  r2_key: string;
  content_type: string | null;
  byte_length: number | null;
  status: "pending" | "copied" | "failed";
  error: string | null;
}

interface FeedbackRow {
  listing_key: string;
  action: FeedbackRecord["action"];
  tags_json: string;
  note: string | null;
  updated_at: string;
}

interface PreferenceEventRow {
  id: string;
  listing_key: string | null;
  event_type: PreferenceEvent["eventType"];
  note: string | null;
  transcript: string | null;
  tags_json: string;
  created_at: string;
}

interface RunRow {
  id: string;
  generated_at: string;
  report_markdown: string | null;
  source_summary_json: string | null;
}

interface RunListingRow {
  listing_key: string;
  payload_json: string;
}

export interface ImportResult {
  runId: string;
  listingCount: number;
  imageCount: number;
  images: Array<{ listingKey: string; imageKey: string; sourceUrl: string; r2Key: string }>;
}

export async function importRun(db: D1Database, payload: ImportPayload | AuctionListing[]): Promise<ImportResult> {
  const rawListings = Array.isArray(payload) ? payload : payload.listings || payload.items || [];
  if (!Array.isArray(rawListings) || rawListings.length === 0) {
    throw new Error("Import payload must include at least one listing");
  }

  const generatedAt = Array.isArray(payload) ? new Date().toISOString() : payload.generatedAt || new Date().toISOString();
  const runId = `run-${generatedAt.replace(/[^0-9a-z]/gi, "-").toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
  const sourceSummary = Array.isArray(payload) ? null : payload.sourceSummary ?? null;
  const reportMarkdown = Array.isArray(payload) ? null : payload.reportMarkdown ?? null;
  const importedImages: ImportResult["images"] = [];

  await db
    .prepare("INSERT INTO runs (id, generated_at, report_markdown, source_summary_json) VALUES (?, ?, ?, ?)")
    .bind(runId, generatedAt, reportMarkdown, sourceSummary === null ? null : JSON.stringify(sourceSummary))
    .run();

  for (let index = 0; index < rawListings.length; index += 1) {
    const listing = normalizeListing(rawListings[index]);
    const listingKey = await listingKeyFor(listing.site, listing.url, listing.title);
    const now = new Date().toISOString();
    const payloadWithKey: AuctionListing = { ...listing, listingKey };
    const payloadJson = JSON.stringify(payloadWithKey);

    await db
      .prepare(
        `INSERT INTO listings (listing_key, site, title, url, lane, first_seen_at, last_seen_at, last_payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(listing_key) DO UPDATE SET
           site = excluded.site,
           title = excluded.title,
           url = excluded.url,
           lane = excluded.lane,
           last_seen_at = excluded.last_seen_at,
           last_payload_json = excluded.last_payload_json`,
      )
      .bind(listingKey, listing.site, listing.title, listing.url, listing.lane, now, now, payloadJson)
      .run();

    await db
      .prepare("INSERT INTO run_listings (run_id, listing_key, sort_order, payload_json) VALUES (?, ?, ?, ?)")
      .bind(runId, listingKey, index, payloadJson)
      .run();

    for (const sourceUrl of listing.images.slice(0, 5)) {
      const imageKey = await imageKeyFor(listingKey, sourceUrl);
      const r2Key = r2KeyFor(imageKey);
      await db
        .prepare(
          `INSERT INTO images (image_key, listing_key, source_url, r2_key, status)
           VALUES (?, ?, ?, ?, 'pending')
           ON CONFLICT(image_key) DO UPDATE SET
             listing_key = excluded.listing_key,
             source_url = excluded.source_url,
             r2_key = excluded.r2_key,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(imageKey, listingKey, sourceUrl, r2Key)
        .run();
      importedImages.push({ listingKey, imageKey, sourceUrl, r2Key });
    }
  }

  return { runId, listingCount: rawListings.length, imageCount: importedImages.length, images: importedImages };
}

export async function markImageCopied(
  db: D1Database,
  input: { imageKey: string; listingKey: string; sourceUrl: string; r2Key: string; contentType: string | null; byteLength: number | null },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO images (image_key, listing_key, source_url, r2_key, content_type, byte_length, status, copied_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'copied', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(image_key) DO UPDATE SET
         listing_key = excluded.listing_key,
         source_url = excluded.source_url,
         r2_key = excluded.r2_key,
         content_type = excluded.content_type,
         byte_length = excluded.byte_length,
         status = 'copied',
         error = NULL,
         copied_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(input.imageKey, input.listingKey, input.sourceUrl, input.r2Key, input.contentType, input.byteLength)
    .run();
}

export async function markImageFailed(
  db: D1Database,
  input: { imageKey: string; listingKey: string; sourceUrl: string; r2Key: string; error: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO images (image_key, listing_key, source_url, r2_key, status, error, updated_at)
       VALUES (?, ?, ?, ?, 'failed', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(image_key) DO UPDATE SET
         status = 'failed',
         error = excluded.error,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(input.imageKey, input.listingKey, input.sourceUrl, input.r2Key, input.error)
    .run();
}

export async function getImage(db: D1Database, imageKey: string): Promise<ImageRow | null> {
  return db.prepare("SELECT * FROM images WHERE image_key = ?").bind(imageKey).first<ImageRow>();
}

export async function getLatestRun(db: D1Database): Promise<RunPayload | null> {
  const run = await db
    .prepare("SELECT * FROM runs ORDER BY generated_at DESC, created_at DESC LIMIT 1")
    .first<RunRow>();
  if (!run) return null;

  const { results: listingRows } = await db
    .prepare("SELECT listing_key, payload_json FROM run_listings WHERE run_id = ? ORDER BY sort_order ASC")
    .bind(run.id)
    .all<RunListingRow>();

  const feedback = await getFeedback(db);
  const feedbackByKey = new Map(feedback.map((entry) => [entry.listingKey, entry]));
  const imagesByListing = await getImagesByListing(db, listingRows.map((row) => row.listing_key));

  const listings = listingRows.map((row) => {
    const listing = JSON.parse(row.payload_json) as AuctionListing;
    const imageRows = imagesByListing.get(row.listing_key) || [];
    return withImageOverlay({ ...listing, listingKey: row.listing_key, feedback: feedbackByKey.get(row.listing_key) || null }, imageRows);
  });

  return {
    id: run.id,
    generatedAt: run.generated_at,
    reportMarkdown: run.report_markdown,
    sourceSummary: run.source_summary_json ? JSON.parse(run.source_summary_json) : null,
    listings,
    feedback,
  };
}

export async function getFeedback(db: D1Database): Promise<FeedbackRecord[]> {
  const { results } = await db.prepare("SELECT * FROM feedback ORDER BY updated_at DESC").all<FeedbackRow>();
  return results.map(feedbackFromRow);
}

export async function upsertFeedback(
  db: D1Database,
  listingKey: string,
  input: { action: unknown; note?: unknown; tags?: unknown },
): Promise<FeedbackRecord> {
  const action = normalizeAction(input.action);
  if (!action) throw new Error("Feedback action must be like, star, hide, or avoid");

  const listing = await db
    .prepare("SELECT last_payload_json FROM listings WHERE listing_key = ?")
    .bind(listingKey)
    .first<{ last_payload_json: string }>();
  if (!listing) throw new Error("Unknown listing");

  const parsed = JSON.parse(listing.last_payload_json) as AuctionListing;
  const tags = Array.isArray(input.tags) ? input.tags.filter(Boolean).map(String) : inferTags(parsed);
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : null;
  const updatedAt = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO feedback (listing_key, action, tags_json, note, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(listing_key) DO UPDATE SET
         action = excluded.action,
         tags_json = excluded.tags_json,
         note = excluded.note,
         updated_at = excluded.updated_at`,
    )
    .bind(listingKey, action, JSON.stringify(tags), note, updatedAt)
    .run();

  return { listingKey, action, tags, note, updatedAt };
}

export async function createPreferenceEvent(
  db: D1Database,
  input: { listingKey?: unknown; eventType?: unknown; note?: unknown; transcript?: unknown; tags?: unknown },
): Promise<PreferenceEvent> {
  const eventType = input.eventType === "voice_note" || input.eventType === "text_note" || input.eventType === "viewed" ? input.eventType : null;
  if (!eventType) throw new Error("Preference event type must be voice_note, text_note, or viewed");

  const listingKey = typeof input.listingKey === "string" && input.listingKey.trim() ? input.listingKey.trim() : null;
  let listing: AuctionListing | null = null;
  if (listingKey) {
    const row = await db
      .prepare("SELECT last_payload_json FROM listings WHERE listing_key = ?")
      .bind(listingKey)
      .first<{ last_payload_json: string }>();
    if (!row) throw new Error("Unknown listing");
    listing = JSON.parse(row.last_payload_json) as AuctionListing;
  }

  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : null;
  const transcript = typeof input.transcript === "string" && input.transcript.trim() ? input.transcript.trim() : null;
  if ((eventType === "voice_note" || eventType === "text_note") && !note && !transcript) {
    throw new Error("Preference note cannot be empty");
  }

  const tags = Array.isArray(input.tags)
    ? input.tags.filter(Boolean).map(String)
    : listing
      ? inferTags(listing)
      : [];
  const createdAt = new Date().toISOString();
  const id = `pref-${createdAt.replace(/[^0-9a-z]/gi, "-").toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;

  await db
    .prepare(
      `INSERT INTO preference_events (id, listing_key, event_type, note, transcript, tags_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, listingKey, eventType, note, transcript, JSON.stringify([...new Set(tags)]), createdAt)
    .run();

  return { id, listingKey, eventType, note, transcript, tags: [...new Set(tags)], createdAt };
}

export async function deleteFeedback(db: D1Database, listingKey: string): Promise<void> {
  await db.prepare("DELETE FROM feedback WHERE listing_key = ?").bind(listingKey).run();
}

export async function exportFeedback(db: D1Database): Promise<FeedbackExport> {
  const feedback = await getFeedback(db);
  const entries = [];
  for (const entry of feedback) {
    const listingRow = await db
      .prepare("SELECT last_payload_json FROM listings WHERE listing_key = ?")
      .bind(entry.listingKey)
      .first<{ last_payload_json: string }>();
    entries.push({
      ...entry,
      listing: listingRow ? (JSON.parse(listingRow.last_payload_json) as AuctionListing) : null,
    });
  }
  const preferenceEvents = await getPreferenceEventsWithListings(db);

  const counts = {
    like: feedback.filter((entry) => entry.action === "like").length,
    star: feedback.filter((entry) => entry.action === "star").length,
    hide: feedback.filter((entry) => entry.action === "hide").length,
    avoid: feedback.filter((entry) => entry.action === "avoid").length,
    total: feedback.length,
  };

  return {
    version: 1,
    kind: "auction-watch-feedback",
    generatedAt: new Date().toISOString(),
    counts,
    entries,
    preferenceEvents,
    steering: {
      prioritizeSimilarTo: entries
        .filter((entry) => (entry.action === "star" || entry.action === "like") && entry.listing)
        .map((entry) => ({ title: entry.listing!.title, url: entry.listing!.url, tags: entry.tags })),
      suppressExactUrls: entries.filter((entry) => entry.action === "hide" && entry.listing).map((entry) => entry.listing!.url),
      avoidSimilarTo: entries
        .filter((entry) => entry.action === "avoid" && entry.listing)
        .map((entry) => ({ title: entry.listing!.title, url: entry.listing!.url, tags: entry.tags, why: entry.listing!.why })),
      notes: preferenceEvents
        .filter((event) => event.note || event.transcript)
        .map((event) => ({
          title: event.listing?.title,
          url: event.listing?.url,
          note: event.note || event.transcript || "",
          tags: event.tags,
        })),
    },
  };
}

async function getPreferenceEventsWithListings(db: D1Database): Promise<Array<PreferenceEvent & { listing?: AuctionListing | null }>> {
  const { results } = await db
    .prepare("SELECT * FROM preference_events ORDER BY created_at DESC LIMIT 200")
    .all<PreferenceEventRow>();
  const events = [];
  for (const row of results) {
    let listing: AuctionListing | null = null;
    if (row.listing_key) {
      const listingRow = await db
        .prepare("SELECT last_payload_json FROM listings WHERE listing_key = ?")
        .bind(row.listing_key)
        .first<{ last_payload_json: string }>();
      listing = listingRow ? (JSON.parse(listingRow.last_payload_json) as AuctionListing) : null;
    }
    events.push({ ...preferenceEventFromRow(row), listing });
  }
  return events;
}

async function getImagesByListing(db: D1Database, listingKeys: string[]): Promise<Map<string, ImageRow[]>> {
  const map = new Map<string, ImageRow[]>();
  if (listingKeys.length === 0) return map;
  const placeholders = listingKeys.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT * FROM images WHERE listing_key IN (${placeholders}) ORDER BY created_at ASC`)
    .bind(...listingKeys)
    .all<ImageRow>();
  for (const row of results) {
    const list = map.get(row.listing_key) || [];
    list.push(row);
    map.set(row.listing_key, list);
  }
  return map;
}

function withImageOverlay(listing: AuctionListing, imageRows: ImageRow[]): AuctionListing {
  const rowsBySource = new Map(imageRows.map((row) => [row.source_url, row]));
  const imageStatus: ImageStatus[] = [];
  const images = listing.images.map((sourceUrl) => {
    const row = rowsBySource.get(sourceUrl);
    if (!row) return sourceUrl;
    const localUrl = `/api/images/${encodeURIComponent(row.image_key)}`;
    imageStatus.push({
      imageKey: row.image_key,
      sourceUrl,
      url: localUrl,
      copied: row.status === "copied",
      status: row.status,
      error: row.error,
    });
    return localUrl;
  });
  return { ...listing, originalImages: listing.images, images, imageStatus };
}

function feedbackFromRow(row: FeedbackRow): FeedbackRecord {
  return {
    listingKey: row.listing_key,
    action: row.action,
    tags: JSON.parse(row.tags_json || "[]") as string[],
    note: row.note,
    updatedAt: row.updated_at,
  };
}

function preferenceEventFromRow(row: PreferenceEventRow): PreferenceEvent {
  return {
    id: row.id,
    listingKey: row.listing_key,
    eventType: row.event_type,
    note: row.note,
    transcript: row.transcript,
    tags: JSON.parse(row.tags_json || "[]") as string[],
    createdAt: row.created_at,
  };
}
