#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { launchCarsAndBidsContext } from "./cab-browser.mjs";

const NOW = process.env.NOW ? new Date(process.env.NOW) : new Date();
const dateStamp = NOW.toISOString().slice(0, 10);
const outPath = resolve(process.env.CAB_OUT || `outputs/cars-and-bids-candidates-${dateStamp}.json`);
const debugPath = resolve(process.env.CAB_DEBUG_OUT || `.tmp/cars-and-bids-network-${dateStamp}.json`);
const debugScreenshotPath = resolve(process.env.CAB_DEBUG_SCREENSHOT || `.tmp/cars-and-bids-blocked-${dateStamp}.png`);
const headless = process.env.CAB_HEADLESS !== "0";
const maxDetails = Number(process.env.CAB_MAX_DETAILS || 30);
const maxImages = Number(process.env.CAB_MAX_IMAGES || 5);
const scrapeConfig = await buildScrapeConfig();
const discoveryUrls = scrapeConfig.discoveryUrls;
const maxPerBucket = Number(process.env.CAB_MAX_PER_BUCKET ?? (scrapeConfig.mode === "targeted" ? 0 : 2));
const includeClosed = truthy(process.env.CAB_INCLUDE_CLOSED);

const networkRecords = [];
const discovered = new Map();
let activeDiscovery = null;
for (const url of scrapeConfig.seedUrls) {
  upsertDiscovered(discovered, { title: titleFromUrl(url), url });
}
console.log(
  `[C&B] Starting ${headless ? "headless" : "headed"} ${scrapeConfig.mode} scrape with ${discoveryUrls.length} discovery URLs; max details ${maxDetails}.`,
);
if (scrapeConfig.queries.length) console.log(`[C&B] Queries: ${scrapeConfig.queries.join(" | ")}`);
if (maxPerBucket > 0) console.log(`[C&B] Diversity cap: ${maxPerBucket} per model bucket.`);
else console.log("[C&B] Diversity cap disabled for targeted scrape.");
if (includeClosed) console.log("[C&B] Including closed/sold listings as comps.");
const context = await openContextOrWriteBlocked();
console.log("[C&B] Browser context opened.");
const page = context.pages()[0] || (await context.newPage());

page.on("response", async (response) => {
  const contentType = response.headers()["content-type"] || "";
  if (!contentType.includes("application/json")) return;
  const url = response.url();
  if (!/carsandbids\.com/i.test(url)) return;
  if (!isListingApiResponse(url)) return;
  try {
    const json = await response.json();
    networkRecords.push({ url, status: response.status(), json: trimJson(json) });
    for (const candidate of extractListingsFromJson(json)) {
      upsertDiscovered(discovered, annotateDiscovery(candidate, activeDiscovery));
    }
  } catch {
    // Ignore non-parseable JSON responses.
  }
});

