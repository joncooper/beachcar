import type { ShadeDossierData } from "../../shared/types";
import type { CandidateDetailEnrichment, SourceCandidate } from "./types";

export const BAT_KEYWORD_PAGES: Array<{ label: string; url: string }> = [
  { label: "Live Auctions", url: "https://bringatrailer.com/auctions/" },
  { label: "Volkswagen Thing", url: "https://bringatrailer.com/volkswagen/thing/" },
  { label: "Suzuki Samurai", url: "https://bringatrailer.com/suzuki/samurai/" },
  { label: "Geo Tracker", url: "https://bringatrailer.com/geo/tracker/" },
  { label: "Jeep Wrangler", url: "https://bringatrailer.com/jeep/wrangler/" },
  { label: "Mitsubishi Delica", url: "https://bringatrailer.com/mitsubishi/delica/" },
  { label: "Mini Moke", url: "https://bringatrailer.com/mini/moke/" },
  { label: "Citroen Mehari", url: "https://bringatrailer.com/citroen/mehari/" },
  { label: "Honda Monkey", url: "https://bringatrailer.com/honda/monkey/" },
  { label: "Vespa", url: "https://bringatrailer.com/vespa/" },
];

export const BAT_RSS_FEED = "https://bringatrailer.com/auctions/feed/";

const BAT_NOTE_SEEDS: Array<{ label: string; url: string; patterns: RegExp[] }> = [
  { label: "Jeep Scrambler", url: "https://bringatrailer.com/jeep/scrambler/", patterns: [/\bscrambler\b|\bcj-?8\b/i] },
  { label: "Jeep CJ", url: "https://bringatrailer.com/jeep/cj/", patterns: [/\bcj-?\d?\b|\bjeep cj\b/i] },
  { label: "Suzuki Sidekick", url: "https://bringatrailer.com/suzuki/sidekick/", patterns: [/\bsidekick\b/i] },
  { label: "Suzuki Jimny", url: "https://bringatrailer.com/suzuki/jimny/", patterns: [/\bjimny\b/i] },
  { label: "Chevrolet Blazer", url: "https://bringatrailer.com/chevrolet/blazer/", patterns: [/\bblazer\b|\bk5\b/i] },
  { label: "Ford Bronco", url: "https://bringatrailer.com/ford/bronco/", patterns: [/\bbronco\b/i] },
  { label: "Toyota 4Runner", url: "https://bringatrailer.com/toyota/4runner/", patterns: [/\b4runner\b/i] },
  { label: "Honda Grom", url: "https://bringatrailer.com/honda/grom/", patterns: [/\bgrom\b/i] },
  { label: "Honda Trail", url: "https://bringatrailer.com/honda/trail/", patterns: [/\btrail\b|\bct70\b|\bct90\b|\bct110\b/i] },
  { label: "BMW Motorcycle", url: "https://bringatrailer.com/bmw/motorcycles/", patterns: [/\bbmw\s+(?:r\d|motorcycle|bike)\b|\bairhead\b/i] },
  { label: "Volkswagen Beetle Convertible", url: "https://bringatrailer.com/volkswagen/beetle-convertible/", patterns: [/\bbeetle convertible\b|\bcabriolet\b/i] },
];

export function bringATrailerPagesFromSourceNotes(notes: string | undefined): Array<{ label: string; url: string }> {
  const text = String(notes || "").trim();
  if (!text) return [];
  const pages: Array<{ label: string; url: string }> = [];
  for (const seed of BAT_NOTE_SEEDS) {
    if (seed.patterns.some((pattern) => pattern.test(text))) pages.push({ label: seed.label, url: seed.url });
  }
  for (const match of text.matchAll(/https?:\/\/(?:www\.)?bringatrailer\.com\/[^\s,;]+/gi)) {
    const url = normalizeBaTPageUrl(match[0], "https://bringatrailer.com/");
    if (url) pages.push({ label: labelFromBaTUrl(url), url });
  }
  return dedupePages(pages);
}

export function dedupeBringATrailerPages(pages: Array<{ label: string; url: string }>): Array<{ label: string; url: string }> {
  return dedupePages(pages);
}

