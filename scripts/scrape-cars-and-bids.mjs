#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { launchCarsAndBidsContext } from "./cab-browser.mjs";
import * as cabCore from "../src/worker/sources/cars-and-bids.ts";

const NOW = process.env.NOW ? new Date(process.env.NOW) : new Date();
const dateStamp = NOW.toISOString().slice(0, 10);
const outPath = resolve(process.env.CAB_OUT || `outputs/cars-and-bids-candidates-${dateStamp}.json`);
const debugPath = resolve(process.env.CAB_DEBUG_OUT || `.tmp/cars-and-bids-network-${dateStamp}.json`);
const debugScreenshotPath = resolve(process.env.CAB_DEBUG_SCREENSHOT || `.tmp/cars-and-bids-blocked-${dateStamp}.png`);
const headless = process.env.CAB_HEADLESS !== "0";
const maxDetails = Number(process.env.CAB_MAX_DETAILS || 30);
const maxImages = Number(process.env.CAB_MAX_IMAGES || 5);
const scrapeConfig = await buildScrapeConfig();
const maxDiscoveryUrls = positiveInteger(process.env.CAB_MAX_DISCOVERY_URLS, scrapeConfig.discoveryTargets.length);
const discoveryTargets = scrapeConfig.discoveryTargets.slice(0, maxDiscoveryUrls);
const discoveryUrls = discoveryTargets.map((target) => target.url);
const maxApiRecords = positiveInteger(process.env.CAB_MAX_API_RECORDS, 120);
const maxLoadMoreSteps = positiveInteger(process.env.CAB_MAX_LOAD_MORE_STEPS, scrapeConfig.mode === "targeted" ? 2 : 4);
const maxApiReplayPagesPerEndpoint = nonNegativeInteger(process.env.CAB_MAX_API_REPLAY_PAGES, scrapeConfig.mode === "targeted" ? 4 : 2);
const pageDelayMs = nonNegativeInteger(process.env.CAB_PAGE_DELAY_MS, 750);
const maxPerBucket = Number(process.env.CAB_MAX_PER_BUCKET ?? (scrapeConfig.mode === "targeted" ? 0 : 2));
const includeClosed = cabCore.truthy(process.env.CAB_INCLUDE_CLOSED);

const networkRecords = [];
const apiAccessIssues = [];
const paginationEvents = [];
const apiReplayEvents = [];
const apiReplayUrlsInFlight = new Set();
const discovered = new Map();
let activeDiscovery = null;
for (const url of scrapeConfig.seedUrls) {
  cabCore.upsertCarsAndBidsCandidate(discovered, { title: cabCore.titleFromCarsAndBidsUrl(url), url });
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
  const url = response.url();
  if (!/carsandbids\.com/i.test(url)) return;
  if (response.status() === 403 || response.status() === 429) {
    apiAccessIssues.push({ url, status: response.status(), reason: response.status() === 429 ? "rate_limited" : "forbidden_or_challenge" });
  }
  if (apiReplayUrlsInFlight.has(url)) return;
  const contentType = response.headers()["content-type"] || "";
  if (!contentType.includes("application/json")) return;
  if (!cabCore.isCarsAndBidsListingApiResponse(url)) return;
  try {
    const json = await response.json();
    ingestApiRecord({ url, status: response.status(), json }, activeDiscovery);
  } catch {
    // Ignore non-parseable JSON responses.
  }
});

