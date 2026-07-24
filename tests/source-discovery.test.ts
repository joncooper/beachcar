import { describe, expect, it } from "vitest";
import {
  BAT_KEYWORD_PAGES,
  bringATrailerPagesFromSourceNotes,
  discoverBringATrailerNextPages,
  parseBringATrailerDetailPage,
  parseBringATrailerLiveListings,
  parseBringATrailerRssFeed,
} from "../src/worker/sources/bringatrailer";
import {
  HEMMINGS_SEED_PAGES,
  buildHemmingsSeedPages,
  hemmingsPagesFromSourceNotes,
  isAllowedHemmingsSeedUrl,
  parseHemmingsDetailPage,
  parseHemmingsListingsPage,
} from "../src/worker/sources/hemmings";
import type { SourceCacheSearchResult } from "../src/worker/source-cache";
import { discoverAndScoreCandidates, type DiscoveryContext } from "../src/worker/workflows/source-discovery";

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
      bidCents: 829500,
      location: "Downey, CA",
      noReserve: true,
    });
    expect(listings[0]?.imageUrls[0]).toContain("?w=470&h=318&crop=1");
  });

  it("parses the current BaT live-auction JSON model", () => {
    const listings = parseBringATrailerLiveListings(batCurrentLiveHtml(), {
      label: "Live Auctions",
      url: "https://bringatrailer.com/auctions/",
    });

    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({
      site: "Bring a Trailer",
      sourceQuery: "Live Auctions",
      title: "1974 Volkswagen Thing",
      url: "https://bringatrailer.com/listing/1974-volkswagen-thing/",
      bid: "USD $8,295",
      bidNum: 8295,
      bidCents: 829500,
      locationCountry: "United States",
      endsAt: "2026-07-22T17:00:00.000Z",
      noReserve: true,
      isLive: true,
      imageUrls: ["https://bringatrailer.com/wp-content/uploads/2026/07/thing.jpg?w=470&h=318&crop=1"],
    });
    expect(listings[0]?.summary).toBe("Open-air beach-town runabout with simple mechanicals.");
  });

  it("covers the generic BaT auctions page and ignores malformed/challenge pages", () => {
    expect(BAT_KEYWORD_PAGES).toContainEqual({
      label: "Live Auctions",
      url: "https://bringatrailer.com/auctions/",
    });
    expect(
      parseBringATrailerLiveListings("<html><body><div class='listing-card'>missing live section</div></body></html>", {
        label: "Malformed",
        url: "https://bringatrailer.com/malformed/",
      }),
    ).toEqual([]);
    expect(
      parseBringATrailerLiveListings("<title>Just a moment...</title><main>Checking your browser before accessing Bring a Trailer.</main>", {
        label: "Challenge",
        url: "https://bringatrailer.com/auctions/",
      }),
    ).toEqual([]);
    expect(parseBringATrailerDetailPage("<html><body><div>not a vehicle listing</div></body></html>")).toEqual({});
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

  it("ranks Bring a Trailer detail images by inspection value and parses reserve status", () => {
    const detail = parseBringATrailerDetailPage(`
      <html>
        <head>
          <meta property="og:image" content="https://bringatrailer.com/wp-content/uploads/2026/06/thing-hero.jpg?w=1200" />
        </head>
        <body>
          <div class="item-tag item-tag-noreserve">No Reserve</div>
          <img class="site-logo" alt="BaT logo" src="https://bringatrailer.com/assets/logo.png" />
          <img class="gallery-image" alt="Exterior front three-quarter" src="https://bringatrailer.com/wp-content/uploads/2026/06/thing-exterior.jpg?w=900" />
          <img class="gallery-image" alt="Interior seats" src="https://bringatrailer.com/wp-content/uploads/2026/06/thing-interior.jpg?w=900" />
          <img class="gallery-image" alt="Undercarriage and floors" src="https://bringatrailer.com/wp-content/uploads/2026/06/thing-undercarriage.jpg?w=900" />
          <img class="gallery-image" alt="Engine bay" src="https://bringatrailer.com/wp-content/uploads/2026/06/thing-engine.jpg?w=900" />
          <img class="gallery-image" alt="Exterior duplicate larger" src="https://bringatrailer.com/wp-content/uploads/2026/06/thing-exterior.jpg?w=1200" />
        </body>
      </html>
    `);

    expect(detail.noReserve).toBe(true);
    expect(detail.imageUrls?.slice(0, 5)).toEqual([
      "https://bringatrailer.com/wp-content/uploads/2026/06/thing-hero.jpg?w=1200",
      "https://bringatrailer.com/wp-content/uploads/2026/06/thing-exterior.jpg?w=1200",
      "https://bringatrailer.com/wp-content/uploads/2026/06/thing-interior.jpg?w=900",
      "https://bringatrailer.com/wp-content/uploads/2026/06/thing-undercarriage.jpg?w=900",
      "https://bringatrailer.com/wp-content/uploads/2026/06/thing-engine.jpg?w=900",
    ]);
    expect(detail.imageUrls).not.toContain("https://bringatrailer.com/assets/logo.png");
    expect(parseBringATrailerDetailPage("<p>Reserve not met after the auction.</p>").noReserve).toBe(false);
  });

  it("discovers explicit Bring a Trailer next-page links conservatively", () => {
    const nextPages = discoverBringATrailerNextPages(
      `
        <link rel="next" href="/volkswagen/thing/page/2/" />
        <a class="next page-numbers" href="/volkswagen/thing/page/3/">Next</a>
      `,
      { label: "Volkswagen Thing", url: "https://bringatrailer.com/volkswagen/thing/" },
      1,
    );

    expect(nextPages).toEqual([
      {
        label: "Volkswagen Thing page 2",
        url: "https://bringatrailer.com/volkswagen/thing/page/2/",
      },
    ]);
  });

  it("derives conservative Bring a Trailer seed pages from source notes", () => {
    expect(
      bringATrailerPagesFromSourceNotes(
        "Prioritize Jeep Scrambler, Suzuki Jimny, and https://bringatrailer.com/toyota/land-cruiser/?utm=test",
      ),
    ).toEqual([
      { label: "Jeep Scrambler", url: "https://bringatrailer.com/jeep/scrambler/" },
      { label: "Suzuki Jimny", url: "https://bringatrailer.com/suzuki/jimny/" },
      { label: "Toyota Land Cruiser", url: "https://bringatrailer.com/toyota/land-cruiser/?utm=test" },
    ]);
  });

  it("extracts Bring a Trailer detail-page locations from listing prose", () => {
    const detail = parseBringATrailerDetailPage(`
      <html>
        <head>
          <meta property="og:description" content="Family-ready K5 with removable top." />
        </head>
        <body>
          <div class="post-content">
            <p>This 1973 Chevrolet K5 Blazer is finished in dark green over tan vinyl and is now offered by the selling dealer in Downey, California, with service records and a clean title.</p>
            <p>Equipment includes a removable hardtop, front bucket seats, rear bench, and Rally wheels.</p>
          </div>
        </body>
      </html>
    `);

    expect(detail.location).toBe("Downey, California");
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
    expect(result.checkedSources.find((check) => check.source === "bringatrailer" && check.label === "Volkswagen Thing")?.selectorHits).toMatchObject({
      "listing-card": 1,
      "candidate-with-location": 1,
      "candidate-missing-location": 0,
      "candidate-with-bid": 1,
    });
    expect(result.blockedSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "carsandbids",
          status: "blocked",
          blockedUrls: ["https://carsandbids.com/auctions/"],
        }),
      ]),
    );
    expect(result.reportMarkdown).toContain("Live source candidates were parsed");

    // Built-in path assembles a dossier with a deterministic 0..1 valueScore + specs.
    const thing = result.listings.find((listing) => listing.title === "1974 Volkswagen Thing");
    expect(thing?.dossier?.valueScore).toBeGreaterThanOrEqual(0);
    expect(thing?.dossier?.valueScore).toBeLessThanOrEqual(1);
    expect(thing?.dossier?.specs).toMatchObject({ seller: "Bring a Trailer", lot: "Volkswagen Thing" });
    expect(thing).toMatchObject({
      location: "Downey, CA",
      bidCents: 829500,
      locationRaw: "Downey, CA",
      locationCity: "Downey",
      locationRegion: "CA",
      locationStatus: "ok",
    });
    expect(thing?.why).toContain("1974 Volkswagen Thing matched");
    expect(thing?.why).toContain("from Bring a Trailer Volkswagen Thing");
    expect(thing?.why).not.toContain("from BaT Volkswagen Thing");
    expect(thing?.why).toContain("Source notes:");
    expect(thing?.currentTake).not.toContain("source-discovery candidate");
  });

  it("uses feedback steering to suppress exact hides and prioritize similar candidates", async () => {
    const feedbackSteering: NonNullable<DiscoveryContext["feedbackSteering"]> = {
      prioritizeSimilarTo: [
        {
          title: "1988 Suzuki Samurai Convertible",
          url: "https://bringatrailer.com/listing/prior-samurai/",
          tags: ["samurai", "convertible"],
        },
      ],
      suppressExactUrls: ["https://bringatrailer.com/listing/1974-volkswagen-thing/?utm_source=feedback"],
      avoidSimilarTo: [],
      notes: [],
    };
    const fetchImpl = async (input: string): Promise<Response> => {
      if (input.includes("/volkswagen/thing/")) return new Response(batLiveHtml("1974 Volkswagen Thing", "USD $8,295"));
      if (input.includes("/suzuki/samurai/")) return new Response(batLiveHtml("1988 Suzuki Samurai Convertible 5-Speed", "USD $4,890"));
      if (input.includes("carsandbids.com")) return new Response("<title>Just a moment...</title>");
      return new Response(`<div class="listings-live"></div><div class="auctions-completed"></div>`);
    };

    const result = await discoverAndScoreCandidates(
      { ...context, feedbackCount: 2, feedbackSteering },
      { runId: "agent-run-feedback-test", source: "manual", reason: "feedback test" },
      { fetchImpl, now: new Date("2026-06-25T12:00:00Z") },
    );

    expect(result.listings.map((listing) => listing.title)).not.toContain("1974 Volkswagen Thing");
    const samurai = result.listings.find((listing) => listing.title.includes("Suzuki Samurai"));
    expect(samurai?.why).toContain("feedback priority");
  });

  it("queues reachable Cars & Bids pages for browser-source runner work", async () => {
    const result = await discoverAndScoreCandidates(
      { ...context, enabledSources: ["carsandbids"] },
      { runId: "agent-run-cab-reachable-test", source: "manual", reason: "test" },
      {
        fetchImpl: async () => new Response("<html><title>Cars & Bids Auctions</title><main>Live auctions</main></html>"),
        now: new Date("2026-06-25T12:00:00Z"),
      },
    );

    expect(result.checkedSources).toContainEqual(
      expect.objectContaining({
        source: "carsandbids",
        status: "blocked",
        blockedUrls: ["https://carsandbids.com/auctions/"],
        message: expect.stringContaining("logged-in browser runner"),
      }),
    );
    expect(result.blockedSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "carsandbids",
          status: "blocked",
        }),
      ]),
    );
    expect(result.fallbackUsed).toBe(true);
  });

  it("filters far-away modern Jeeps while allowing local exceptions", async () => {
    const fetchImpl = async (input: string): Promise<Response> => {
      if (input.includes("/jeep/wrangler/")) {
        return new Response(`
          <div class="listings-live page-section">
            ${batLiveCard("2018 Jeep Wrangler Sport 4x4", "USD $6,500", "Lake Zurich, IL", "https://bringatrailer.com/listing/2018-jeep-wrangler-sport/")}
            ${batLiveCard("2015 Jeep Wrangler Sport 4x4", "USD $5,000", "Hudson, NY", "https://bringatrailer.com/listing/2015-jeep-wrangler-sport/")}
          </div>
          <div class="auctions-completed page-section"></div>
        `);
      }
      if (input.includes("carsandbids.com")) return new Response("<title>Just a moment...</title>");
      return new Response(`<div class="listings-live"></div><div class="auctions-completed"></div>`);
    };

    const result = await discoverAndScoreCandidates(
      context,
      { runId: "agent-run-modern-jeep-test", source: "manual", reason: "test" },
      { fetchImpl, now: new Date("2026-06-25T12:00:00Z") },
    );

    expect(result.listings.map((listing) => listing.title)).toContain("2015 Jeep Wrangler Sport 4x4");
    expect(result.listings.map((listing) => listing.title)).not.toContain("2018 Jeep Wrangler Sport 4x4");
    expect(result.listings.find((listing) => listing.title.includes("2015"))?.currentTake).toContain("nearby Jeep exception");
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
      locationRaw: "Charleston, South Carolina",
      locationCity: "Charleston",
      locationRegion: "South Carolina",
      locationStatus: "ok",
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
          detailAttempts: expect.objectContaining({ attempted: 1, enriched: 1, blocked: 0, failed: 0, empty: 0 }),
        }),
      ]),
    );
    expect(result.cacheableCandidates.find((candidate) => candidate.title === "1974 Volkswagen Thing")).toMatchObject({
      source: "bringatrailer",
      detailStatus: "ok",
      lastDetailAt: "2026-06-25T12:00:00.000Z",
      location: "Charleston, South Carolina",
    });
  });

  it("detail-enriches a broader BaT pool before making the final shortlist", async () => {
    const lateUrl = "https://bringatrailer.com/listing/1974-volkswagen-convertible/";
    const requested: string[] = [];
    const fetchImpl = async (input: string): Promise<Response> => {
      requested.push(input);
      if (input === lateUrl) {
        return new Response(`
          <html>
            <head><meta property="og:description" content="Mini Moke-style open-air runabout with simple beach duty scale." /></head>
            <body>
              <div class="post-content">
                <p>This light open-air car has Mini Moke proportions, simple mechanicals, and beach-town appeal.</p>
              </div>
            </body>
          </html>
        `);
      }
      if (input.includes("/jeep/wrangler/")) {
        return new Response(`
          <div class="listings-live page-section">
            ${Array.from({ length: 8 }, (_, index) =>
              batLiveCard(
                `197${index} Jeep CJ-5 4x4`,
                "USD $6,500",
                "Hudson, NY",
                `https://bringatrailer.com/listing/jeep-cj-${index}/`,
              ),
            ).join("")}
          </div>
          <div class="auctions-completed page-section"></div>
        `);
      }
      if (input.includes("/volkswagen/thing/")) {
        return new Response(`
          <div class="listings-live page-section">
            ${batLiveCard("1974 Volkswagen Convertible", "USD $6,200", "Hudson, NY", lateUrl)}
          </div>
          <div class="auctions-completed page-section"></div>
        `);
      }
      if (input.includes("carsandbids.com")) return new Response("<title>Just a moment...</title>");
      if (input.includes("/listing/jeep-cj-")) return new Response("<html><body>No detail enrichment here.</body></html>");
      return new Response(`<div class="listings-live"></div><div class="auctions-completed"></div>`);
    };

    const result = await discoverAndScoreCandidates(
      context,
      { runId: "agent-run-bat-broad-enrichment-test", source: "manual", reason: "test" },
      { fetchImpl, now: new Date("2026-06-25T12:00:00Z") },
    );

    expect(requested).toContain(lateUrl);
    expect(result.listings.map((listing) => listing.title)).toContain("1974 Volkswagen Convertible");
    expect(result.checkedSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "bringatrailer-detail",
          label: "Shortlist detail pages",
          detailAttempts: expect.objectContaining({ attempted: 9, enriched: 1 }),
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
    const moke = result.listings.find((listing) => listing.title === "1967 Austin Mini Moke");
    expect(moke?.why).toContain("from Bring a Trailer auctions feed");
    expect(moke?.why).not.toContain("from BaT");
    expect(result.checkedSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Auctions RSS",
          status: "ok",
          candidateCount: 1,
          message: expect.stringContaining("1/1 candidate(s) missing source location"),
          selectorHits: expect.objectContaining({
            "candidate-missing-location": 1,
          }),
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

  it("follows one bounded BaT keyword pagination page when an explicit next link exists", async () => {
    const requested: string[] = [];
    const fetchImpl = async (input: string): Promise<Response> => {
      requested.push(input);
      if (input.includes("/volkswagen/thing/page/2/")) {
        return new Response(batLiveHtml("1973 Volkswagen Thing", "USD $6,400", "Hudson, NY"));
      }
      if (input.includes("/volkswagen/thing/")) {
        return new Response(`${batLiveHtml("1974 Volkswagen Thing", "USD $8,295")}<a class="next page-numbers" href="/volkswagen/thing/page/2/">Next</a>`);
      }
      if (input.includes("carsandbids.com")) return new Response("<title>Just a moment...</title>");
      return new Response(`<div class="listings-live"></div><div class="auctions-completed"></div>`);
    };

    const result = await discoverAndScoreCandidates(
      context,
      { runId: "agent-run-bat-pagination-test", source: "manual", reason: "test" },
      { fetchImpl, now: new Date("2026-06-25T12:00:00Z") },
    );

    expect(requested).toContain("https://bringatrailer.com/volkswagen/thing/page/2/");
    expect(result.listings.map((listing) => listing.title)).toEqual(
      expect.arrayContaining(["1974 Volkswagen Thing", "1973 Volkswagen Thing"]),
    );
    expect(result.checkedSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "bringatrailer",
          label: "Volkswagen Thing page 2",
          status: "ok",
          candidateCount: 1,
          message: expect.stringContaining("bounded keyword-page pagination"),
        }),
      ]),
    );
  });

  it("uses source-note-derived BaT pages during discovery", async () => {
    const requested: string[] = [];
    const fetchImpl = async (input: string): Promise<Response> => {
      requested.push(input);
      if (input.includes("/jeep/scrambler/")) {
        return new Response(batLiveHtml("1983 Jeep Scrambler 4x4", "USD $9,100", "Providence, RI"));
      }
      if (input.includes("carsandbids.com")) return new Response("<title>Just a moment...</title>");
      return new Response(`<div class="listings-live"></div><div class="auctions-completed"></div>`);
    };

    const result = await discoverAndScoreCandidates(
      {
        ...context,
        sourceSettings: [
          {
            source: "bringatrailer",
            enabled: true,
            settings: { searchNotes: "Add Jeep Scrambler and BMW airhead to the daily sweep." },
          },
        ],
      },
      { runId: "agent-run-bat-source-notes-test", source: "manual", reason: "test" },
      { fetchImpl, now: new Date("2026-06-25T12:00:00Z") },
    );

    expect(requested).toContain("https://bringatrailer.com/jeep/scrambler/");
    expect(requested).toContain("https://bringatrailer.com/bmw/motorcycles/");
    expect(result.listings.map((listing) => listing.title)).toContain("1983 Jeep Scrambler 4x4");
    expect(result.checkedSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "bringatrailer",
          label: "Jeep Scrambler",
          status: "ok",
          candidateCount: 1,
        }),
      ]),
    );
  });

  it("falls back to cached BaT candidates with preserved location when live fetch is blocked", async () => {
    const cacheTerms: string[][] = [];
    const cachedCandidate = {
      source: "bringatrailer",
      site: "Bring a Trailer",
      sourceQuery: "cached BaT RSS",
      title: "1988 Suzuki Samurai JX 4x4",
      url: "https://bringatrailer.com/listing/1988-suzuki-samurai-cache/",
      bid: "$7,800",
      bidNum: 7800,
      total: "$8,190 incl. buyer fee estimate",
      location: "Portland, ME",
      locationRaw: "Portland, ME",
      locationCity: "Portland",
      locationRegion: "ME",
      locationStatus: "ok" as const,
      timeLeft: "cached",
      bids: "check listing",
      bidders: "check listing",
      comments: "check listing",
      imageUrls: ["https://bringatrailer.com/wp-content/uploads/2026/06/samurai-cache.jpg?w=620"],
      summary: "Small soft-top 4x4 with beach-town appeal from the public RSS cache.",
      sourceUrl: "https://bringatrailer.com/auctions/feed/",
      publishedAt: "2026-06-25T16:00:00.000Z",
    };

    const result = await discoverAndScoreCandidates(
      { ...context, enabledSources: ["bringatrailer"] },
      { runId: "agent-run-bat-cache-test", source: "manual", reason: "test" },
      {
        fetchImpl: async () => new Response("<title>Just a moment...</title>"),
        now: new Date("2026-06-25T12:00:00Z"),
        sourceCache: {
          async searchBringATrailer(input) {
            cacheTerms.push(input.terms);
            return {
              source: "bringatrailer",
              site: "Bring a Trailer",
              mode: "d1_cache",
              cacheStatus: "hit",
              feed: "https://bringatrailer.com/auctions/feed/",
              terms: input.terms,
              candidateCount: 1,
              status: {
                source: "bringatrailer",
                itemCount: 1,
                latestIngestion: {
                  id: "source-ingestion-test",
                  source: "bringatrailer",
                  sourceUrl: "https://bringatrailer.com/auctions/feed/",
                  status: "ok",
                  itemCount: 1,
                  newItemCount: 1,
                  error: null,
                  startedAt: "2026-06-25T15:59:00.000Z",
                  finishedAt: "2026-06-25T16:00:00.000Z",
                },
              },
              ingestion: null,
              refreshError: null,
              candidates: [cachedCandidate],
            } satisfies SourceCacheSearchResult;
          },
        },
      },
    );

    expect(cacheTerms[0]).toEqual(expect.arrayContaining(["samurai", "thing"]));
    expect(result.fallbackUsed).toBe(false);
    expect(result.checkedSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "bringatrailer-cache",
          status: "fallback",
          candidateCount: 1,
          cache: expect.objectContaining({
            status: "hit",
            usableCount: 1,
            latestIngestionAt: "2026-06-25T16:00:00.000Z",
          }),
        }),
        expect.objectContaining({
          source: "bringatrailer-detail",
          status: "blocked",
          detailAttempts: expect.objectContaining({ attempted: 1, enriched: 0, blocked: 1 }),
          blockedUrls: ["https://bringatrailer.com/listing/1988-suzuki-samurai-cache/"],
        }),
      ]),
    );
    expect(result.listings[0]).toMatchObject({
      title: "1988 Suzuki Samurai JX 4x4",
      location: "Portland, ME",
      locationCity: "Portland",
      locationRegion: "ME",
      locationStatus: "ok",
    });
    expect(result.listings[0]?.why).toContain("from Bring a Trailer cached BaT RSS");
    expect(result.cacheableCandidates[0]).toMatchObject({
      title: "1988 Suzuki Samurai JX 4x4",
      detailStatus: "blocked",
      lastDetailAt: "2026-06-25T12:00:00.000Z",
      detailError: "Detail page reached a bot/access challenge.",
    });
  });

  it("records explicit heuristic scoring only when AI scoring was not requested", async () => {
    const fetchImpl = async (input: string): Promise<Response> => {
      if (input.includes("/suzuki/samurai/")) return new Response(batLiveHtml("1988 Suzuki Samurai Convertible 5-Speed", "USD $4,890"));
      if (input.includes("carsandbids.com")) return new Response("<title>Just a moment...</title>");
      return new Response(`<div class="listings-live"></div><div class="auctions-completed"></div>`);
    };

    const result = await discoverAndScoreCandidates(
      context,
      { runId: "agent-run-heuristic-test", source: "manual", reason: "test" },
      { fetchImpl, now: new Date("2026-06-25T12:00:00Z") },
    );

    expect(result.aiScoring).toEqual({
      status: "skipped",
      provider: "heuristic",
      model: null,
      totalTokens: 0,
      costMicros: 0,
      message: "AI scoring was not requested; heuristic scoring was used.",
      scores: [],
    });
    expect(result.checkedSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "heuristic-scoring", site: "Beachcar heuristic scoring", status: "skipped" }),
      ]),
    );
  });

  it("refuses managed curation when AI Gateway scoring is unavailable", async () => {
    const fetchImpl = async (input: string): Promise<Response> => {
      if (input.includes("/suzuki/samurai/")) return new Response(batLiveHtml("1988 Suzuki Samurai Convertible 5-Speed", "USD $4,890"));
      if (input.includes("carsandbids.com")) return new Response("<title>Just a moment...</title>");
      return new Response(`<div class="listings-live"></div><div class="auctions-completed"></div>`);
    };

    await expect(
      discoverAndScoreCandidates(
        context,
        { runId: "agent-run-managed-without-ai", source: "manual", reason: "test" },
        { fetchImpl, now: new Date("2026-06-25T12:00:00Z"), requireAiScoring: true, allowPlaceholderFallback: false },
      ),
    ).rejects.toThrow("Managed curation is unavailable because AI Gateway is not configured");
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
              model: "openai/gpt-4.1-mini",
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

  it("keeps Hemmings seeds broad, high-intent, and search-free", () => {
    const pages = buildHemmingsSeedPages();
    const labels = pages.map((page) => page.label);

    expect(labels).toEqual(
      expect.arrayContaining([
        "Volkswagen Thing",
        "Volkswagen Type 2",
        "Suzuki Samurai",
        "Suzuki Sidekick",
        "Suzuki Vitara",
        "Suzuki Jimny",
        "Jeep CJ",
        "Jeep Wrangler",
        "Jeep Scrambler",
        "Ford Bronco",
        "Chevrolet Blazer",
        "Toyota 4Runner",
        "Honda Trail 90",
        "BMW Motorcycles",
      ]),
    );
    expect(pages.some((page) => page.categories.includes("4x4"))).toBe(true);
    expect(pages.some((page) => page.categories.includes("convertible"))).toBe(true);
    expect(pages.some((page) => page.categories.includes("motorcycle"))).toBe(true);
    expect(pages.some((page) => page.categories.includes("under-budget"))).toBe(true);
    expect(pages.every((page) => isAllowedHemmingsSeedUrl(page.url))).toBe(true);
    expect(pages.some((page) => page.url.includes("?") || page.url.includes("/search/"))).toBe(false);
    expect(new Set(pages.map((page) => page.url)).size).toBe(pages.length);
    expect(HEMMINGS_SEED_PAGES.every((page) => isAllowedHemmingsSeedUrl(page.url))).toBe(true);
  });

  it("derives Hemmings pages from source notes without query search URLs", () => {
    const pages = hemmingsPagesFromSourceNotes("CJ-8 Scrambler, Geo Tracker, VW bus, Honda Trail 90, BMW airhead");
    const labels = pages.map((page) => page.label);

    expect(labels).toEqual(expect.arrayContaining(["Jeep Scrambler", "Suzuki Sidekick", "Volkswagen Type 2", "Honda Trail 90", "BMW Motorcycles"]));
    expect(pages.every((page) => isAllowedHemmingsSeedUrl(page.url))).toBe(true);
  });

  it("parses Hemmings listing and detail fixtures", () => {
    const listings = parseHemmingsListingsPage(hemmingsListingsHtml(), {
      label: "Suzuki Samurai",
      url: "https://www.hemmings.com/classifieds/cars-for-sale/suzuki/samurai",
    });

    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({
      source: "hemmings",
      site: "Hemmings",
      sourceQuery: "Suzuki Samurai",
      title: "1987 Suzuki Samurai JX 4x4",
      url: "https://www.hemmings.com/classifieds/listing/1987-suzuki-samurai-jx-4x4",
      bid: "$12,500",
      bidNum: 12500,
      bidCents: 1250000,
      location: "Portland, ME",
      imageUrls: ["https://www.hemmings.com/images/samurai-card.jpg"],
    });

    const detail = parseHemmingsDetailPage(hemmingsDetailHtml());
    expect(detail).toMatchObject({
      location: "Charleston, South Carolina",
      imageUrls: expect.arrayContaining(["https://www.hemmings.com/images/samurai-detail.jpg"]),
      dossier: {
        summary: "Soft-top Samurai with recent service and beach-town scale.",
        specs: {
          odometer: "84,200 miles",
          transmission: "5-speed manual",
          seller: "Lowcountry Classics",
        },
      },
    });
  });

  it("discovers opt-in Hemmings listings and prefers detail-page location", async () => {
    const fetchImpl = async (input: string): Promise<Response> => {
      if (input.includes("/classifieds/listing/1987-suzuki-samurai-jx-4x4")) return new Response(hemmingsDetailHtml());
      if (input.includes("/suzuki/samurai")) return new Response(hemmingsListingsHtml());
      return new Response("<main>No matching Hemmings listings today.</main>");
    };

    const result = await discoverAndScoreCandidates(
      { ...context, enabledSources: ["hemmings"] },
      { runId: "agent-run-hemmings-test", source: "manual", reason: "test" },
      { fetchImpl, now: new Date("2026-06-25T12:00:00Z") },
    );

    expect(result.fallbackUsed).toBe(false);
    expect(result.checkedSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "hemmings", label: "Suzuki Samurai", status: "ok", candidateCount: 1 }),
        expect.objectContaining({
          source: "hemmings-detail",
          status: "ok",
          candidateCount: 1,
          detailAttempts: expect.objectContaining({ attempted: 1, enriched: 1 }),
        }),
      ]),
    );
    expect(result.listings[0]).toMatchObject({
      site: "Hemmings",
      title: "1987 Suzuki Samurai JX 4x4",
      location: "Charleston, South Carolina",
      locationCity: "Charleston",
      locationRegion: "South Carolina",
      locationStatus: "ok",
    });
    expect(result.listings[0]?.why).toContain("from Hemmings Suzuki Samurai");
    expect(result.listings[0]?.currentTake).toContain("$12,500 asking");
  });

  it("reports blocked opt-in Hemmings pages without silently omitting the source", async () => {
    const result = await discoverAndScoreCandidates(
      { ...context, enabledSources: ["hemmings"] },
      { runId: "agent-run-hemmings-blocked-test", source: "manual", reason: "test" },
      { fetchImpl: async () => new Response("<title>Just a moment...</title>"), now: new Date("2026-06-25T12:00:00Z") },
    );

    expect(result.blockedSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "hemmings",
          status: "blocked",
        }),
      ]),
    );
    expect(result.fallbackUsed).toBe(true);
  });

  it("honors Hemmings maxSeedPages source setting", async () => {
    const fetched: string[] = [];
    const result = await discoverAndScoreCandidates(
      {
        ...context,
        enabledSources: ["hemmings"],
        sourceSettings: [{ source: "hemmings", enabled: true, settings: { maxSeedPages: 1 } }],
      },
      { runId: "agent-run-hemmings-limit-test", source: "manual", reason: "test" },
      {
        fetchImpl: async (input) => {
          fetched.push(String(input));
          return new Response("<title>Just a moment...</title>");
        },
        now: new Date("2026-06-25T12:00:00Z"),
      },
    );

    expect(fetched).toEqual(["https://www.hemmings.com/classifieds/cars-for-sale/volkswagen/thing"]);
    expect(result.checkedSources.filter((check) => check.source === "hemmings")).toHaveLength(1);
    expect(result.blockedSources).toContainEqual(expect.objectContaining({ source: "hemmings", status: "blocked" }));
  });

  it("classifies Hemmings 403 challenge responses as blocked", async () => {
    const result = await discoverAndScoreCandidates(
      { ...context, enabledSources: ["hemmings"] },
      { runId: "agent-run-hemmings-403-test", source: "manual", reason: "test" },
      {
        fetchImpl: async () =>
          new Response("<title>Just a moment...</title>", {
            status: 403,
            headers: { "cf-mitigated": "challenge" },
          }),
        now: new Date("2026-06-25T12:00:00Z"),
      },
    );

    expect(result.blockedSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "hemmings",
          status: "blocked",
          blockedUrls: expect.arrayContaining(["https://www.hemmings.com/classifieds/cars-for-sale/suzuki/samurai"]),
        }),
      ]),
    );
    expect(result.checkedSources).toContainEqual(
      expect.objectContaining({
        source: "hemmings",
        status: "blocked",
        message: expect.stringContaining("bot/access challenge"),
      }),
    );
  });
});

function hemmingsListingsHtml(): string {
  return `
    <main>
      <article class="classified-card vehicle-card">
        <a href="/classifieds/listing/1987-suzuki-samurai-jx-4x4">
          <img src="/images/samurai-card.jpg" alt="1987 Suzuki Samurai JX 4x4" />
          <h3>1987 Suzuki Samurai JX 4x4</h3>
        </a>
        <span class="listing-price">$12,500</span>
        <span class="vehicle-location">Portland, ME</span>
        <p class="summary">Soft-top small 4x4 with manual transmission and simple beach-town scale.</p>
      </article>
    </main>
  `;
}

function hemmingsDetailHtml(): string {
  return `
    <html>
      <head>
        <meta property="og:description" content="Soft-top Samurai with recent service and beach-town scale." />
        <meta property="og:image" content="https://www.hemmings.com/images/samurai-detail.jpg" />
        <script type="application/ld+json">
          {
            "@type": "Vehicle",
            "name": "1987 Suzuki Samurai JX 4x4",
            "description": "Soft-top Samurai with recent service and beach-town scale.",
            "image": ["https://www.hemmings.com/images/samurai-detail.jpg"],
            "address": {
              "addressLocality": "Charleston",
              "addressRegion": "South Carolina"
            }
          }
        </script>
      </head>
      <body>
        <dl>
          <dt>Location</dt><dd>Charleston, South Carolina</dd>
          <dt>Odometer</dt><dd>84,200 miles</dd>
          <dt>Transmission</dt><dd>5-speed manual</dd>
          <dt>Seller</dt><dd>Lowcountry Classics</dd>
        </dl>
        <div class="description">
          <p>This Suzuki Samurai wears a soft top and has the right size for short beach errands.</p>
          <p>Recent work includes tires, fluids, and a carburetor service.</p>
        </div>
      </body>
    </html>
  `;
}

function batLiveHtml(title: string, bid: string, location = "Downey, CA"): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const url = `https://bringatrailer.com/listing/${slug}/`;
  return `
    <div class="listings-live page-section">
      ${batLiveCard(title, bid, location, url)}
    </div>
    <div class="auctions-completed page-section"></div>
  `;
}

function batCurrentLiveHtml(): string {
  return `
    <script type="text/javascript" id="bat-theme-auctions-current-initial-data">
      var auctionsCurrentInitialData = {"items":[{
        "active":true,
        "comments":12,
        "country":"United States",
        "current_bid":8295,
        "current_bid_formatted":"USD $8,295",
        "excerpt":"Open-air beach-town runabout with &lt;strong&gt;simple mechanicals&lt;/strong&gt;.",
        "noreserve":true,
        "thumbnail_url":"https:\/\/bringatrailer.com\/wp-content\/uploads\/2026\/07\/thing.jpg?w=470&h=318&crop=1",
        "timestamp_end":1784739600,
        "title":"1974 Volkswagen Thing",
        "url":"https:\/\/bringatrailer.com\/listing\/1974-volkswagen-thing\/"
      }]};
      /* ]]> */
    </script>
  `;
}

function batLiveCard(title: string, bid: string, location: string, url: string): string {
  return `
    <div class="listing-card listing-card-separate featured-listing-card"
      data-listing_id="116381630"
      data-timestamp_end="1782932400">
      <div class="thumbnail">
        <img src="https://bringatrailer.com/wp-content/uploads/2026/06/1974_thing.jpg?w=470&#038;h=318&#038;crop=1" alt="${title}" />
        <a class="image-overlay" href="${url}" title="${title}"></a>
      </div>
      <div class="content-main">
        <h3><a href="${url}">${title}</a></h3>
        <div class="item-location">${location}</div>
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
