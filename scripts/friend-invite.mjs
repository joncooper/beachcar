#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
loadDotEnv(path.join(root, ".env.apple.local"));
loadDotEnv(path.join(root, ".publish.env"));

const args = parseArgs(process.argv.slice(2));
if (args.help) usage(0);

const displayName = requiredArg(args.name, "--name");
const email = normalizeEmail(requiredArg(args.email, "--email"));
const apiBase = "https://api.appstoreconnect.apple.com/v1";
const workerBaseUrl = requiredEnvAny(["AUCTION_WATCH_URL", "BEACHCAR_API_URL"]).replace(/\/+$/, "");
const publishToken = required("PUBLISH_TOKEN");
const keyId = required("ASC_KEY_ID");
const issuerId = required("ASC_ISSUER_ID");
const keyPath = expandHome(required("ASC_KEY_PATH"));
const bundleId = process.env.IOS_BUNDLE_ID || "com.joncooper.beachcar";
const groupName = process.env.TESTFLIGHT_FRIENDS_GROUP_NAME || "Beachcar Friends";

if (!fs.existsSync(keyPath)) throw new Error(`App Store Connect key not found: ${keyPath}`);

const token = createJwt({ keyId, issuerId, keyPath });
const app = await findOne(`/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`, `No App Store Connect app found for ${bundleId}.`);
const groups = (await ascFetch(`/betaGroups?filter[app]=${encodeURIComponent(app.id)}&limit=200`)).data || [];
const group = groups.find((candidate) => candidate.attributes?.name === groupName);
if (!group) throw new Error(`External TestFlight group "${groupName}" is absent. Run bun run ios:release:friends first.`);
if (group.attributes?.isInternalGroup !== false) {
  throw new Error(`TestFlight group "${groupName}" is internal. Refusing to attach a friend to it.`);
}

const builds = (
  await ascFetch(
    `/builds?filter[app]=${encodeURIComponent(app.id)}&sort=-uploadedDate&limit=50&fields[builds]=version,uploadedDate,expirationDate,expired,processingState,buildAudienceType`,
  )
).data || [];
const build = builds[0];
if (!build) throw new Error("Beachcar has no uploaded TestFlight build.");
validateExternalBuild(build);
if (!(await relationshipContains(`/betaGroups/${group.id}/relationships/builds?limit=200`, build.id))) {
  throw new Error(`Latest build ${build.attributes?.version || build.id} is not assigned to "${groupName}". Run bun run ios:release:friends.`);
}

const submissions = (
  await ascFetch(`/betaAppReviewSubmissions?filter[build]=${encodeURIComponent(build.id)}&limit=10`)
).data || [];
const reviewState = submissions[0]?.attributes?.betaReviewState || "NOT_SUBMITTED";
if (reviewState === "REJECTED") {
  throw new Error(`Latest build ${build.attributes?.version || build.id} was rejected by external beta review.`);
}
if (reviewState === "NOT_SUBMITTED") {
  throw new Error(`Latest build ${build.attributes?.version || build.id} has not been submitted for external beta review.`);
}

const beachcarInvite = await createBeachcarInvite({ email, displayName });
const tester = await findOrCreateTester({ email, displayName, groupId: group.id });
await attachTesterToGroup(group.id, tester.id);

const testerState = String(tester.attributes?.state || "INVITED").toUpperCase();
const pendingReview = reviewState !== "APPROVED";
const testFlightStatus = pendingReview
  ? `pending review (${reviewState.toLowerCase().replaceAll("_", " ")})`
  : testerState === "ACCEPTED" || testerState === "INSTALLED"
    ? "already accepted"
    : "sent";
const beachcarStatus = beachcarInvite.acceptedAt
  ? "already accepted"
  : beachcarInvite.alreadyExisted
    ? "already ready"
    : "created";

console.log(`Friend: ${displayName} <${email}>`);
console.log(`TestFlight: ${testFlightStatus}`);
console.log(`Beachcar invitation: ${beachcarStatus}`);
console.log(`Build: ${build.attributes?.version || build.id}`);

