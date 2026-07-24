#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
loadDotEnv(path.join(root, ".env.apple.local"));

const apiBase = "https://api.appstoreconnect.apple.com/v1";
const keyId = required("ASC_KEY_ID");
const issuerId = required("ASC_ISSUER_ID");
const keyPath = expandHome(required("ASC_KEY_PATH"));
const bundleId = process.env.IOS_BUNDLE_ID || "com.joncooper.beachcar";
const groupName = process.env.TESTFLIGHT_BETA_GROUP_NAME || "Beachcar Internal";
const externalFriendsRelease = /^(yes|true|1)$/i.test(process.env.TESTFLIGHT_EXTERNAL || "");
const archivePath = resolveArchivePath();
const buildNumber = process.env.IOS_BUILD_NUMBER || readArchiveValue(archivePath, "CFBundleVersion");
const lookupTimeoutSeconds = Number(process.env.TESTFLIGHT_BUILD_LOOKUP_TIMEOUT_SECONDS || 45 * 60);
const lookupIntervalSeconds = Number(process.env.TESTFLIGHT_BUILD_LOOKUP_INTERVAL_SECONDS || 20);

if (!fs.existsSync(keyPath)) {
  throw new Error(`App Store Connect key not found: ${keyPath}`);
}

const token = { toString: () => currentToken() };
let cachedToken = "";
let cachedTokenExpiresAt = 0;
const app = await findApp({ token, bundleId });
const build = await findBuild({ token, appId: app.id, buildNumber });
if (externalFriendsRelease) validateExternalBuild(build);
const group = await findOrCreateBetaGroup({ token, appId: app.id, groupName, external: externalFriendsRelease });

if (externalFriendsRelease) {
  await upsertBetaMetadata({ token, appId: app.id, buildId: build.id });
}

if (group.attributes?.hasAccessToAllBuilds) {
  console.log(`Beta group "${group.attributes.name}" already has access to all builds.`);
  if (!externalFriendsRelease) process.exit(0);
} else {
  await assignBuildToGroup({ token, groupId: group.id, buildId: build.id });
  await verifyBuildInGroup({ token, groupId: group.id, buildId: build.id });
}

const review = externalFriendsRelease ? await submitForBetaReview({ token, buildId: build.id }) : null;

console.log(`Assigned build ${build.attributes.version} (${build.id}) to TestFlight group "${group.attributes.name}".`);
if (review) console.log(`External beta review: ${review.attributes?.betaReviewState || "submitted"}.`);

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

function resolveArchivePath() {
  if (process.env.IOS_ARCHIVE_PATH) return process.env.IOS_ARCHIVE_PATH;
  const latestPath = path.join(root, process.env.IOS_ARCHIVE_ROOT || "build/ios", "latest-archive-path");
  if (!fs.existsSync(latestPath)) {
    throw new Error(`No archive path supplied and ${latestPath} does not exist. Run bun run ios:archive first.`);
  }
  return fs.readFileSync(latestPath, "utf8").trim();
}

