#!/usr/bin/env node
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

loadDotEnv(path.resolve(".env.apple.local"));
loadDotEnv(path.resolve(".publish.env"));

const email = normalizeEmail(required("APPLE_REVIEW_ACCOUNT_EMAIL"));
const password = required("APPLE_REVIEW_ACCOUNT_PASSWORD");
const workerBaseUrl = requiredAny(["AUCTION_WATCH_URL", "BEACHCAR_API_URL"]).replace(/\/+$/, "");
const publishToken = required("PUBLISH_TOKEN");
const displayName = process.env.APPLE_REVIEW_ACCOUNT_NAME || "Apple Review";

const existing = clerkJson([
  "users", "list", "--instance", "prod", "--email-address", email, "--limit", "10", "--json",
]);
const users = Array.isArray(existing) ? existing : Array.isArray(existing?.data) ? existing.data : [];
let clerkStatus = "already exists";

if (!users.some((user) => userEmail(user) === email)) {
  const directory = mkdtempSync(path.join(tmpdir(), "beachcar-clerk-review-"));
  const file = path.join(directory, "user.json");
  try {
    chmodSync(directory, 0o700);
    writeFileSync(file, JSON.stringify({
      email_address: [email],
      password,
      first_name: "Apple",
      last_name: "Review",
    }), { mode: 0o600 });
    clerkJson(["users", "create", "--instance", "prod", "--file", file, "--yes", "--json"]);
    clerkStatus = "created";
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const user = await workerRequest("/api/admin/review-account", {
  method: "POST",
  body: JSON.stringify({ email, displayName }),
});
const adminUsers = await workerRequest("/api/admin/users");
const adminUser = Array.isArray(adminUsers) ? adminUsers.find((candidate) => candidate.id === user.id) : null;
let seedStatus = "already present";

if (!adminUser?.latestRunAt) {
  const sample = JSON.parse(readFileSync(path.resolve("examples/daily-run.sample.json"), "utf8"));
  await workerRequest(`/api/admin/users/${encodeURIComponent(user.id)}/runs/import`, {
    method: "POST",
    body: JSON.stringify({ ...sample, generatedAt: new Date().toISOString() }),
  });
  seedStatus = "created";
}

console.log(`Clerk production review user: ${clerkStatus}`);
console.log(`Beachcar managed review profile: ready`);
console.log(`Seeded shortlist: ${seedStatus}`);
console.log(`Review email: ${email}`);

function clerkJson(args) {
  const result = spawnSync("bunx", ["clerk@latest", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Clerk CLI failed: ${(result.stderr || result.stdout).trim()}`);
  const output = stripAnsi(result.stdout).trim();
  const jsonStart = Math.min(...[output.indexOf("["), output.indexOf("{")].filter((index) => index >= 0));
  if (!Number.isFinite(jsonStart)) throw new Error("Clerk CLI did not return JSON");
  return JSON.parse(output.slice(jsonStart));
}

async function workerRequest(pathname, init = {}) {
  const response = await fetch(`${workerBaseUrl}${pathname}`, {
    ...init,
    headers: { "X-Publish-Token": publishToken, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = text; }
  if (!response.ok) throw new Error(`Beachcar ${pathname} failed (${response.status}): ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return body;
}

function userEmail(user) {
  const addresses = Array.isArray(user?.email_addresses) ? user.email_addresses : [];
  return normalizeEmail(addresses[0]?.email_address || user?.email_address || "");
}

function normalizeEmail(value) {
  const email = String(value).trim().toLowerCase();
  return email.includes("@") ? email : "";
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requiredAny(names) {
  for (const name of names) if (process.env[name]) return process.env[name];
  throw new Error(`Set ${names.join(" or ")}.`);
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}
