#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

await loadEnvFile(resolve(".publish.env"));

const baseUrl = (process.env.AUCTION_WATCH_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");
const publishToken = process.env.PUBLISH_TOKEN || "";
const runnerId = process.env.RUNNER_TASK_ID || "local-container-codex-sim";
const executorUrl = (process.env.RUNNER_TASK_EXECUTOR_URL || "").replace(/\/+$/, "");

if (!publishToken) {
  fail("Set PUBLISH_TOKEN to the same secret configured on the local Worker.");
}

const task = await claimTask();
if (!task) {
  fail("No queued runner task was available to claim.");
}

const execution = executorUrl ? await runExecutor(task) : deterministicResult(task);
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