try {
  for (const [index, target] of scrapeConfig.discoveryTargets.entries()) {
    const url = target.url;
    activeDiscovery = target;
    console.log(`[C&B] Discovery ${index + 1}/${discoveryUrls.length}: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    const blocked = await isBlocked(page);
    if (blocked) {
      await captureBlockedPage(page, debugScreenshotPath);
      await writeFallback(outPath, debugPath, networkRecords, {
        status: "blocked",
        reason: "auth_or_challenge_required",
        checkedAt: new Date().toISOString(),
        message: `Run bun run cab:login, complete Cloudflare/sign-in, then rerun bun run cab:scrape. Screenshot: ${debugScreenshotPath}`,
      });
      await context.close();
      process.exit(2);
    }
    for (const candidate of await extractListingsFromDom(page)) {
      upsertDiscovered(discovered, annotateDiscovery(candidate, target));
    }
    console.log(`[C&B] Discovery ${index + 1}/${discoveryUrls.length} complete; ${discovered.size} unique candidates so far.`);
    activeDiscovery = null;
  }

  const rankedCandidates = rankCandidates([...discovered.values()], {
    maxPerBucket,
    mode: scrapeConfig.mode,
    queryOrder: scrapeConfig.queries,
    includeClosed,
  });
  const detailCandidates = rankedCandidates.slice(0, maxDetails);
  console.log(`[C&B] Scraping details for ${detailCandidates.length} candidates.`);
  const detailed = [];
  for (const [index, candidate] of detailCandidates.entries()) {
    console.log(`[C&B] Detail ${index + 1}/${detailCandidates.length}: ${candidate.title || candidate.url}`);
    const detail = await scrapeDetail(context, candidate.url).catch((error) => ({
      ...candidate,
      scrapeError: error instanceof Error ? error.message : String(error),
    }));
    detailed.push(
      toCandidateListing({
        ...candidate,
        ...withoutEmpty(detail),
        images: dedupe([...(candidate.images || []), ...(detail.images || [])]),
      }),
    );
  }

  await mkdir(resolve(outPath, ".."), { recursive: true });
  await writeFile(
    outPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "Cars & Bids",
        status: "ok",
        mode: scrapeConfig.mode,
        queries: scrapeConfig.queries,
        discoveryUrls,
        maxDetails,
        maxPerBucket,
        includeClosed,
        listings: detailed,
      },
      null,
      2,
    )}\n`,
  );
  await writeDebug(debugPath, networkRecords);
  console.log(`Wrote ${detailed.length} Cars & Bids candidates to ${outPath}`);
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  await writeFallback(outPath, debugPath, networkRecords, {
    status: "blocked",
    reason: "unexpected_scrape_error",
    checkedAt: new Date().toISOString(),
    message,
  });
  process.exitCode = 1;
} finally {
  await context.close();
}

async function openContextOrWriteBlocked() {
  try {
    return await launchCarsAndBidsContext({ headless });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const profileInUse = /profile is already in use|profile directory is already in use|ProcessSingleton|SingletonLock/i.test(message);
    await writeFallback(outPath, debugPath, networkRecords, {
      status: "blocked",
      reason: profileInUse ? "profile_in_use" : "browser_launch_failed",
      checkedAt: new Date().toISOString(),
      message,
    });
    process.exit(2);
  }
}

async function buildScrapeConfig() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode || process.env.CAB_MODE || process.env.CAB_DISCOVERY_MODE || "broad";
  const fileQueries = await readQueryFile(process.env.CAB_QUERY_FILE || process.env.CAB_TARGETS_FILE);
  const envQueries = parseList(process.env.CAB_QUERIES || process.env.CAB_TARGETS || "");
  const cliQueries = args.queries;
  const queries = dedupe([...envQueries, ...fileQueries, ...cliQueries]);
  const explicitUrls = dedupe([...parseList(process.env.CAB_DISCOVERY_URLS || ""), ...args.urls]);

  const effectiveQueries = queries.length ? queries : explicitUrls.length ? [] : defaultSearchQueries();
  const queryUrls = effectiveQueries.map((query) => searchUrl(query));
  const includeGeneric =
    args.includeGeneric ||
    truthy(process.env.CAB_INCLUDE_GENERIC) ||
    (mode !== "targeted" && explicitUrls.length === 0 && queries.length === 0);
  const discoveryTargets = dedupeTargets([
    ...explicitUrls.map((url) => ({ url, kind: isListingUrl(url) ? "listing" : "url" })),
    ...effectiveQueries.map((query) => ({ url: searchUrl(query), kind: "query", query })),
    ...(includeGeneric ? [{ url: "https://carsandbids.com/auctions/", kind: "generic" }] : []),
  ]);
  const discoveryUrls = discoveryTargets.map((target) => target.url);
  const seedUrls = dedupe([...explicitUrls, ...args.urls].filter(isListingUrl));

  return {
    mode,
    queries: effectiveQueries,
    discoveryTargets: discoveryTargets.length ? discoveryTargets : defaultDiscoveryTargets(),
    discoveryUrls: discoveryUrls.length ? discoveryUrls : defaultDiscoveryUrls(),
    seedUrls,
  };
}

