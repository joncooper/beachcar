import { describe, expect, it } from "vitest";
import { listingKeyFor, normalizeListing } from "../src/shared/normalize";
import type { AuctionListing } from "../src/shared/types";
import { mergeListingsIntoRun, withImageOverlay } from "../src/worker/db";

describe("run listing merge", () => {
  it("patches existing listings without replacing the stored payload with defaults", async () => {
    const db = new FakeD1Database();
    const runId = "run-test";
    db.runs.add(runId);

    const original = normalizeListing({
      section: "Strong fits",
      lane: "family",
      site: "Bring a Trailer",
      title: "1974 Volkswagen Thing",
      url: "https://bringatrailer.com/listing/1974-volkswagen-thing-99/",
      bid: "$9,500",
      total: "$11,200 all-in",
      location: "Charleston, SC",
      why: "Open-air beach runabout with simple mechanicals.",
      concerns: "Verify rust in pans.",
      images: ["https://example.com/thing.jpg"],
      dossier: {
        summary: "Existing short read.",
        specs: { odometer: "44k miles", transmission: "4-speed manual" },
        beachUse: { body: "Open four-seater", people: "Four in town" },
      },
    });
    const listingKey = await listingKeyFor(original.site, original.url, original.title);
    db.runListings.set(`${runId}:${listingKey}`, {
      run_id: runId,
      listing_key: listingKey,
      sort_order: 0,
      payload_json: JSON.stringify({ ...original, listingKey }),
    });

    const result = await mergeListingsIntoRun(db as unknown as D1Database, runId, [
      {
        listingKey,
        dossier: {
          summary: "Enriched full-page read.",
          specs: { engine: "1.6L flat-four" },
          beachUse: { paperwork: "Clean SC title" },
          valueScore: 0.2,
        },
      },
    ]);

    expect(result).toMatchObject({ runId, patched: 1, inserted: 0 });
    const patched = JSON.parse(db.runListings.get(`${runId}:${listingKey}`)?.payload_json || "{}") as AuctionListing;
    expect(patched).toMatchObject({
      listingKey,
      section: "Strong fits",
      lane: "family",
      site: "Bring a Trailer",
      title: "1974 Volkswagen Thing",
      bid: "$9,500",
      total: "$11,200 all-in",
      location: "Charleston, SC",
      why: "Open-air beach runabout with simple mechanicals.",
      concerns: "Verify rust in pans.",
      images: ["https://example.com/thing.jpg"],
      dossier: {
        summary: "Enriched full-page read.",
        specs: { odometer: "44k miles", transmission: "4-speed manual", engine: "1.6L flat-four" },
        beachUse: { body: "Open four-seater", people: "Four in town", paperwork: "Clean SC title" },
        valueScore: 0.2,
      },
    });
  });

  it("expands copied image rows beyond the stored payload gallery", () => {
    const listing = normalizeListing({
      site: "Cars & Bids",
      title: "1973 Chevrolet K5 Blazer 4x4",
      url: "https://carsandbids.com/auctions/example/1973-chevrolet-k5-blazer-4x4",
      images: [
        "https://media.carsandbids.com/cdn-cgi/image/width=768,quality=70/abc/photos/k5/main.jpg?t=1",
      ],
    });
    const overlaid = withImageOverlay(listing, [
      imageRow("first", "https://media.carsandbids.com/abc/photos/k5/main.jpg?t=1"),
      imageRow("first-dupe", "https://media.carsandbids.com/cdn-cgi/image/width=768,quality=70/abc/photos/k5/main.jpg?t=1"),
      imageRow("second", "https://media.carsandbids.com/abc/photos/k5/interior.jpg?t=2"),
      imageRow("pending", "https://media.carsandbids.com/abc/photos/k5/engine.jpg?t=3", "pending"),
    ] as never);

    expect(overlaid.images).toEqual([
      "/api/images/first?variant=deck",
      "/api/images/second?variant=deck",
    ]);
    expect(overlaid.imageStatus?.map((image) => image.imageKey)).toEqual(["first", "second"]);
    expect(overlaid.originalImages).toEqual(listing.images);
  });
});

function imageRow(imageKey: string, sourceUrl: string, status: "pending" | "copied" | "failed" = "copied") {
  return {
    image_key: imageKey,
    listing_key: "cars-and-bids-k5",
    source_url: sourceUrl,
    r2_key: `listing-images/${imageKey}.jpg`,
    content_type: "image/jpeg",
    byte_length: 1000,
    status,
    error: null,
  };
}

interface FakeRunListingRow {
  run_id: string;
  listing_key: string;
  sort_order: number;
  payload_json: string;
}

class FakeD1Database {
  runs = new Set<string>();
  runListings = new Map<string, FakeRunListingRow>();
  listings = new Map<string, Record<string, unknown>>();
  images = new Map<string, Record<string, unknown>>();

  prepare(sql: string): FakeD1Statement {
    return new FakeD1Statement(this, sql);
  }
}

class FakeD1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly db: FakeD1Database,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql === "SELECT id FROM runs WHERE id = ?") {
      const runId = String(this.values[0] || "");
      return this.db.runs.has(runId) ? ({ id: runId } as T) : null;
    }
    if (this.sql === "SELECT COALESCE(MAX(sort_order), -1) AS max FROM run_listings WHERE run_id = ?") {
      const runId = String(this.values[0] || "");
      const rows = Array.from(this.db.runListings.values()).filter((row) => row.run_id === runId);
      const max = rows.reduce((value, row) => Math.max(value, row.sort_order), -1);
      return { max } as T;
    }
    if (this.sql === "SELECT sort_order, payload_json FROM run_listings WHERE run_id = ? AND listing_key = ?") {
      const row = this.db.runListings.get(`${this.values[0]}:${this.values[1]}`);
      return row ? ({ sort_order: row.sort_order, payload_json: row.payload_json } as T) : null;
    }
    throw new Error(`Unexpected first() query: ${this.sql}`);
  }

  async run(): Promise<Record<string, unknown>> {
    if (this.sql.includes("INSERT INTO listings")) {
      const [listingKey, site, title, url, lane, firstSeenAt, lastSeenAt, payloadJson] = this.values;
      this.db.listings.set(String(listingKey), { listingKey, site, title, url, lane, firstSeenAt, lastSeenAt, payloadJson });
      return { success: true };
    }
    if (this.sql === "UPDATE run_listings SET payload_json = ? WHERE run_id = ? AND listing_key = ?") {
      const [payloadJson, runId, listingKey] = this.values;
      const key = `${runId}:${listingKey}`;
      const existing = this.db.runListings.get(key);
      if (existing) existing.payload_json = String(payloadJson);
      return { success: true };
    }
    if (this.sql === "INSERT INTO run_listings (run_id, listing_key, sort_order, payload_json) VALUES (?, ?, ?, ?)") {
      const [runId, listingKey, sortOrder, payloadJson] = this.values;
      this.db.runListings.set(`${runId}:${listingKey}`, {
        run_id: String(runId),
        listing_key: String(listingKey),
        sort_order: Number(sortOrder),
        payload_json: String(payloadJson),
      });
      return { success: true };
    }
    if (this.sql.includes("INSERT INTO images")) {
      const [imageKey, listingKey, sourceUrl, r2Key] = this.values;
      this.db.images.set(String(imageKey), { imageKey, listingKey, sourceUrl, r2Key, status: "pending" });
      return { success: true };
    }
    throw new Error(`Unexpected run() query: ${this.sql}`);
  }
}
