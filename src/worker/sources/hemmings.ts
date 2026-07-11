import type { AuctionListing, Lane, LocationStatus, ShadeDossierData } from "../../shared/types";
import { normalizeLocationMetadata } from "../../shared/normalize";
import type { CandidateDetailEnrichment, SourceCandidate } from "./types";

export type HemmingsSeedCategory = "4x4" | "convertible" | "microbus" | "motorcycle" | "small-runabout" | "under-budget";

export type HemmingsSeedPage = {
  label: string;
  url: string;
  categories: HemmingsSeedCategory[];
};

export type HemmingsCandidateListing = Partial<AuctionListing>;

export interface HemmingsListingOptions {
  maxImages?: number;
}

export const HEMMINGS_SEED_PAGES: HemmingsSeedPage[] = [
  hemmingsSeed("Volkswagen Thing", "cars-for-sale/volkswagen/thing", ["convertible", "small-runabout", "under-budget"]),
  hemmingsSeed("Volkswagen Type 2", "cars-for-sale/volkswagen/type-2", ["microbus"]),
  hemmingsSeed("Volkswagen Beetle", "cars-for-sale/volkswagen/beetle", ["convertible", "small-runabout"]),
  hemmingsSeed("Citroen Mehari", "cars-for-sale/citroen/mehari", ["convertible", "small-runabout", "under-budget"]),
  hemmingsSeed("Mini Moke", "cars-for-sale/mini/moke", ["convertible", "small-runabout"]),
  hemmingsSeed("Suzuki Samurai", "cars-for-sale/suzuki/samurai", ["4x4", "small-runabout", "under-budget"]),
  hemmingsSeed("Suzuki Sidekick", "cars-for-sale/suzuki/sidekick", ["4x4", "small-runabout", "under-budget"]),
  hemmingsSeed("Suzuki Vitara", "cars-for-sale/suzuki/vitara", ["4x4", "small-runabout", "under-budget"]),
  hemmingsSeed("Suzuki Jimny", "cars-for-sale/suzuki/jimny", ["4x4", "small-runabout", "under-budget"]),
  hemmingsSeed("Jeep CJ", "cars-for-sale/jeep/cj", ["4x4", "convertible"]),
  hemmingsSeed("Jeep Wrangler", "cars-for-sale/jeep/wrangler", ["4x4", "convertible"]),
  hemmingsSeed("Jeep Scrambler", "cars-for-sale/jeep/scrambler", ["4x4", "convertible"]),
  hemmingsSeed("Ford Bronco", "cars-for-sale/ford/bronco", ["4x4", "convertible"]),
  hemmingsSeed("Chevrolet Blazer", "cars-for-sale/chevrolet/blazer", ["4x4", "convertible"]),
  hemmingsSeed("Toyota Land Cruiser", "cars-for-sale/toyota/land-cruiser", ["4x4", "convertible"]),
  hemmingsSeed("Toyota 4Runner", "cars-for-sale/toyota/4runner", ["4x4", "convertible"]),
  hemmingsSeed("International Scout", "cars-for-sale/international/scout", ["4x4", "convertible"]),
  hemmingsSeed("Honda Trail 90", "motorcycles-for-sale/honda/trail-90", ["motorcycle", "small-runabout", "under-budget"]),
  hemmingsSeed("Honda CT90", "motorcycles-for-sale/honda/ct90", ["motorcycle", "small-runabout", "under-budget"]),
  hemmingsSeed("Honda CT110", "motorcycles-for-sale/honda/ct110", ["motorcycle", "small-runabout", "under-budget"]),
  hemmingsSeed("Honda Monkey", "motorcycles-for-sale/honda/monkey", ["motorcycle", "small-runabout", "under-budget"]),
  hemmingsSeed("Honda Grom", "motorcycles-for-sale/honda/grom", ["motorcycle", "small-runabout", "under-budget"]),
  hemmingsSeed("BMW Motorcycles", "motorcycles-for-sale/bmw", ["motorcycle"]),
];

