import { describe, expect, it } from "vitest";
import { searchSourceCache, upsertSourceCache } from "../src/worker/db";
import type { SourceCandidate } from "../src/worker/sources/types";

describe("source cache", () => {
  it("stores and searches structured listing fields from cached source candidates", async () => {
    const db = new FakeSourceCacheD1();
    const candidate: SourceCandidate = {
      source: "bringatrailer",
      site: "Bring a Trailer",
      sourceQuery: "BaT Suzuki Samurai",
      title: "1988 Suzuki Samurai JX Soft Top",
      url: "https://bringatrailer.com/listing/1988-suzuki-samurai-cache-2/",
      bid: "$7,800",
      bidNum: 7800,
      bidCents: 780000,
      total: "$8,190 incl. buyer fee estimate",
      location: "Portland, ME",
      locationCity: "Portland",
      locationRegion: "ME",
      locationStatus: "ok",
      endsAt: "2026-07-10T20:00:00.000Z",
      timeLeft: "1 day",
      bids: 14,
      bidders: 8,
      comments: 22,
      imageUrls: ["https://bringatrailer.com/wp-content/uploads/2026/07/samurai.jpg?w=620"],
      summary: "Small soft-top 4x4 with beach-town appeal.",
      noReserve: true,
      isLive: true,
      sourceUrl: "https://bringatrailer.com/auctions/feed/",
      publishedAt: "2026-07-09T12:00:00.000Z",
      lastDetailAt: "2026-07-09T12:03:00.000Z",
      detailStatus: "ok",
      dossier: {
        summary: "Cache-preserved Samurai dossier.",
        specs: { transmission: "5-speed manual" },
      },
    };

    const result = await upsertSourceCache(db as unknown as D1Database, {
      source: "bringatrailer",
      sourceUrl: "https://bringatrailer.com/auctions/feed/",
      candidates: [candidate],
      startedAt: "2026-07-09T12:00:00.000Z",
      finishedAt: "2026-07-09T12:04:00.000Z",
    });

    expect(result).toMatchObject({ source: "bringatrailer", itemCount: 1, newItemCount: 1 });
    const stored = Array.from(db.sourceItems.values())[0];
    expect(stored).toMatchObject({
      bid_num: 7800,
      location: "Portland, ME",
      location_city: "Portland",
      location_region: "ME",
      ends_at: "2026-07-10T20:00:00.000Z",
      no_reserve: 1,
      is_live: 1,
      detail_status: "ok",
      last_detail_at: "2026-07-09T12:03:00.000Z",
    });
    expect(JSON.parse(stored?.dossier_json || "{}")).toMatchObject({
      summary: "Cache-preserved Samurai dossier.",
      specs: { transmission: "5-speed manual" },
    });

    const search = await searchSourceCache(db as unknown as D1Database, {
      source: "bringatrailer",
      terms: ["samurai"],
      limit: 5,
    });

    expect(search.status).toMatchObject({ source: "bringatrailer", itemCount: 1 });
    expect(search.candidates[0]).toMatchObject({
      title: "1988 Suzuki Samurai JX Soft Top",
      bidNum: 7800,
      bidCents: 780000,
      location: "Portland, ME",
      locationCity: "Portland",
      locationRegion: "ME",
      locationStatus: "ok",
      endsAt: "2026-07-10T20:00:00.000Z",
      noReserve: true,
      isLive: true,
      detailStatus: "ok",
      lastDetailAt: "2026-07-09T12:03:00.000Z",
      dossier: {
        summary: "Cache-preserved Samurai dossier.",
        specs: { transmission: "5-speed manual" },
      },
    });
  });

  it("reconstructs location from cache columns when legacy payload JSON is thin", async () => {
    const db = new FakeSourceCacheD1();
    db.sourceItems.set("source-item-legacy", {
      id: "source-item-legacy",
      source: "bringatrailer",
      site: "Bring a Trailer",
      source_url: "https://bringatrailer.com/auctions/feed/",
      item_url: "https://bringatrailer.com/listing/1974-volkswagen-thing-cache/",
      title: "1974 Volkswagen Thing",
      summary: "Open-air beach-town runabout.",
      image_urls_json: "[]",
      payload_json: JSON.stringify({
        sourceQuery: "cached source item",
        bid: "Check listing",
        total: "Check listing",
      }),
      published_at: "2026-07-09T10:00:00.000Z",
      bid_num: null,
      location: "Charleston, SC",
      location_city: "Charleston",
      location_region: "SC",
      location_country: null,
      ends_at: null,
      no_reserve: null,
      last_detail_at: null,
      detail_status: null,
      detail_error: null,
      is_live: null,
      dossier_json: "{}",
      first_seen_at: "2026-07-09T10:00:00.000Z",
      last_seen_at: "2026-07-09T10:00:00.000Z",
    });

    const search = await searchSourceCache(db as unknown as D1Database, {
      source: "bringatrailer",
      terms: ["thing"],
      limit: 5,
    });

    expect(search.candidates[0]).toMatchObject({
      title: "1974 Volkswagen Thing",
      bidCents: undefined,
      location: "Charleston, SC",
      locationRaw: "Charleston, SC",
      locationCity: "Charleston",
      locationRegion: "SC",
      locationStatus: "ok",
    });
  });
});

