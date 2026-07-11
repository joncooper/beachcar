#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import {
  buildHemmingsSeedPages,
  isAllowedHemmingsSeedUrl,
  looksLikeHemmingsBlockedPage,
  parseHemmingsDetailPage,
  parseHemmingsListingsPage,
  toHemmingsListing,
} from "../src/worker/sources/hemmings.ts";

const NOW = process.env.NOW ? new Date(process.env.NOW) : new Date();
const dateStamp = NOW.toISOString().slice(0, 10);
const outPath = resolve(process.env.HEMMINGS_OUT || `outputs/hemmings-candidates-${dateStamp}.json`);
const debugPath = resolve(process.env.HEMMINGS_DEBUG_OUT || `.tmp/hemmings-debug-${dateStamp}.json`);
const debugScreenshotPath = resolve(process.env.HEMMINGS_DEBUG_SCREENSHOT || `.tmp/hemmings-blocked-${dateStamp}.png`);
const headless = process.env.HEMMINGS_HEADLESS !== "0";
const maxSeedPages = positiveInteger(process.env.HEMMINGS_MAX_SEED_PAGES, 8);
const maxDetails = positiveInteger(process.env.HEMMINGS_MAX_DETAILS, 6);
const maxImages = positiveInteger(process.env.HEMMINGS_MAX_IMAGES, 6);
const pageDelayMs = nonNegativeInteger(process.env.HEMMINGS_PAGE_DELAY_MS, 750);
const scrapeConfig = buildScrapeConfig();

const diagnostics = {
  seedPages: scrapeConfig.pages.map((page) => ({ label: page.label, url: page.url })),
  pageChecks: [],
  detailChecks: [],
  blockedUrls: [],
  failedUrls: [],
  limits: { maxSeedPages, maxDetails, maxImages, pageDelayMs },
};
const discovered = new Map();

console.log(`[Hemmings] Starting ${headless ? "headless" : "headed"} scrape with ${scrapeConfig.pages.length} seed page(s); max details ${maxDetails}.`);
const context = await openContextOrWriteBlocked();
const page = context.pages()[0] || (await context.newPage());

try {
  for (const [index, seed] of scrapeConfig.pages.entries()) {
    console.log(`[Hemmings] Seed ${index + 1}/${scrapeConfig.pages.length}: ${seed.url}`);
    const response = await page.goto(seed.url, { waitUntil: "domcontentloaded", timeout: 90_000 }).catch((error) => ({ error }));
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    const html = await page.content().catch(() => "");
    const title = await page.title().catch(() => "");
    const body = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    const status = response && "status" in response ? response.status() : response?.error ? 0 : 0;
    if (looksLikeHemmingsBlockedPage({ title, body })) {
      diagnostics.blockedUrls.push(seed.url);
      diagnostics.pageChecks.push({ ...seed, status: "blocked", httpStatus: status, candidateCount: 0 });
      await captureBlockedPage(page, debugScreenshotPath);
      continue;
    }
    if (response?.error) {
      diagnostics.failedUrls.push(seed.url);
      diagnostics.pageChecks.push({ ...seed, status: "failed", error: String(response.error?.message || response.error), candidateCount: 0 });
      continue;
    }
    if (status >= 400) {
      const checkStatus = status === 404 ? "skipped" : "failed";
      diagnostics.pageChecks.push({ ...seed, status: checkStatus, httpStatus: status, candidateCount: 0 });
      if (checkStatus === "failed") diagnostics.failedUrls.push(seed.url);
      continue;
    }
    const parsed = parseHemmingsListingsPage(html, seed);
    diagnostics.pageChecks.push({ ...seed, status: "ok", httpStatus: status, candidateCount: parsed.length });
    for (const candidate of parsed) upsertCandidate(candidate);
    if (pageDelayMs > 0 && index < scrapeConfig.pages.length - 1) await delay(pageDelayMs);
  }

  const ranked = rankCandidates([...discovered.values()]).slice(0, maxDetails);
  console.log(`[Hemmings] Scraping details for ${ranked.length} candidate(s).`);
  const detailed = [];
  for (const [index, candidate] of ranked.entries()) {
    console.log(`[Hemmings] Detail ${index + 1}/${ranked.length}: ${candidate.title || candidate.url}`);
    const detail = await scrapeDetail(context, candidate).catch((error) => ({
      candidate,
      check: { url: candidate.url, title: candidate.title, status: "failed", error: error instanceof Error ? error.message : String(error) },
    }));
    diagnostics.detailChecks.push(detail.check);
    detailed.push(toHemmingsListing(detail.candidate, { maxImages }));
    if (pageDelayMs > 0 && index < ranked.length - 1) await delay(pageDelayMs);
  }

  const status = detailed.length ? "ok" : diagnostics.blockedUrls.length ? "blocked" : diagnostics.failedUrls.length ? "failed" : "empty";
  await writeOutput({
    generatedAt: new Date().toISOString(),
    source: "Hemmings",
    status,
    ...(status === "blocked" ? { message: `Hemmings blocked ${diagnostics.blockedUrls.length} seed page(s); retry headed or with an approved browser session.` } : {}),
    ...(status === "empty" ? { message: "Hemmings scrape completed without parseable candidates from the configured seed pages." } : {}),
    sourceNotes: scrapeConfig.sourceNotes,
    seedUrls: scrapeConfig.pages.map((seed) => seed.url),
    maxDetails,
    diagnostics: {
      ...diagnostics,
      discoveredCount: discovered.size,
      detailAttemptCount: ranked.length,
    },
    warnings: warningsForDiagnostics(diagnostics),
    listings: detailed,
  });
  console.log(`Wrote ${detailed.length} Hemmings candidates to ${outPath}`);
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  await writeOutput({
    generatedAt: new Date().toISOString(),
    source: "Hemmings",
    status: "failed",
    reason: "unexpected_scrape_error",
    message,
    diagnostics,
    listings: [],
  });
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}

