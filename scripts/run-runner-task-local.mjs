#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

await loadEnvFile(resolve(".publish.env"));

const baseUrl = (process.env.AUCTION_WATCH_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");
const publishToken = process.env.PUBLISH_TOKEN || "";
const runnerId = process.env.RUNNER_TASK_ID || "local-container-codex-sim";
const executorUrl = (process.env.RUNNER_TASK_EXECUTOR_URL || "").replace(/\/+$/, "");
const browserRunner = booleanEnv(process.env.RUNNER_TASK_BROWSER) || booleanEnv(process.env.RUNNER_TASK_CARS_AND_BIDS_BROWSER);

if (!publishToken) {
  fail("Set PUBLISH_TOKEN to the same secret configured on the local Worker.");
}

const task = await claimTask();
if (!task) {
  fail("No queued runner task was available to claim.");
}

const execution = executorUrl ? await runExecutor(task) : await runLocalTask(task);
const result = execution.result || execution;
const aiUsage =
  execution.aiUsage || {
    provider: executorUrl ? "local-container" : "local-simulator",
    model: "none",
    operation: `runner_task:${task.kind}`,
    status: "cached",
    costMicros: 0,
    metadata: {
      source: task.source,
      taskId: task.id,
      executorUrl: executorUrl || null,
    },
  };

const response = await fetch(`${baseUrl}/api/admin/runner-tasks/${encodeURIComponent(task.id)}/complete`, {
  method: "POST",
  headers: {
    ...authHeaders(),
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    runnerId,
    result,
    aiUsage,
  }),
});
const body = await readResponse(response);
if (!response.ok) {
  fail(`Complete failed: ${response.status} ${formatBody(body)}`);
}

console.log(`Completed runner task ${body.task.id} for ${body.task.source}; status=${body.task.status}.`);

async function runExecutor(task) {
  const response = await fetch(`${executorUrl}/run-task`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task }),
  });
  const body = await readResponse(response);
  if (!response.ok) {
    fail(`Executor failed: ${response.status} ${formatBody(body)}`);
  }
  return body;
}

async function runLocalTask(task) {
  const source = normalizeSource(task.source);
  if (browserRunner && source === "carsandbids") {
    return runCarsAndBidsBrowserTask(task);
  }
  if (browserRunner && source === "hemmings") {
    return runHemmingsBrowserTask(task);
  }
  return deterministicResult(task);
}