const HEMMINGS_NOTE_SEEDS: Array<{ terms: RegExp; page: HemmingsSeedPage }> = [
  { terms: /\b(?:westfalia|vw\s+bus|type\s*2|camper)\b/i, page: hemmingsSeed("Volkswagen Type 2", "cars-for-sale/volkswagen/type-2", ["microbus"]) },
  { terms: /\b(?:thing|type\s*181)\b/i, page: hemmingsSeed("Volkswagen Thing", "cars-for-sale/volkswagen/thing", ["convertible", "small-runabout", "under-budget"]) },
  { terms: /\b(?:beetle|bug)\b/i, page: hemmingsSeed("Volkswagen Beetle", "cars-for-sale/volkswagen/beetle", ["convertible", "small-runabout"]) },
  { terms: /\b(?:mehari|citroen)\b/i, page: hemmingsSeed("Citroen Mehari", "cars-for-sale/citroen/mehari", ["convertible", "small-runabout", "under-budget"]) },
  { terms: /\b(?:moke)\b/i, page: hemmingsSeed("Mini Moke", "cars-for-sale/mini/moke", ["convertible", "small-runabout"]) },
  { terms: /\b(?:samurai)\b/i, page: hemmingsSeed("Suzuki Samurai", "cars-for-sale/suzuki/samurai", ["4x4", "small-runabout", "under-budget"]) },
  { terms: /\b(?:sidekick|tracker|vitara)\b/i, page: hemmingsSeed("Suzuki Sidekick", "cars-for-sale/suzuki/sidekick", ["4x4", "small-runabout", "under-budget"]) },
  { terms: /\b(?:jimny)\b/i, page: hemmingsSeed("Suzuki Jimny", "cars-for-sale/suzuki/jimny", ["4x4", "small-runabout", "under-budget"]) },
  { terms: /\b(?:cj-?8|scrambler)\b/i, page: hemmingsSeed("Jeep Scrambler", "cars-for-sale/jeep/scrambler", ["4x4", "convertible"]) },
  { terms: /\b(?:cj-?5|cj-?7|jeep\s+cj)\b/i, page: hemmingsSeed("Jeep CJ", "cars-for-sale/jeep/cj", ["4x4", "convertible"]) },
  { terms: /\b(?:wrangler|yj|tj)\b/i, page: hemmingsSeed("Jeep Wrangler", "cars-for-sale/jeep/wrangler", ["4x4", "convertible"]) },
  { terms: /\b(?:bronco)\b/i, page: hemmingsSeed("Ford Bronco", "cars-for-sale/ford/bronco", ["4x4", "convertible"]) },
  { terms: /\b(?:blazer|k5)\b/i, page: hemmingsSeed("Chevrolet Blazer", "cars-for-sale/chevrolet/blazer", ["4x4", "convertible"]) },
  { terms: /\b(?:land\s+cruiser|fj40|fj\s*40)\b/i, page: hemmingsSeed("Toyota Land Cruiser", "cars-for-sale/toyota/land-cruiser", ["4x4", "convertible"]) },
  { terms: /\b(?:4runner|4\s*runner)\b/i, page: hemmingsSeed("Toyota 4Runner", "cars-for-sale/toyota/4runner", ["4x4", "convertible"]) },
  { terms: /\b(?:scout|international\s+harvester)\b/i, page: hemmingsSeed("International Scout", "cars-for-sale/international/scout", ["4x4", "convertible"]) },
  { terms: /\b(?:trail\s*90|ct90)\b/i, page: hemmingsSeed("Honda Trail 90", "motorcycles-for-sale/honda/trail-90", ["motorcycle", "small-runabout", "under-budget"]) },
  { terms: /\b(?:ct110|trail\s*110)\b/i, page: hemmingsSeed("Honda CT110", "motorcycles-for-sale/honda/ct110", ["motorcycle", "small-runabout", "under-budget"]) },
  { terms: /\b(?:monkey|grom)\b/i, page: hemmingsSeed("Honda Grom", "motorcycles-for-sale/honda/grom", ["motorcycle", "small-runabout", "under-budget"]) },
  { terms: /\b(?:bmw|airhead|r\s*series|r75|r80|r100)\b/i, page: hemmingsSeed("BMW Motorcycles", "motorcycles-for-sale/bmw", ["motorcycle"]) },
];

export function buildHemmingsSeedPages(options: { sourceNotes?: string; limit?: number } = {}): HemmingsSeedPage[] {
  const limit = Math.max(1, Math.min(48, options.limit || 32));
  return dedupeHemmingsSeedPages([...HEMMINGS_SEED_PAGES, ...hemmingsPagesFromSourceNotes(options.sourceNotes || "")]).slice(0, limit);
}

