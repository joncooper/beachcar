#!/usr/bin/env bun
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
loadDotEnv(path.join(root, ".env.apple.local"));

const apiBase = "https://api.appstoreconnect.apple.com/v1";
const keyId = required("ASC_KEY_ID");
const issuerId = required("ASC_ISSUER_ID");
const keyPath = expandHome(required("ASC_KEY_PATH"));
const bundleId = process.env.IOS_BUNDLE_ID || "com.joncooper.beachcar";
const expectedGroupName = process.env.TESTFLIGHT_BETA_GROUP_NAME || "Beachcar Internal";

if (!fs.existsSync(keyPath)) {
  throw new Error(`App Store Connect key not found: ${keyPath}`);
}

const token = createJwt({ keyId, issuerId, keyPath });

console.log("Checking App Store Connect API access...");
const appResponse = await ascFetch(`/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`);
const app = appResponse.data?.[0];
if (!app) {
  throw new Error(`No App Store Connect app found for bundle ID ${bundleId}.`);
}

console.log(`App: ${app.attributes?.name || "(unnamed)"} (${app.id})`);
console.log(`Bundle ID: ${bundleId}`);

const groupsResponse = await ascFetch(`/betaGroups?filter[app]=${encodeURIComponent(app.id)}&limit=200`);
const groups = groupsResponse.data || [];
if (!groups.length) {
  throw new Error(`No TestFlight beta groups found for app ${app.id}.`);
}

const groupNames = groups.map((group) => group.attributes?.name).filter(Boolean);
console.log(`TestFlight groups: ${groupNames.join(", ")}`);
const group = groups.find((candidate) => candidate.attributes?.name === expectedGroupName) || (groups.length === 1 ? groups[0] : null);
if (!group) {
  throw new Error(`No TestFlight beta group named "${expectedGroupName}" found. Available groups: ${groupNames.join(", ") || "none"}.`);
}
console.log(`Selected TestFlight group: ${group.attributes?.name}`);

const buildsResponse = await ascFetch(`/builds?filter[app]=${encodeURIComponent(app.id)}&sort=-uploadedDate&limit=5`);
const builds = buildsResponse.data || [];
if (builds.length) {
  console.log("Recent builds:");
  for (const build of builds) {
    const attrs = build.attributes || {};
    console.log(`  ${attrs.version || "(unknown build)"} uploaded ${attrs.uploadedDate || "(unknown date)"}`);
  }
} else {
  console.log("Recent builds: none");
}

console.log("App Store Connect check passed.");

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required. Copy .env.apple.example to .env.apple.local and fill it in.`);
  }
  return value;
}

function expandHome(value) {
  return value.startsWith("~/") ? path.join(process.env.HOME || "", value.slice(2)) : value;
}

function createJwt({ keyId, issuerId, keyPath }) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iss: issuerId, iat: now, exp: now + 20 * 60, aud: "appstoreconnect-v1" }));
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key: fs.readFileSync(keyPath),
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${base64url(signature)}`;
}

function base64url(value) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function ascFetch(pathname) {
  const response = await fetch(`${apiBase}${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`App Store Connect request failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}