try {
  for (const [index, target] of discoveryTargets.entries()) {
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
      cabCore.upsertCarsAndBidsCandidate(discovered, annotateDiscovery(withDomLocation(candidate), target));
    }
    const pagination = await loadAdditionalDiscovery(page, target);
    paginationEvents.push(pagination);
    const apiReplay = await replayApiPagination(page, target);
    if (apiReplay.attempted > 0 || apiReplay.available > 0) apiReplayEvents.push(apiReplay);
    console.log(`[C&B] Discovery ${index + 1}/${discoveryUrls.length} complete; ${discovered.size} unique candidates so far.`);
    activeDiscovery = null;
    if (pageDelayMs > 0 && index < discoveryTargets.length - 1) await delay(pageDelayMs);
  }

  const discoveredCandidates = [...discovered.values()];
  const closedCandidateCount = discoveredCandidates.filter((candidate) => cabCore.isCarsAndBidsClosedStatus(candidate.status)).length;
  const activeCandidateCount = discoveredCandidates.length - closedCandidateCount;
  const rankedCandidates = cabCore.rankCarsAndBidsCandidates(discoveredCandidates, {
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
      cabCore.toCarsAndBidsListing({
        ...candidate,
        ...cabCore.withoutEmpty(detail),
        images: cabCore.dedupe([...(candidate.images || []), ...(detail.images || [])]),
      }, { maxImages, now: NOW }),
    );
  }
  const accessBlocked = apiAccessIssues.length > 0 && discoveredCandidates.length === 0 && detailed.length === 0;
  const status = accessBlocked ? "blocked" : cabCore.carsAndBidsOutputStatus(detailed);

  await mkdir(resolve(outPath, ".."), { recursive: true });
  const apiCoverage = apiCoverageStats(networkRecords);
  const diagnostics = {
    discoveredCount: discoveredCandidates.length,
    activeCandidateCount,
    closedCandidateCount,
    rankedCount: rankedCandidates.length,
    detailAttemptCount: detailCandidates.length,
    networkRecordCount: networkRecords.length,
    apiCoverage,
    apiAccessIssues,
    pagination: paginationEvents,
    apiReplay: apiReplayEvents,
    limits: {
      maxDiscoveryUrls,
      maxApiRecords,
      maxLoadMoreSteps,
      maxApiReplayPagesPerEndpoint,
      pageDelayMs,
    },
  };
  await writeFile(
    outPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "Cars & Bids",
        status,
        ...(status === "empty" ? { message: emptyMessage(diagnostics, includeClosed) } : {}),
        ...(status === "blocked" ? { message: blockedMessage(diagnostics) } : {}),
        mode: scrapeConfig.mode,
        queries: scrapeConfig.queries,
        discoveryUrls,
        maxDetails,
        maxPerBucket,
        includeClosed,
        diagnostics,
        warnings: diagnosticsWarnings(diagnostics),
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
    status: "failed",
    reason: "unexpected_scrape_error",
    checkedAt: new Date().toISOString(),
    message,
  });
  process.exitCode = 1;
} finally {
  await context.close();
}

async function loadAdditionalDiscovery(page, target) {
  const event = {
    url: target.url,
    steps: 0,
    clicks: 0,
    scrolls: 0,
    networkRecordsBefore: networkRecords.length,
    candidatesBefore: discovered.size,
    stoppedBecause: "not_started",
  };
  let idleSteps = 0;
  let forceScroll = false;

  for (let step = 0; step < maxLoadMoreSteps; step += 1) {
    if (networkRecords.length >= maxApiRecords) {
      event.stoppedBecause = "max_api_records";
      break;
    }

    const beforeRecords = networkRecords.length;
    const beforeCandidates = discovered.size;
    const clicked = forceScroll ? false : await clickLoadMore(page);
    if (clicked) event.clicks += 1;
    else {
      event.scrolls += 1;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    }

    event.steps += 1;
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
    await delay(pageDelayMs);
    for (const candidate of await extractListingsFromDom(page).catch(() => [])) {
      cabCore.upsertCarsAndBidsCandidate(discovered, annotateDiscovery(withDomLocation(candidate), target));
    }

    if (networkRecords.length === beforeRecords && discovered.size === beforeCandidates) {
      idleSteps += 1;
      forceScroll = clicked;
      if (idleSteps >= 2) {
        event.stoppedBecause = clicked ? "load_more_no_progress" : "scroll_no_progress";
        break;
      }
    } else {
      idleSteps = 0;
      forceScroll = false;
      event.stoppedBecause = "made_progress";
    }
  }

  if (event.stoppedBecause === "not_started" || event.stoppedBecause === "made_progress") {
    event.stoppedBecause = event.steps >= maxLoadMoreSteps ? "max_load_more_steps" : event.stoppedBecause;
  }
  return {
    ...event,
    networkRecordsAfter: networkRecords.length,
    candidatesAfter: discovered.size,
  };
}

async function clickLoadMore(page) {
  const button = page
    .getByRole("button", { name: /load more|show more|more auctions|view more/i })
    .or(page.getByRole("link", { name: /load more|show more|more auctions|view more/i }))
    .first();
  if (!(await button.isVisible({ timeout: 1_000 }).catch(() => false))) return false;
  await button.click({ timeout: 5_000 }).catch(() => {});
  return true;
}