export function hemmingsPagesFromSourceNotes(sourceNotes: string): HemmingsSeedPage[] {
  if (!sourceNotes.trim()) return [];
  return HEMMINGS_NOTE_SEEDS.filter((seed) => seed.terms.test(sourceNotes)).map((seed) => seed.page);
}

export function isAllowedHemmingsSeedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "www.hemmings.com" || url.search || url.hash) return false;
    if (/(^|\/)search(\/|$)/i.test(url.pathname)) return false;
    return /^\/classifieds\/(?:cars-for-sale|motorcycles-for-sale)(?:\/[a-z0-9-]+){0,2}\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function dedupeHemmingsSeedPages(pages: HemmingsSeedPage[]): HemmingsSeedPage[] {
  const out: HemmingsSeedPage[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    const url = normalizeHemmingsUrl(page.url);
    if (!url || seen.has(url) || !isAllowedHemmingsSeedUrl(url)) continue;
    seen.add(url);
    out.push({ ...page, url });
  }
  return out;
}

function hemmingsSeed(label: string, path: string, categories: HemmingsSeedCategory[]): HemmingsSeedPage {
  return {
    label,
    url: `https://www.hemmings.com/classifieds/${path.replace(/^\/+/, "")}`,
    categories,
  };
}

export function parseHemmingsListingsPage(html: string, page: { label: string; url: string }): SourceCandidate[] {
  const candidates = new Map<string, SourceCandidate>();
  for (const block of candidateBlocks(html)) {
    const candidate = candidateFromBlock(block, page);
    if (candidate) candidates.set(candidate.url, candidate);
  }
  for (const candidate of candidatesFromJsonLd(html, page)) {
    candidates.set(candidate.url, { ...(candidates.get(candidate.url) || {}), ...candidate });
  }
  return [...candidates.values()];
}

export function parseHemmingsDetailPage(html: string): CandidateDetailEnrichment {
  const jsonDetail = detailFromJsonLd(html);
  const summary = firstNonEmpty(
    metaContent(html, "og:description"),
    metaContent(html, "description"),
    jsonDetail.summary,
    paragraphsFromHtml(html)[0],
  );
  const location = firstNonEmpty(
    labeledValue(html, /location|seller location/i),
    textFromClass(html, /location|seller-location|vehicle-location/i),
    jsonDetail.location,
    locationFromText(normalizeText(html)),
  );
  const images = uniqueUrls([
    metaContent(html, "og:image") || "",
    ...jsonDetail.imageUrls,
    ...imageUrlsFromText(html),
  ]).slice(0, 8);
  const specs = detailSpecs(html);
  const dossier: ShadeDossierData = {
    ...(summary ? { summary: summary.slice(0, 520) } : {}),
    ...(Object.keys(specs).length ? { specs } : {}),
    ...(paragraphsFromHtml(html).slice(0, 6).length ? { listing: paragraphsFromHtml(html).slice(0, 6) } : {}),
  };

  return {
    ...(location ? { location } : {}),
    ...(images.length ? { imageUrls: images } : {}),
    ...(Object.keys(dossier).length ? { dossier } : {}),
  };
}

export function looksLikeHemmingsBlockedPage(input: { title?: unknown; body?: unknown } | unknown): boolean {
  const text =
    input && typeof input === "object" && !Array.isArray(input)
      ? `${String((input as { title?: unknown }).title || "")}\n${String((input as { body?: unknown }).body || "")}`
      : String(input || "");
  return /just a moment|verify you are human|checking your browser|cloudflare|cf-browser-verification|attention required|access denied|request blocked/i.test(text);
}

