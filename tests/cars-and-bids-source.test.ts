import { describe, expect, it } from "vitest";
import {
  carsAndBidsPaginationUrlsFromApiRecord,
  carsAndBidsOutputStatus,
  extractCarsAndBidsLocationFromText,
  extractCarsAndBidsDetailFromBrowser,
  extractCarsAndBidsListingsFromBrowser,
  extractCarsAndBidsListingsFromJson,
  isCarsAndBidsClosedStatus,
  looksLikeCarsAndBidsBlockedPage,
  rankCarsAndBidsCandidates,
  toCarsAndBidsListing,
} from "../src/worker/sources/cars-and-bids";

describe("Cars & Bids source helpers", () => {
  it("extracts normalized candidates from auction API-shaped JSON", () => {
    const candidates = extractCarsAndBidsListingsFromJson({
      data: {
        auctions: [
          {
            id: "abc123",
            slug: "1995-suzuki-samurai-4x4",
            title: "1995 Suzuki Samurai 4x4",
            currentBid: "$7,250",
            city: "Portland",
            state: "ME",
            endTime: "2026-07-12T17:00:00-04:00",
            bidCount: 14,
            commentCount: 9,
            photos: [
              { baseUrl: "media.carsandbids.com", path: "root/photos/exterior/main.jpg" },
              { url: "https://media.carsandbids.com/root/photos/interior/seat.jpg" },
            ],
          },
        ],
      },
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        title: "1995 Suzuki Samurai 4x4",
        url: "https://carsandbids.com/auctions/abc123/1995-suzuki-samurai-4x4",
        bidNum: 7250,
        bidCents: 725000,
        location: "Portland, ME",
        endsAt: "2026-07-12T21:00:00.000Z",
        bids: 14,
        comments: 9,
        images: expect.arrayContaining(["https://media.carsandbids.com/root/photos/exterior/main.jpg"]),
      }),
    ]);
  });

  it("shapes listings with location metadata and a coherent gallery group", () => {
    const listing = toCarsAndBidsListing(
      {
        title: "1995 Suzuki Samurai 4x4",
        url: "https://carsandbids.com/auctions/abc123/1995-suzuki-samurai-4x4?utm=test",
        bidNum: 7250,
        location: "Portland, ME",
        endsAt: "2026-07-12T21:00:00.000Z",
        images: [
          "https://media.carsandbids.com/root-a/photos/exterior/main.jpg?t=1",
          "https://media.carsandbids.com/root-a/photos/exterior/rear.jpg?t=2",
          "https://media.carsandbids.com/root-b/photos/interior/seat.jpg?t=3",
          "https://media.carsandbids.com/application/photos/banner.jpg?t=4",
        ],
      },
      { maxImages: 5, now: new Date("2026-07-11T21:00:00.000Z") },
    );

    expect(listing).toMatchObject({
      site: "Cars & Bids",
      title: "1995 Suzuki Samurai 4x4",
      url: "https://carsandbids.com/auctions/abc123/1995-suzuki-samurai-4x4",
      bid: "$7,250",
      total: "$7,613",
      bidCents: 725000,
      location: "Portland, ME",
      locationRaw: "Portland, ME",
      locationCity: "Portland",
      locationRegion: "ME",
      locationCountry: "US",
      locationStatus: "ok",
      timeLeft: "1 day, 0h",
    });
    expect(listing.missingData).toBeUndefined();
    expect(listing.images).toEqual([
      "https://media.carsandbids.com/root-a/photos/exterior/main.jpg?t=1",
      "https://media.carsandbids.com/root-a/photos/exterior/rear.jpg?t=2",
    ]);
  });

  it("marks location missing instead of publishing a silent placeholder", () => {
    const listing = toCarsAndBidsListing({
      title: "1995 Suzuki Samurai 4x4",
      url: "https://carsandbids.com/auctions/abc123/1995-suzuki-samurai-4x4",
    });

    expect(listing.location).toBeUndefined();
    expect(listing.locationStatus).toBe("missing");
    expect(listing.missingData).toEqual(["location"]);
  });

  it("extracts listing locations from Cars & Bids page text", () => {
    expect(
      extractCarsAndBidsLocationFromText(`
        Seller
        private party
        Location
        Kerrville, TX 78028
        Listing Details
      `),
    ).toBe("Kerrville, TX 78028");
    expect(extractCarsAndBidsLocationFromText("This auction is located in Portland, ME and ends Tuesday.")).toBe("Portland, ME");
  });

  it("extracts discovery candidates from browser DOM", () => {
    const listings = withDocument(
      fakeDiscoveryDocument(),
      () => extractCarsAndBidsListingsFromBrowser(),
    );

    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({
      title: "1995 Suzuki Samurai 4x4",
      url: "https://carsandbids.com/auctions/abc123/1995-suzuki-samurai-4x4",
      cardText: expect.stringContaining("Kerrville, TX 78028"),
      images: expect.arrayContaining(["https://media.carsandbids.com/root/photos/exterior/main.jpg"]),
    });
  });

  it("extracts detail title, text, and gallery images from browser DOM", () => {
    const detail = withDocument(
      fakeDetailDocument(),
      () => extractCarsAndBidsDetailFromBrowser(),
    );

    expect(detail).toMatchObject({
      title: "2020 Jeep Wrangler Unlimited Rubicon 4x4",
      pageText: expect.stringContaining("Kerrville, TX 78028"),
      images: ["https://media.carsandbids.com/root/photos/exterior/main.jpg"],
    });
  });

  it("reports empty and blocked statuses honestly", () => {
    expect(carsAndBidsOutputStatus([])).toBe("empty");
    expect(carsAndBidsOutputStatus([{}])).toBe("ok");
    expect(carsAndBidsOutputStatus([], "blocked")).toBe("blocked");
    expect(carsAndBidsOutputStatus([], "garbage" as never)).toBe("empty");
    expect(isCarsAndBidsClosedStatus("sold_after")).toBe(true);
    expect(isCarsAndBidsClosedStatus("live")).toBe(false);
  });

  it("detects Cars & Bids challenge pages without relying on the scraper script", () => {
    expect(
      looksLikeCarsAndBidsBlockedPage({
        title: "Just a moment...",
        body: "Checking your browser before accessing Cars & Bids. Verify you are human.",
      }),
    ).toBe(true);
    expect(looksLikeCarsAndBidsBlockedPage("Access denied Request blocked by Cloudflare")).toBe(true);
    expect(looksLikeCarsAndBidsBlockedPage({ title: "Cars & Bids", body: "2020 Jeep Wrangler Unlimited Rubicon 4x4" })).toBe(false);
  });

  it("derives bounded signed API offset URLs from partial Cars & Bids responses", () => {
    const urls = carsAndBidsPaginationUrlsFromApiRecord(
      "https://carsandbids.com/v2/autos/auctions?search=wrangler&limit=30&status=closed&page=1&timestamp=123&signature=abc",
      { count: 30, total: 95, auctions: Array.from({ length: 30 }) },
      2,
    );

    expect(urls).toEqual([
      "https://carsandbids.com/v2/autos/auctions?search=wrangler&limit=30&status=closed&timestamp=123&signature=abc&offset=30",
      "https://carsandbids.com/v2/autos/auctions?search=wrangler&limit=30&status=closed&timestamp=123&signature=abc&offset=60",
    ]);
    expect(carsAndBidsPaginationUrlsFromApiRecord("https://carsandbids.com/v2/autos/auctions?search=wrangler", { count: 3, total: 3 }, 4)).toEqual([]);
    expect(carsAndBidsPaginationUrlsFromApiRecord("not a url", { count: 30, total: 90 }, 4)).toEqual([]);
  });

  it("filters closed candidates unless comps are explicitly included", () => {
    const candidates = [
      { title: "1995 Suzuki Samurai 4x4", url: "https://carsandbids.com/auctions/a/samurai", status: "live", bidNum: 7000 },
      { title: "1994 Suzuki Samurai 4x4", url: "https://carsandbids.com/auctions/b/samurai", status: "sold", bidNum: 8000 },
    ];

    expect(rankCarsAndBidsCandidates(candidates).map((candidate) => candidate.url)).toEqual([
      "https://carsandbids.com/auctions/a/samurai",
    ]);
    expect(rankCarsAndBidsCandidates(candidates, { includeClosed: true }).map((candidate) => candidate.url)).toEqual([
      "https://carsandbids.com/auctions/a/samurai",
      "https://carsandbids.com/auctions/b/samurai",
    ]);
  });
});