function readArchiveValue(archive, key) {
  const infoPath = path.join(archive, "Info.plist");
  if (!fs.existsSync(infoPath)) {
    throw new Error(`Archive Info.plist not found: ${infoPath}`);
  }
  return execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :ApplicationProperties:${key}`, infoPath], {
    encoding: "utf8",
  }).trim();
}


function currentToken() {
  const now = Math.floor(Date.now() / 1000);
  if (!cachedToken || now >= cachedTokenExpiresAt - 60) {
    cachedToken = createJwt({ keyId, issuerId, keyPath });
    cachedTokenExpiresAt = now + 20 * 60;
  }
  return cachedToken;
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

async function findApp({ token, bundleId }) {
  const response = await ascFetch(token, `/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`);
  const app = response.data?.[0];
  if (!app) throw new Error(`No App Store Connect app found for bundle ID ${bundleId}.`);
  return app;
}

async function findBuild({ token, appId, buildNumber }) {
  const deadline = Date.now() + lookupTimeoutSeconds * 1000;
  let seen = "none";
  while (Date.now() <= deadline) {
    const response = await ascFetch(
      token,
      `/builds?filter[app]=${encodeURIComponent(appId)}&sort=-uploadedDate&limit=50&fields[builds]=version,uploadedDate,expirationDate,expired,processingState,buildAudienceType`,
    );
    const builds = response.data || [];
    const build = builds.find((candidate) => candidate.attributes?.version === buildNumber);
    if (build) return build;

    seen = builds.map((candidate) => candidate.attributes?.version).filter(Boolean).join(", ") || "none";
    const remainingSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    if (remainingSeconds === 0) break;
    console.log(`Build ${buildNumber} is not visible in App Store Connect yet. Retrying in ${lookupIntervalSeconds}s...`);
    await sleep(Math.min(lookupIntervalSeconds, remainingSeconds) * 1000);
  }
  throw new Error(`No uploaded build ${buildNumber} found for app ${appId}. Recent builds: ${seen}.`);
}

async function findOrCreateBetaGroup({ token, appId, groupName, external }) {
  const response = await ascFetch(token, `/betaGroups?filter[app]=${encodeURIComponent(appId)}&limit=200`);
  const groups = response.data || [];
  let group = groups.find((candidate) => candidate.attributes?.name === groupName) || (!external && groups.length === 1 ? groups[0] : null);
  if (!group && external) {
    const created = await ascWrite(token, "/betaGroups", "POST", {
      data: {
        type: "betaGroups",
        attributes: { name: groupName, publicLinkEnabled: false, feedbackEnabled: true },
        relationships: { app: { data: { type: "apps", id: appId } } },
      },
    });
    group = created.data;
  }
  if (!group) {
    const names = groups.map((candidate) => candidate.attributes?.name).filter(Boolean).join(", ") || "none";
    throw new Error(`No TestFlight beta group named "${groupName}" found. Available groups: ${names}.`);
  }
  if (external && group.attributes?.isInternalGroup !== false) {
    throw new Error(`TestFlight group "${groupName}" is not an external group. Refusing to attach friends to an internal group.`);
  }
  return group;
}

function validateExternalBuild(build) {
  const attributes = build.attributes || {};
  if (attributes.buildAudienceType !== "APP_STORE_ELIGIBLE") {
    throw new Error(
      `Build ${attributes.version || build.id} is ${attributes.buildAudienceType || "missing an audience type"}, not APP_STORE_ELIGIBLE. ` +
        "Upload again with TESTFLIGHT_INTERNAL_ONLY=NO; internal-only builds can never be sent to friends.",
    );
  }
  if (attributes.expired) throw new Error(`Build ${attributes.version || build.id} has expired and cannot be sent to friends.`);
  if (attributes.processingState !== "VALID") {
    throw new Error(`Build ${attributes.version || build.id} is ${attributes.processingState || "not processed"}; wait for a valid build before inviting friends.`);
  }
}

async function upsertBetaMetadata({ token, appId, buildId }) {
  const description =
    process.env.TESTFLIGHT_BETA_DESCRIPTION ||
    "Beachcar prepares a private daily shortlist of auction cars matched to each tester’s location, budget, and taste.";
  const whatsNew =
    process.env.TESTFLIGHT_WHATS_NEW ||
    "A smooth three-step setup now builds your first personalized shortlist immediately. Daily research and ready emails are included during the private beta.";
  const feedbackEmail = process.env.TESTFLIGHT_FEEDBACK_EMAIL || "jon.cooper@gmail.com";
  const marketingUrl = process.env.TESTFLIGHT_MARKETING_URL || "https://beachcar-watch.jon-cooper.workers.dev";
  const privacyPolicyUrl = required("TESTFLIGHT_PRIVACY_URL");

  await upsertLocalizedResource({
    token,
    listPath: `/betaAppLocalizations?filter[app]=${encodeURIComponent(appId)}&filter[locale]=en-US&limit=1`,
    createPath: "/betaAppLocalizations",
    type: "betaAppLocalizations",
    relationshipType: "apps",
    relationshipName: "app",
    relationshipId: appId,
    attributes: { locale: "en-US", description, feedbackEmail, marketingUrl, privacyPolicyUrl },
  });
  await upsertLocalizedResource({
    token,
    listPath: `/betaBuildLocalizations?filter[build]=${encodeURIComponent(buildId)}&filter[locale]=en-US&limit=1`,
    createPath: "/betaBuildLocalizations",
    type: "betaBuildLocalizations",
    relationshipType: "builds",
    relationshipName: "build",
    relationshipId: buildId,
    attributes: { locale: "en-US", whatsNew },
  });

  const reviewDetail = await ascFetch(token, `/apps/${appId}/betaAppReviewDetail`);
  if (!reviewDetail.data?.id) throw new Error("App Store Connect did not return beta review details for Beachcar.");
  await ascWrite(token, `/betaAppReviewDetails/${reviewDetail.data.id}`, "PATCH", {
    data: {
      type: "betaAppReviewDetails",
      id: reviewDetail.data.id,
      attributes: {
        contactFirstName: required("APPLE_REVIEW_CONTACT_FIRST_NAME"),
        contactLastName: required("APPLE_REVIEW_CONTACT_LAST_NAME"),
        contactPhone: required("APPLE_REVIEW_CONTACT_PHONE"),
        contactEmail: required("APPLE_REVIEW_CONTACT_EMAIL"),
        demoAccountName: required("APPLE_REVIEW_ACCOUNT_EMAIL"),
        demoAccountPassword: required("APPLE_REVIEW_ACCOUNT_PASSWORD"),
        notes:
          process.env.APPLE_REVIEW_NOTES ||
          "Sign in with the review account above. It is pre-provisioned for managed private-beta access and has a seeded shortlist. Email code is the normal friend flow; password is enabled only for this review account.",
      },
    },
  });
}

async function upsertLocalizedResource({
  token,
  listPath,
  createPath,
  type,
  relationshipType,
  relationshipName,
  relationshipId,
  attributes,
}) {
  const existing = (await ascFetch(token, listPath)).data?.[0];
  if (existing) {
    return ascWrite(token, `${createPath}/${existing.id}`, "PATCH", { data: { type, id: existing.id, attributes } });
  }
  return ascWrite(token, createPath, "POST", {
    data: {
      type,
      attributes,
      relationships: { [relationshipName]: { data: { type: relationshipType, id: relationshipId } } },
    },
  });
}

async function submitForBetaReview({ token, buildId }) {
  const submissions = await ascFetch(token, `/betaAppReviewSubmissions?filter[build]=${encodeURIComponent(buildId)}&limit=10`);
  const existing = submissions.data?.[0];
  if (existing) {
    if (existing.attributes?.betaReviewState === "REJECTED") {
      throw new Error("This build was rejected by external beta review. Upload a corrected, app-store-eligible build before inviting friends.");
    }
    return existing;
  }
  const created = await ascWrite(token, "/betaAppReviewSubmissions", "POST", {
    data: {
      type: "betaAppReviewSubmissions",
      relationships: { build: { data: { type: "builds", id: buildId } } },
    },
  });
  return created.data;
}

async function assignBuildToGroup({ token, groupId, buildId }) {
  const response = await fetch(`${apiBase}/betaGroups/${groupId}/relationships/builds`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: [{ type: "builds", id: buildId }] }),
  });
  if (response.ok) return;

  const text = await response.text();
  if (response.status === 409) return;
  throw new Error(`App Store Connect assignment failed (${response.status}): ${text}`);
}

async function verifyBuildInGroup({ token, groupId, buildId }) {
  let path = `/betaGroups/${groupId}/relationships/builds?limit=200`;
  while (path) {
    const response = await ascFetch(token, path);
    if ((response.data || []).some((item) => item.id === buildId)) return;
    path = response.links?.next ? response.links.next.replace(apiBase, "") : "";
  }
  throw new Error(`Build ${buildId} was not found in beta group ${groupId} after assignment.`);
}

async function ascFetch(token, pathname) {
  const response = await fetch(`${apiBase}${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`App Store Connect request failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

async function ascWrite(token, pathname, method, body) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`App Store Connect ${method} ${pathname} failed (${response.status}): ${await response.text()}`);
  }
  return response.status === 204 ? {} : response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
