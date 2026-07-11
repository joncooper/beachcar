import { describe, expect, it } from "vitest";
import {
  analyzeRunnerResult,
  mergeRunSourceSummaries,
  normalizeRunnerCandidates,
  normalizeRunSourceSummary,
} from "../src/worker/runner-results";

describe("runner result validation", () => {
  it("accepts listing-shaped runner candidates and reports concrete rejection reasons", () => {
    const result = normalizeRunnerCandidates([
      {
        site: "Cars & Bids",
        title: "1973 Chevrolet K5 Blazer 4x4",
        url: "https://carsandbids.com/auctions/example/1973-chevrolet-k5-blazer",
        bid: "$12,500",
        total: "$13,125 incl. buyer fee estimate",
        location: "Charleston, SC",
        images: ["https://media.carsandbids.com/abc/photos/k5/main.jpg"],
      },
      "not an object",
      { site: "Cars & Bids", url: "https://carsandbids.com/auctions/missing-title" },
      { site: "Cars & Bids", title: "Bad URL", url: "not a url" },
      { title: "Missing site", url: "https://example.com/listing" },
    ]);

    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]).toMatchObject({
      site: "Cars & Bids",
      title: "1973 Chevrolet K5 Blazer 4x4",
      location: "Charleston, SC",
    });
    expect(result.rejections).toEqual([
      { index: 1, reason: "candidate_not_object" },
      { index: 2, reason: "missing_title", url: "https://carsandbids.com/auctions/missing-title" },
      { index: 3, reason: "missing_or_invalid_url", title: "Bad URL", url: "not a url" },
      { index: 4, reason: "missing_site", title: "Missing site", url: "https://example.com/listing" },
    ]);
  });

  it("rejects unknown runner statuses instead of surfacing arbitrary strings", () => {
    expect(analyzeRunnerResult({ status: "definitely-fine", normalizedCandidates: [] }).resultStatus).toBe("failed");
    expect(analyzeRunnerResult({ normalizedCandidates: [] }).resultStatus).toBe("empty");
  });

  it("normalizes typed source-summary fields at untrusted JSON boundaries", () => {
    expect(
      normalizeRunSourceSummary({
        publisher: " workflow ",
        smoke: true,
        checkedSources: [
          { source: "bringatrailer", site: "Bring a Trailer", status: "ok", candidateCount: 3 },
          { source: "carsandbids", site: "Cars & Bids", status: "garbage", candidateCount: 2 },
        ],
        runnerTasks: [{ id: "task-1", source: "carsandbids", kind: "browser_source", status: "queued", mergeStatus: "nonsense" }],
        fallbackUsed: "yes",
      }),
    ).toEqual({
      smoke: true,
      publisher: "workflow",
      checkedSources: [{ source: "bringatrailer", site: "Bring a Trailer", status: "ok", candidateCount: 3 }],
      runnerTasks: [{ id: "task-1", source: "carsandbids", kind: "browser_source", status: "queued" }],
    });
  });

  it("preserves terminal merge diagnostics across an idempotent republish", () => {
    const merged = mergeRunSourceSummaries(
      normalizeRunSourceSummary({
        runnerTasks: [{ id: "task-1", source: "carsandbids", kind: "browser_source", status: "completed", mergeStatus: "merged", importedCount: 2 }],
      }),
      normalizeRunSourceSummary({
        runnerTasks: [{ id: "task-1", source: "carsandbids", kind: "browser_source", status: "queued" }],
      }),
    );

    expect(merged?.runnerTasks).toEqual([
      { id: "task-1", source: "carsandbids", kind: "browser_source", status: "completed", mergeStatus: "merged", importedCount: 2 },
    ]);
  });
});
