import { describe, expect, it } from "vitest";
import {
  discoverAndScoreCandidates,
  parseBringATrailerDetailPage,
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

  it("parses Bring a Trailer detail pages into a rich dossier", () => {
    const detail = parseBringATrailerDetailPage(batDetailHtml());

    expect(detail).toMatchObject({
      location: "Charleston, South Carolina",
      bids: 38,
      bidders: 12,
      comments: 36,
      imageUrls: expect.arrayContaining([
        "https://bringatrailer.com/wp-content/uploads/2026/06/thing-hero.jpg?w=1200",
        "https://bringatrailer.com/wp-content/uploads/2026/06/thing-undercarriage.jpg?w=900",
      ]),
      dossier: {
        summary: "Removable-roof family 4x4 with honest paint and recent soft-top work.",
        specs: {
          odometer: "62,400 miles",
          engine: "350ci V8",
          transmission: "3-speed automatic",
          title: "Clean South Carolina title",
          seller: "lowcountry_blazer",
          lot: "BaT Auction 123456",
        },
        listing: [
          "This K5 Blazer is finished in dark green over tan vinyl and is powered by a 350ci V8 paired with a three-speed automatic transmission.",
          "Equipment includes a removable hardtop, front bucket seats, rear bench, air conditioning, and 15-inch Rally wheels.",
        ],
        equipment: ["Removable hardtop", "Front bucket seats and rear bench", "15-inch Rally wheels"],
        service: ["2025 - soft top seals replaced", "2024 - brake service and oil change"],
        bidLog: [{ bidder: "beach4x4", amount: "$8,500", ago: "2h" }],
        comments: [{ user: "lowcountry_blazer", body: "The floors are original and photos of the underside were added today.", ago: "1h", seller: true }],
      },
    });
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

  it("enriches shortlisted BaT candidates with detail-page dossier data", async () => {
    const fetchImpl = async (input: string): Promise<Response> => {
      if (input.includes("/listing/1974-volkswagen-thing/")) return new Response(batDetailHtml());
      if (input.includes("/volkswagen/thing/")) return new Response(batLiveHtml("1974 Volkswagen Thing", "USD $8,295"));
      if (input.includes("carsandbids.com")) return new Response("<title>Just a moment...</title>");
      return new Response(`<div class="listings-live"></div><div class="auctions-completed"></div>`);
    };

    const result = await discoverAndScoreCandidates(
      context,
      { runId: "agent-run-detail-test", source: "manual", reason: "test" },
      { fetchImpl, now: new Date("2026-06-25T12:00:00Z") },
    );

    const thing = result.listings.find((listing) => listing.title === "1974 Volkswagen Thing");
    expect(thing).toMatchObject({
      location: "Charleston, South Carolina",
      bids: 38,
      bidders: 12,
      comments: 36,
    });
    expect(thing?.images).toEqual(
      expect.arrayContaining([
        "https://bringatrailer.com/wp-content/uploads/2026/06/1974_thing.jpg?w=470&h=318&crop=1",
        "https://bringatrailer.com/wp-content/uploads/2026/06/thing-hero.jpg?w=1200",
      ]),
    );
    expect(thing?.dossier?.listing).toHaveLength(2);
    expect(thing?.dossier?.bidLog?.[0]).toMatchObject({ bidder: "beach4x4", amount: "$8,500" });
    expect(thing?.dossier?.comments?.[0]).toMatchObject({ user: "lowcountry_blazer", seller: true });
    expect(result.checkedSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "bringatrailer-detail",
          status: "ok",
          candidateCount: 1,
        }),
      ]),
    );
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

function batDetailHtml(): string {
  return `
    <html>
      <head>
        <meta property="og:description" content="Removable-roof family 4x4 with honest paint and recent soft-top work." />
        <meta property="og:image" content="https://bringatrailer.com/wp-content/uploads/2026/06/thing-hero.jpg?w=1200" />
      </head>
      <body>
        <section class="listing-essentials">
          <dl>
            <dt>Location</dt><dd>Charleston, South Carolina</dd>
            <dt>Odometer</dt><dd>62,400 miles</dd>
            <dt>Engine</dt><dd>350ci V8</dd>
            <dt>Transmission</dt><dd>3-speed automatic</dd>
            <dt>Title</dt><dd>Clean South Carolina title</dd>
            <dt>Seller</dt><dd>lowcountry_blazer</dd>
            <dt>Lot</dt><dd>BaT Auction 123456</dd>
          </dl>
          <p class="stats">38 bids 12 bidders 36 comments</p>
        </section>

        <div class="post-content">
          <p>This K5 Blazer is finished in dark green over tan vinyl and is powered by a 350ci V8 paired with a three-speed automatic transmission.</p>
          <p>Equipment includes a removable hardtop, front bucket seats, rear bench, air conditioning, and 15-inch Rally wheels.</p>
        </div>

        <h2>Equipment</h2>
        <ul>
          <li>Removable hardtop</li>
          <li>Front bucket seats and rear bench</li>
          <li>15-inch Rally wheels</li>
        </ul>

        <h2>Recent Service</h2>
        <ul>
          <li>2025 - soft top seals replaced</li>
          <li>2024 - brake service and oil change</li>
        </ul>

        <ul class="bid-history">
          <li class="bid-history-item">
            <span class="bidder">beach4x4</span>
            <span class="amount">$8,500</span>
            <time class="ago">2h</time>
          </li>
        </ul>

        <section class="comments">
          <article class="comment-item seller">
            <span class="comment-author">lowcountry_blazer</span>
            <time class="ago">1h</time>
            <p class="comment-content">The floors are original and photos of the underside were added today.</p>
          </article>
        </section>

        <img src="https://bringatrailer.com/wp-content/uploads/2026/06/thing-undercarriage.jpg?w=900" />
      </body>
    </html>
  `;
}