async function scrapeDetail(context, candidate) {
  const page = await context.newPage();
  try {
    const response = await page.goto(candidate.url, { waitUntil: "domcontentloaded", timeout: 90_000 }).catch((error) => ({ error }));
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    const html = await page.content().catch(() => "");
    const title = await page.title().catch(() => "");
    const body = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    const status = response && "status" in response ? response.status() : response?.error ? 0 : 0;
    if (looksLikeHemmingsBlockedPage({ title, body })) {
      diagnostics.blockedUrls.push(candidate.url);
      return { candidate, check: { url: candidate.url, title: candidate.title, status: "blocked", httpStatus: status } };
    }
    if (response?.error) {
      diagnostics.failedUrls.push(candidate.url);
      return { candidate, check: { url: candidate.url, title: candidate.title, status: "failed", error: String(response.error?.message || response.error) } };
    }
    if (status >= 400) {
      diagnostics.failedUrls.push(candidate.url);
      return { candidate, check: { url: candidate.url, title: candidate.title, status: "failed", httpStatus: status } };
    }
    const detail = parseHemmingsDetailPage(html);
    const next = mergeDetail(candidate, detail);
    const enriched = Boolean(detail.location || detail.imageUrls?.length || detail.dossier);
    return { candidate: next, check: { url: candidate.url, title: candidate.title, status: enriched ? "ok" : "empty", httpStatus: status } };
  } finally {
    await page.close().catch(() => {});
  }
}

function buildScrapeConfig() {
  const sourceNotes = process.env.HEMMINGS_SOURCE_NOTES || process.env.HEMMINGS_QUERIES || "";
  const explicit = parseList(process.env.HEMMINGS_SEED_URLS || "")
    .map((url) => new URL(url, "https://www.hemmings.com").toString())
    .filter(isAllowedHemmingsSeedUrl)
    .map((url) => ({ label: labelFromUrl(url), url, categories: [] }));
  const pages = explicit.length ? explicit : buildHemmingsSeedPages({ sourceNotes, limit: maxSeedPages });
  return { sourceNotes, pages: pages.slice(0, maxSeedPages) };
}

function upsertCandidate(candidate) {
  const existing = discovered.get(candidate.url) || {};
  discovered.set(candidate.url, {
    ...existing,
    ...withoutEmpty(candidate),
    imageUrls: dedupeStrings([...(existing.imageUrls || []), ...(candidate.imageUrls || [])]),
  });
}

function mergeDetail(candidate, detail) {
  return {
    ...candidate,
    ...(detail.location ? { location: detail.location } : {}),
    imageUrls: dedupeStrings([...(candidate.imageUrls || []), ...(detail.imageUrls || [])]),
    dossier: mergeDossier(candidate.dossier, detail.dossier),
  };
}

function mergeDossier(current, detail) {
  if (!current) return detail;
  if (!detail) return current;
  return {
    ...current,
    ...detail,
    specs: { ...(current.specs || {}), ...(detail.specs || {}) },
    listing: dedupeStrings([...(current.listing || []), ...(detail.listing || [])]),
  };
}

