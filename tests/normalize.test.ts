import { describe, expect, it } from "vitest";
import { imageKeyFor, inferTags, listingKeyFor, normalizeListing, r2KeyFor } from "../src/shared/normalize";

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
});
