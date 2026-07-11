import type { AuctionListing, Lane, LocationStatus } from "../../shared/types";
import { normalizeLocationMetadata } from "../../shared/normalize";

export type CarsAndBidsScrapeStatus = "ok" | "empty" | "blocked" | "failed";

export interface CarsAndBidsDiscoveryTarget {
  url: string;
  kind?: string;
  query?: string;
  sourceQueries?: string[];
}

export interface CarsAndBidsDiscoveryCandidate {
  title?: string;
  url?: string;
  bidNum?: number;
  bidCents?: number;
  saleAmount?: number;
  status?: string;
  location?: string;
  endsAt?: string;
  bids?: number;
  comments?: number;
  images?: string[];
  cardText?: string;
  pageText?: string;
  subTitle?: string;
  subtitle?: string;
  sourceQueries?: string[];
  scrapeError?: string;
  relevanceScore?: number;
}

export type CarsAndBidsCandidateListing = Partial<AuctionListing> & {
  saleAmount?: number;
  listingStatus?: string;
  sourceQueries?: string[];
};

export interface CarsAndBidsListingOptions {
  maxImages?: number;
  now?: Date;
}

export function extractCarsAndBidsListingsFromJson(value: unknown): CarsAndBidsDiscoveryCandidate[] {
  const listings: CarsAndBidsDiscoveryCandidate[] = [];
  walk(value, (node) => {
    const url = urlFromNode(node);
    const title = stringValue(node.title, node.auction_title, node.auctionTitle, node.name, node.vehicleTitle);
    if (!url || !title) return;
    const bidNum = numberValue(node.current_bid, node.currentBid, node.highest_bid, node.highestBid, node.high_bid, node.highBid);
    const saleAmount = numberValue(node.sale_amount, node.saleAmount, node.sold_price, node.soldPrice);
    listings.push({
      title,
      url,
      bidNum,
      bidCents: centsFromDollars(bidNum),
      saleAmount,
      status: stringValue(node.status, node.auction_status, node.auctionStatus) || undefined,
      location: locationFromNode(node),
      endsAt: dateValue(node.ends_at, node.end_time, node.endTime, node.auction_end, node.auctionEnd),
      bids: numberValue(node.bid_count, node.bidCount, node.bids_count, node.bidsCount),
      comments: numberValue(node.comment_count, node.commentCount, node.comments_count, node.commentsCount),
      images: imageUrlsFromNode(node),
    });
  });
  return listings;
}