function rankCandidates(candidates) {
  return candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || (left.candidate.bidNum || 0) - (right.candidate.bidNum || 0))
    .map((entry) => entry.candidate);
}

function scoreCandidate(candidate) {
  const text = `${candidate.title || ""} ${candidate.summary || ""}`.toLowerCase();
  let score = 0;
  for (const [pattern, value] of [
    [/thing|type 181|moke|mehari|beetle convertible/, 18],
    [/samurai|sidekick|vitara|jimny|wrangler|\bcj\b|scrambler|bronco|blazer|4runner|land cruiser|scout/, 16],
    [/westfalia|type 2|camper|microbus/, 12],
    [/trail|ct90|ct110|monkey|grom|bmw|motorcycle|scooter/, 10],
    [/4x4|4wd|convertible|soft top|removable|beach|open air|open-air/, 4],
  ]) {
    if (pattern.test(text)) score += value;
  }
  if (candidate.bidNum && candidate.bidNum > 45_000) score -= 10;
  else if (candidate.bidNum && candidate.bidNum > 32_000) score -= 5;
  return score;
}

async function openContextOrWriteBlocked() {
  try {
    return await launchHemmingsContext({ headless });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeOutput({
      generatedAt: new Date().toISOString(),
      source: "Hemmings",
      status: "blocked",
      reason: "browser_launch_failed",
      checkedAt: new Date().toISOString(),
      message,
      diagnostics,
      listings: [],
    });
    process.exit(2);
  }
}

async function launchHemmingsContext({ headless }) {
  const profileDir = resolve(process.env.HEMMINGS_PROFILE_DIR || ".hemmings-profile");
  const browserChannel = process.env.HEMMINGS_BROWSER_CHANNEL || "chrome";
  const useSandbox = process.env.HEMMINGS_CHROMIUM_SANDBOX !== "0";
  await mkdir(profileDir, { recursive: true });
  try {
    return await chromium.launchPersistentContext(profileDir, launchOptions({ browserChannel, headless, useSandbox }));
  } catch (error) {
    if (!useSandbox || process.env.HEMMINGS_CHROMIUM_SANDBOX_FALLBACK === "0" || !looksLikeSandboxFailure(error)) throw error;
    console.warn("Chrome sandbox launch failed; retrying Hemmings browser with HEMMINGS_CHROMIUM_SANDBOX=0.");
    return chromium.launchPersistentContext(profileDir, launchOptions({ browserChannel, headless, useSandbox: false }));
  }
}

function launchOptions({ browserChannel, headless, useSandbox }) {
  return {
    channel: browserChannel,
    headless,
    chromiumSandbox: useSandbox,
    ignoreDefaultArgs: process.env.HEMMINGS_KEEP_AUTOMATION_FLAG === "1" ? undefined : ["--enable-automation"],
    viewport: { width: 1400, height: 1000 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "America/New_York",
    userAgent:
      process.env.HEMMINGS_USER_AGENT ||
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    args: ["--disable-blink-features=AutomationControlled", "--disable-search-engine-choice-screen", "--lang=en-US", "--window-size=1400,1000"],
  };
}

function warningsForDiagnostics(input) {
  const warnings = [];
  if (input.blockedUrls.length) warnings.push(`Hemmings blocked ${input.blockedUrls.length} URL(s); retry headed or with an approved browser session.`);
  if (input.failedUrls.length) warnings.push(`Hemmings failed ${input.failedUrls.length} URL(s); inspect debug output before broadening seeds.`);
  return warnings;
}

async function writeOutput(value) {
  await mkdir(resolve(outPath, ".."), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(value, null, 2)}\n`);
  await mkdir(resolve(debugPath, ".."), { recursive: true });
  await writeFile(debugPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), diagnostics }, null, 2)}\n`).catch(() => {});
}

async function captureBlockedPage(page, screenshotPath) {
  await mkdir(resolve(screenshotPath, ".."), { recursive: true }).catch(() => {});
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
}

function parseList(value) {
  return String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function labelFromUrl(value) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean).slice(-2);
    return parts
      .join(" ")
      .split(/[-\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return "Hemmings seed";
  }
}

function withoutEmpty(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0)));
}

function dedupeStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of values.filter(Boolean).map(String)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function looksLikeSandboxFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /sandbox|setuid|namespace|operation not permitted/i.test(message);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
