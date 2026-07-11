import { describe, expect, it } from "vitest";
import { listingKeyFor, normalizeListing } from "../src/shared/normalize";
import type { AuctionListing } from "../src/shared/types";
import {
  importRun,
  mergeListingsIntoRun,
  reconcileCompletedRunnerTasksForRun,
  updateRunRunnerTaskSummary,
  withImageOverlay,
} from "../src/worker/db";

describe("run listing merge", () => {
  it("reuses existing listing rows by URL when importing a repeated auction", async () => {
    const db = new FakeD1Database();
    const url = "https://bringatrailer.com/listing/1974-volkswagen-thing-230/";

    await importRun(db as unknown as D1Database, {
      runId: "run-first",
      generatedAt: "2026-06-27T08:00:00.000Z",
      listings: [
        {
          section: "Strong fits",
          lane: "family",
          site: "Bring a Trailer",
          title: "1974 Volkswagen Thing",
          url,
          bid: "$3,800",
          total: "$3,990 incl. buyer fee estimate",
          why: "Early value watch.",
          concerns: "Verify underside.",
          images: ["https://example.com/thing-1.jpg"],
        },
      ],
    });

    await importRun(db as unknown as D1Database, {
      runId: "run-second",
      generatedAt: "2026-06-27T15:31:00.000Z",
      listings: [
        {
          section: "Strong fits",
          lane: "family",
          site: "Bring a Trailer",
          title: "1,835cc-Powered 1974 Volkswagen Thing",
          url,
          bid: "$4,000",
          total: "$4,200 incl. buyer fee estimate",
          why: "Same auction after title enrichment.",
          concerns: "Verify underside and seller notes.",
          images: ["https://example.com/thing-2.jpg"],
        },
      ],
    });

    const firstKey = await listingKeyFor("Bring a Trailer", url, "1974 Volkswagen Thing");
    const secondProposedKey = await listingKeyFor("Bring a Trailer", url, "1,835cc-Powered 1974 Volkswagen Thing");

    expect(firstKey).not.toBe(secondProposedKey);
    expect(db.listings.size).toBe(1);
    expect(db.listings.has(firstKey)).toBe(true);
    expect(db.runListings.has(`run-first:${firstKey}`)).toBe(true);
    expect(db.runListings.has(`run-second:${firstKey}`)).toBe(true);
    expect(db.runListings.has(`run-second:${secondProposedKey}`)).toBe(false);

    const secondPayload = JSON.parse(db.runListings.get(`run-second:${firstKey}`)?.payload_json || "{}") as AuctionListing;
    expect(secondPayload).toMatchObject({
      listingKey: firstKey,
      title: "1,835cc-Powered 1974 Volkswagen Thing",
      bid: "$4,000",
    });
  });

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
      locationRaw: "Charleston, SC",
      locationCity: "Charleston",
      locationRegion: "SC",
      locationStatus: "ok",
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

  it("inserts runner listings as normal run listings with location and images", async () => {
    const db = new FakeD1Database();
    const runId = "run-runner-merge";
    db.runs.add(runId);

    const result = await mergeListingsIntoRun(db as unknown as D1Database, runId, [
      {
        section: "Runner finds",
        lane: "family",
        site: "Cars & Bids",
        title: "1973 Chevrolet K5 Blazer 4x4",
        url: "https://carsandbids.com/auctions/example/1973-chevrolet-k5-blazer",
        bid: "$12,500",
        total: "$13,125 incl. buyer fee estimate",
        location: "Charleston, SC",
        locationRaw: "Charleston, SC",
        locationCity: "Charleston",
        locationRegion: "SC",
        locationStatus: "ok",
        why: "Runner found a beach-friendly open 4x4.",
        concerns: "Verify rust and title.",
        images: ["https://media.carsandbids.com/abc/photos/k5/main.jpg"],
      },
    ]);

    expect(result).toMatchObject({ runId, patched: 0, inserted: 1 });
    expect(result.images).toHaveLength(1);
    const row = Array.from(db.runListings.values()).find((listing) => listing.run_id === runId);
    const payload = JSON.parse(row?.payload_json || "{}") as AuctionListing;
    expect(payload).toMatchObject({
      site: "Cars & Bids",
      title: "1973 Chevrolet K5 Blazer 4x4",
      location: "Charleston, SC",
      locationCity: "Charleston",
      locationRegion: "SC",
      locationStatus: "ok",
      images: ["https://media.carsandbids.com/abc/photos/k5/main.jpg"],
    });
    expect(db.images.size).toBe(1);
  });

  it("updates the run source summary with runner merge diagnostics", async () => {
    const db = new FakeD1Database();
    const runId = "run-runner-summary";
    db.runs.add(runId);
    db.runSourceSummaries.set(
      runId,
      JSON.stringify({
        checkedSources: [{ source: "bringatrailer", site: "Bring a Trailer", status: "ok", candidateCount: 2 }],
        runnerTasks: [{ id: "task-cab", source: "carsandbids", kind: "browser_source", status: "queued" }],
      }),
    );

    await updateRunRunnerTaskSummary(db as unknown as D1Database, runId, {
      id: "task-cab",
      source: "carsandbids",
      kind: "browser_source",
      status: "completed",
      mergeStatus: "merged",
      normalizedCandidateCount: 3,
      importedCount: 2,
      patchedCount: 1,
      insertedCount: 1,
      rejectedCount: 1,
      rejectionReasons: [{ reason: "missing_title", count: 1 }],
    });

    const summary = JSON.parse(db.runSourceSummaries.get(runId) || "{}");
    expect(summary.checkedSources).toHaveLength(1);
    expect(summary.runnerTasks).toEqual([
      {
        id: "task-cab",
        source: "carsandbids",
        kind: "browser_source",
        status: "completed",
        mergeStatus: "merged",
        normalizedCandidateCount: 3,
        importedCount: 2,
        patchedCount: 1,
        insertedCount: 1,
        rejectedCount: 1,
        rejectionReasons: [{ reason: "missing_title", count: 1 }],
      },
    ]);
  });

  it("reconciles runner results completed before publication exactly once", async () => {
    const db = new FakeD1Database();
    db.runnerTasks.push({
      id: "task-cab-before-publish",
      user_id: "user-a",
      agent_run_id: "agent-run-a",
      kind: "browser_source",
      source: "carsandbids",
      status: "completed",
      priority: 80,
      input_json: "{}",
      result_json: JSON.stringify({
        status: "ok",
        normalizedCandidates: [
          {
            site: "Cars & Bids",
            title: "1995 Suzuki Samurai 4x4",
            url: "https://carsandbids.com/auctions/runner/samurai",
            bid: "$7,250",
            total: "$7,613",
            location: "Portland, ME",
            why: "Simple open 4x4.",
            concerns: "Check rust.",
            images: ["https://media.carsandbids.com/root/photos/exterior/main.jpg"],
          },
          { site: "Cars & Bids", url: "https://carsandbids.com/auctions/runner/missing-title" },
        ],
      }),
      error: null,
      runner_id: "test-runner",
      claimed_at: "2026-07-11T12:00:00.000Z",
      finished_at: "2026-07-11T12:01:00.000Z",
      created_at: "2026-07-11T11:59:00.000Z",
      updated_at: "2026-07-11T12:01:00.000Z",
    });

    const imported = await importRun(
      db as unknown as D1Database,
      {
        runId: "run-from-agent-a",
        sourceSummary: {
          agentRunId: "agent-run-a",
          runnerTasks: [{ id: "task-cab-before-publish", source: "carsandbids", kind: "browser_source", status: "queued" }],
        },
        listings: [
          {
            section: "Strong fits",
            lane: "family",
            site: "Bring a Trailer",
            title: "1974 Volkswagen Thing",
            url: "https://bringatrailer.com/listing/1974-volkswagen-thing-reconcile/",
            bid: "$8,000",
            total: "$8,400",
            why: "Baseline workflow result.",
            concerns: "Check floors.",
            images: [],
          },
        ],
      },
      "user-a",
    );

    expect(imported).toMatchObject({ listingCount: 2 });
    expect(imported.runnerMerges).toEqual([
      expect.objectContaining({
        taskId: "task-cab-before-publish",
        runId: "run-from-agent-a",
        status: "merged",
        normalizedCandidateCount: 1,
        importedCount: 1,
        inserted: 1,
        rejectedCount: 1,
        alreadyMerged: false,
      }),
    ]);
    expect(db.runListings.size).toBe(2);

    const secondPass = await reconcileCompletedRunnerTasksForRun(db as unknown as D1Database, {
      runId: "run-from-agent-a",
      userId: "user-a",
      agentRunId: "agent-run-a",
    });

    expect(secondPass).toEqual([
      expect.objectContaining({
        taskId: "task-cab-before-publish",
        status: "merged",
        alreadyMerged: true,
        inserted: 0,
      }),
    ]);
    expect(db.runListings.size).toBe(2);
    expect(JSON.parse(db.runSourceSummaries.get("run-from-agent-a") || "{}").runnerTasks).toEqual([
      {
        id: "task-cab-before-publish",
        source: "carsandbids",
        kind: "browser_source",
        status: "completed",
        mergeStatus: "merged",
        resultStatus: "ok",
        normalizedCandidateCount: 1,
        importedCount: 1,
        patchedCount: 0,
        insertedCount: 1,
        rejectedCount: 1,
        rejectionReasons: [{ reason: "missing_title", count: 1 }],
      },
    ]);
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

interface FakeRunnerTaskRow {
  id: string;
  user_id: string;
  agent_run_id: string | null;
  kind: "source_discovery" | "codex_research" | "browser_source";
  source: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  priority: number;
  input_json: string;
  result_json: string | null;
  error: string | null;
  runner_id: string | null;
  claimed_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

class FakeD1Database {
  runs = new Set<string>();
  runUsers = new Map<string, string | null>();
  runSourceSummaries = new Map<string, string | null>();
  runListings = new Map<string, FakeRunListingRow>();
  listings = new Map<string, Record<string, unknown>>();
  images = new Map<string, Record<string, unknown>>();
  runnerTasks: FakeRunnerTaskRow[] = [];

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
    if (this.sql === "SELECT source_summary_json FROM runs WHERE id = ?") {
      const runId = String(this.values[0] || "");
      return this.db.runs.has(runId) ? ({ source_summary_json: this.db.runSourceSummaries.get(runId) ?? null } as T) : null;
    }
    if (this.sql === "SELECT user_id FROM runs WHERE id = ?") {
      const runId = String(this.values[0] || "");
      return this.db.runs.has(runId) ? ({ user_id: this.db.runUsers.get(runId) ?? null } as T) : null;
    }
    if (this.sql.includes("SELECT listing_key FROM listings")) {
      const [listingKey, url] = this.values.map((value) => String(value || ""));
      const byUrl = Array.from(this.db.listings.values()).find((row) => row.url === url);
      if (byUrl) return { listing_key: byUrl.listingKey } as T;
      const byKey = this.db.listings.get(listingKey);
      return byKey ? ({ listing_key: byKey.listingKey } as T) : null;
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

  async all<T>(): Promise<{ results: T[] }> {
    if (this.sql.includes("FROM runner_tasks") && this.sql.includes("status = 'completed'")) {
      const [agentRunId, userId] = this.values.map((value) => String(value || ""));
      const results = this.db.runnerTasks.filter(
        (task) => task.agent_run_id === agentRunId && task.user_id === userId && task.status === "completed",
      );
      return { results: results as T[] };
    }
    throw new Error(`Unexpected all() query: ${this.sql}`);
  }

  async run(): Promise<Record<string, unknown>> {
    if (this.sql.includes("INSERT INTO runs")) {
      const [runId, userId, , , sourceSummaryJson] = this.values;
      this.db.runs.add(String(runId));
      this.db.runUsers.set(String(runId), userId === null || userId === undefined ? null : String(userId));
      this.db.runSourceSummaries.set(String(runId), sourceSummaryJson === null || sourceSummaryJson === undefined ? null : String(sourceSummaryJson));
      return { success: true };
    }
    if (this.sql === "UPDATE runs SET source_summary_json = ? WHERE id = ?") {
      const [sourceSummaryJson, runId] = this.values;
      this.db.runSourceSummaries.set(String(runId), sourceSummaryJson === null || sourceSummaryJson === undefined ? null : String(sourceSummaryJson));
      return { success: true };
    }
    if (this.sql.includes("SET source_summary_json = json_set") && this.values.length === 3) {
      const [path, taskJson, runId] = this.values;
      const summary = JSON.parse(this.db.runSourceSummaries.get(String(runId)) || "{}") as { runnerTasks?: unknown[] };
      const index = Number(String(path).match(/\[(\d+)\]$/)?.[1]);
      const runnerTasks = Array.isArray(summary.runnerTasks) ? [...summary.runnerTasks] : [];
      runnerTasks[index] = JSON.parse(String(taskJson));
      this.db.runSourceSummaries.set(String(runId), JSON.stringify({ ...summary, runnerTasks }));
      return { success: true };
    }
    if (this.sql.includes("SET source_summary_json = json_set") && this.values.length === 1) {
      const runId = String(this.values[0]);
      const summary = JSON.parse(this.db.runSourceSummaries.get(runId) || "{}") as { runnerTasks?: unknown[] };
      this.db.runSourceSummaries.set(runId, JSON.stringify({ ...summary, runnerTasks: Array.isArray(summary.runnerTasks) ? summary.runnerTasks : [] }));
      return { success: true };
    }
    if (this.sql.includes("json_insert(source_summary_json, '$.runnerTasks[#]'")) {
      const [taskJson, runId] = this.values;
      const summary = JSON.parse(this.db.runSourceSummaries.get(String(runId)) || "{}") as { runnerTasks?: unknown[] };
      const runnerTasks = Array.isArray(summary.runnerTasks) ? [...summary.runnerTasks] : [];
      runnerTasks.push(JSON.parse(String(taskJson)));
      this.db.runSourceSummaries.set(String(runId), JSON.stringify({ ...summary, runnerTasks }));
      return { success: true };
    }
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
    if (this.sql.includes("INSERT INTO run_listings")) {
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