export function extractCarsAndBidsListingsFromBrowser(): CarsAndBidsDiscoveryCandidate[] {
  const doc = (globalThis as { document?: unknown }).document as
    | { querySelectorAll?: (selector: string) => Iterable<unknown> | ArrayLike<unknown> }
    | undefined;
  if (!doc?.querySelectorAll) return [];
  const normalize = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
  const linkUrl = (value: unknown) => String((value as { href?: unknown })?.href || "");
  const text = (value: unknown) => normalize((value as { innerText?: unknown; textContent?: unknown })?.innerText || (value as { textContent?: unknown })?.textContent || "");
  const parent = (value: unknown) => (value as { parentElement?: unknown })?.parentElement;
  const queryAll = (root: unknown, selector: string): unknown[] => Array.from(((root as { querySelectorAll?: (query: string) => Iterable<unknown> | ArrayLike<unknown> })?.querySelectorAll?.(selector) || []) as Iterable<unknown> | ArrayLike<unknown>);
  const output: CarsAndBidsDiscoveryCandidate[] = [];

  for (const link of queryAll(doc, 'a[href*="/auctions/"]')) {
    const href = linkUrl(link);
    if (!/\/auctions\/[^/]+\/[^/?#]+/.test(href)) continue;
    let node: unknown = link;
    for (let i = 0; i < 5 && parent(node); i += 1) node = parent(node);
    const cardText = text(node) || text(link);
    const title = text(link) || cardText.split(/\n/)[0] || cardText;
    const images = queryAll(node || doc, "img")
      .map((img) => String((img as { currentSrc?: unknown; src?: unknown })?.currentSrc || (img as { src?: unknown })?.src || ""))
      .filter((src) => /media\.carsandbids\.com|carsandbids/i.test(src));
    output.push({ title, url: href, cardText, images });
  }

  return output;
}

export function extractCarsAndBidsDetailFromBrowser(): CarsAndBidsDiscoveryCandidate {
  const doc = (globalThis as { document?: unknown }).document as
    | {
        title?: unknown;
        body?: { innerText?: unknown; textContent?: unknown };
        querySelector?: (selector: string) => unknown;
        querySelectorAll?: (selector: string) => Iterable<unknown> | ArrayLike<unknown>;
      }
    | undefined;
  if (!doc) return {};
  const normalize = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
  const queryAll = (selector: string): unknown[] => Array.from((doc.querySelectorAll?.(selector) || []) as Iterable<unknown> | ArrayLike<unknown>);
  const titleText = normalize((doc.querySelector?.("h1") as { textContent?: unknown } | undefined)?.textContent);
  const fallbackTitle = normalize(String(doc.title || "").replace(/\s*\|\s*Cars & Bids.*$/i, ""));
  const images = queryAll("img")
    .map((img) => String((img as { currentSrc?: unknown; src?: unknown })?.currentSrc || (img as { src?: unknown })?.src || ""))
    .filter((src) => /media\.carsandbids\.com|carsandbids/i.test(src));
  return {
    title: titleText || fallbackTitle,
    pageText: normalize(doc.body?.innerText || doc.body?.textContent || ""),
    images,
  };
}

export function toCarsAndBidsListing(
  input: CarsAndBidsDiscoveryCandidate,
  options: CarsAndBidsListingOptions = {},
): CarsAndBidsCandidateListing {
  const pageText = input.pageText || input.cardText || "";
  const listingText = input.cardText || input.subTitle || input.subtitle || "";
  const status = stringValue(input.status) || undefined;
  const closed = isClosedStatus(status);
  const bidNum = closed ? undefined : input.bidNum || parseCurrentBidNumber(pageText);
  const bidCents = closed ? undefined : input.bidCents || centsFromDollars(bidNum);
  const saleAmount = input.saleAmount || (closed ? input.bidNum : undefined);
  const bid = closed
    ? saleAmount
      ? `sold for ${money(saleAmount)}`
      : status || "closed"
    : bidNum
      ? money(bidNum)
      : stringValue((input as { bid?: unknown }).bid) || "check listing";
  const endsAt = input.endsAt || undefined;
  const location = stringValue(input.location) || undefined;
  const locationStatus: LocationStatus = location ? "ok" : "missing";
  const locationMetadata = normalizeLocationMetadata({ location, locationRaw: location, locationStatus });
  const maxImages = positiveInteger(options.maxImages) || 5;
  const now = options.now || new Date();

  return {
    section: "Worth a look",
    lane: inferLane(input.title, listingText),
    site: "Cars & Bids",
    title: input.title || "Untitled Cars & Bids listing",
    url: normalizeCarsAndBidsUrl(input.url),
    bid,
    total: closed ? "comp only" : totalFor(bidNum, bid),
    ...(bidNum ? { bidNum } : {}),
    ...(bidCents ? { bidCents } : {}),
    ...(saleAmount ? { saleAmount } : {}),
    ...(status ? { listingStatus: status } : {}),
    ...locationMetadata,
    ...(endsAt ? { endsAt } : {}),
    ...(endsAt ? { ends: formatEnds(new Date(endsAt)), timeLeft: timeLeft(new Date(endsAt), now) } : { timeLeft: "check listing" }),
    bids: input.bids ?? parseCount(pageText, "bid") ?? "check listing",
    bidders: "check listing",
    comments: input.comments ?? parseCount(pageText, "comment") ?? "check listing",
    fair: "Needs AI valuation",
    ceiling: "Needs AI bid ceiling",
    conf: "Low until reviewed",
    why: "Cars & Bids candidate collected by authenticated browser scraper; needs daily AI fit review.",
    concerns: "Verify title/history, condition, location, fees, listing details, and whether it fits the beach-car profile.",
    currentTake: "C&B candidate - review",
    ...(input.sourceQueries?.length ? { sourceQueries: input.sourceQueries } : {}),
    images: selectCarsAndBidsImages(input.images || [], maxImages),
  };
}

export function carsAndBidsOutputStatus(listings: unknown[], fallbackStatus?: CarsAndBidsScrapeStatus): CarsAndBidsScrapeStatus {
  if (fallbackStatus === "empty" || fallbackStatus === "blocked" || fallbackStatus === "failed") return fallbackStatus;
  return listings.length ? "ok" : "empty";
}

export function looksLikeCarsAndBidsBlockedPage(input: { title?: unknown; body?: unknown } | unknown): boolean {
  const text =
    input && typeof input === "object" && !Array.isArray(input)
      ? `${String((input as { title?: unknown }).title || "")}\n${String((input as { body?: unknown }).body || "")}`
      : String(input || "");
  return /just a moment|verify you are human|checking your browser|cloudflare|cf-browser-verification|access denied|request blocked|unsupported command-line flag/i.test(text);
}

export function isCarsAndBidsClosedStatus(status: unknown): boolean {
  return isClosedStatus(status);
}

export function defaultCarsAndBidsDiscoveryUrls(): string[] {
  return defaultCarsAndBidsDiscoveryTargets().map((target) => target.url);
}

export function defaultCarsAndBidsDiscoveryTargets(): CarsAndBidsDiscoveryTarget[] {
  return [
    ...defaultCarsAndBidsSearchQueries().map((query) => ({ url: carsAndBidsSearchUrl(query), kind: "query", query })),
    { url: "https://carsandbids.com/auctions/", kind: "generic" },
  ];
}

export function defaultCarsAndBidsSearchQueries(): string[] {
  return [
    "suzuki samurai",
    "suzuki sidekick",
    "geo tracker",
    "jeep wrangler",
    "jeep cj",
    "toyota 4runner",
    "ford bronco",
    "chevrolet blazer",
    "subaru baja",
    "volkswagen beetle convertible",
    "removable top",
    "soft top",
    "open air",
    "low speed vehicle",
    "neighborhood electric",
    "sidecar",
    "microcar",
    "beach buggy",
    "surrey",
    "titled for road use",
    "fiberglass body",
    "dune buggy",
    "moped",
    "vespa",
    "honda monkey",
    "honda trail",
    "honda passport",
    "bmw motorcycle",
  ];
}

export function carsAndBidsSearchUrl(query: string): string {
  return `https://carsandbids.com/search?q=${encodeURIComponent(query)}`;
}

export function rankCarsAndBidsCandidates(
  candidates: CarsAndBidsDiscoveryCandidate[],
  options: { maxPerBucket?: number; mode?: string; queryOrder?: string[]; includeClosed?: boolean } = {},
): CarsAndBidsDiscoveryCandidate[] {
  const maxPerBucket = Number(options.maxPerBucket || 0);
  const pool = candidates.filter((candidate) => options.includeClosed || !isClosedStatus(candidate.status));
  const ranked = pool
    .map((candidate) => ({ ...candidate, relevanceScore: relevanceScore(candidate) }))
    .filter((candidate) => (candidate.relevanceScore || 0) > 0)
    .sort((left, right) => (right.relevanceScore || 0) - (left.relevanceScore || 0) || (left.bidNum || 0) - (right.bidNum || 0));

  const ordered =
    options.mode === "targeted" && options.queryOrder?.length ? interleaveByQuery(ranked, options.queryOrder) : ranked;

  if (ordered.length) return diversifyCandidates(ordered, { maxPerBucket });
  return pool.slice().sort((left, right) => (left.bidNum || 0) - (right.bidNum || 0));
}

export function upsertCarsAndBidsCandidate(
  map: Map<string, CarsAndBidsDiscoveryCandidate>,
  candidate: CarsAndBidsDiscoveryCandidate,
): void {
  const url = normalizeCarsAndBidsUrl(candidate.url);
  if (!url) return;
  const existing = map.get(url) || {};
  map.set(url, {
    ...existing,
    ...withoutEmpty(candidate),
    url,
    images: dedupe([...(existing.images || []), ...(candidate.images || [])]),
    sourceQueries: dedupe([...(existing.sourceQueries || []), ...(candidate.sourceQueries || [])]),
  });
}

export function trimJson(value: unknown): unknown {
  const text = JSON.stringify(value) || "";
  if (text.length <= 250_000) return value;
  return { truncated: true, bytes: text.length };
}

export function carsAndBidsPaginationUrlsFromApiRecord(recordUrl: unknown, value: unknown, maxPages: number): string[] {
  const limit = Math.max(0, Math.min(20, Math.floor(maxPages || 0)));
  if (!limit) return [];
  const record = isRecord(value) ? value : {};
  const count = positiveNumber(record.count) || (Array.isArray(record.auctions) ? record.auctions.length : 0);
  const total = positiveNumber(record.total) || count;
  if (!count || !total || total <= count) return [];
  try {
    const url = new URL(String(recordUrl || ""));
    const currentOffset = positiveNumber(url.searchParams.get("offset")) || 0;
    url.searchParams.delete("page");
    const urls: string[] = [];
    for (let offset = currentOffset + count; offset < total && urls.length < limit; offset += count) {
      const next = new URL(url);
      next.searchParams.set("offset", String(offset));
      urls.push(next.toString());
    }
    return urls;
  } catch {
    return [];
  }
}

export function normalizeCarsAndBidsUrl(url: unknown): string {
  if (!url) return "";
  try {
    const parsed = new URL(String(url), "https://carsandbids.com");
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function normalizeCarsAndBidsDiscoveryUrl(url: unknown): string {
  if (!url) return "";
  try {
    const parsed = new URL(String(url), "https://carsandbids.com");
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function absoluteCarsAndBidsUrl(value: string): string {
  return new URL(value, "https://carsandbids.com").toString();
}

export function isCarsAndBidsListingUrl(value: unknown): boolean {
  return /\/auctions\/[^/?#]+\/[^/?#]+/i.test(String(value || ""));
}

export function isCarsAndBidsListingApiResponse(value: unknown): boolean {
  return /\/v\d+\/autos\/auctions(?:\?|$|\/)/i.test(String(value || ""));
}

export function titleFromCarsAndBidsUrl(value: unknown): string {
  try {
    const parsed = new URL(String(value), "https://carsandbids.com");
    const slug = parsed.pathname.split("/").filter(Boolean).at(-1) || "cars-and-bids-listing";
    return slug
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return "Cars & Bids listing";
  }
}

export function parseCarsAndBidsList(value: unknown): string[] {
  return String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function dedupeCarsAndBidsTargets(targets: CarsAndBidsDiscoveryTarget[]): CarsAndBidsDiscoveryTarget[] {
  const byUrl = new Map<string, CarsAndBidsDiscoveryTarget>();
  for (const target of targets) {
    const url = normalizeCarsAndBidsDiscoveryUrl(target.url);
    if (!url) continue;
    const existing = byUrl.get(url);
    if (!existing) {
      byUrl.set(url, { ...target, url, sourceQueries: target.query ? [target.query] : [] });
      continue;
    }
    byUrl.set(url, {
      ...existing,
      ...target,
      url,
      query: existing.query || target.query,
      sourceQueries: dedupe([...(existing.sourceQueries || []), ...(target.query ? [target.query] : []), ...(target.sourceQueries || [])]),
    });
  }
  return [...byUrl.values()];
}

export function truthy(value: unknown): boolean {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

export function dedupe(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values.filter(Boolean).map(String)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function withoutEmpty<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).filter(([, value]) => value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0)),
  ) as Partial<T>;
}

function walk(value: unknown, visit: (node: Record<string, unknown>) => void, seen = new Set<unknown>()): void {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, seen);
    return;
  }
  const record = value as Record<string, unknown>;
  visit(record);
  for (const item of Object.values(record)) walk(item, visit, seen);
}

function urlFromNode(node: Record<string, unknown>): string | null {
  const raw = stringValue(node.url, node.path, node.href, node.auction_url, node.auctionUrl);
  if (raw && /\/auctions\//.test(raw)) return absoluteCarsAndBidsUrl(raw);
  const id = stringValue(node.id, node.auction_id, node.auctionId);
  const slug = stringValue(node.slug, node.auction_slug, node.auctionSlug);
  if (id && slug) return `https://carsandbids.com/auctions/${id}/${slug}`;
  const title = stringValue(node.title, node.auction_title, node.auctionTitle, node.name, node.vehicleTitle);
  if (id && title) return `https://carsandbids.com/auctions/${id}/${slugify(title)}`;
  return null;
}

function locationFromNode(node: Record<string, unknown>): string | undefined {
  const direct = stringValue(
    node.location,
    node.city_state,
    node.cityState,
    node.vehicle_location,
    node.vehicleLocation,
    node.seller_location,
    node.sellerLocation,
  );
  if (direct) return direct;
  const city = stringValue(node.city, node.vehicle_city, node.vehicleCity, node.seller_city, node.sellerCity);
  const region = stringValue(node.state, node.region, node.province, node.vehicle_state, node.vehicleState, node.seller_state, node.sellerState);
  return city && region ? `${city}, ${region}` : city || region || undefined;
}

export function extractCarsAndBidsLocationFromText(value: unknown): string | undefined {
  const raw = String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (!raw) return undefined;
  const text = raw.replace(/\s+/g, " ");
  const city = String.raw`[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)*`;
  const region = String.raw`(?:[A-Z]{2}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)`;
  const zip = String.raw`(?:\s+\d{5}(?:-\d{4})?)?`;
  const place = String.raw`(${city},\s*${region}${zip})`;
  for (const pattern of [
    new RegExp(String.raw`\b(?:location|seller location|located in|located near)\s*[:\-]?\s*${place}`, "i"),
    new RegExp(String.raw`\b${place}\b`),
  ]) {
    const match = text.match(pattern);
    const location = match?.[1]?.replace(/\s+/g, " ").trim();
    if (location) return location;
  }
  return undefined;
}

function imageUrlsFromNode(node: Record<string, unknown>): string[] {
  const images: string[] = [];
  walk(node, (inner) => {
    const baseUrl = stringValue(inner.base_url, inner.baseUrl);
    const path = stringValue(inner.path);
    if (baseUrl && path && /\.(?:jpg|jpeg|png|webp)(?:\?|$)/i.test(path)) {
      images.push(`https://${baseUrl.replace(/^https?:\/\//i, "")}/${path}`);
    }
    for (const value of Object.values(inner)) {
      if (typeof value === "string" && /https?:\/\/[^"\s]+(?:jpg|jpeg|png|webp)/i.test(value)) images.push(value);
    }
  });
  return selectCarsAndBidsImages(images, 30);
}

function selectCarsAndBidsImages(values: unknown[], maxImages: number): string[] {
  const unique = dedupe(values).filter((url) => !/avatar|icon|logo|sprite|emoji|blank|placeholder/i.test(url));
  const groups = new Map<string, { firstIndex: number; urls: string[] }>();
  for (const [index, url] of unique.entries()) {
    const group = carsAndBidsPhotoGroup(url);
    if (!group) continue;
    const current = groups.get(group) || { firstIndex: index, urls: [] };
    current.urls.push(url);
    groups.set(group, current);
  }
  if (!groups.size) return unique.slice(0, maxImages);

  const best = [...groups.entries()].sort((left, right) => right[1].urls.length - left[1].urls.length || left[1].firstIndex - right[1].firstIndex)[0];
  return best ? best[1].urls.slice(0, maxImages) : unique.slice(0, maxImages);
}

function carsAndBidsPhotoGroup(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hostname !== "media.carsandbids.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const photosIndex = parts.indexOf("photos");
    if (photosIndex <= 0 || !parts[photosIndex + 1]) return null;
    const root = parts[photosIndex - 1];
    const album = parts[photosIndex + 1];
    if (/^(application|avatars?|users?|logos?)$/i.test(root) || /^(application|avatars?|users?|logos?)$/i.test(album)) return null;
    return `${root}/${album}`;
  } catch {
    return null;
  }
}

function isClosedStatus(status: unknown): boolean {
  return /^(sold|sold_after|reserve_not_met|closed|ended|withdrawn|canceled|cancelled)$/i.test(String(status || "").trim());
}

function totalFor(bidNum: number | undefined, bid: string): string {
  if (!bidNum || bid === "No bids") return "check listing";
  return money(Math.round(bidNum + Math.min(7500, Math.max(250, bidNum * 0.05))));
}

function timeLeft(end: Date, now: Date): string {
  const delta = end.getTime() - now.getTime();
  if (delta <= 0) return "ended";
  const minutes = Math.floor(delta / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days === 0) return `today, ${hours}h ${mins}m`;
  if (days === 1) return `1 day, ${hours}h`;
  return `${days} days, ${hours}h`;
}

function formatEnds(end: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(end);
}

function inferLane(title: unknown, text: unknown): Lane {
  const titleBlob = String(title || "").toLowerCase();
  const blob = `${title || ""} ${text || ""}`.toLowerCase();
  if (/wrangler|\bcj\b|4runner|bronco|blazer|jimmy|lx 470|land cruiser|xterra|samurai|tracker|sidekick|baja|brat|montero|delica/.test(titleBlob)) {
    return "family";
  }
  if (/vespa|motorcycle|bmw r|harley|monkey|grom|scooter|boxster|cayman|miata|mx-5|z3|z4|spider|roadster|coupe|mini cooper|fiesta|wrx/.test(titleBlob)) {
    return "solo";
  }
  if (/midget|kei|gem|mini car|odd|project/.test(blob)) return "curiosity";
  return "family";
}

function money(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function relevanceScore(candidate: CarsAndBidsDiscoveryCandidate): number {
  const text = `${candidate.title || ""} ${candidate.cardText || ""}`.toLowerCase();
  let score = 0;
  const checks: Array<[RegExp, number]> = [
    [/samurai|sidekick|tracker|wrangler|\bcj[-\s]|\bcj\b|bronco|blazer|jimmy|4runner/, 10],
    [/thing|moke|mehari|jolly|beetle convertible/, 10],
    [/midget|microcar|gem|neighborhood electric|nev\b|low-speed|surrey|cushman|moped/, 8],
    [/vespa|scooter|monkey|grom|trail|passport|cub|sidecar|bmw r\d|airhead|harley/, 8],
    [/dune buggy|beach buggy|meyers manx|fiberglass|titled for road use|street legal/, 7],
    [/4x4|4wd|soft top|removable|manual|beach|open-air|open air|convertible/, 3],
    [/no reserve|one-owner|original-owner|low-mile|low mile/, 1],
  ];

  for (const [pattern, value] of checks) {
    if (pattern.test(text)) score += value;
  }

  if (/boxster|cayman|miata|mx-5|z3|z4|124 spider|spider|roadster|ferrari|lamborghini|aston martin|mclaren|gt3|gt-r|diablo|vantage|scaglietti|911 turbo|corvette|amg|integrale|lancia/i.test(text)) {
    score -= 12;
  }

  const bidNum = candidate.bidNum || parseMoneyNumber(text.match(/\$([0-9,]+)/)?.[1]);
  if (bidNum && bidNum > 45_000) score -= 10;
  else if (bidNum && bidNum > 32_000) score -= 5;

  return score;
}

function interleaveByQuery(candidates: CarsAndBidsDiscoveryCandidate[], queryOrder: string[]): CarsAndBidsDiscoveryCandidate[] {
  const queryKeys = queryOrder.map(queryKey);
  const byQuery = new Map(queryKeys.map((key) => [key, [] as CarsAndBidsDiscoveryCandidate[]]));
  const rest: CarsAndBidsDiscoveryCandidate[] = [];

  for (const candidate of candidates) {
    const sourceKeys = (candidate.sourceQueries || []).map(queryKey);
    const key = sourceKeys.find((sourceKey) => byQuery.has(sourceKey));
    if (key) byQuery.get(key)?.push(candidate);
    else rest.push(candidate);
  }

  const selected: CarsAndBidsDiscoveryCandidate[] = [];
  const seen = new Set<string>();
  let added = true;
  while (added) {
    added = false;
    for (const key of queryKeys) {
      const queue = byQuery.get(key) || [];
      while (queue.length) {
        const candidate = queue.shift();
        if (!candidate) continue;
        const candidateKey = normalizeCarsAndBidsUrl(candidate.url);
        if (seen.has(candidateKey)) continue;
        seen.add(candidateKey);
        selected.push(candidate);
        added = true;
        break;
      }
    }
  }

  for (const candidate of rest) {
    const candidateKey = normalizeCarsAndBidsUrl(candidate.url);
    if (seen.has(candidateKey)) continue;
    seen.add(candidateKey);
    selected.push(candidate);
  }

  return selected;
}

function queryKey(value: unknown): string {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function diversifyCandidates(
  candidates: CarsAndBidsDiscoveryCandidate[],
  options: { maxPerBucket?: number } = {},
): CarsAndBidsDiscoveryCandidate[] {
  const maxPerBucket = Number(options.maxPerBucket || 0);
  const selected: CarsAndBidsDiscoveryCandidate[] = [];
  const deferred: CarsAndBidsDiscoveryCandidate[] = [];
  const bucketCounts = new Map<string, number>();
  const titleCounts = new Map<string, number>();

  for (const candidate of candidates) {
    const bucket = modelBucket(candidate);
    const titleKey = String(candidate.title || "").toLowerCase().replace(/\s+/g, " ").trim();
    const bucketCount = bucketCounts.get(bucket) || 0;
    const titleCount = titleCounts.get(titleKey) || 0;

    if (titleKey && titleCount >= 1) {
      deferred.push(candidate);
      continue;
    }

    if (maxPerBucket > 0 && bucketCount >= maxPerBucket) {
      deferred.push(candidate);
      continue;
    }

    selected.push(candidate);
    bucketCounts.set(bucket, bucketCount + 1);
    if (titleKey) titleCounts.set(titleKey, titleCount + 1);
  }

  return [...selected, ...deferred];
}

function modelBucket(candidate: CarsAndBidsDiscoveryCandidate): string {
  const text = `${candidate.title || ""} ${candidate.cardText || ""}`.toLowerCase();
  const buckets: Array<[RegExp, string]> = [
    [/samurai|sidekick|tracker/, "small-suzuki-tracker"],
    [/wrangler|\bcj[-\s]|\bcj\b/, "jeep-open"],
    [/4runner/, "4runner"],
    [/bronco/, "bronco"],
    [/blazer|jimmy/, "blazer-jimmy"],
    [/baja|brat/, "subaru-ute"],
    [/sambar|hijet|acty|carry|kei|midget/, "kei"],
    [/microcar|surrey|cushman|gem|neighborhood electric|low-speed/, "micro-nev"],
    [/dune buggy|beach buggy|meyers manx|fiberglass/, "buggy"],
    [/beetle/, "beetle"],
    [/vespa|scooter/, "scooter"],
    [/monkey|grom|trail|passport|cub/, "small-honda-bike"],
    [/bmw r\d|airhead|motorcycle|sidecar/, "motorcycle"],
  ];
  return buckets.find(([pattern]) => pattern.test(text))?.[1] || "other";
}

function stringValue(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = parseMoneyNumber(value);
      if (parsed) return parsed;
    }
  }
  return undefined;
}

function dateValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (!value) continue;
    const date = new Date(String(value));
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return undefined;
}

function parseMoneyNumber(value: unknown): number | undefined {
  if (!value) return undefined;
  const parsed = Number(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function centsFromDollars(value: number | undefined): number | undefined {
  return Number.isFinite(value) && value !== undefined ? Math.round(value * 100) : undefined;
}

function parseCurrentBidNumber(text: unknown): number | undefined {
  const match = String(text || "").match(/\b(?:current|high(?:est)?)\s+bid\s*\$([0-9,]+)/i);
  return parseMoneyNumber(match?.[1]);
}

function parseCount(text: unknown, label: string): number | undefined {
  const match = String(text || "").match(new RegExp(`(?<![$,\\d])(\\d{1,4})\\s+${label}s?\\b`, "i"));
  return match ? Number(match[1]) : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function slugify(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