function ingestApiRecord(record, target) {
  if (networkRecords.length >= maxApiRecords) return false;
  networkRecords.push({ url: record.url, status: record.status, json: cabCore.trimJson(record.json) });
  for (const candidate of cabCore.extractCarsAndBidsListingsFromJson(record.json)) {
    cabCore.upsertCarsAndBidsCandidate(discovered, annotateDiscovery(candidate, target));
  }
  return true;
}

async function replayApiPagination(page, target) {
  const event = {
    url: target.url,
    available: 0,
    attempted: 0,
    fetched: 0,
    failed: 0,
    candidatesBefore: discovered.size,
    networkRecordsBefore: networkRecords.length,
    stoppedBecause: "not_needed",
  };
  if (maxApiReplayPagesPerEndpoint <= 0) {
    event.stoppedBecause = "disabled";
    return { ...event, candidatesAfter: discovered.size, networkRecordsAfter: networkRecords.length };
  }

  const existingRequestKeys = new Set(networkRecords.map((record) => apiRequestKey(record.url)));
  const urls = [];
  for (const record of [...networkRecords]) {
    if (!cabCore.isCarsAndBidsListingApiResponse(record.url)) continue;
    for (const url of cabCore.carsAndBidsPaginationUrlsFromApiRecord(record.url, record.json, maxApiReplayPagesPerEndpoint)) {
      const key = apiRequestKey(url);
      if (existingRequestKeys.has(key)) continue;
      existingRequestKeys.add(key);
      urls.push(url);
    }
  }
  event.available = urls.length;
  if (!urls.length) return { ...event, candidatesAfter: discovered.size, networkRecordsAfter: networkRecords.length };

  event.stoppedBecause = "completed";
  for (const url of urls) {
    if (networkRecords.length >= maxApiRecords) {
      event.stoppedBecause = "max_api_records";
      break;
    }
    event.attempted += 1;
    apiReplayUrlsInFlight.add(url);
    try {
      const result = await fetchApiJson(page, url);
      if (result.status === 403 || result.status === 429) {
        apiAccessIssues.push({ url, status: result.status, reason: result.status === 429 ? "rate_limited" : "forbidden_or_challenge" });
      }
      if (result.status >= 200 && result.status < 300 && result.json) {
        if (ingestApiRecord({ url: result.url || url, status: result.status, json: result.json }, target)) event.fetched += 1;
      } else {
        event.failed += 1;
      }
    } catch {
      event.failed += 1;
    } finally {
      apiReplayUrlsInFlight.delete(url);
    }
    if (pageDelayMs > 0) await delay(Math.min(pageDelayMs, 500));
  }

  return {
    ...event,
    candidatesAfter: discovered.size,
    networkRecordsAfter: networkRecords.length,
  };
}

async function fetchApiJson(page, url) {
  return page.evaluate(async (input) => {
    const response = await fetch(input, { credentials: "include" });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Keep null JSON for diagnostics and failed replay accounting.
    }
    return {
      url: response.url,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      json,
    };
  }, url);
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
  const envQueries = cabCore.parseCarsAndBidsList(process.env.CAB_QUERIES || process.env.CAB_TARGETS || "");
  const cliQueries = args.queries;
  const queries = cabCore.dedupe([...envQueries, ...fileQueries, ...cliQueries]);
  const explicitUrls = cabCore.dedupe([...cabCore.parseCarsAndBidsList(process.env.CAB_DISCOVERY_URLS || ""), ...args.urls]);

  const effectiveQueries = queries.length ? queries : explicitUrls.length ? [] : cabCore.defaultCarsAndBidsSearchQueries();
  const includeGeneric =
    args.includeGeneric ||
    cabCore.truthy(process.env.CAB_INCLUDE_GENERIC) ||
    (mode !== "targeted" && explicitUrls.length === 0 && queries.length === 0);
  const discoveryTargets = cabCore.dedupeCarsAndBidsTargets([
    ...explicitUrls.map((url) => ({ url, kind: cabCore.isCarsAndBidsListingUrl(url) ? "listing" : "url" })),
    ...effectiveQueries.map((query) => ({ url: cabCore.carsAndBidsSearchUrl(query), kind: "query", query })),
    ...(includeGeneric ? [{ url: "https://carsandbids.com/auctions/", kind: "generic" }] : []),
  ]);
  const discoveryUrls = discoveryTargets.map((target) => target.url);
  const seedUrls = cabCore.dedupe([...explicitUrls, ...args.urls].filter(cabCore.isCarsAndBidsListingUrl));

  return {
    mode,
    queries: effectiveQueries,
    discoveryTargets: discoveryTargets.length ? discoveryTargets : cabCore.defaultCarsAndBidsDiscoveryTargets(),
    discoveryUrls: discoveryUrls.length ? discoveryUrls : cabCore.defaultCarsAndBidsDiscoveryUrls(),
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
      out.queries.push(...cabCore.parseCarsAndBidsList(arg.slice("--query=".length)));
      continue;
    }
    if (arg.startsWith("--url=")) {
      out.urls.push(...cabCore.parseCarsAndBidsList(arg.slice("--url=".length)).map(cabCore.absoluteCarsAndBidsUrl));
      continue;
    }
    if (/^https?:\/\//i.test(arg)) out.urls.push(cabCore.absoluteCarsAndBidsUrl(arg));
    else if (arg.trim()) out.queries.push(arg.trim());
  }
  out.queries = cabCore.dedupe(out.queries);
  out.urls = cabCore.dedupe(out.urls);
  return out;
}

