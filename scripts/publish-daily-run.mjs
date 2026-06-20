#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

await loadEnvFile(resolve(".publish.env"));

const dailyJson = resolve(process.env.DAILY_JSON || "examples/daily-run.sample.json");
const reportMarkdown = process.env.REPORT_MARKDOWN ? await readOptional(resolve(process.env.REPORT_MARKDOWN)) : null;
const baseUrl = (process.env.AUCTION_WATCH_URL || "").replace(/\/+$/, "");
const publishToken = process.env.PUBLISH_TOKEN || "";
const accessClientId = process.env.CF_ACCESS_CLIENT_ID || "";
const accessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET || "";

if (!baseUrl) {
  fail("Set AUCTION_WATCH_URL to the deployed Worker URL, for example https://beachcar-watch.<subdomain>.workers.dev");
}

if (!publishToken) {
  fail("Set PUBLISH_TOKEN to the same secret configured on the Worker.");
}

const raw = JSON.parse(await readFile(dailyJson, "utf8"));
const listings = Array.isArray(raw) ? raw : raw.listings || raw.items || [];
if (!Array.isArray(listings) || listings.length === 0) {
  fail(`${basename(dailyJson)} does not contain any listings.`);
}

const payload = {
  generatedAt: process.env.GENERATED_AT || new Date().toISOString(),
  reportMarkdown,
  sourceSummary: {
    sourceFile: dailyJson,
    listingCount: listings.length,
    publisher: "codex",
    imagePolicy: "copy-to-r2-v1",
  },
  listings,
};

const authHeaders = {
  "X-Publish-Token": publishToken,
  ...(accessClientId && accessClientSecret
    ? {
        "CF-Access-Client-Id": accessClientId,
        "CF-Access-Client-Secret": accessClientSecret,
      }
    : {}),
};

console.log(`Importing ${listings.length} listings into ${baseUrl}...`);
const importResponse = await fetch(`${baseUrl}/api/admin/import`, {
  method: "POST",
  headers: {
    ...authHeaders,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});

const importBody = await readResponse(importResponse);
if (!importResponse.ok) {
  fail(`Import failed: ${importResponse.status} ${formatBody(importBody)}`);
}

const images = Array.isArray(importBody.images) ? importBody.images : [];
console.log(`Imported run ${importBody.runId}; ${images.length} image records queued.`);

let copied = 0;
let failed = 0;
for (const image of images) {
  if (!image?.listingKey || !image?.imageKey || !image?.sourceUrl) continue;
  try {
    await copyImage(image);
    copied += 1;
  } catch (error) {
    failed += 1;
    console.warn(`Image copy failed for ${image.sourceUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`Done. Copied ${copied}/${images.length} images to R2${failed ? `, ${failed} failed` : ""}.`);

async function copyImage(image) {
  const imageResponse = await fetch(image.sourceUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 BeachcarWatch/1.0",
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      Referer: new URL(image.sourceUrl).origin,
    },
  });

  if (!imageResponse.ok || !imageResponse.body) {
    throw new Error(`source returned ${imageResponse.status}`);
  }

  const contentType = imageResponse.headers.get("content-type") || "application/octet-stream";
  const body = await imageResponse.arrayBuffer();
  const uploadResponse = await fetch(
    `${baseUrl}/api/admin/images/${encodeURIComponent(image.listingKey)}/${encodeURIComponent(image.imageKey)}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": contentType,
        "Content-Length": String(body.byteLength),
        "X-Source-Url": image.sourceUrl,
      },
      body,
    },
  );

  const uploadBody = await readResponse(uploadResponse);
  if (!uploadResponse.ok) {
    throw new Error(`upload returned ${uploadResponse.status} ${formatBody(uploadBody)}`);
  }
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
