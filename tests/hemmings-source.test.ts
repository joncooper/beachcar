import { describe, expect, it } from "vitest";
import {
  looksLikeHemmingsBlockedPage,
  parseHemmingsDetailPage,
  parseHemmingsListingsPage,
  toHemmingsListing,
} from "../src/worker/sources/hemmings";

describe("Hemmings source helpers", () => {
  it("shapes parsed Hemmings candidates into runner-mergeable listings with location metadata", () => {
    const [candidate] = parseHemmingsListingsPage(
      `
        <article class="classified-card vehicle-card">
          <a href="/classifieds/listing/1987-suzuki-samurai-jx-4x4">
            <img src="/images/samurai-card.jpg" alt="1987 Suzuki Samurai JX 4x4" />
            <h3>1987 Suzuki Samurai JX 4x4</h3>
          </a>
          <span class="listing-price">$12,500</span>
          <span class="vehicle-location">Portland, ME</span>
          <p class="summary">Soft-top small 4x4 with manual transmission and simple beach-town scale.</p>
        </article>
      `,
      { label: "Suzuki Samurai", url: "https://www.hemmings.com/classifieds/cars-for-sale/suzuki/samurai" },
    );

    const detail = parseHemmingsDetailPage(`
      <meta property="og:description" content="Soft-top Samurai with recent service and beach-town scale." />
      <dl>
        <dt>Location</dt><dd>Charleston, South Carolina</dd>
        <dt>Odometer</dt><dd>84,200 miles</dd>
        <dt>Transmission</dt><dd>5-speed manual</dd>
      </dl>
    `);
    const listing = toHemmingsListing({
      ...candidate,
      location: detail.location,
      dossier: detail.dossier,
      imageUrls: [...candidate.imageUrls, ...(detail.imageUrls || [])],
    });

    expect(listing).toMatchObject({
      site: "Hemmings",
      title: "1987 Suzuki Samurai JX 4x4",
      url: "https://www.hemmings.com/classifieds/listing/1987-suzuki-samurai-jx-4x4",
      bid: "$12,500",
      bidNum: 12500,
      bidCents: 1250000,
      location: "Charleston, South Carolina",
      locationRaw: "Charleston, South Carolina",
      locationCity: "Charleston",
      locationRegion: "South Carolina",
      locationStatus: "ok",
      lane: "family",
    });
    expect(listing.missingData).toBeUndefined();
  });

  it("marks missing Hemmings location explicitly", () => {
    const listing = toHemmingsListing({
      source: "hemmings",
      site: "Hemmings",
      sourceQuery: "Mini Moke",
      title: "1967 Mini Moke",
      url: "https://www.hemmings.com/classifieds/listing/1967-mini-moke",
      bid: "Check listing",
      total: "Check listing",
      timeLeft: "check listing",
      bids: "check listing",
      bidders: "check listing",
      comments: "check listing",
      imageUrls: [],
      summary: "",
      sourceUrl: "https://www.hemmings.com/classifieds/cars-for-sale/mini/moke",
    });

    expect(listing.location).toBeUndefined();
    expect(listing.locationStatus).toBe("missing");
    expect(listing.missingData).toEqual(["location"]);
  });

  it("does not treat Hemmings category pages as listing candidates", () => {
    const listings = parseHemmingsListingsPage(
      `
        <div class="vehicle-card">
          <a href="https://www.hemmings.com/classifieds/cars-for-sale/volkswagen/thing">Volkswagen Thing category</a>
          <img src="https://www.hemmings.com/images/category.jpg" alt="Volkswagen Thing" />
        </div>
        <article class="classified-card">
          <a href="/classifieds/listing/1974-volkswagen-thing">
            <img src="/images/thing.jpg" alt="1974 Volkswagen Thing" />
            <h3>1974 Volkswagen Thing</h3>
          </a>
          <span class="vehicle-location">Charleston, SC</span>
        </article>
        <script type="application/ld+json">
          {"@type":"CollectionPage","name":"Volkswagen Thing","url":"https://www.hemmings.com/classifieds/cars-for-sale/volkswagen/thing"}
        </script>
      `,
      { label: "Volkswagen Thing", url: "https://www.hemmings.com/classifieds/cars-for-sale/volkswagen/thing" },
    );

    expect(listings).toHaveLength(1);
    expect(listings[0]?.url).toBe("https://www.hemmings.com/classifieds/listing/1974-volkswagen-thing");
  });

  it("detects Hemmings challenge pages for runner blocked status", () => {
    expect(looksLikeHemmingsBlockedPage({ title: "Just a moment...", body: "Checking your browser before accessing Hemmings." })).toBe(true);
    expect(looksLikeHemmingsBlockedPage("Attention Required! Cloudflare Verify you are human")).toBe(true);
    expect(looksLikeHemmingsBlockedPage({ title: "Hemmings", body: "1987 Suzuki Samurai JX 4x4 Portland, ME" })).toBe(false);
  });
});