async function readQueryFile(path) {
  if (!path) return [];
  const text = await readFile(resolve(path), "utf8").catch(() => "");
  if (!text.trim()) return [];
  try {
    const json = JSON.parse(text);
    if (Array.isArray(json)) return json.flatMap((item) => cabCore.parseCarsAndBidsList(String(item || "")));
    if (Array.isArray(json.queries)) return json.queries.flatMap((item) => cabCore.parseCarsAndBidsList(String(item || "")));
    if (Array.isArray(json.targets)) return json.targets.flatMap((item) => cabCore.parseCarsAndBidsList(String(item || "")));
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
    sourceQueries: cabCore.dedupe([...(candidate.sourceQueries || []), ...queries]),
  };
}

function withDomLocation(candidate) {
  if (candidate.location) return candidate;
  const location = cabCore.extractCarsAndBidsLocationFromText(candidate.cardText || candidate.pageText);
  return location ? { ...candidate, location } : candidate;
}

async function scrapeDetail(context, url) {
  const page = await context.newPage();
  const detailRecords = [];
  page.on("response", async (response) => {
    const contentType = response.headers()["content-type"] || "";
    if (!contentType.includes("application/json")) return;
    if (!/carsandbids\.com/i.test(response.url())) return;
    if (!cabCore.isCarsAndBidsListingApiResponse(response.url())) return;
    try {
      const json = await response.json();
      detailRecords.push({ url: response.url(), status: response.status(), json: cabCore.trimJson(json) });
    } catch {}
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  if (await isBlocked(page)) throw new Error("Cars & Bids auth/challenge page");

  const dom = withDomLocation(await extractDetailFromDom(page));
  const jsonCandidates = detailRecords.flatMap((record) => cabCore.extractCarsAndBidsListingsFromJson(record.json));
  const jsonBest = jsonCandidates.find((candidate) => cabCore.normalizeCarsAndBidsUrl(candidate.url) === cabCore.normalizeCarsAndBidsUrl(url)) || jsonCandidates[0] || {};
  await page.close();
  return { ...jsonBest, ...dom, url };
}

async function isBlocked(page) {
  const title = await page.title().catch(() => "");
  const body = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  return cabCore.looksLikeCarsAndBidsBlockedPage({ title, body });
}

async function captureBlockedPage(page, screenshotPath) {
  await mkdir(resolve(screenshotPath, ".."), { recursive: true }).catch(() => {});
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
}

async function extractListingsFromDom(page) {
  return page.evaluate(cabCore.extractCarsAndBidsListingsFromBrowser);
}

async function extractDetailFromDom(page) {
  return page.evaluate(cabCore.extractCarsAndBidsDetailFromBrowser);
}

async function writeFallback(out, debug, networkRecords, summary) {
  await mkdir(resolve(out, ".."), { recursive: true });
  await writeFile(
    out,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "Cars & Bids",
        ...summary,
        diagnostics: { networkRecordCount: networkRecords.length },
        listings: [],
      },
      null,
      2,
    )}\n`,
  );
  await writeDebug(debug, networkRecords);
  console.warn(`${summary.message} Wrote empty C&B candidate file to ${out}`);
}

async function writeDebug(path, records) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2)}\n`).catch(() => {});
}