export function toHemmingsListing(input: SourceCandidate, options: HemmingsListingOptions = {}): HemmingsCandidateListing {
  const location = firstNonEmpty(input.location, input.locationRaw);
  const locationStatus: LocationStatus = location ? "ok" : "missing";
  const locationMetadata = normalizeLocationMetadata({ ...input, location, locationRaw: location, locationStatus });
  const maxImages = positiveInteger(options.maxImages) || 6;

  return {
    section: "Worth a look",
    lane: inferLane(input.title, input.summary || input.dossier?.summary),
    site: "Hemmings",
    title: input.title,
    url: input.url,
    bid: input.bid || "check listing",
    total: input.total || input.bid || "check listing",
    ...(input.bidNum ? { bidNum: input.bidNum } : {}),
    ...(input.bidCents ? { bidCents: input.bidCents } : {}),
    ...locationMetadata,
    ...(input.endsAt ? { endsAt: input.endsAt } : {}),
    timeLeft: input.timeLeft || "check listing",
    bids: input.bids || "check listing",
    bidders: input.bidders || "check listing",
    comments: input.comments || "check listing",
    fair: "Needs comp check",
    ceiling: "Keep total under configured budget unless unusually clean.",
    conf: "Hemmings browser-source candidate",
    why: `Hemmings candidate from ${input.sourceQuery || "curated source page"}; review against beach-car profile.`,
    concerns: "Verify seller, title, rust, location, fees, listing age, and whether the vehicle is still available.",
    currentTake: input.bidNum ? `${input.bid} asking` : "Hemmings candidate - review",
    images: uniqueUrls(input.imageUrls || []).slice(0, maxImages),
    ...(input.dossier ? { dossier: input.dossier } : input.summary ? { dossier: { summary: input.summary.slice(0, 520) } } : {}),
  };
}

