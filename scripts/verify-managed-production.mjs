#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const yes = args.includes("--yes");
const jsonOutput = args.includes("--json");
const timeoutMs = numberArg("--timeout-ms", 5 * 60 * 1_000);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}
if (!execute || !yes) fail("This single-use Clerk ticket verifier requires --execute --yes.");

const env = {
  ...(await loadEnvFile(resolve(".env.local"))),
  ...(await loadEnvFile(resolve(".publish.env"))),
  ...(await loadEnvFile(resolve(".deploy.env"))),
  ...process.env,
};
const signInUrl = value("CLERK_DEV_APP_SIGN_IN_URL");
const baseUrl = normalizeBaseUrl(valueArg("--url") || value("BEACHCAR_DEPLOY_URL") || originOf(signInUrl));
const publishToken = value("PUBLISH_TOKEN");

if (!signInUrl) fail("Missing CLERK_DEV_APP_SIGN_IN_URL in .env.local.");
if (!baseUrl) fail("Set BEACHCAR_DEPLOY_URL or pass --url.");

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  mode: "managed-run",
  checks: [],
};

let browser;
try {
  await runPublicPreflight();
  if (report.checks.some((entry) => entry.status === "fail")) {
    throw new Error("Public/admin preflight failed before Clerk ticket exchange.");
  }

  browser = await launchBrowser();
  const page = await browser.newPage();
  await page.goto(signInUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {
    throw new Error("Clerk ticket navigation failed.");
  });
  await page.waitForFunction(() => Boolean(window.Clerk?.session), null, { timeout: 60_000 }).catch(() => {
    throw new Error("Clerk ticket did not create an active session.");
  });
  addCheck("Clerk ticket exchanged for a session", true, "Active browser session created.");

  const me = await authorizedJson(page, "/api/me");
  addCheck("Signed-in API accepts the Clerk session", me.response.ok && Boolean(me.body?.id), `HTTP ${me.response.status}`);
  addCheck("Pilot user is active", me.body?.status === "active", me.body?.status || "missing status");
  addCheck("Pilot onboarding is complete", me.body?.onboarding?.completed === true, me.body?.onboarding?.completed ? "complete" : "incomplete");
  addCheck("Managed Run now is enabled", me.body?.capabilities?.canRunNow === true, me.body?.capabilities?.canRunNow ? "enabled" : "disabled");

  const automation = await authorizedJson(page, "/api/automation/status");
  addCheck(
    "Signed-in automation status points at production MCP",
    automation.response.ok && automation.body?.mcpEndpoint === `${baseUrl}/mcp`,
    automation.body?.mcpEndpoint || `HTTP ${automation.response.status}`,
  );

  if (report.checks.some((entry) => entry.status === "fail")) {
    throw new Error("Signed-in preflight failed; managed run was not queued.");
  }

  const queued = await authorizedJson(page, "/api/agent-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "source-quality-v1-production-verification" }),
  });
  addCheck("Managed run was accepted", queued.response.status === 201 && Boolean(queued.body?.id), `HTTP ${queued.response.status}`);
  if (!queued.response.ok || !queued.body?.id) throw new Error(`Managed run was not accepted: HTTP ${queued.response.status}`);

  const finished = await pollManagedRun(page, queued.body.id, timeoutMs);
  addCheck("Managed Workflow reached published", finished?.status === "published", finished?.status || "timed out");
  if (finished?.status !== "published") throw new Error(finished?.error || `Managed Workflow ended as ${finished?.status || "unknown"}.`);

  const publishedRunId = typeof finished?.progress?.publishedRunId === "string" ? finished.progress.publishedRunId : "";
  addCheck("Agent run records its concrete published run", Boolean(publishedRunId), publishedRunId ? "recorded" : "missing");
  if (!publishedRunId) throw new Error("Published Agent run did not record its concrete run id.");

  const published = await authorizedJson(page, `/api/runs/${encodeURIComponent(publishedRunId)}`);
  addCheck("Published run is addressable by its id", published.response.ok && published.body?.id === publishedRunId, `HTTP ${published.response.status}`);
  const listings = Array.isArray(published.body?.listings) ? published.body.listings : [];
  const summary = published.body?.sourceSummary || {};
  const checkedSources = Array.isArray(summary.checkedSources) ? summary.checkedSources : [];
  const runnerTasks = Array.isArray(summary.runnerTasks) ? summary.runnerTasks : [];
  const diagnosticSources = new Set(
    [...checkedSources, ...runnerTasks].map((entry) => String(entry?.source || "").toLowerCase()).filter(Boolean),
  );
  const enabledSources = expectedEnabledSources(me.body, summary);
  addCheck("Published shortlist contains listings", published.response.ok && listings.length > 0, `${listings.length} listing(s)`);
  addCheck("Managed run avoided transparent fallback", summary.fallbackUsed !== true, summary.fallbackUsed === true ? "fallback used" : "direct discovery");
  for (const source of enabledSources) {
    addCheck(`Source diagnostics include ${source}`, diagnosticSources.has(source), diagnosticSources.has(source) ? "present" : "missing");
  }

  const imageUrl = firstDeckImageUrl(listings);
  if (imageUrl) {
    const imageTarget = new URL(imageUrl, baseUrl);
    imageTarget.searchParams.set("variant", "deck");
    const firstImage = await fetch(imageTarget);
    const secondImage = await fetch(imageTarget);
    addCheck(
      "Beachcar deck image variant is created and cached",
      firstImage.ok &&
        secondImage.ok &&
        (firstImage.headers.get("content-type") || "").startsWith("image/") &&
        (secondImage.headers.get("content-type") || "").startsWith("image/") &&
        firstImage.headers.get("X-Beachcar-Image-Variant") === "deck" &&
        secondImage.headers.get("X-Beachcar-Image-Variant") === "deck" &&
        secondImage.headers.get("X-Beachcar-Image-Cache") === "hit",
      `HTTP ${firstImage.status}/${secondImage.status}; second cache ${secondImage.headers.get("X-Beachcar-Image-Cache") || "missing"}`,
    );
  } else {
    addCheck("Beachcar deck image variant is created and cached", false, "No /api/images/ URL was published.");
  }

  const usage = await authorizedJson(page, "/api/ai-usage");
  addCheck("Managed budget ledger is readable", usage.response.ok && typeof usage.body?.summary?.budgetExceeded === "boolean", `HTTP ${usage.response.status}`);
} catch (error) {
  report.error = safeErrorMessage(error);
} finally {
  await browser?.close().catch(() => {});
}