function emptyMessage(diagnostics, includeClosed) {
  if (!includeClosed && diagnostics.closedCandidateCount > 0 && diagnostics.activeCandidateCount === 0) {
    return `Cars & Bids returned ${diagnostics.closedCandidateCount} closed comp(s) and no active candidates for this scrape. Set CAB_INCLUDE_CLOSED=1 to export closed comps.`;
  }
  if (diagnostics.discoveredCount > 0 && diagnostics.rankedCount === 0) {
    return `Cars & Bids discovered ${diagnostics.discoveredCount} candidate(s), but none matched the active ranking/filter criteria. Try broader queries, CAB_INCLUDE_CLOSED=1, or inspect the debug output.`;
  }
  return "Cars & Bids scrape completed without discovered candidates; check debug output for access, parser, or API coverage.";
}

function blockedMessage(diagnostics) {
  const issue = diagnostics.apiAccessIssues?.[0];
  if (issue?.status === 429) return "Cars & Bids rate-limited the scraper; retry later with a longer CAB_PAGE_DELAY_MS or fewer CAB_MAX_DISCOVERY_URLS.";
  if (issue) return "Cars & Bids returned an access challenge or forbidden API response; run bun run cab:login and retry in headed mode if needed.";
  return "Cars & Bids scrape was blocked before candidates could be collected.";
}

function diagnosticsWarnings(diagnostics) {
  const warnings = [];
  if (diagnostics.apiCoverage?.missing > 0) {
    warnings.push(
      `Cars & Bids API coverage is partial: fetched ${diagnostics.apiCoverage.fetched}/${diagnostics.apiCoverage.total} API-listed candidate(s) within current load-more/API limits.`,
    );
  }
  if (diagnostics.pagination?.some((event) => /no_progress/.test(event.stoppedBecause || ""))) {
    warnings.push("Load-more/scroll attempts did not expose additional Cars & Bids API records for at least one discovery page.");
  }
  if (diagnostics.apiAccessIssues?.length) {
    warnings.push(`Cars & Bids returned ${diagnostics.apiAccessIssues.length} access/rate-limit response(s).`);
  }
  return warnings;
}

function apiCoverageStats(records) {
  const byEndpoint = new Map();
  for (const record of records) {
    const auctions = Array.isArray(record.json?.auctions) ? record.json.auctions.length : 0;
    const count = Number(record.json?.count ?? auctions);
    const total = Number(record.json?.total ?? count);
    const key = apiCoverageKey(record.url);
    const current = byEndpoint.get(key) || { endpoint: key, fetched: 0, total: 0, requests: 0 };
    const requestKey = apiRequestKey(record.url);
    current.requestKeys = current.requestKeys || new Set();
    if (!current.requestKeys.has(requestKey)) {
      current.fetched += auctions || (Number.isFinite(count) ? count : 0);
      current.requestKeys.add(requestKey);
    }
    current.total = Math.max(current.total, Number.isFinite(total) ? total : 0);
    current.requests += 1;
    byEndpoint.set(key, current);
  }

  const endpoints = [...byEndpoint.values()].map(({ requestKeys, ...entry }) => ({
    ...entry,
    missing: Math.max(0, entry.total - entry.fetched),
  }));
  return {
    endpoints,
    fetched: endpoints.reduce((sum, entry) => sum + entry.fetched, 0),
    total: endpoints.reduce((sum, entry) => sum + entry.total, 0),
    missing: endpoints.reduce((sum, entry) => sum + entry.missing, 0),
  };
}

function apiCoverageKey(value) {
  try {
    const url = new URL(value);
    for (const key of ["timestamp", "signature", "offset", "page", "cursor"]) url.searchParams.delete(key);
    return `${url.pathname}?${[...url.searchParams.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, val]) => `${key}=${val}`)
      .join("&")}`;
  } catch {
    return String(value || "");
  }
}

function apiRequestKey(value) {
  try {
    const url = new URL(value);
    for (const key of ["timestamp", "signature"]) url.searchParams.delete(key);
    return `${url.pathname}?${[...url.searchParams.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, val]) => `${key}=${val}`)
      .join("&")}`;
  } catch {
    return String(value || "");
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
