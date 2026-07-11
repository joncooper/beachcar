import { describe, expect, it } from "vitest";
import { imageKeyFor, inferTags, listingKeyFor, normalizeAction, normalizeListing, r2KeyFor } from "../src/shared/normalize";

describe("listing normalization", () => {
  it("defaults sparse imported listings safely", () => {
    expect(normalizeListing({ title: "1974 VW Thing" })).toMatchObject({
      section: "Worth a look",
      lane: "family",
      site: "Unknown",
      title: "1974 VW Thing",
      bid: "Check listing",
      total: "Check listing",
      images: [],
    });
  });

  it("creates stable listing and image keys", async () => {
    const first = await listingKeyFor("BaT", "https://bringatrailer.com/listing/thing/", "VW Thing");
    const second = await listingKeyFor("BaT", "https://bringatrailer.com/listing/thing/", "VW Thing");
    const image = await imageKeyFor(first, "https://example.com/photo.jpg");

    expect(first).toBe(second);
    expect(first).toMatch(/^bat-vw-thing-[a-f0-9]{14}$/);
    expect(image).toContain(first);
  });

  it("chooses useful preference steering tags", () => {
    expect(
      inferTags({
        title: "Modified 1974 Volkswagen Thing",
        why: "open-air beach-town car",
        concerns: "seat belts",
        lane: "family",
        section: "Strong fits",
      }),
    ).toEqual(expect.arrayContaining(["family", "pure beach buggy"]));
  });

  it("maps image content types into R2 object extensions", () => {
    expect(r2KeyFor("abc", "image/jpeg")).toBe("listing-images/abc.jpg");
    expect(r2KeyFor("abc", "image/webp; charset=utf-8")).toBe("listing-images/abc.webp");
    expect(r2KeyFor("abc")).toBe("listing-images/abc.bin");
  });

  it("normalizes structured location metadata from a display location", () => {
    const listing = normalizeListing({
      title: "1974 VW Thing",
      location: "Charleston, South Carolina",
      missingData: ["price", "location"],
    });

    expect(listing).toMatchObject({
      location: "Charleston, South Carolina",
      locationRaw: "Charleston, South Carolina",
      locationCity: "Charleston",
      locationRegion: "South Carolina",
      locationStatus: "ok",
      missingData: ["price"],
    });
  });

  it("preserves explicit bid cents and derives them from bid dollars when needed", () => {
    expect(
      normalizeListing({
        title: "1974 VW Thing",
        bid: "$8,295",
        bidNum: 8295,
        bidCents: 829550,
      }),
    ).toMatchObject({ bidNum: 8295, bidCents: 829550 });

    expect(
      normalizeListing({
        title: "1988 Suzuki Samurai",
        bid: "$7,800",
        bidNum: 7800,
      }),
    ).toMatchObject({ bidNum: 7800, bidCents: 780000 });
  });

  it("normalizes US city/state/ZIP source locations", () => {
    const listing = normalizeListing({
      site: "Cars & Bids",
      title: "1999 Suzuki Jimny 4x4",
      url: "https://carsandbids.com/auctions/9l056Wwm/1999-suzuki-jimny-4x4",
      location: "Ceres, CA 95307",
    });

    expect(listing).toMatchObject({
      location: "Ceres, CA 95307",
      locationRaw: "Ceres, CA 95307",
      locationCity: "Ceres",
      locationRegion: "CA",
      locationCountry: "US",
      locationStatus: "ok",
    });
  });

  it("marks location missing when no displayable source location exists", () => {
    const listing = normalizeListing({
      title: "1974 VW Thing",
      location: "check listing",
    });

    expect(listing.location).toBeUndefined();
    expect(listing.locationStatus).toBe("missing");
    expect(listing.missingData).toEqual(["location"]);
  });

  it("keeps Cars & Bids galleries from mixing media roots", () => {
    const listing = normalizeListing({
      site: "Cars & Bids",
      title: "2018 Jeep Wrangler Sport 4x4",
      url: "https://carsandbids.com/auctions/rb2ZbLgQ/2018-jeep-wrangler-sport-4x4",
      images: [
        "https://media.carsandbids.com/1477bbe21e8d6b5e719c7c3ccab577fd47dd8cc3/photos/JeepWranglerSport2018008/edit/xfo2A.jpg?t=178083241823",
        "https://media.carsandbids.com/cdn-cgi/image/width=768,quality=70/1477bbe21e8d6b5e719c7c3ccab577fd47dd8cc3/photos/JeepWranglerSport2018008/edit/xfo2A.jpg?t=178083241823",
        "https://media.carsandbids.com/cdn-cgi/image/width=768,quality=70/1477bbe21e8d6b5e719c7c3ccab577fd47dd8cc3/photos/JeepWrangler2016026/edit/rmKP6.jpg?t=178184341443",
        "https://media.carsandbids.com/cdn-cgi/image/width=768,quality=70/bd307a3ec329e10a2cff8fb87480823da114f8f4/photos/application/s-WLhynrr.jpg?t=178088938643",
        "https://media.carsandbids.com/cdn-cgi/image/width=768,quality=70/8e6341e27a680ffab7d98e42bef83b0dd1b0fb94/photos/exterior/KYyjweZE-Hwh4MzQ/edit/Kcqhx.jpg?t=178062444668",
      ],
    });

    expect(listing.images).toEqual([
      "https://media.carsandbids.com/1477bbe21e8d6b5e719c7c3ccab577fd47dd8cc3/photos/JeepWranglerSport2018008/edit/xfo2A.jpg?t=178083241823",
    ]);
  });

  it("accepts the full feedback action set", () => {
    expect(normalizeAction("like")).toBe("like");
    expect(normalizeAction("star")).toBe("star");
    expect(normalizeAction("hide")).toBe("hide");
    expect(normalizeAction("avoid")).toBe("avoid");
    expect(normalizeAction("pass")).toBeNull();
  });
});

