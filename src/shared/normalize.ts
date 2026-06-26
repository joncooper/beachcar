import type { AuctionListing, FeedbackAction, Lane, ShadeDossierData } from "./types";

export function normalizeLane(value: unknown): Lane {
  if (value === "solo" || value === "curiosity") return value;
  return "family";
}

export function normalizeAction(value: unknown): FeedbackAction | null {
  if (value === "like" || value === "star" || value === "hide" || value === "avoid") return value;
  return null;
}

export function normalizeListing(input: Partial<AuctionListing>): AuctionListing {
  const site = String(input.site || "Unknown");
  const url = String(input.url || "");
  return {
    section: String(input.section || "Worth a look"),
    lane: normalizeLane(input.lane),
    site,
    title: String(input.title || "Untitled listing"),
    url,
    bid: String(input.bid || "Check listing"),
    total: String(input.total || "Check listing"),
    location: input.location ? String(input.location) : undefined,
    bidNum: typeof input.bidNum === "number" ? input.bidNum : undefined,
    endsAt: input.endsAt ? String(input.endsAt) : undefined,
    ends: input.ends ? String(input.ends) : undefined,
    timeLeft: input.timeLeft ? String(input.timeLeft) : undefined,
    bids: input.bids ?? "check listing",
    bidders: input.bidders ?? "check listing",
    comments: input.comments ?? "check listing",
    fair: input.fair ? String(input.fair) : undefined,
    ceiling: input.ceiling ? String(input.ceiling) : undefined,
    conf: input.conf ? String(input.conf) : undefined,
    why: String(input.why || ""),
    concerns: String(input.concerns || ""),
    currentTake: input.currentTake ? String(input.currentTake) : undefined,
    images: normalizeImages(input.images, { site, url }),
    dossier: normalizeDossier(input.dossier),
  };
}

const DOSSIER_SPEC_KEYS = [
  "odometer",
  "engine",
  "transmission",
  "drivetrain",
  "exterior",
  "interior",
  "title",
  "seller",
  "lot",
] as const;

const DOSSIER_BEACH_KEYS = ["body", "location", "people", "paperwork"] as const;

/**
 * Coerces an untrusted `dossier` payload into the ShadeDossierData shape the
 * clients decode. Soft + graceful: keeps only the declared keys with valid
 * types, clamps `valueScore` to 0..1, and returns `undefined` when nothing
 * usable remains, so partial/garbage input degrades instead of failing import.
 */
export function normalizeDossier(input: unknown): ShadeDossierData | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const out: ShadeDossierData = {};

  if (typeof raw.summary === "string" && raw.summary.trim()) out.summary = raw.summary.trim();

  if (typeof raw.valueScore === "number" && Number.isFinite(raw.valueScore)) {
    out.valueScore = Math.max(0, Math.min(1, raw.valueScore));
  }

  const specs = pickStringFields(raw.specs, DOSSIER_SPEC_KEYS);
  if (specs) out.specs = specs;

  for (const key of ["listing", "equipment", "service"] as const) {
    const list = stringArray(raw[key]);
    if (list) out[key] = list;
  }

  const bidLog = normalizeBidLog(raw.bidLog);
  if (bidLog) out.bidLog = bidLog;

  const comments = normalizeDossierComments(raw.comments);
  if (comments) out.comments = comments;

  const beachUse = pickStringFields(raw.beachUse, DOSSIER_BEACH_KEYS);
  if (beachUse) out.beachUse = beachUse;

  return Object.keys(out).length ? out : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return list.length ? list : undefined;
}

function pickStringFields<K extends string>(value: unknown, keys: readonly K[]): Partial<Record<K, string>> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const out: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const field = source[key];
    if (typeof field === "string" && field.trim()) out[key] = field.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeBidLog(value: unknown): ShadeDossierData["bidLog"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries: NonNullable<ShadeDossierData["bidLog"]> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.bidder !== "string" || typeof row.amount !== "string") continue;
    entries.push({
      bidder: row.bidder,
      amount: row.amount,
      ...(typeof row.ago === "string" ? { ago: row.ago } : {}),
    });
  }
  return entries.length ? entries : undefined;
}

function normalizeDossierComments(value: unknown): ShadeDossierData["comments"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries: NonNullable<ShadeDossierData["comments"]> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.user !== "string" || typeof row.body !== "string") continue;
    entries.push({
      user: row.user,
      body: row.body,
      ...(typeof row.ago === "string" ? { ago: row.ago } : {}),
      ...(typeof row.seller === "boolean" ? { seller: row.seller } : {}),
    });
  }
  return entries.length ? entries : undefined;
}