interface FakeSourceItemRow {
  id: string;
  source: string;
  site: string;
  source_url: string;
  item_url: string;
  title: string;
  summary: string | null;
  image_urls_json: string;
  payload_json: string;
  published_at: string | null;
  bid_num: number | null;
  location: string | null;
  location_city: string | null;
  location_region: string | null;
  location_country: string | null;
  ends_at: string | null;
  no_reserve: number | null;
  last_detail_at: string | null;
  detail_status: string | null;
  detail_error: string | null;
  is_live: number | null;
  dossier_json: string;
  first_seen_at: string;
  last_seen_at: string;
}

interface FakeSourceIngestionRunRow {
  id: string;
  source: string;
  source_url: string;
  status: "ok" | "failed";
  item_count: number;
  new_item_count: number;
  error: string | null;
  started_at: string;
  finished_at: string;
}

class FakeSourceCacheD1 {
  sourceItems = new Map<string, FakeSourceItemRow>();
  ingestions = new Map<string, FakeSourceIngestionRunRow>();

  prepare(sql: string): FakeSourceCacheStatement {
    return new FakeSourceCacheStatement(this, sql);
  }
}

class FakeSourceCacheStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: FakeSourceCacheD1,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql === "SELECT id FROM source_items WHERE item_url = ?") {
      const itemUrl = String(this.values[0] || "");
      const row = Array.from(this.db.sourceItems.values()).find((candidate) => candidate.item_url === itemUrl);
      return row ? ({ id: row.id } as T) : null;
    }
    if (this.sql.startsWith("SELECT COUNT(*) AS count FROM source_items WHERE source = ?")) {
      const source = String(this.values[0] || "");
      return { count: Array.from(this.db.sourceItems.values()).filter((row) => row.source === source).length } as T;
    }
    if (this.sql.startsWith("SELECT * FROM source_ingestion_runs WHERE id = ?")) {
      return (this.db.ingestions.get(String(this.values[0] || "")) as T | undefined) || null;
    }
    if (this.sql.startsWith("SELECT * FROM source_ingestion_runs WHERE source = ?")) {
      const source = String(this.values[0] || "");
      const latest = Array.from(this.db.ingestions.values())
        .filter((row) => row.source === source)
        .sort((left, right) => right.finished_at.localeCompare(left.finished_at))[0];
      return (latest as T | undefined) || null;
    }
    throw new Error(`Unexpected first() query: ${this.sql}`);
  }

  async all<T>(): Promise<{ results: T[] }> {
    if (this.sql.includes("FROM source_items") && this.sql.includes("WHERE source = ?")) {
      const source = String(this.values[0] || "");
      const rows = Array.from(this.db.sourceItems.values())
        .filter((row) => row.source === source)
        .sort(compareSourceRows);
      return { results: rows as T[] };
    }
    throw new Error(`Unexpected all() query: ${this.sql}`);
  }

  async run(): Promise<Record<string, unknown>> {
    if (this.sql.includes("INSERT INTO source_items")) {
      const [
        id,
        source,
        site,
        sourceUrl,
        itemUrl,
        title,
        summary,
        imageUrlsJson,
        payloadJson,
        publishedAt,
        bidNum,
        location,
        locationCity,
        locationRegion,
        locationCountry,
        endsAt,
        noReserve,
        lastDetailAt,
        detailStatus,
        detailError,
        isLive,
        dossierJson,
        firstSeenAt,
        lastSeenAt,
      ] = this.values;
      const existing = Array.from(this.db.sourceItems.values()).find((row) => row.item_url === itemUrl);
      const row: FakeSourceItemRow = {
        id: String(existing?.id || id),
        source: String(source),
        site: String(site),
        source_url: String(sourceUrl),
        item_url: String(itemUrl),
        title: String(title),
        summary: nullableString(summary),
        image_urls_json: String(imageUrlsJson || "[]"),
        payload_json: String(payloadJson || "{}"),
        published_at: nullableString(publishedAt) || existing?.published_at || null,
        bid_num: nullableNumber(bidNum) ?? existing?.bid_num ?? null,
        location: nullableString(location) || existing?.location || null,
        location_city: nullableString(locationCity) || existing?.location_city || null,
        location_region: nullableString(locationRegion) || existing?.location_region || null,
        location_country: nullableString(locationCountry) || existing?.location_country || null,
        ends_at: nullableString(endsAt) || existing?.ends_at || null,
        no_reserve: nullableNumber(noReserve) ?? existing?.no_reserve ?? null,
        last_detail_at: nullableString(lastDetailAt) || existing?.last_detail_at || null,
        detail_status: nullableString(detailStatus) || existing?.detail_status || null,
        detail_error: nullableString(detailError) || existing?.detail_error || null,
        is_live: nullableNumber(isLive) ?? existing?.is_live ?? null,
        dossier_json: String(dossierJson || "{}") !== "{}" ? String(dossierJson || "{}") : existing?.dossier_json || "{}",
        first_seen_at: existing?.first_seen_at || String(firstSeenAt),
        last_seen_at: String(lastSeenAt),
      };
      this.db.sourceItems.set(row.id, row);
      return { success: true };
    }

    if (this.sql.includes("INSERT INTO source_ingestion_runs")) {
      const [id, source, sourceUrl, status, itemCount, newItemCount, error, startedAt, finishedAt] = this.values;
      this.db.ingestions.set(String(id), {
        id: String(id),
        source: String(source),
        source_url: String(sourceUrl),
        status: status === "failed" ? "failed" : "ok",
        item_count: Number(itemCount || 0),
        new_item_count: Number(newItemCount || 0),
        error: nullableString(error),
        started_at: String(startedAt),
        finished_at: String(finishedAt),
      });
      return { success: true };
    }

    throw new Error(`Unexpected run() query: ${this.sql}`);
  }
}

function compareSourceRows(left: FakeSourceItemRow, right: FakeSourceItemRow): number {
  const live = (right.is_live || 0) - (left.is_live || 0);
  if (live !== 0) return live;
  if (left.ends_at && right.ends_at && left.ends_at !== right.ends_at) return left.ends_at.localeCompare(right.ends_at);
  if (left.ends_at && !right.ends_at) return -1;
  if (!left.ends_at && right.ends_at) return 1;
  return (right.published_at || right.last_seen_at).localeCompare(left.published_at || left.last_seen_at);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nullableNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
