import { describe, expect, it } from "vitest";
import type { AuctionListing } from "../src/shared/types";
import { createPreferenceEvent, exportFeedback, upsertFeedback } from "../src/worker/db";

describe("user-scoped feedback listing snapshots", () => {
  it("hydrates feedback and preference exports from each user's run snapshot", async () => {
    const db = isolationDatabase();

    const userA = await exportFeedback(db as unknown as D1Database, { userId: "user-a", includeLegacyData: false });
    const userB = await exportFeedback(db as unknown as D1Database, { userId: "user-b", includeLegacyData: false });

    expect(userA.entries[0]?.listing).toMatchObject({ title: "1974 Volkswagen Thing for user A", url: "https://example.com/user-a-thing" });
    expect(userA.preferenceEvents?.[0]?.listing).toMatchObject({ title: "1974 Volkswagen Thing for user A" });
    expect(userA.steering.prioritizeSimilarTo[0]).toMatchObject({ title: "1974 Volkswagen Thing for user A" });
    expect(userB.entries[0]?.listing).toMatchObject({ title: "BMW R80 motorcycle for user B", url: "https://example.com/user-b-bike" });
    expect(userB.preferenceEvents?.[0]?.listing).toMatchObject({ title: "BMW R80 motorcycle for user B" });
  });

  it("infers feedback and preference tags only from the acting user's snapshot", async () => {
    const db = isolationDatabase();

    const feedback = await upsertFeedback(
      db as unknown as D1Database,
      { userId: "user-a", includeLegacyData: false },
      "shared-listing",
      { action: "star" },
    );
    const preference = await createPreferenceEvent(
      db as unknown as D1Database,
      { userId: "user-a", includeLegacyData: false },
      { listingKey: "shared-listing", eventType: "text_note", note: "More like this" },
    );

    expect(feedback.tags).toContain("pure beach buggy");
    expect(feedback.tags).not.toContain("small motorcycle");
    expect(preference.tags).toContain("pure beach buggy");
    await expect(
      upsertFeedback(
        db as unknown as D1Database,
        { userId: "user-without-run", includeLegacyData: false },
        "shared-listing",
        { action: "star" },
      ),
    ).rejects.toThrow("Unknown listing");
  });
});

function isolationDatabase(): FeedbackIsolationD1 {
  const db = new FeedbackIsolationD1();
  db.snapshots.push(
    {
      userId: "user-a",
      listingKey: "shared-listing",
      generatedAt: "2026-07-10T12:00:00.000Z",
      payloadJson: JSON.stringify(listing("1974 Volkswagen Thing for user A", "https://example.com/user-a-thing", "family")),
    },
    {
      userId: "user-b",
      listingKey: "shared-listing",
      generatedAt: "2026-07-11T12:00:00.000Z",
      payloadJson: JSON.stringify(listing("BMW R80 motorcycle for user B", "https://example.com/user-b-bike", "solo")),
    },
  );
  db.feedback.push(
    feedbackRow("user-a", "star"),
    feedbackRow("user-b", "star"),
  );
  db.preferenceEvents.push(
    preferenceRow("pref-a", "user-a"),
    preferenceRow("pref-b", "user-b"),
  );
  return db;
}

function listing(title: string, url: string, lane: "family" | "solo"): AuctionListing {
  return {
    listingKey: "shared-listing",
    section: "Strong fits",
    lane,
    site: "Example Auctions",
    title,
    url,
    bid: "$8,000",
    total: "$8,400",
    why: title,
    concerns: "Inspect before bidding.",
    images: [],
  };
}

function feedbackRow(userId: string, action: "star") {
  return {
    user_id: userId,
    listing_key: "shared-listing",
    action,
    tags_json: "[]",
    note: null,
    updated_at: "2026-07-11T13:00:00.000Z",
  };
}

function preferenceRow(id: string, userId: string) {
  return {
    id,
    user_id: userId,
    listing_key: "shared-listing",
    event_type: "text_note" as const,
    note: "Remember this one",
    transcript: null,
    tags_json: "[]",
    created_at: "2026-07-11T13:05:00.000Z",
  };
}

interface SnapshotRow {
  userId: string | null;
  listingKey: string;
  generatedAt: string;
  payloadJson: string;
}

class FeedbackIsolationD1 {
  snapshots: SnapshotRow[] = [];
  feedback: ReturnType<typeof feedbackRow>[] = [];
  preferenceEvents: ReturnType<typeof preferenceRow>[] = [];

  prepare(sql: string): FeedbackIsolationStatement {
    if (sql.includes("last_payload_json")) throw new Error("Global listing payload must not be queried");
    return new FeedbackIsolationStatement(this, sql);
  }
}

class FeedbackIsolationStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: FeedbackIsolationD1,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM run_listings rl")) {
      const listingKey = String(this.values[0] || "");
      const userId = String(this.values[1] || "");
      const includeLegacy = this.sql.includes("r.user_id IS NULL");
      const matching = this.db.snapshots
        .filter((row) => row.listingKey === listingKey && (row.userId === userId || (includeLegacy && row.userId === null)))
        .sort((left, right) => {
          if (includeLegacy && left.userId !== right.userId) return left.userId === userId ? -1 : 1;
          return right.generatedAt.localeCompare(left.generatedAt);
        });
      return matching[0] ? ({ payload_json: matching[0].payloadJson } as T) : null;
    }
    throw new Error(`Unexpected first() query: ${this.sql}`);
  }

  async all<T>(): Promise<{ results: T[] }> {
    const userId = String(this.values[0] || "");
    if (this.sql.startsWith("SELECT * FROM feedback")) {
      return { results: this.db.feedback.filter((row) => row.user_id === userId) as T[] };
    }
    if (this.sql.startsWith("SELECT * FROM preference_events")) {
      return { results: this.db.preferenceEvents.filter((row) => row.user_id === userId) as T[] };
    }
    throw new Error(`Unexpected all() query: ${this.sql}`);
  }

  async run(): Promise<Record<string, unknown>> {
    if (this.sql.includes("INSERT INTO feedback")) return { success: true };
    if (this.sql.includes("INSERT INTO preference_events")) return { success: true };
    throw new Error(`Unexpected run() query: ${this.sql}`);
  }
}