describe("dossier normalization", () => {
  it("preserves a valid dossier, clamps valueScore, and drops invalid sub-fields", () => {
    const listing = normalizeListing({
      title: "1974 VW Thing",
      comments: 21,
      dossier: {
        summary: "Open-air Thing.",
        specs: { engine: "1.6L flat-4", seller: "lowcountry_air", junk: 5 },
        listing: ["Para 1.", "Para 2.", 99],
        equipment: ["New top"],
        service: ["2024 — new top"],
        bidLog: [
          { bidder: "a", amount: "$8,500", ago: "2h" },
          { bidder: "b" },
        ],
        comments: [
          { user: "x", body: "hi", seller: true },
          { body: "no user" },
        ],
        beachUse: { body: "Open 2WD", location: "Charleston, SC" },
        valueScore: 1.8,
      },
    } as never);

    expect(listing.dossier).toEqual({
      summary: "Open-air Thing.",
      specs: { engine: "1.6L flat-4", seller: "lowcountry_air" },
      listing: ["Para 1.", "Para 2."],
      equipment: ["New top"],
      service: ["2024 — new top"],
      bidLog: [{ bidder: "a", amount: "$8,500", ago: "2h" }],
      comments: [{ user: "x", body: "hi", seller: true }],
      beachUse: { body: "Open 2WD", location: "Charleston, SC" },
      valueScore: 1,
    });
    // The top-level comments count is independent of dossier.comments[].
    expect(listing.comments).toBe(21);
  });

  it("drops an empty, non-object, or all-invalid dossier to undefined", () => {
    expect(normalizeListing({ title: "x" }).dossier).toBeUndefined();
    expect(normalizeListing({ title: "x", dossier: {} } as never).dossier).toBeUndefined();
    expect(normalizeListing({ title: "x", dossier: "nope" } as never).dossier).toBeUndefined();
    expect(normalizeListing({ title: "x", dossier: { specs: { junk: 1 }, bidLog: [{}] } } as never).dossier).toBeUndefined();
  });
});