async function runCarsAndBidsBrowserTask(task) {
  const safeTaskId = slugify(task.id || `task-${Date.now()}`);
  const outPath = resolve(process.env.CAB_OUT || `outputs/cars-and-bids-runner-${safeTaskId}.json`);
  const debugPath = resolve(process.env.CAB_DEBUG_OUT || `.tmp/cars-and-bids-runner-${safeTaskId}.json`);
  const sourceSettings = normalizeObject(task.input?.sourceSettings);
  const runner = normalizeObject(task.input?.runner);
  const scrapeEnv = {
    ...process.env,
    CAB_MODE: process.env.CAB_MODE || "targeted",
    CAB_OUT: outPath,
    CAB_DEBUG_OUT: debugPath,
    CAB_MAX_DETAILS: String(runner.maxDetails || sourceSettings.maxDetails || process.env.CAB_MAX_DETAILS || 30),
  };

  let runError = null;
  try {
    await execFileAsync("bun", ["scripts/scrape-cars-and-bids.mjs"], {
      cwd: process.cwd(),
      env: scrapeEnv,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    runError = error;
  }

  const scrape = await readJsonOptional(outPath);
  if (!scrape) {
    throw runError || new Error(`Cars & Bids scraper did not write ${outPath}`);
  }

  const listings = Array.isArray(scrape.listings) ? scrape.listings : [];
  const status = scrape.status === "ok" ? "completed" : scrape.status || "blocked";
  return {
    runner: runnerId,
    runtime: "local-browser",
    mode: "cars-and-bids-browser",
    source: task.source,
    status,
    checkedAt: new Date().toISOString(),
    message:
      scrape.message ||
      (status === "completed"
        ? `Cars & Bids browser scrape completed with ${listings.length} normalized candidate(s).`
        : "Cars & Bids browser scrape did not produce candidates."),
    outputPath: outPath,
    debugPath,
    sourceSettings,
    normalizedCandidates: listings,
  };
}

async function runHemmingsBrowserTask(task) {
  const safeTaskId = slugify(task.id || `task-${Date.now()}`);
  const outPath = resolve(process.env.HEMMINGS_OUT || `outputs/hemmings-runner-${safeTaskId}.json`);
  const debugPath = resolve(process.env.HEMMINGS_DEBUG_OUT || `.tmp/hemmings-runner-${safeTaskId}.json`);
  const sourceSettings = normalizeObject(task.input?.sourceSettings);
  const runner = normalizeObject(task.input?.runner);
  const blockedUrls = Array.isArray(task.input?.source?.blockedUrls) ? task.input.source.blockedUrls.filter(Boolean).join(",") : "";
  const scrapeEnv = {
    ...process.env,
    HEMMINGS_OUT: outPath,
    HEMMINGS_DEBUG_OUT: debugPath,
    HEMMINGS_SOURCE_NOTES: String(sourceSettings.searchNotes || task.input?.tasteNotes || ""),
    HEMMINGS_SEED_URLS: process.env.HEMMINGS_SEED_URLS || blockedUrls,
    HEMMINGS_MAX_DETAILS: String(runner.maxDetails || sourceSettings.maxDetails || process.env.HEMMINGS_MAX_DETAILS || 6),
  };

  let runError = null;
  try {
    await execFileAsync("bun", ["scripts/scrape-hemmings.mjs"], {
      cwd: process.cwd(),
      env: scrapeEnv,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    runError = error;
  }

  const scrape = await readJsonOptional(outPath);
  if (!scrape) {
    throw runError || new Error(`Hemmings scraper did not write ${outPath}`);
  }

  const listings = Array.isArray(scrape.listings) ? scrape.listings : [];
  const status = scrape.status === "ok" ? "completed" : scrape.status || "blocked";
  return {
    runner: runnerId,
    runtime: "local-browser",
    mode: "hemmings-browser",
    source: task.source,
    status,
    checkedAt: new Date().toISOString(),
    message:
      scrape.message ||
      (status === "completed"
        ? `Hemmings browser scrape completed with ${listings.length} normalized candidate(s).`
        : "Hemmings browser scrape did not produce candidates."),
    outputPath: outPath,
    debugPath,
    sourceSettings,
    normalizedCandidates: listings,
  };
}

function deterministicResult(task) {
  return {
    runner: runnerId,
    runtime: "local-simulator",
    intendedRuntime: task.input?.runner?.preferredRuntime || "cloudflare-container",
    source: task.source,
    status: "blocked_without_browser_session",
    checkedAt: new Date().toISOString(),
    message:
      "Local simulator proved the Container/Codex runner contract. A deployed Container can replace this result with browser/Codex-discovered normalized candidates.",
    normalizedCandidates: [],
  };
}

async function readJsonOptional(path) {
  const text = await readOptional(path);
  if (!text) return null;
  return JSON.parse(text);
}

async function claimTask() {
  const response = await fetch(`${baseUrl}/api/admin/runner-tasks/claim`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ runnerId }),
  });
  const body = await readResponse(response);
  if (!response.ok) {
    fail(`Claim failed: ${response.status} ${formatBody(body)}`);
  }
  if (body.task) {
    console.log(`Claimed runner task ${body.task.id} for source ${body.task.source}.`);
  }
  return body.task || null;
}

function authHeaders() {
  return {
    "X-Publish-Token": publishToken,
  };
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function loadEnvFile(path) {
  const text = await readOptional(path);
  if (!text) return;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals < 1) continue;
    const key = trimmed.slice(0, equals).trim();
    const value = unquote(trimmed.slice(equals + 1).trim());
    if (!process.env[key]) process.env[key] = value;
  }
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeSource(value) {
  const normalized = String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized === "carsbids" ? "carsandbids" : normalized;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function booleanEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

async function readResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  return response.text();
}

function formatBody(body) {
  if (typeof body === "string") return body.slice(0, 400);
  return JSON.stringify(body).slice(0, 400);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