export function normalizeImages(input: unknown, listing: { site?: string; url?: string } = {}): string[] {
  if (!Array.isArray(input)) return [];
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw) continue;
    const imageUrl = String(raw);
    const canonical = canonicalImageUrl(imageUrl);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    unique.push(imageUrl);
  }

  if (!isCarsAndBidsListing(listing)) return unique;
  const firstGroup = unique.map(carsAndBidsPhotoGroup).find(Boolean);
  if (!firstGroup) return unique;

  return unique.filter((imageUrl) => carsAndBidsPhotoGroup(imageUrl) === firstGroup);
}

export function inferTags(listing: Pick<AuctionListing, "title" | "why" | "concerns" | "lane" | "section">): string[] {
  const text = `${listing.title} ${listing.why} ${listing.concerns} ${listing.section}`.toLowerCase();
  const tags: string[] = [listing.lane];
  const checks: Array<[RegExp, string]> = [
    [/thing|moke|mehari|jolly/, "pure beach buggy"],
    [/wrangler|\bcj[-\s]|\bcj\b|samurai|sidekick|tracker|bronco|fj40|land cruiser|4runner|willys/, "classic open 4x4"],
    [/vespa|lambretta|scooter/, "scooter"],
    [/bmw r|airhead|motorcycle|honda zb|monkey|grom|cub|trail/, "small motorcycle"],
    [/isetta|midget|kei|microcar/, "tiny oddball"],
    [/boxster|spider|convertible|beetle/, "convertible runabout"],
    [/baja|wagoneer|subaru|suv/, "quirky practical utility"],
    [/no bids|cheap\/early|still plausible/, "early value watch"],
  ];

  for (const [pattern, tag] of checks) {
    if (pattern.test(text)) tags.push(tag);
  }
  return [...new Set(tags)];
}

export async function listingKeyFor(site: string, url: string, title: string): Promise<string> {
  const slug = slugify(`${site}-${title}`).slice(0, 44) || "listing";
  const hash = await sha256Hex(`${site}|${url || title}`);
  return `${slug}-${hash.slice(0, 14)}`;
}

export async function imageKeyFor(listingKey: string, sourceUrl: string): Promise<string> {
  const hash = await sha256Hex(`${listingKey}|${sourceUrl}`);
  return `${listingKey}-${hash.slice(0, 16)}`;
}

export function r2KeyFor(imageKey: string, contentType?: string | null): string {
  const ext = extensionForContentType(contentType) || extensionFromPath(imageKey) || "bin";
  return `listing-images/${imageKey}.${ext}`;
}

export function imageVariantR2KeyFor(imageKey: string, variant: string, contentType?: string | null): string {
  const ext = extensionForContentType(contentType) || extensionFromPath(imageKey) || "bin";
  return `listing-images/variants/${variant}/${imageKey}.${ext}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extensionFromPath(value: string): string | null {
  const match = value.match(/\.([a-z0-9]{2,5})(?:$|\?)/i);
  return match ? match[1].toLowerCase() : null;
}

function extensionForContentType(contentType?: string | null): string | null {
  if (!contentType) return null;
  const clean = contentType.toLowerCase().split(";")[0]?.trim();
  if (clean === "image/jpeg") return "jpg";
  if (clean === "image/png") return "png";
  if (clean === "image/webp") return "webp";
  if (clean === "image/gif") return "gif";
  if (clean === "image/avif") return "avif";
  return null;
}

function isCarsAndBidsListing(listing: { site?: string; url?: string }): boolean {
  const site = (listing.site || "").toLowerCase();
  const url = (listing.url || "").toLowerCase();
  return site.includes("cars") && site.includes("bids") || url.includes("carsandbids.com");
}

function canonicalImageUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    if (url.hostname === "media.carsandbids.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      const photosIndex = parts.indexOf("photos");
      if (photosIndex > 0) {
        const root = parts[photosIndex - 1];
        return `${url.origin}/${root}/${parts.slice(photosIndex).join("/")}`;
      }
    }
    return url.toString();
  } catch {
    return value;
  }
}

function carsAndBidsPhotoGroup(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hostname !== "media.carsandbids.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const photosIndex = parts.indexOf("photos");
    if (photosIndex <= 0 || !parts[photosIndex + 1]) return null;
    return `${parts[photosIndex - 1]}/${parts[photosIndex + 1]}`;
  } catch {
    return null;
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
