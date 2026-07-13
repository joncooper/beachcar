import { describe, expect, it } from "vitest";
import {
  ProductEventValidationError,
  createProductEvents,
  getProductEventSummary,
  getProductEvents,
} from "../src/worker/db";

describe("product interaction diagnostics", () => {
  it("stores allowlisted, user-scoped events and deduplicates retries", async () => {
    const db = new ProductEventsD1();
    const body = batch("event-1", {
      direction: "right",
      maximumGate: "primary",
      committed: "true",
      action: "like",
      durationBucket: "under_1s",
      tuningPreset: "balanced",
    });

    expect(await createProductEvents(db as unknown as D1Database, "user-a", body)).toEqual({ accepted: 1, processed: 1 });
    expect(await createProductEvents(db as unknown as D1Database, "user-a", body)).toEqual({ accepted: 0, processed: 1 });

    const exported = await getProductEvents(db as unknown as D1Database, "user-a");
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({
      id: "event-1",
      eventName: "review_drag_ended",
      properties: { action: "like", tuningPreset: "balanced" },
      appBuild: "0.1.0 (42)",
      tuningVersion: 1,
    });
    expect(await getProductEvents(db as unknown as D1Database, "user-b")).toEqual([]);
  });

  it("rejects unknown events, sensitive properties, and oversized comments", async () => {
    const db = new ProductEventsD1();
    await expect(
      createProductEvents(db as unknown as D1Database, "user-a", {
        events: [{ ...batch("event-1", {}).events[0], eventName: "raw_touch_path" }],
      }),
    ).rejects.toBeInstanceOf(ProductEventValidationError);
    await expect(
      createProductEvents(db as unknown as D1Database, "user-a", batch("event-2", { listingTitle: "Secret car" })),
    ).rejects.toThrow("listingTitle is not allowed");
    await expect(
      createProductEvents(db as unknown as D1Database, "user-a", {
        events: [
          {
            ...batch("event-3", {}).events[0],
            eventName: "experience_feedback_submitted",
            properties: { comment: "x".repeat(241) },
          },
        ],
      }),
    ).rejects.toThrow("comment is too long");
  });

  it("returns an aggregate without exposing raw user payloads", async () => {
    const db = new ProductEventsD1();
    await createProductEvents(db as unknown as D1Database, "user-a", batch("event-1", { tuningPreset: "quick" }));
    await createProductEvents(db as unknown as D1Database, "user-b", batch("event-2", { tuningPreset: "quick" }));

    const summary = await getProductEventSummary(db as unknown as D1Database, 30);
    expect(summary.total).toBe(2);
    expect(summary.users).toBe(2);
    expect(summary.sessions).toBe(1);
    expect(summary.aggregates).toEqual([{ eventName: "review_drag_ended", tuningPreset: "quick", count: 2 }]);
    expect(summary.reviewOutcomes).toEqual([{ tuningPreset: "quick", total: 2, committed: 0, cancelled: 0 }]);
  });
});

function batch(id: string, properties: Record<string, string>) {
  return {
    events: [
      {
        id,
        sessionId: "session-1",
        eventName: "review_drag_ended",
        properties,
        clientCreatedAt: new Date().toISOString(),
        appBuild: "0.1.0 (42)",
        tuningVersion: 1,
      },
    ],
  };
}

interface StoredProductEvent {
  id: string;
  user_id: string;
  session_id: string;
  event_name: string;
  properties_json: string;
  client_created_at: string;
  received_at: string;
  app_build: string;
  tuning_version: number;
}

class ProductEventsD1 {
  rows: StoredProductEvent[] = [];

  prepare(sql: string): ProductEventStatement {
    return new ProductEventStatement(this, sql);
  }
}

class ProductEventStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: ProductEventsD1,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async run(): Promise<{ meta: { changes: number } }> {
    if (this.sql.startsWith("DELETE FROM product_events WHERE received_at")) return { meta: { changes: 0 } };
    if (this.sql.includes("INSERT OR IGNORE INTO product_events")) {
      const [id, userId, sessionId, eventName, propertiesJson, clientCreatedAt, appBuild, tuningVersion] = this.values;
      if (this.db.rows.some((row) => row.id === id)) return { meta: { changes: 0 } };
      this.db.rows.push({
        id: String(id),
        user_id: String(userId),
        session_id: String(sessionId),
        event_name: String(eventName),
        properties_json: String(propertiesJson),
        client_created_at: String(clientCreatedAt),
        received_at: new Date().toISOString(),
        app_build: String(appBuild),
        tuning_version: Number(tuningVersion),
      });
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unexpected run query: ${this.sql}`);
  }

  async all<T>(): Promise<{ results: T[] }> {
    if (this.sql.startsWith("SELECT * FROM product_events")) {
      const userId = String(this.values[0]);
      return { results: this.db.rows.filter((row) => row.user_id === userId) as T[] };
    }
    if (this.sql.includes("GROUP BY event_name, tuning_preset")) {
      const counts = new Map<string, { event_name: string; tuning_preset: string; count: number }>();
      for (const row of this.db.rows) {
        const properties = JSON.parse(row.properties_json) as Record<string, string>;
        const tuningPreset = properties.tuningPreset || "unknown";
        const key = `${row.event_name}:${tuningPreset}`;
        const current = counts.get(key) || { event_name: row.event_name, tuning_preset: tuningPreset, count: 0 };
        current.count += 1;
        counts.set(key, current);
      }
      return { results: [...counts.values()] as T[] };
    }
    if (this.sql.includes("event_name = 'review_drag_ended'")) {
      return { results: aggregateOutcomeRows(this.db.rows, "review") as T[] };
    }
    if (this.sql.includes("event_name = 'gallery_dismissed'")) {
      return { results: aggregateOutcomeRows(this.db.rows, "gallery") as T[] };
    }
    throw new Error(`Unexpected all query: ${this.sql}`);
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("COUNT(DISTINCT user_id)")) {
      return {
        total: this.db.rows.length,
        users: new Set(this.db.rows.map((row) => row.user_id)).size,
        sessions: new Set(this.db.rows.map((row) => row.session_id)).size,
      } as T;
    }
    throw new Error(`Unexpected first query: ${this.sql}`);
  }
}

function aggregateOutcomeRows(rows: StoredProductEvent[], kind: "review" | "gallery"): Array<Record<string, unknown>> {
  const matchingName = kind === "review" ? "review_drag_ended" : "gallery_dismissed";
  const grouped = new Map<string, Record<string, number | string>>();
  for (const row of rows.filter((entry) => entry.event_name === matchingName)) {
    const properties = JSON.parse(row.properties_json) as Record<string, string>;
    const preset = properties.tuningPreset || "unknown";
    const current = grouped.get(preset) ||
      (kind === "review"
        ? { tuning_preset: preset, total: 0, committed: 0, cancelled: 0 }
        : { tuning_preset: preset, total: 0, gesture: 0, control: 0, first_attempt_gesture: 0 });
    current.total = Number(current.total) + 1;
    if (kind === "review") {
      if (properties.committed === "true") current.committed = Number(current.committed) + 1;
      if (properties.committed === "false") current.cancelled = Number(current.cancelled) + 1;
    } else if (properties.method === "vertical_gesture") {
      current.gesture = Number(current.gesture) + 1;
      if (properties.attemptCountBucket === "one") current.first_attempt_gesture = Number(current.first_attempt_gesture) + 1;
    } else if (properties.method === "control") {
      current.control = Number(current.control) + 1;
    }
    grouped.set(preset, current);
  }
  return [...grouped.values()];
}