async function createBeachcarInvite({ email, displayName }) {
  const response = await fetch(`${workerBaseUrl}/api/admin/invites`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Publish-Token": publishToken },
    body: JSON.stringify({ email, displayName, acceptance: "verified_email", managedResearch: true }),
  });
  const body = await readJsonResponse(response);
  if (!response.ok) throw new Error(`Beachcar invitation failed (${response.status}): ${formatBody(body)}`);
  return body;
}

async function findOrCreateTester({ email, displayName, groupId }) {
  const matches = (await ascFetch(`/betaTesters?filter[email]=${encodeURIComponent(email)}&limit=20`)).data || [];
  const existing = matches.find((candidate) => normalizeEmail(candidate.attributes?.email || "") === email);
  if (existing) return existing;

  const names = splitName(displayName);
  const created = await ascWrite("/betaTesters", "POST", {
    data: {
      type: "betaTesters",
      attributes: { email, firstName: names.firstName, lastName: names.lastName },
      relationships: { betaGroups: { data: [{ type: "betaGroups", id: groupId }] } },
    },
  });
  return created.data;
}

async function attachTesterToGroup(groupId, testerId) {
  const response = await fetch(`${apiBase}/betaGroups/${groupId}/relationships/betaTesters`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ data: [{ type: "betaTesters", id: testerId }] }),
  });
  if (response.ok || response.status === 409) return;
  throw new Error(`Could not add the tester to "${groupName}" (${response.status}): ${await response.text()}`);
}

async function relationshipContains(pathname, id) {
  let next = pathname;
  while (next) {
    const response = await ascFetch(next);
    if ((response.data || []).some((item) => item.id === id)) return true;
    next = response.links?.next ? response.links.next.replace(apiBase, "") : "";
  }
  return false;
}

function validateExternalBuild(build) {
  const attributes = build.attributes || {};
  if (attributes.buildAudienceType !== "APP_STORE_ELIGIBLE") {
    throw new Error(
      `Latest build ${attributes.version || build.id} is ${attributes.buildAudienceType || "missing an audience type"}. ` +
        "Friends require a new APP_STORE_ELIGIBLE upload from bun run ios:release:friends.",
    );
  }
  if (attributes.expired) throw new Error(`Latest build ${attributes.version || build.id} has expired.`);
  if (attributes.processingState !== "VALID") {
    throw new Error(`Latest build ${attributes.version || build.id} is ${attributes.processingState || "not processed"}. Try again after processing finishes.`);
  }
}

async function findOne(pathname, message) {
  const response = await ascFetch(pathname);
  const value = response.data?.[0];
  if (!value) throw new Error(message);
  return value;
}

async function ascFetch(pathname) {
  const response = await fetch(`${apiBase}${pathname}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`App Store Connect request failed (${response.status}): ${await response.text()}`);
  return response.json();
}

async function ascWrite(pathname, method, body) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`App Store Connect ${method} ${pathname} failed (${response.status}): ${await response.text()}`);
  return response.status === 204 ? {} : response.json();
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

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function formatBody(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function splitName(value) {
  const parts = value.trim().split(/\s+/);
  return { firstName: parts.shift() || value, lastName: parts.join(" ") || "Tester" };
}

function normalizeEmail(value) {
  const normalized = String(value).trim().toLowerCase();
  if (!normalized.includes("@")) throw new Error(`Invalid email address: ${value}`);
  return normalized;
}

function expandHome(value) {
  return value.startsWith("~/") ? path.join(process.env.HOME || "", value.slice(2)) : value;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requiredEnvAny(names) {
  for (const name of names) if (process.env[name]) return process.env[name];
  throw new Error(`Set ${names.join(" or ")} to the deployed Beachcar Worker URL.`);
}

function requiredArg(value, name) {
  if (!value) {
    console.error(`${name} is required.`);
    usage(1);
  }
  return String(value).trim();
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--help" || value === "-h") parsed.help = true;
    else if (value === "--name") parsed.name = values[++index];
    else if (value === "--email") parsed.email = values[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  return parsed;
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function usage(exitCode) {
  console.log('Usage: bun run friend:invite -- --name "Friend Name" --email friend@example.com');
  process.exit(exitCode);
}
