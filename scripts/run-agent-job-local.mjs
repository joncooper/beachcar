#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { randomUUID } from "node:crypto";

await loadEnvFile(resolve(".publish.env"));

const baseUrl = (process.env.AUCTION_WATCH_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");
const publishToken = process.env.PUBLISH_TOKEN || "";
const dailyJson = resolve(process.env.DAILY_JSON || "examples/daily-run.sample.json");
const queueTestEmail = (process.env.QUEUE_TEST_EMAIL || "").trim();
const runnerId = process.env.AGENT_RUNNER_ID || "local-simulated-runner";

if (!publishToken) {
  fail("Set PUBLISH_TOKEN to the same secret configured on the local Worker.");
}

if (queueTestEmail) {
  await queueRun(queueTestEmail);
}

const job = await claimJob();
if (!job.agentRun) {
  fail("No queued agent run was available to claim.");
}

const raw = JSON.parse(await readFile(dailyJson, "utf8"));
const listings = Array.isArray(raw) ? raw : raw.listings || raw.items || [];
if (!Array.isArray(listings) || listings.length === 0) {
  fail(`${basename(dailyJson)} does not contain any listings.`);
}

const payload = {
  generatedAt: process.env.GENERATED_AT || new Date().toISOString(),
  reportMarkdown: raw.reportMarkdown || `Local simulated agent run for ${job.user?.email || job.agentRun.userId}.`,
  sourceSummary: {
    ...(raw.sourceSummary || {}),
    sourceFile: dailyJson,
    listingCount: listings.length,
    runner: runnerId,
    agentRunId: job.agentRun.id,
    userId: job.agentRun.userId,
    feedbackCount: job.feedback?.counts?.total || 0,
    profile: job.user?.profile
      ? {
          niche: job.user.profile.niche,
          budgetMax: job.user.profile.budgetMax,
          homeRegion: job.user.profile.homeRegion,
          timezone: job.user.profile.timezone,
        }
      : null,
  },
  listings,
};

const publishResponse = await fetch(`${baseUrl}/api/admin/agent-runs/${encodeURIComponent(job.agentRun.id)}/publish`, {
  method: "POST",
  headers: {
    ...authHeaders(),
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});
const publishBody = await readResponse(publishResponse);
if (!publishResponse.ok) {
  fail(`Publish failed: ${publishResponse.status} ${formatBody(publishBody)}`);
}

console.log(
  `Published ${publishBody.import.listingCount} listings for ${job.user?.email || job.agentRun.userId} via ${publishBody.agentRun.id}.`,
);
console.log(`Run id: ${publishBody.import.runId}; image records queued: ${publishBody.import.imageCount}.`);

async function queueRun(email) {
  const response = await fetch(`${baseUrl}/api/agent-runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Beachcar-Test-Email": email,
    },
    body: JSON.stringify({ requestId: randomUUID(), reason: `local simulator ${new Date().toISOString()}` }),
  });
  const body = await readResponse(response);
  if (!response.ok) {
    fail(`Queue failed for ${email}: ${response.status} ${formatBody(body)}`);
  }
  console.log(`Queued ${body.id} for ${email}.`);
}

async function claimJob() {
  const response = await fetch(`${baseUrl}/api/admin/agent-runs/claim`, {
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
  if (body.agentRun) {
    console.log(`Claimed ${body.agentRun.id} for ${body.user?.email || body.agentRun.userId}.`);
  }
  return body;
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
    const value = trimmed.slice(equals + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
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