function parseArgs(args) {
  const out = { mode: undefined, queries: [], urls: [], includeGeneric: false };
  for (const arg of args) {
    if (arg === "--targeted") {
      out.mode = "targeted";
      continue;
    }
    if (arg === "--broad") {
      out.mode = "broad";
      continue;
    }
    if (arg === "--include-generic") {
      out.includeGeneric = true;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      out.mode = arg.slice("--mode=".length).trim() || undefined;
      continue;
    }
    if (arg.startsWith("--query=")) {
      out.queries.push(...parseList(arg.slice("--query=".length)));
      continue;
    }
    if (arg.startsWith("--url=")) {
      out.urls.push(...parseList(arg.slice("--url=".length)).map(absoluteUrl));
      continue;
    }
    if (/^https?:\/\//i.test(arg)) out.urls.push(absoluteUrl(arg));
    else if (arg.trim()) out.queries.push(arg.trim());
  }
  out.queries = dedupe(out.queries);
  out.urls = dedupe(out.urls);
  return out;
}

async function readQueryFile(path) {
  if (!path) return [];
  const text = await readFile(resolve(path), "utf8").catch(() => "");
  if (!text.trim()) return [];
  try {
    const json = JSON.parse(text);
    if (Array.isArray(json)) return json.flatMap((item) => parseList(String(item || "")));
    if (Array.isArray(json.queries)) return json.queries.flatMap((item) => parseList(String(item || "")));
    if (Array.isArray(json.targets)) return json.targets.flatMap((item) => parseList(String(item || "")));
  } catch {
    // Fall through to text parsing.
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean);
}

function annotateDiscovery(candidate, target) {
  const queries = target?.sourceQueries?.length ? target.sourceQueries : target?.query ? [target.query] : [];
  if (!queries.length) return candidate;
  return {
    ...candidate,
    sourceQueries: dedupe([...(candidate.sourceQueries || []), ...queries]),
  };
}

async function scrapeDetail(context, url) {
  const page = await context.newPage();
  const detailRecords = [];
  page.on("response", async (response) => {
    const contentType = response.headers()["content-type"] || "";
    if (!contentType.includes("application/json")) return;
    if (!/carsandbids\.com/i.test(response.url())) return;
    if (!isListingApiResponse(response.url())) return;
    try {
      const json = await response.json();
      detailRecords.push({ url: response.url(), status: response.status(), json: trimJson(json) });
    } catch {}
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  if (await isBlocked(page)) throw new Error("Cars & Bids auth/challenge page");

  const dom = await extractDetailFromDom(page);
  const jsonCandidates = detailRecords.flatMap((record) => extractListingsFromJson(record.json));
  const jsonBest = jsonCandidates.find((candidate) => normalizeUrl(candidate.url) === normalizeUrl(url)) || jsonCandidates[0] || {};
  await page.close();
  return { ...jsonBest, ...dom, url };
}

async function isBlocked(page) {
  const title = await page.title().catch(() => "");
  const body = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  return /just a moment|verify you are human|cloudflare|checking your browser|unsupported command-line flag/i.test(`${title}\n${body}`);
}

async function captureBlockedPage(page, screenshotPath) {
  await mkdir(resolve(screenshotPath, ".."), { recursive: true }).catch(() => {});
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
}

async function extractListingsFromDom(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const listingLinks = [...document.querySelectorAll('a[href*="/auctions/"]')];
    const output = [];
    for (const link of listingLinks) {
      const href = link.href;
      if (!/\/auctions\/[^/]+\/[^/?#]+/.test(href)) continue;
      let node = link;
      for (let i = 0; i < 5 && node?.parentElement; i += 1) node = node.parentElement;
      const text = normalize(node?.innerText || link.textContent || "");
      const title = normalize(link.textContent || text.split(/\n/)[0]);
      const images = [...(node || document).querySelectorAll("img")]
        .map((img) => img.currentSrc || img.src)
        .filter((src) => /media\.carsandbids\.com|carsandbids/i.test(src));
      output.push({ title, url: href, cardText: text, images });
    }
    return output;
  });
}

async function extractDetailFromDom(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const text = normalize(document.body?.innerText || "");
    const title = normalize(document.querySelector("h1")?.textContent || document.title.replace(/\s*\|\s*Cars & Bids.*$/i, ""));
    const images = [...document.querySelectorAll("img")]
      .map((img) => img.currentSrc || img.src)
      .filter((src) => /media\.carsandbids\.com|carsandbids/i.test(src));
    return { title, pageText: text, images };
  });
}

function extractListingsFromJson(value) {
  const listings = [];
  walk(value, (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const url = urlFromNode(node);
    const title = stringValue(node.title, node.auction_title, node.auctionTitle, node.name, node.vehicleTitle);
    if (!url || !title) return;
    listings.push({
      title,
      url,
      bidNum: numberValue(node.current_bid, node.currentBid, node.highest_bid, node.highestBid, node.high_bid, node.highBid),
      saleAmount: numberValue(node.sale_amount, node.saleAmount, node.sold_price, node.soldPrice),
      status: stringValue(node.status, node.auction_status, node.auctionStatus),
      location: stringValue(node.location, node.city_state, node.cityState, node.vehicle_location),
      endsAt: dateValue(node.ends_at, node.end_time, node.endTime, node.auction_end, node.auctionEnd),
      bids: numberValue(node.bid_count, node.bidCount, node.bids_count, node.bidsCount),
      comments: numberValue(node.comment_count, node.commentCount, node.comments_count, node.commentsCount),
      images: imageUrlsFromNode(node),
    });
  });
  return listings;
}

function walk(value, visit, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  visit(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, seen);
    return;
  }
  for (const item of Object.values(value)) walk(item, visit, seen);
}