function candidateBlocks(html: string): string[] {
  const blocks: string[] = [];
  const pattern = /<(article|li|div)\b[^>]*class=["'][^"']*(?:listing|classified|vehicle|result|card)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of html.matchAll(pattern)) {
    const block = match[0] || "";
    if (/href=["'][^"']*(?:\/classifieds\/|\/auction\/|\/listings\/)/i.test(block)) blocks.push(block);
  }
  return blocks;
}

function candidateFromBlock(block: string, page: { label: string; url: string }): SourceCandidate | null {
  const rawUrl = firstMatch(block, /<a\b[^>]+href=["']([^"']+)["'][^>]*>/i);
  const url = normalizeHemmingsUrl(rawUrl);
  if (!url) return null;
  if (!isHemmingsCandidateUrl(url)) return null;
  const title = firstNonEmpty(
    attrFromLink(block, rawUrl, "title"),
    attrFromImage(block, "alt"),
    headingText(block),
    normalizeText(firstMatch(block, /<a\b[^>]+href=["'][^"']+["'][^>]*>([\s\S]*?)<\/a>/i)),
  );
  if (!title) return null;
  const price = firstNonEmpty(
    textFromClass(block, /price|asking|amount|current-bid/i),
    labeledValue(block, /price|asking/i),
    firstMatch(normalizeText(block), /(\$[\d,]+(?:\.\d{2})?)/),
  );
  const bidNum = price ? parseMoney(price) : undefined;
  const bidCents = centsFromDollars(bidNum);
  const location = firstNonEmpty(
    textFromClass(block, /location|seller-location|vehicle-location/i),
    labeledValue(block, /location/i),
    locationFromText(normalizeText(block)),
  );
  const imageUrls = uniqueUrls([attrFromImage(block, "src"), attrFromImage(block, "data-src"), ...imageUrlsFromText(block)]).slice(0, 4);
  const summary = firstNonEmpty(textFromClass(block, /summary|description|excerpt|deck/i), normalizeText(firstMatch(block, /<p\b[^>]*>([\s\S]*?)<\/p>/i))) || "";

  return {
    source: "hemmings",
    site: "Hemmings",
    sourceQuery: page.label,
    title,
    url,
    bid: price || "Check listing",
    ...(bidNum ? { bidNum } : {}),
    ...(bidCents ? { bidCents } : {}),
    total: price || "Check listing",
    ...(location ? { location } : {}),
    timeLeft: "check listing",
    bids: "check listing",
    bidders: "check listing",
    comments: "check listing",
    imageUrls,
    summary,
    sourceUrl: page.url,
  };
}

function candidatesFromJsonLd(html: string, page: { label: string; url: string }): SourceCandidate[] {
  const out: SourceCandidate[] = [];
  for (const item of jsonLdObjects(html)) {
    walkJson(item, (node) => {
      const rawUrl = stringValue(node.url, node["@id"]);
      const url = normalizeHemmingsUrl(rawUrl);
      const title = stringValue(node.name, node.title);
      if (!url || !title) return;
      if (!isHemmingsCandidateUrl(url)) return;
      const price = stringValue((node.offers as Record<string, unknown> | undefined)?.price, node.price);
      const bidNum = parseMoney(price || "");
      const bidCents = centsFromDollars(bidNum);
      const bid = bidNum ? `$${bidNum.toLocaleString("en-US")}` : price || "Check listing";
      const location = locationFromJsonNode(node);
      out.push({
        source: "hemmings",
        site: "Hemmings",
        sourceQuery: page.label,
        title,
        url,
        bid,
        ...(bidNum ? { bidNum } : {}),
        ...(bidCents ? { bidCents } : {}),
        total: bid,
        ...(location ? { location } : {}),
        timeLeft: "check listing",
        bids: "check listing",
        bidders: "check listing",
        comments: "check listing",
        imageUrls: uniqueUrls(arrayValues(node.image)).slice(0, 4),
        summary: stringValue(node.description) || "",
        sourceUrl: page.url,
      });
    });
  }
  return out;
}

function detailFromJsonLd(html: string): { location?: string; imageUrls: string[]; summary?: string } {
  const detail = { imageUrls: [] as string[] } as { location?: string; imageUrls: string[]; summary?: string };
  for (const item of jsonLdObjects(html)) {
    walkJson(item, (node) => {
      if (!detail.location) detail.location = locationFromJsonNode(node);
      if (!detail.summary) detail.summary = stringValue(node.description);
      detail.imageUrls.push(...arrayValues(node.image));
    });
  }
  detail.imageUrls = uniqueUrls(detail.imageUrls);
  return detail;
}

function locationFromJsonNode(node: Record<string, unknown>): string | undefined {
  const address = (node.address || node.seller || node.location) as Record<string, unknown> | undefined;
  const city = stringValue(node.addressLocality, address?.addressLocality, address?.city);
  const region = stringValue(node.addressRegion, address?.addressRegion, address?.state);
  const country = stringValue(node.addressCountry, address?.addressCountry);
  return city && region ? [city, region, country].filter(Boolean).join(", ") : city || region || undefined;
}

function detailSpecs(html: string): NonNullable<ShadeDossierData["specs"]> {
  const specs: NonNullable<ShadeDossierData["specs"]> = {};
  const fields: Array<[keyof NonNullable<ShadeDossierData["specs"]>, RegExp]> = [
    ["odometer", /odometer|mileage|miles/i],
    ["engine", /engine/i],
    ["transmission", /transmission/i],
    ["drivetrain", /drivetrain|drive type|drive/i],
    ["exterior", /exterior|paint|color/i],
    ["interior", /interior/i],
    ["title", /title|registration/i],
    ["seller", /seller|dealer/i],
    ["lot", /stock|listing|lot/i],
  ];
  for (const [key, label] of fields) {
    const value = labeledValue(html, label);
    if (value) specs[key] = value;
  }
  return specs;
}

function jsonLdObjects(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const match of html.matchAll(/<script\b[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1] || "").trim());
      if (Array.isArray(parsed)) out.push(...parsed.filter(isRecord));
      else if (isRecord(parsed)) out.push(parsed);
    } catch {
      // Ignore malformed JSON-LD.
    }
  }
  return out;
}

function walkJson(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, visit);
    return;
  }
  const node = value as Record<string, unknown>;
  visit(node);
  for (const child of Object.values(node)) walkJson(child, visit);
}

function labeledValue(html: string, label: RegExp): string | undefined {
  for (const match of html.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) {
    if (label.test(normalizeText(match[1] || ""))) return cleanText(match[2] || "");
  }
  for (const match of html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/gi)) {
    if (label.test(normalizeText(match[1] || ""))) return cleanText(match[2] || "");
  }
  for (const match of html.matchAll(/<(?:li|p|div|span)\b[^>]*>([\s\S]*?)<\/(?:li|p|div|span)>/gi)) {
    const text = normalizeText(match[1] || "");
    const parts = text.match(/^([^:]{2,45}):\s*(.{1,160})$/);
    if (parts && label.test(parts[1] || "")) return cleanText(parts[2] || "");
  }
  return undefined;
}