function withDocument<T>(document: unknown, run: () => T): T {
  const hadDocument = Object.prototype.hasOwnProperty.call(globalThis, "document");
  const previousDocument = (globalThis as { document?: unknown }).document;
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  try {
    return run();
  } finally {
    if (hadDocument) Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    else Reflect.deleteProperty(globalThis, "document");
  }
}

function fakeDiscoveryDocument(): unknown {
  const mediaImage = { currentSrc: "", src: "https://media.carsandbids.com/root/photos/exterior/main.jpg" };
  const logoImage = { currentSrc: "", src: "https://static.carsandbids.com/application/logo.png" };
  const card = {
    innerText: "1995 Suzuki Samurai 4x4 Location Kerrville, TX 78028 Current Bid $7,250",
    textContent: "1995 Suzuki Samurai 4x4 Location Kerrville, TX 78028 Current Bid $7,250",
    querySelectorAll: (selector: string) => (selector === "img" ? [mediaImage, logoImage] : []),
  };
  const link = {
    href: "https://carsandbids.com/auctions/abc123/1995-suzuki-samurai-4x4",
    textContent: "1995 Suzuki Samurai 4x4",
    parentElement: card,
  };
  return {
    querySelectorAll: (selector: string) => (selector === 'a[href*="/auctions/"]' ? [link] : []),
  };
}

function fakeDetailDocument(): unknown {
  const images = [
    { currentSrc: "", src: "https://media.carsandbids.com/root/photos/exterior/main.jpg" },
    { currentSrc: "", src: "https://example.com/not-cab.jpg" },
  ];
  return {
    title: "2020 Jeep Wrangler Unlimited Rubicon 4x4 | Cars & Bids",
    body: { textContent: "2020 Jeep Wrangler Unlimited Rubicon 4x4 Seller Location Kerrville, TX 78028" },
    querySelector: (selector: string) => (selector === "h1" ? { textContent: "2020 Jeep Wrangler Unlimited Rubicon 4x4" } : null),
    querySelectorAll: (selector: string) => (selector === "img" ? images : []),
  };
}