function urlFromNode(node) {
  const raw = stringValue(node.url, node.path, node.href, node.auction_url, node.auctionUrl);
  if (raw && /\/auctions\//.test(raw)) return absoluteUrl(raw);
  const id = stringValue(node.id, node.auction_id, node.auctionId);
  const slug = stringValue(node.slug, node.auction_slug, node.auctionSlug);
  if (id && slug) return `https://carsandbids.com/auctions/${id}/${slug}`;
  const title = stringValue(node.title, node.auction_title, node.auctionTitle, node.name, node.vehicleTitle);
  if (id && title) return `https://carsandbids.com/auctions/${id}/${slugify(title)}`;
  return null;
}

function imageUrlsFromNode(node) {
  const images = [];
  walk(node, (inner) => {
    if (typeof inner !== "object" || Array.isArray(inner)) return;
    const baseUrl = stringValue(inner.base_url, inner.baseUrl);
    const path = stringValue(inner.path);
    if (baseUrl && path && /\.(?:jpg|jpeg|png|webp)(?:\?|$)/i.test(path)) {
      images.push(`https://${baseUrl.replace(/^https?:\/\//i, "")}/${path}`);
    }
    for (const value of Object.values(inner)) {
      if (typeof value === "string" && /https?:\/\/[^"\s]+(?:jpg|jpeg|png|webp)/i.test(value)) images.push(value);
    }
  });
  return dedupe(images);
}

function toCandidateListing(input) {
  const pageText = input.pageText || input.cardText || "";
  const listingText = input.cardText || input.subTitle || input.subtitle || "";
  const status = stringValue(input.status);
  const closed = isClosedStatus(status);
  const bidNum = closed ? undefined : input.bidNum || parseCurrentBidNumber(pageText);
  const saleAmount = input.saleAmount || (closed ? input.bidNum : undefined);
  const bid = closed
    ? saleAmount
      ? `sold for ${money(saleAmount)}`
      : status || "closed"
    : bidNum
      ? money(bidNum)
      : stringValue(input.bid) || "check listing";
  const endsAt = input.endsAt || undefined;
  return {
    section: "Worth a look",
    lane: inferLane(input.title, listingText),
    site: "Cars & Bids",
    title: input.title || "Untitled Cars & Bids listing",
    url: normalizeUrl(input.url),
    bid,
    total: closed ? "comp only" : totalFor(bidNum, bid),
    ...(bidNum ? { bidNum } : {}),
    ...(saleAmount ? { saleAmount } : {}),
    ...(status ? { listingStatus: status } : {}),
    ...(input.location ? { location: input.location } : {}),
    ...(endsAt ? { endsAt } : {}),
    ...(endsAt ? { ends: formatEnds(new Date(endsAt)), timeLeft: timeLeft(new Date(endsAt)) } : { timeLeft: "check listing" }),
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
    images: dedupe(input.images || []).slice(0, maxImages),
  };
}

function defaultDiscoveryUrls() {
  return defaultDiscoveryTargets().map((target) => target.url);
}

function defaultDiscoveryTargets() {
  return [
    ...defaultSearchQueries().map((query) => ({ url: searchUrl(query), kind: "query", query })),
    { url: "https://carsandbids.com/auctions/", kind: "generic" },
  ];
}

function defaultSearchQueries() {
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

function searchUrl(query) {
  return `https://carsandbids.com/search?q=${encodeURIComponent(query)}`;
}

function rankCandidates(candidates, options = {}) {
  const maxPerBucket = Number(options.maxPerBucket || 0);
  const pool = candidates.filter((candidate) => options.includeClosed || !isClosedStatus(candidate.status));
  const ranked = pool
    .map((candidate) => ({ ...candidate, relevanceScore: relevanceScore(candidate) }))
    .filter((candidate) => candidate.relevanceScore > 0)
    .sort((left, right) => right.relevanceScore - left.relevanceScore || (left.bidNum || 0) - (right.bidNum || 0));

  const ordered =
    options.mode === "targeted" && options.queryOrder?.length ? interleaveByQuery(ranked, options.queryOrder) : ranked;

  if (ordered.length) return diversifyCandidates(ordered, { maxPerBucket });
  return pool.slice().sort((left, right) => (left.bidNum || 0) - (right.bidNum || 0));
}

function interleaveByQuery(candidates, queryOrder) {
  const queryKeys = queryOrder.map(queryKey);
  const byQuery = new Map(queryKeys.map((key) => [key, []]));
  const rest = [];

  for (const candidate of candidates) {
    const sourceKeys = (candidate.sourceQueries || []).map(queryKey);
    const key = sourceKeys.find((sourceKey) => byQuery.has(sourceKey));
    if (key) byQuery.get(key).push(candidate);
    else rest.push(candidate);
  }

  const selected = [];
  const seen = new Set();
  let added = true;
  while (added) {
    added = false;
    for (const key of queryKeys) {
      const queue = byQuery.get(key) || [];
      while (queue.length) {
        const candidate = queue.shift();
        const candidateKey = normalizeUrl(candidate.url);
        if (seen.has(candidateKey)) continue;
        seen.add(candidateKey);
        selected.push(candidate);
        added = true;
        break;
      }
    }
  }

  for (const candidate of rest) {
    const candidateKey = normalizeUrl(candidate.url);
    if (seen.has(candidateKey)) continue;
    seen.add(candidateKey);
    selected.push(candidate);
  }

  return selected;
}

function queryKey(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function diversifyCandidates(candidates, options = {}) {
  const maxPerBucket = Number(options.maxPerBucket || 0);
  const selected = [];
  const deferred = [];
  const bucketCounts = new Map();
  const titleCounts = new Map();

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

function modelBucket(candidate) {
  const text = `${candidate.title || ""} ${candidate.cardText || ""}`.toLowerCase();
  const buckets = [
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

function relevanceScore(candidate) {
  const text = `${candidate.title || ""} ${candidate.cardText || ""}`.toLowerCase();
  let score = 0;
  const checks = [
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
  if (bidNum > 45_000) score -= 10;
  else if (bidNum > 32_000) score -= 5;

  return score;
}

function upsertDiscovered(map, candidate) {
  const url = normalizeUrl(candidate.url);
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

function trimJson(value) {
  const text = JSON.stringify(value);
  if (text.length <= 250_000) return value;
  return { truncated: true, bytes: text.length };
}

async function writeFallback(out, debug, networkRecords, summary) {
  await mkdir(resolve(out, ".."), { recursive: true });
  await writeFile(out, `${JSON.stringify({ generatedAt: new Date().toISOString(), source: "Cars & Bids", ...summary, listings: [] }, null, 2)}\n`);
  await writeDebug(debug, networkRecords);
  console.warn(`${summary.message} Wrote empty C&B candidate file to ${out}`);
}

async function writeDebug(path, records) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2)}\n`).catch(() => {});
}

function normalizeUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url, "https://carsandbids.com");
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeDiscoveryUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url, "https://carsandbids.com");
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function absoluteUrl(value) {
  return new URL(value, "https://carsandbids.com").toString();
}

function isListingUrl(value) {
  return /\/auctions\/[^/?#]+\/[^/?#]+/i.test(String(value || ""));
}

function isListingApiResponse(value) {
  return /\/v\d+\/autos\/auctions(?:\?|$|\/)/i.test(String(value || ""));
}

function titleFromUrl(value) {
  try {
    const parsed = new URL(value, "https://carsandbids.com");
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

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseList(value) {
  return String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupeTargets(targets) {
  const byUrl = new Map();
  for (const target of targets) {
    const url = normalizeDiscoveryUrl(target.url);
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

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function stringValue(...values) {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function numberValue(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = parseMoneyNumber(value);
      if (parsed) return parsed;
    }
  }
  return undefined;
}

function dateValue(...values) {
  for (const value of values) {
    if (!value) continue;
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return undefined;
}

function parseMoneyNumber(value) {
  if (!value) return undefined;
  const parsed = Number(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseCurrentBidNumber(text) {
  const match = String(text || "").match(/\b(?:current|high(?:est)?)\s+bid\s*\$([0-9,]+)/i);
  return parseMoneyNumber(match?.[1]);
}

function parseCount(text, label) {
  const match = String(text || "").match(new RegExp(`(?<![$,\\d])(\\d{1,4})\\s+${label}s?\\b`, "i"));
  return match ? Number(match[1]) : undefined;
}

function isClosedStatus(status) {
  return /^(sold|sold_after|reserve_not_met|closed|ended|withdrawn|canceled|cancelled)$/i.test(String(status || "").trim());
}

function totalFor(bidNum, bid) {
  if (!bidNum || bid === "No bids") return "check listing";
  return money(Math.round(bidNum + Math.min(7500, Math.max(250, bidNum * 0.05))));
}

function timeLeft(end) {
  const delta = end.getTime() - NOW.getTime();
  if (delta <= 0) return "ended";
  const minutes = Math.floor(delta / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days === 0) return `today, ${hours}h ${mins}m`;
  if (days === 1) return `1 day, ${hours}h`;
  return `${days} days, ${hours}h`;
}

function formatEnds(end) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(end);
}

function inferLane(title, text) {
  const titleBlob = String(title || "").toLowerCase();
  const blob = `${title} ${text}`.toLowerCase();
  if (/wrangler|\bcj\b|4runner|bronco|blazer|jimmy|lx 470|land cruiser|xterra|samurai|tracker|sidekick|baja|brat|montero|delica/.test(titleBlob)) {
    return "family";
  }
  if (/vespa|motorcycle|bmw r|harley|monkey|grom|scooter|boxster|cayman|miata|mx-5|z3|z4|spider|roadster|coupe|mini cooper|fiesta|wrx/.test(titleBlob)) {
    return "solo";
  }
  if (/midget|kei|gem|mini car|odd|project/.test(blob)) return "curiosity";
  return "family";
}

function money(value) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function dedupe(values) {
  const seen = new Set();
  const out = [];
  for (const value of values.filter(Boolean).map(String)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function withoutEmpty(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0)),
  );
}