function textFromClass(html: string, classPattern: RegExp): string | undefined {
  for (const match of html.matchAll(/<[a-z0-9]+\b[^>]*class=["']([^"']+)["'][^>]*>([\s\S]*?)<\/[a-z0-9]+>/gi)) {
    if (classPattern.test(match[1] || "")) return normalizeText(match[2] || "");
  }
  return undefined;
}

function headingText(html: string): string | undefined {
  const match = html.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i);
  return match ? normalizeText(match[1] || "") : undefined;
}

function paragraphsFromHtml(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = normalizeText(match[1] || "");
    if (text.length < 35 || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function metaContent(html: string, name: string): string | undefined {
  const escaped = escapeRegExp(name);
  const propertyMatch = html.match(new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"));
  const nameMatch = html.match(new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"));
  return cleanText(propertyMatch?.[1] || nameMatch?.[1] || "");
}

function attrFromImage(html: string, attr: string): string {
  return firstMatch(html, new RegExp(`<img\\b[^>]+${escapeRegExp(attr)}=["']([^"']+)["'][^>]*>`, "i"));
}

function attrFromLink(html: string, href: string, attr: string): string {
  const escapedHref = escapeRegExp(href || "");
  if (!escapedHref) return "";
  return firstMatch(html, new RegExp(`<a\\b[^>]+href=["']${escapedHref}["'][^>]+${escapeRegExp(attr)}=["']([^"']+)["'][^>]*>`, "i"));
}

function imageUrlsFromText(text: string): string[] {
  return Array.from(text.matchAll(/https?:\/\/[^\s"'<>]+?\.(?:jpe?g|png|webp)(?:\?[^\s"'<>]*)?/gi)).map((match) => decodeHtml(match[0]));
}

function locationFromText(text: string): string | undefined {
  const city = String.raw`[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)*`;
  const state = String.raw`(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*|[A-Z]{2})`;
  const place = String.raw`(${city},\s*${state})`;
  for (const pattern of [
    new RegExp(String.raw`\b(?:located|based|offered|seller)\s+(?:in|from|near)\s+${place}`, "i"),
    new RegExp(String.raw`\bLocation:\s*${place}`, "i"),
  ]) {
    const location = firstMatch(text, pattern);
    if (location) return location;
  }
  return undefined;
}

function normalizeHemmingsUrl(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(decodeHtml(value), "https://www.hemmings.com");
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return "";
  }
}

function isHemmingsCandidateUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return /\/classifieds\/listing\/|\/auction\/|\/listings\//i.test(url.pathname);
  } catch {
    return false;
  }
}

function uniqueUrls(values: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const url = normalizeHemmingsUrl(value);
    if (!url || seen.has(url) || /avatar|logo|icon|sprite|placeholder|blank/i.test(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function arrayValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function parseMoney(value: string): number | undefined {
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function centsFromDollars(value: number | undefined): number | undefined {
  return Number.isFinite(value) && value !== undefined ? Math.round(value * 100) : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function inferLane(title: unknown, summary: unknown): Lane {
  const text = `${title || ""} ${summary || ""}`.toLowerCase();
  if (/motorcycle|scooter|monkey|grom|trail|ct90|ct110|bmw|vespa/.test(text)) return "solo";
  if (/microcar|moke|mehari|thing|beetle|samurai|jimny|sidekick|vitara|cj|wrangler|bronco|blazer|4runner|land cruiser|scout|westfalia|type 2/.test(text)) return "family";
  return "curiosity";
}

function firstMatch(value: string, pattern: RegExp): string {
  const match = value.match(pattern);
  return match ? match[1] || "" : "";
}

function firstNonEmpty(...values: Array<string | undefined | null>): string | undefined {
  for (const value of values) {
    const cleaned = cleanText(value || "");
    if (cleaned) return cleaned;
  }
  return undefined;
}

function normalizeText(value: string): string {
  return cleanText(stripHtml(value));
}

function cleanText(value: string): string {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    quot: "\"",
    apos: "'",
    "#039": "'",
    nbsp: " ",
    lt: "<",
    gt: ">",
    ndash: "-",
    mdash: "-",
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, raw: string) => String.fromCharCode(Number.parseInt(raw, 10)))
    .replace(/&([a-zA-Z0-9#]+);/g, (entity, name: string) => named[name] || entity)
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