export function parseBringATrailerLiveListings(html: string, page: { label: string; url: string }): SourceCandidate[] {
  const initialDataListings = candidatesFromBatInitialData(html, page);
  if (initialDataListings.length) return initialDataListings;

  const liveHtml = liveListingsSection(html);
  if (!liveHtml) return [];

  return liveHtml
    .split(/<div class="listing-card\b/)
    .slice(1)
    .map((card) => candidateFromBatCard(card, page))
    .filter((candidate): candidate is SourceCandidate => candidate !== null);
}

interface BatInitialDataItem {
  active?: unknown;
  comments?: unknown;
  country?: unknown;
  current_bid?: unknown;
  current_bid_formatted?: unknown;
  excerpt?: unknown;
  noreserve?: unknown;
  thumbnail_url?: unknown;
  timestamp_end?: unknown;
  title?: unknown;
  url?: unknown;
}

function candidatesFromBatInitialData(html: string, page: { label: string; url: string }): SourceCandidate[] {
  const marker = html.match(/\bvar\s+auctionsCurrentInitialData\s*=\s*/i);
  if (!marker || marker.index === undefined) return [];
  const start = marker.index + marker[0].length;
  const scriptEnd = html.indexOf("</script>", start);
  if (scriptEnd < 0) return [];
  const assignment = html.slice(start, scriptEnd);
  const end = assignment.lastIndexOf("}");
  if (end < 0) return [];

  let parsed: { items?: BatInitialDataItem[] };
  try {
    parsed = JSON.parse(assignment.slice(0, end + 1)) as { items?: BatInitialDataItem[] };
  } catch {
    return [];
  }

  if (!Array.isArray(parsed.items)) return [];
  return parsed.items
    .map((item): SourceCandidate | null => candidateFromBatInitialData(item, page))
    .filter((candidate): candidate is SourceCandidate => candidate !== null);
}

function candidateFromBatInitialData(item: BatInitialDataItem, page: { label: string; url: string }): SourceCandidate | null {
  const title = stringValue(item.title);
  const url = stringValue(item.url);
  if (!title || !url || item.active === false) return null;

  const bidNum = finiteNumber(item.current_bid);
  const bid = stringValue(item.current_bid_formatted) || (bidNum !== undefined ? `$${bidNum.toLocaleString("en-US")}` : "Check listing");
  const timestamp = finiteNumber(item.timestamp_end);
  const endsAt = timestamp !== undefined && timestamp > 0 ? new Date(timestamp * 1000).toISOString() : undefined;
  const country = stringValue(item.country);
  const image = stringValue(item.thumbnail_url);
  const comments = finiteNumber(item.comments);

  return {
    source: "bringatrailer",
    site: "Bring a Trailer",
    sourceQuery: page.label,
    title: decodeHtml(title),
    url: decodeHtml(url),
    bid: decodeHtml(bid),
    ...(bidNum !== undefined ? { bidNum, bidCents: centsFromDollars(bidNum) } : {}),
    total: bidNum !== undefined ? `$${Math.round(bidNum * 1.05).toLocaleString("en-US")} incl. buyer fee estimate` : "Check listing",
    ...(country ? { locationCountry: decodeHtml(country) } : {}),
    ...(endsAt ? { endsAt } : {}),
    timeLeft: "check listing",
    bids: "check listing",
    bidders: "check listing",
    ...(comments !== undefined ? { comments } : { comments: "check listing" }),
    imageUrls: image ? [decodeHtml(image)] : [],
    summary: decodeHtml(stripHtml(decodeHtml(stringValue(item.excerpt) || ""))).replace(/\s+([.,;:!?])/g, "$1"),
    ...(typeof item.noreserve === "boolean" ? { noReserve: item.noreserve } : {}),
    isLive: true,
    sourceUrl: page.url,
  };
}

export function parseBringATrailerRssFeed(xml: string): SourceCandidate[] {
  const items = Array.from(xml.matchAll(/<item>[\s\S]*?<\/item>/gi)).slice(0, 60);
  return items
    .map((match): SourceCandidate | null => {
      const block = match[0];
      const title = textFromXmlTag(block, "title");
      const url = textFromXmlTag(block, "link");
      if (!title || !url) return null;
      const summary = stripHtml(textFromXmlTag(block, "description") || textFromXmlTag(block, "content:encoded") || "");
      const publishedAt = isoDateOrUndefined(textFromXmlTag(block, "pubDate") || textFromXmlTag(block, "dc:date"));
      return {
        source: "bringatrailer",
        site: "Bring a Trailer",
        sourceQuery: "BaT auctions feed",
        title: decodeHtml(title),
        url: decodeHtml(url),
        bid: "Check listing",
        total: "Check listing",
        timeLeft: "check listing",
        bids: "check listing",
        bidders: "check listing",
        comments: "check listing",
        imageUrls: imageUrlsFromText(block).slice(0, 4),
        summary,
        isLive: true,
        sourceUrl: BAT_RSS_FEED,
        publishedAt,
      } satisfies SourceCandidate;
    })
    .filter((candidate): candidate is SourceCandidate => candidate !== null);
}

export function discoverBringATrailerNextPages(html: string, page: { label: string; url: string }, limit = 1): Array<{ label: string; url: string }> {
  const urls = new Set<string>();
  for (const match of html.matchAll(/<link\b[^>]*rel=["'][^"']*\bnext\b[^"']*["'][^>]*>/gi)) {
    const url = normalizeBaTPageUrl(attr(match[0] || "", "href"), page.url);
    if (url) urls.add(url);
  }
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const tag = match[0] || "";
    const text = normalizeText(match[2] || "");
    if (!/\bnext\b|older|more/i.test(`${tag} ${text}`)) continue;
    const url = normalizeBaTPageUrl(match[1], page.url);
    if (url) urls.add(url);
  }
  return [...urls].slice(0, limit).map((url, index) => ({
    label: `${page.label} page ${index + 2}`,
    url,
  }));
}

export function parseBringATrailerDetailPage(html: string): CandidateDetailEnrichment {
  const listingBlock = firstHtmlBlock(
    html,
    [
      "post-content",
      "entry-content",
      "listing-content",
      "auction-description",
      "item-description",
      "description",
    ],
    80_000,
  );
  const listing = paragraphsFromHtml(listingBlock || html).slice(0, 8);
  const summary = firstNonEmpty(
    metaContent(html, "og:description"),
    metaContent(html, "description"),
    listing[0],
  );
  const imageUrls = detailImageUrls(html).slice(0, 6);
  const specs = detailSpecs(html);
  const equipment = listItemsAfterHeading(html, /equipment|highlights|features/i).slice(0, 12);
  const service = listItemsAfterHeading(html, /service|maintenance|recent work|work performed/i).slice(0, 12);
  const bidLog = detailBidLog(html).slice(0, 8);
  const commentRows = detailComments(html).slice(0, 8);
  const noReserve = noReserveFromHtml(html);
  const location = firstNonEmpty(
    specs.location,
    locationFromHtml(html, [...listing, summary].filter(Boolean).join(" ")),
  );
  const bids = countLabel(html, /bids?/i);
  const comments = countLabel(html, /comments?/i);
  const bidders = countLabel(html, /bidders?/i);

  const dossier: ShadeDossierData = {
    ...(summary ? { summary: summary.slice(0, 520) } : {}),
    ...(specs.dossierSpecs ? { specs: specs.dossierSpecs } : {}),
    ...(listing.length ? { listing } : {}),
    ...(equipment.length ? { equipment } : {}),
    ...(service.length ? { service } : {}),
    ...(bidLog.length ? { bidLog } : {}),
    ...(commentRows.length ? { comments: commentRows } : {}),
  };

  return {
    ...(location ? { location } : {}),
    ...(bids ? { bids } : {}),
    ...(bidders ? { bidders } : {}),
    ...(comments ? { comments } : {}),
    ...(imageUrls.length ? { imageUrls } : {}),
    ...(noReserve !== undefined ? { noReserve } : {}),
    ...(Object.keys(dossier).length ? { dossier } : {}),
  };
}

function liveListingsSection(html: string): string | null {
  const start = html.indexOf("listings-live");
  if (start < 0) return null;
  const completed = html.indexOf("auctions-completed", start);
  const end = completed > start ? completed : html.length;
  return html.slice(start, end);
}

function candidateFromBatCard(card: string, page: { label: string; url: string }): SourceCandidate | null {
  const title = decodeHtml(firstMatch(card, /<a class="image-overlay"[^>]*title="([^"]+)"/i) || firstMatch(card, /<h3>\s*<a [^>]*>([\s\S]*?)<\/a>\s*<\/h3>/i));
  const url = decodeHtml(firstMatch(card, /<a class="image-overlay"[^>]*href="([^"]+)"/i) || firstMatch(card, /<h3>\s*<a href="([^"]+)"/i));
  if (!title || !url) return null;

  const timestamp = Number(firstMatch(card, /data-timestamp_end="(\d+)"/i) || "");
  const endsAt = Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000).toISOString() : undefined;
  const bid = decodeHtml(stripHtml(firstMatch(card, /<span class="bid-formatted bold">([\s\S]*?)<\/span>/i) || "")) || "Check listing";
  const bidNum = parseMoney(bid);
  const bidCents = centsFromDollars(bidNum);
  const image = decodeHtml(firstMatch(card, /<img src="([^"]+)"[^>]*alt=/i));
  const excerpt = decodeHtml(stripHtml(firstMatch(card, /<div class="item-excerpt">([\s\S]*?)<\/div>/i) || ""));
  const location = locationFromHtml(card);

  return {
    source: "bringatrailer",
    site: "Bring a Trailer",
    sourceQuery: page.label,
    title,
    url,
    bid,
    bidNum,
    bidCents,
    total: bidNum ? `$${Math.round(bidNum * 1.05).toLocaleString()} incl. buyer fee estimate` : "Check listing",
    ...(location ? { location } : {}),
    endsAt,
    timeLeft: "check listing",
    bids: "check listing",
    bidders: "check listing",
    comments: "check listing",
    imageUrls: image ? [image] : [],
    summary: excerpt,
    noReserve: /item-tag-noreserve/i.test(card),
    sourceUrl: page.url,
  };
}

function firstHtmlBlock(html: string, classHints: string[], maxLength: number): string | null {
  for (const hint of classHints) {
    const escaped = escapeRegExp(hint);
    const match = html.match(new RegExp(`<([a-z0-9]+)[^>]+class=["'][^"']*${escaped}[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "i"));
    if (match?.[2]) return match[2].slice(0, maxLength);
  }
  return null;
}

function paragraphsFromHtml(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = normalizeText(match[1] || "");
    if (text.length < 35) continue;
    if (/^(submit|view listing|share this|see all|click here)/i.test(text)) continue;
    if (seen.has(text)) continue;
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

type ImageRole = "hero" | "exterior" | "interior" | "underbody" | "engine" | "other";

type DetailImageCandidate = {
  url: string;
  canonical: string;
  role: ImageRole;
  score: number;
  index: number;
};

function detailImageUrls(html: string): string[] {
  const bestByCanonical = new Map<string, DetailImageCandidate>();
  for (const candidate of detailImageCandidates(html)) {
    const existing = bestByCanonical.get(candidate.canonical);
    if (!existing || candidate.score > existing.score || (candidate.score === existing.score && candidate.index < existing.index)) {
      bestByCanonical.set(candidate.canonical, candidate);
    }
  }

  const ranked = [...bestByCanonical.values()].sort((left, right) => right.score - left.score || left.index - right.index);
  const selected: DetailImageCandidate[] = [];
  const selectedCanonicals = new Set<string>();
  for (const role of ["hero", "exterior", "interior", "underbody", "engine"] satisfies ImageRole[]) {
    const match = ranked.find((candidate) => candidate.role === role && !selectedCanonicals.has(candidate.canonical));
    if (!match) continue;
    selected.push(match);
    selectedCanonicals.add(match.canonical);
  }
  for (const candidate of ranked) {
    if (selectedCanonicals.has(candidate.canonical)) continue;
    selected.push(candidate);
    selectedCanonicals.add(candidate.canonical);
  }
  return selected.map((candidate) => candidate.url);
}

function detailImageCandidates(html: string): DetailImageCandidate[] {
  const candidates: DetailImageCandidate[] = [];
  let index = 0;
  const add = (url: string | undefined, context: string, baseScore = 0) => {
    const cleaned = decodeHtml(url || "").trim();
    if (!cleaned || !/^https?:\/\//i.test(cleaned)) return;
    if (/avatar|icon|logo|sprite|emoji|blank|placeholder|favicon/i.test(cleaned)) return;
    const canonical = cleaned.replace(/\?.*$/, "");
    const role = imageRole(`${context} ${cleaned}`);
    candidates.push({ url: cleaned, canonical, role, score: imageScore(role, `${context} ${cleaned}`, baseScore), index: index++ });
  };

  add(metaContent(html, "og:image"), "og:image hero featured exterior", 80);
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0] || "";
    const context = `${attr(tag, "class")} ${attr(tag, "alt")} ${attr(tag, "title")} ${tag}`;
    add(attr(tag, "src"), context, 20);
    add(attr(tag, "data-src"), context, 18);
    for (const src of srcsetUrls(attr(tag, "srcset"))) add(src, context, 18);
    for (const src of srcsetUrls(attr(tag, "data-srcset"))) add(src, context, 16);
  }
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["'][^>]*>/gi)) {
    const tag = match[0] || "";
    add(match[1], `${attr(tag, "class")} ${attr(tag, "title")} ${tag}`, 10);
  }
  for (const url of imageUrlsFromText(html)) add(url, "raw-url", 0);
  return candidates;
}

function imageRole(context: string): ImageRole {
  if (/og:image|hero|lead|featured|main image|primary/i.test(context)) return "hero";
  if (/engine|engine bay|motor/i.test(context)) return "engine";
  if (/underbody|undercarriage|underside|chassis|floor|frame|rust/i.test(context)) return "underbody";
  if (/interior|dashboard|dash|seat|cabin|console|door panel/i.test(context)) return "interior";
  if (/exterior|front|rear|side|profile|quarter|top|roof|body|paint/i.test(context)) return "exterior";
  return "other";
}

function imageScore(role: ImageRole, context: string, baseScore: number): number {
  const roleScore: Record<ImageRole, number> = {
    hero: 60,
    exterior: 50,
    interior: 42,
    underbody: 38,
    engine: 36,
    other: 10,
  };
  let score = baseScore + roleScore[role];
  if (/gallery|photo|image|wp-content\/uploads/i.test(context)) score += 8;
  if (/thumbnail|thumb|small|150x150|avatar|logo/i.test(context)) score -= 40;
  if (/\b(?:w|width)=1[0-9]{2}\b|-\d{2,3}x\d{2,3}\./i.test(context)) score -= 15;
  const width = imageWidthHint(context);
  if (width >= 1200) score += 12;
  else if (width >= 900) score += 8;
  return score;
}

function srcsetUrls(value: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0] || "")
    .filter(Boolean);
}

function imageWidthHint(context: string): number {
  const explicit = context.match(/\b(?:w|width)=(\d{2,4})\b/i);
  if (explicit) return Number(explicit[1]) || 0;
  const resized = context.match(/-(\d{2,4})x\d{2,4}\./i);
  return resized ? Number(resized[1]) || 0 : 0;
}

function detailSpecs(html: string): { location?: string; dossierSpecs?: ShadeDossierData["specs"] } {
  const location = locationFromHtml(html);
  const specs: NonNullable<ShadeDossierData["specs"]> = {};
  const fields: Array<[keyof NonNullable<ShadeDossierData["specs"]>, RegExp]> = [
    ["odometer", /odometer|mileage|miles/i],
    ["engine", /engine/i],
    ["transmission", /transmission/i],
    ["drivetrain", /drivetrain|drive type|drive/i],
    ["exterior", /exterior|paint|color/i],
    ["interior", /interior/i],
    ["title", /title|registration/i],
    ["seller", /seller|seller name/i],
    ["lot", /lot/i],
  ];
  for (const [key, label] of fields) {
    const value = labeledValue(html, label);
    if (value) specs[key] = value;
  }
  return {
    ...(location ? { location } : {}),
    ...(Object.keys(specs).length ? { dossierSpecs: specs } : {}),
  };
}

function locationFromHtml(html: string, textFallback?: string): string | undefined {
  return firstNonEmpty(
    labeledValue(html, /location/i),
    locationClassText(html),
    textFromClass(html, /listing-location|item-location|auction-location|vehicle-location|location/i),
    locationFromText(textFallback || normalizeText(html)),
  );
}

function locationClassText(html: string): string | undefined {
  const match = html.match(/<[a-z0-9]+\b[^>]*class=["'][^"']*(?:listing-location|item-location|auction-location|vehicle-location)[^"']*["'][^>]*>([\s\S]*?)<\/[a-z0-9]+>/i);
  return match?.[1] ? normalizeText(match[1]) : undefined;
}

function locationFromText(text: string): string | undefined {
  const city = String.raw`[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)*`;
  const state = String.raw`(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*|[A-Z]{2})`;
  const place = String.raw`(${city},\s*${state})`;
  const patterns = [
    new RegExp(String.raw`\b(?:located|based|garaged)\s+in\s+${place}`, "i"),
    new RegExp(String.raw`\boffered\s+(?:by\s+[^,.]{0,100}\s+)?(?:in|from)\s+${place}`, "i"),
    new RegExp(String.raw`\b(?:seller|dealer)\s+(?:is\s+)?(?:located|based)?\s*(?:in|from)\s+${place}`, "i"),
  ];
  for (const pattern of patterns) {
    const location = firstMatch(text, pattern);
    if (location) return location;
  }
  return undefined;
}

function noReserveFromHtml(html: string): boolean | undefined {
  const text = normalizeText(html);
  if (/item-tag-noreserve|no[-\s]?reserve|\bwithout reserve\b/i.test(html) || /\bno reserve\b/i.test(text)) return true;
  if (/\breserve (?:not met|has not been met|was not met|met|has been met)\b/i.test(text)) return false;
  if (/\b(?:reserve price|reserve auction)\b/i.test(text)) return false;
  return undefined;
}

function listItemsAfterHeading(html: string, label: RegExp): string[] {
  for (const match of html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)) {
    const heading = normalizeText(match[1] || "");
    if (!label.test(heading)) continue;
    const start = (match.index || 0) + match[0].length;
    const rest = html.slice(start);
    const nextHeading = rest.search(/<h[1-6]\b/i);
    const section = rest.slice(0, nextHeading >= 0 ? nextHeading : 20_000);
    const firstList = section.match(/<ul\b[^>]*>([\s\S]*?)<\/ul>/i);
    return firstList ? listItems(firstList[1] || "") : [];
  }
  return [];
}

function listItems(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const text = normalizeText(match[1] || "");
    if (text.length < 3 || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function detailBidLog(html: string): NonNullable<ShadeDossierData["bidLog"]> {
  const rows: NonNullable<ShadeDossierData["bidLog"]> = [];
  for (const block of classBlocks(html, /bid-history|bid-row|bid-log|bidder-row/).slice(0, 20)) {
    const amount = cleanText(firstMatch(normalizeText(block), /(\$[\d,]+(?:\.\d{2})?)/));
    const bidder = textFromClassBlock(block, /bidder|username|user|member/) || cleanText(firstMatch(normalizeText(block), /(?:by|from)\s+([A-Za-z0-9_.-]{2,})/i));
    const ago = textFromClassBlock(block, /ago|time|date/) || timeText(block);
    if (!amount || !bidder) continue;
    rows.push({ bidder, amount, ...(ago ? { ago } : {}) });
  }
  return rows;
}

function detailComments(html: string): NonNullable<ShadeDossierData["comments"]> {
  const rows: NonNullable<ShadeDossierData["comments"]> = [];
  for (const block of classBlocks(html, /comment\b|comment-item|comment-row/).slice(0, 30)) {
    const user = textFromClassBlock(block, /comment-author|author|username|user/) || cleanText(firstMatch(block, /data-author=["']([^"']+)["']/i));
    const body = textFromClassBlock(block, /comment-content|comment-body|body|content/) || paragraphText(block);
    const ago = textFromClassBlock(block, /ago|date|time/) || timeText(block);
    if (!user || !body || body.length < 5) continue;
    rows.push({
      user,
      body,
      ...(ago ? { ago } : {}),
      ...(isSellerComment(block) ? { seller: true } : {}),
    });
  }
  return rows;
}

function classBlocks(html: string, classPattern: RegExp): string[] {
  const blocks: string[] = [];
  const pattern = /<(article|li|tr|div|span|p|time)\b[^>]*class=["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of html.matchAll(pattern)) {
    if (classPattern.test(match[2] || "")) blocks.push(match[0] || "");
  }
  return blocks;
}

function labeledValue(html: string, label: RegExp): string | undefined {
  for (const match of html.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) {
    if (label.test(normalizeText(match[1] || ""))) return cleanText(normalizeText(match[2] || ""));
  }
  for (const match of html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/gi)) {
    if (label.test(normalizeText(match[1] || ""))) return cleanText(normalizeText(match[2] || ""));
  }
  for (const match of html.matchAll(/<(?:li|p|div)\b[^>]*>([\s\S]*?)<\/(?:li|p|div)>/gi)) {
    const text = normalizeText(match[1] || "");
    const parts = text.match(/^([^:]{2,45}):\s*(.{1,140})$/);
    if (parts && label.test(parts[1] || "")) return cleanText(parts[2] || "");
  }
  return undefined;
}

function countLabel(html: string, label: RegExp): number | undefined {
  const text = normalizeText(html);
  for (const match of text.matchAll(/(\d{1,4})\s+([A-Za-z ]{2,20})/g)) {
    if (label.test(match[2] || "")) return Number(match[1]);
  }
  for (const match of text.matchAll(/([A-Za-z ]{2,20}):\s*(\d{1,4})/g)) {
    if (label.test(match[1] || "")) return Number(match[2]);
  }
  return undefined;
}

function textFromClass(html: string, classPattern: RegExp): string | undefined {
  const block = classBlocks(html, classPattern)[0];
  return block ? normalizeText(block) : undefined;
}

function textFromClassBlock(html: string, classPattern: RegExp): string | undefined {
  const leafPattern = /<(span|p|time|a|strong|em)\b[^>]*class=["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of html.matchAll(leafPattern)) {
    if (classPattern.test(match[2] || "")) return normalizeText(match[3] || "");
  }
  return textFromClass(html, classPattern);
}

function paragraphText(html: string): string | undefined {
  const match = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  return match ? normalizeText(match[1] || "") : undefined;
}

function timeText(html: string): string | undefined {
  const match = html.match(/<time\b[^>]*>([\s\S]*?)<\/time>/i);
  return match ? normalizeText(match[1] || "") : undefined;
}

function isSellerComment(html: string): boolean {
  return /seller|listing-author|author-badge|badge-seller/i.test(html);
}

function imageUrlsFromText(text: string): string[] {
  const urls = Array.from(text.matchAll(/https?:\/\/[^\s"'<>]+?\.(?:jpe?g|png|webp)(?:\?[^\s"'<>]*)?/gi)).map((match) => decodeHtml(match[0]));
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const url of urls) {
    const canonical = url.replace(/\?.*$/, "");
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    unique.push(url);
  }
  return unique;
}

function normalizeBaTPageUrl(value: string | undefined, baseUrl: string): string {
  if (!value) return "";
  try {
    const url = new URL(decodeHtml(value), baseUrl);
    if (!/(^|\.)bringatrailer\.com$/i.test(url.hostname)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function labelFromBaTUrl(value: string): string {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const slug = parts.slice(-2).join(" ") || parts.at(-1) || "custom BaT seed";
    return slug
      .split(/[-\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return "Custom BaT seed";
  }
}

function dedupePages(pages: Array<{ label: string; url: string }>): Array<{ label: string; url: string }> {
  const byUrl = new Map<string, { label: string; url: string }>();
  for (const page of pages) {
    const url = normalizeBaTPageUrl(page.url, "https://bringatrailer.com/");
    if (!url || byUrl.has(url)) continue;
    byUrl.set(url, { ...page, url });
  }
  return [...byUrl.values()];
}

function attr(html: string, name: string): string {
  return firstMatch(html, new RegExp(`${escapeRegExp(name)}=["']([^"']+)["']`, "i"));
}

function textFromXmlTag(xml: string, tagName: string): string | null {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}[^>]*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*<\\/${escaped}>`, "i"));
  return match ? match[1] || match[2] || null : null;
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

function isoDateOrUndefined(value: string | null): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function parseMoney(value: string): number | undefined {
  const match = value.replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function centsFromDollars(value: number | undefined): number | undefined {
  return Number.isFinite(value) && value !== undefined ? Math.round(value * 100) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}