if (jsonOutput) console.log(JSON.stringify(report, null, 2));
else printReport();

if (report.error || report.checks.some((entry) => entry.status === "fail")) process.exit(1);

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    return chromium.launch({ headless: true, channel: "chrome" });
  }
}

async function runPublicPreflight() {
  const shell = await fetch(baseUrl, { headers: { Accept: "text/html" } });
  addCheck("Production app shell is reachable", shell.ok, `HTTP ${shell.status}`);
  const metadata = await fetchJson(`${baseUrl}/mcp`);
  addCheck("Production MCP metadata is reachable", metadata.response.ok && metadata.body?.name === "beachcar-remote-mcp", `HTTP ${metadata.response.status}`);
  if (!publishToken) {
    addCheck("Admin source-cache status is reachable", false, "PUBLISH_TOKEN is unavailable.");
    return;
  }
  const sourceCache = await fetchJson(`${baseUrl}/api/admin/source-cache/status`, {
    headers: { "X-Publish-Token": publishToken },
  });
  addCheck("Admin source-cache status is reachable", sourceCache.response.ok && Boolean(sourceCache.body?.sources?.bringatrailer), `HTTP ${sourceCache.response.status}`);
}

async function authorizedJson(page, pathname, init = {}) {
  const token = await page.evaluate(() => window.Clerk?.session?.getToken());
  if (!token) throw new Error("Clerk session did not return a bearer token.");
  return fetchJson(`${baseUrl}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init.headers || {}) } });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { text };
  }
  return { response, body };
}

async function pollManagedRun(page, runId, timeout) {
  const deadline = Date.now() + timeout;
  let latest = null;
  while (Date.now() < deadline) {
    const result = await authorizedJson(page, `/api/agent-runs/${encodeURIComponent(runId)}`);
    latest = result.body;
    if (!result.response.ok) throw new Error(`Could not read queued Agent run: HTTP ${result.response.status}`);
    if (["published", "failed", "cancelled"].includes(latest?.status)) return latest;
    await Bun.sleep(2_000);
  }
  return latest;
}

function firstDeckImageUrl(listings) {
  for (const listing of listings) {
    if (!Array.isArray(listing?.images)) continue;
    const image = listing.images.find((value) => {
      try {
        return new URL(value, baseUrl).pathname.startsWith("/api/images/");
      } catch {
        return false;
      }
    });
    if (image) return image;
  }
  return "";
}

function expectedEnabledSources(user, summary) {
  const fromSummary = Array.isArray(summary.enabledSources) ? summary.enabledSources : [];
  const fromSettings = Array.isArray(user?.sourceSettings)
    ? user.sourceSettings.filter((entry) => entry?.enabled).map((entry) => entry?.source)
    : [];
  return Array.from(new Set((fromSummary.length ? fromSummary : fromSettings).map((value) => String(value || "").toLowerCase()).filter(Boolean))).sort();
}

function addCheck(label, ok, detail) {
  report.checks.push({ label, status: ok ? "ok" : "fail", detail });
}

function value(name) {
  return String(env[name] || "").trim();
}

function valueArg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "").trim() : "";
}

function numberArg(name, fallback) {
  const current = Number(valueArg(name));
  return Number.isFinite(current) && current > 0 ? current : fallback;
}

function originOf(input) {
  try {
    return new URL(input).origin;
  } catch {
    return "";
  }
}

function normalizeBaseUrl(input) {
  try {
    const url = new URL(input);
    return url.origin;
  } catch {
    return "";
  }
}

async function loadEnvFile(path) {
  try {
    const text = await readFile(path, "utf8");
    return Object.fromEntries(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
        }),
    );
  } catch {
    return {};
  }
}

function printReport() {
  console.log(`Beachcar managed production verification (${report.mode})`);
  console.log(`Target: ${report.baseUrl}\n`);
  for (const entry of report.checks) console.log(`${entry.status === "ok" ? "OK" : "FAIL"} ${entry.label}: ${entry.detail}`);
  if (report.error) console.log(`\nFAIL ${report.error}`);
}

function safeErrorMessage(error) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/([?&](?:__clerk_ticket|ticket|token)=)[^&\s]+/gi, "$1<redacted>")
    .replace(/\beyJ[A-Za-z0-9._-]{20,}\b/g, "<redacted-jwt>")
    .replace(/\b(?:sk|pk)_(?:test|live)_[A-Za-z0-9_-]+\b/g, "<redacted-key>");
}

function printHelp() {
  console.log(`Beachcar managed production verifier

Exchanges the protected Clerk sign-in ticket in .env.local inside a headless
browser without printing or persisting the resulting one-minute bearer token.

The stored Clerk sign-in ticket may be single-use, so this command has no
auth-only mode. It runs all public/admin preflight checks before consuming the
ticket, then queues and verifies exactly one managed Workflow run:

  bun scripts/verify-managed-production.mjs --execute --yes --url https://beachcar-watch.jon-cooper.workers.dev

Options:
  --execute               Queue a real managed run and poll it to completion.
  --yes                   Required with --execute.
  --url <origin>          Deployed Worker origin.
  --timeout-ms <number>   Workflow polling timeout (default: 300000).
  --json                  Emit a machine-readable report (never the bearer token).
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
