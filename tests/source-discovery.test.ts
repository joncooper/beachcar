import { describe, expect, it } from "vitest";
import {
  discoverAndScoreCandidates,
  parseBringATrailerLiveListings,
  parseBringATrailerRssFeed,
  type DiscoveryContext,
} from "../src/worker/workflows/source-discovery";

const context: DiscoveryContext = {
  email: "friend@example.com",
  niche: "Beach cars and runabouts",
  budgetMax: 30000,
  stretchBudget: 2000,
  homeRegion: "Northeast",
  timezone: "America/New_York",
  tasteNotes: "simple open-air beach-town cars",
  avoidNotes: "rust and salvage",
  aiMode: "managed",
  enabledSources: ["bringatrailer", "carsandbids"],
  feedbackCount: 2,
  latestRunId: "previous-run",
};

describe("source discovery", () => {
  it("parses Bring a Trailer live keyword cards", () => {
    const listings = parseBringATrailerLiveListings(batLiveHtml("1974 Volkswagen Thing", "USD $8,295"), {
      label: "Volkswagen Thing",
      url: "https://bringatrailer.com/volkswagen/thing/",
    });

    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({
      site: "Bring a Trailer",
      sourceQuery: "Volkswagen Thing",
      title: "1974 Volkswagen Thing",
      url: "https://bringatrailer.com/listing/1974-volkswagen-thing/",
      bid: "USD $8,295",
      bidNum: 8295,
      noReserve: true,
    });
    expect(listings[0]?.imageUrls[0]).toContain("?w=470&h=318&crop=1");
  });

  it("discovers, scores, and reports blocked sources", async () => {
    const fetchImpl = async (input: string): Promise<Response> => {
      if (input.includes("/volkswagen/thing/")) return new Response(batLiveHtml("1974 Volkswagen Thing", "USD $8,295"));
      if (input.includes("/suzuki/samurai/")) return new Response(batLiveHtml("1988 Suzuki Samurai Convertible 5-Speed", "USD $4,890"));
      if (input.includes("carsandbids.com")) return new Response("<title>Just a moment...</title>");
      return new Response(`<div class="listings-live"></div><div class="auctions-completed"></div>`);
    };

    const result = await discoverAndScoreCandidates(
      context,
      { runId: "agent-run-test", source: "manual", reason: "test" },
      { fetchImpl, now: new Date("2026-06-25T12:00:00Z") },
    );

    expect(result.fallbackUsed).toBe(false);
    expect(result.rawCandidateCount).toBeGreaterThanOrEqual(2);
    expect(result.listings.map((listing) => listing.title)).toEqual(
      expect.arrayContaining(["1974 Volkswagen Thing", "1988 Suzuki Samurai Convertible 5-Speed"]),
    );
    expect(result.checkedSources.some((check) => check.source === "bringatrailer" && check.status === "ok")).toBe(true);
    expect(result.blockedSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "carsandbids",
          status: "blocked",
        }),
      ]),
    );
    expect(result.reportMarkdown).toContain("Live source candidates were parsed");

    // Built-in path assembles a dossier with a deterministic 0..1 valueScore + specs.
    const thing = result.listings.find((listing) => listing.title === "1974 Volkswagen Thing");
    expect(thing?.dossier?.valueScore).toBeGreaterThanOrEqual(0);
    expect(thing?.dossier?.valueScore).toBeLessThanOrEqual(1);
    expect(thing?.dossier?.specs).toMatchObject({ seller: "Bring a Trailer", lot: "Volkswagen Thing" });
  });

  it("adds RSS sweep candidates even when keyword pages have live matches", async () => {
    const requested: string[] = [];
    const fetchImpl = async (input: string): Promise<Response> => {
      requested.push(input);
      if (input.includes("/volkswagen/thing/")) return new Response(batLiveHtml("1974 Volkswagen Thing", "USD $8,295"));
      if (input.includes("/mini/moke/")) return new Response("Not found", { status: 404 });
      if (input.includes("/auctions/feed/")) {
        return new Response(
          `<?xml version="1.0"?><rss><channel><item>
            <title><![CDATA[1967 Austin Mini Moke]]></title>
            <link>https://bringatrailer.com/listing/1967-austin-mini-moke/</link>
            <description><![CDATA[Open beach-town runabout with compact proportions.]]></description>
          </item></channel></rss>`,
          { headers: { "Content-Type": "application/rss+xml" } },
        );
      }
      if (input.includes("carsandbids.com")) return new Response("<title>Just a moment...</title>");
      return new Response(`<div class="listings-live"></div><div class="auctions-completed"></div>`);
    };

    const result = await discoverAndScoreCandidates(
      context,
      { runId: "agent-run-rss-sweep-test", source: "manual", reason: "test" },
      { fetchImpl, now: new Date("2026-06-25T12:00:00Z") },
    );

    expect(requested.some((url) => url.includes("/auctions/feed/"))).toBe(true);
    expect(result.listings.map((listing) => listing.title)).toEqual(
      expect.arrayContaining(["1974 Volkswagen Thing", "1967 Austin Mini Moke"]),
    );
    expect(result.checkedSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Auctions RSS",
          status: "ok",
          candidateCount: 1,
        }),
        expect.objectContaining({
          label: "Mini Moke",
          status: "skipped",
        }),
      ]),
    );
    expect(result.blockedSources).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Mini Moke",
        }),
      ]),
    );
  });

  it("can apply AI Gateway-style reranking without changing the source parser", async () => {
    const fetchImpl = async (input: string): Promise<Response> => {
      if (input.includes("/volkswagen/thing/")) return new Response(batLiveHtml("1974 Volkswagen Thing", "USD $8,295"));
      if (input.includes("/suzuki/samurai/")) return new Response(batLiveHtml("1988 Suzuki Samurai Convertible 5-Speed", "USD $4,890"));
      if (input.includes("carsandbids.com")) return new Response("<title>Just a moment...</title>");
      return new Response(`<div class="listings-live"></div><div class="auctions-completed"></div>`);
    };

    const result = await discoverAndScoreCandidates(
      { ...context, userId: "email:friend@example.com", gatewayKeyRef: "friend-openai" },
      { runId: "agent-run-ai-test", source: "manual", reason: "test" },
      {
        fetchImpl,
        now: new Date("2026-06-25T12:00:00Z"),
        aiScorer: {
          async scoreCandidates(input) {
            const samurai = input.candidates.find((candidate) => candidate.candidate.title.includes("Samurai"));
            const thing = input.candidates.find((candidate) => candidate.candidate.title.includes("Thing"));
            return {
              status: "ok",
              provider: "cloudflare-ai-gateway",
              model: "openai/gpt-4.1",
              gatewayId: "default",
              gatewayKeyRef: "friend-openai",
              requestId: "ai-gateway-score-agent-run-ai-test",
              inputTokens: 100,
              outputTokens: 40,
              totalTokens: 140,
              costMicros: 280,
              scores: [
                {
                  url: samurai?.candidate.url || "",
                  scoreDelta: 20,
                  lane: "family",
                  section: "AI strong fits",
                  why: "Cleaner family beach runabout.",
                  concerns: "Confirm rust and soft-top condition.",
                  valueScore: 0.42,
                  summary: "Tidy family-friendly open 4x4 at a fair number.",
                },
                {
                  url: thing?.candidate.url || "",
                  scoreDelta: -10,
                  concerns: "Higher final price risk.",
                },
              ],
            };
          },
        },
      },
    );

    expect(result.aiScoring).toMatchObject({
      status: "ok",
      provider: "cloudflare-ai-gateway",
      totalTokens: 140,
      costMicros: 280,
    });
    expect(result.checkedSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "ai-gateway",
          status: "ok",
          candidateCount: 2,
        }),
      ]),
    );
    expect(result.listings[0]).toMatchObject({
      title: "1988 Suzuki Samurai Convertible 5-Speed",
      section: "AI strong fits",
    });
    expect(result.listings[0]?.why).toContain("AI fit note: Cleaner family beach runabout.");
    expect(result.listings[0]?.concerns).toContain("AI caution: Confirm rust and soft-top condition.");
    // AI valueScore/summary override the deterministic dossier values.
    expect(result.listings[0]?.dossier?.valueScore).toBeCloseTo(0.42);
    expect(result.listings[0]?.dossier?.summary).toBe("Tidy family-friendly open 4x4 at a fair number.");
  });

  it("parses Bring a Trailer RSS items as a broad fallback", () => {
    const rss = `<?xml version="1.0"?><rss><channel><item>
      <title><![CDATA[1988 Suzuki Samurai JX]]></title>
      <link>https://bringatrailer.com/listing/1988-suzuki-samurai-60/</link>
      <pubDate>Thu, 25 Jun 2026 16:00:00 GMT</pubDate>
      <description><![CDATA[Small soft-top 4x4 with beach-town appeal.]]></description>
      <content:encoded><![CDATA[<img src="https://bringatrailer.com/wp-content/uploads/2026/06/samurai.jpg?w=620" />]]></content:encoded>
    </item></channel></rss>`;

    const listings = parseBringATrailerRssFeed(rss);
    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({
      title: "1988 Suzuki Samurai JX",
      url: "https://bringatrailer.com/listing/1988-suzuki-samurai-60/",
      publishedAt: "2026-06-25T16:00:00.000Z",
      imageUrls: ["https://bringatrailer.com/wp-content/uploads/2026/06/samurai.jpg?w=620"],
    });
  });
});

function batLiveHtml(title: string, bid: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const url = `https://bringatrailer.com/listing/${slug}/`;
  return `
    <div class="listings-live page-section">
      <div class="listing-card listing-card-separate featured-listing-card"
        data-listing_id="116381630"
        data-timestamp_end="1782932400">
        <div class="thumbnail">
          <img src="https://bringatrailer.com/wp-content/uploads/2026/06/1974_thing.jpg?w=470&#038;h=318&#038;crop=1" alt="${title}" />
          <a class="image-overlay" href="${url}" title="${title}"></a>
        </div>
        <div class="content-main">
          <h3><a href="${url}">${title}</a></h3>
          <div class="item-tag item-tag-noreserve"><span>No Reserve</span></div>
          <div class="item-excerpt">This open-air beach-town runabout has a soft top and simple mechanicals.</div>
        </div>
        <div class="item-bidding">
          <span class="bidding-bid">
            <span class="bid-label">Bid:</span>
            <span class="bid-formatted bold">${bid}</span>
          </span>
        </div>
      </div>
    </div>
    <div class="auctions-completed page-section"></div>
  `;
}
