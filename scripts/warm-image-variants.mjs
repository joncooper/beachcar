#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

await loadEnvFile(resolve(".publish.env"));
await loadEnvFile(resolve(".deploy.env"));

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--") && !arg.includes("=")));
const execute = flags.has("--execute");
const allImages = flags.has("--all");
const force = flags.has("--force");
const database = valueArg("--database") || process.env.BEACHCAR_D1_DATABASE || "beach-car-watch";
const baseUrl = (process.env.AUCTION_WATCH_URL || process.env.BEACHCAR_DEPLOY_URL || "").replace(/\/+$/, "");
const variants = parseVariantList(valueArg("--variants") || process.env.IMAGE_WARM_VARIANTS || "deck,thumb");
const limit = positiveInteger(valueArg("--limit") || process.env.IMAGE_WARM_LIMIT, 0);
const concurrency = positiveInteger(valueArg("--concurrency") || process.env.IMAGE_WARM_CONCURRENCY, 8);

if (flags.has("--help") || flags.has("-h")) {
  printHelp();
  process.exit(0);
}

if (!baseUrl) {
  fail("Set AUCTION_WATCH_URL in .publish.env or BEACHCAR_DEPLOY_URL in .deploy.env.");
}

if (!variants.length) {
  fail("Set at least one valid variant with --variants deck,thumb,full.");
}

const rows = await readImageRows();
const tasks = buildTasks(rows);
const selectedTasks = limit > 0 ? tasks.slice(0, limit) : tasks;

console.log(`${execute ? "Warming" : "Dry run"} ${selectedTasks.length}/${tasks.length} ${allImages ? "all-image" : "latest-run"} variant request(s).`);
console.log(`Target: ${baseUrl}`);
console.log(`Variants: ${variants.join(", ")}; concurrency: ${concurrency}; force: ${force ? "yes" : "no"}.`);

if (!execute) {
  console.log("No requests sent. Add --execute to create missing variants.");
  process.exit(0);
}

const result = {
  total: selectedTasks.length,
  ok: 0,
  failed: 0,
  hit: 0,
  miss: 0,
  bytes: 0,
};

await runPool(selectedTasks, concurrency, async (task) => {
  const response = await fetch(`${baseUrl}/api/images/${encodeURIComponent(task.imageKey)}?variant=${encodeURIComponent(task.variant)}`, {
    headers: imageAccessHeaders(),
  });
  const body = await response.arrayBuffer().catch(() => new ArrayBuffer(0));
  result.bytes += body.byteLength;
  if (response.ok) {
    result.ok += 1;
    const cacheStatus = (response.headers.get("x-beachcar-image-cache") || "").toLowerCase();
    if (cacheStatus === "hit") result.hit += 1;
    else result.miss += 1;
    return;
  }
  result.failed += 1;
  console.warn(`warm failed ${task.imageKey} ${task.variant}: ${response.status}`);
});

console.log(
  `Done. ${result.ok}/${result.total} ok, ${result.failed} failed, ${result.hit} hit, ${result.miss} created/missed, ${formatBytes(result.bytes)} fetched.`,
);

async function readImageRows() {
  const sql = allImages ? allImagesSql() : latestRunSql();
  const { stdout } = await execFileAsync("bunx", ["wrangler", "d1", "execute", database, "--remote", "--json", "--command", sql], {
    maxBuffer: 10 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout);
  const results = parsed?.[0]?.results;
  if (!Array.isArray(results)) {
    fail(`Could not read D1 image rows from ${database}.`);
  }
  return results;
}

function buildTasks(rows) {
  const tasks = [];
  const seen = new Set();
  for (const row of rows) {
    const imageKey = row.image_key || row.imageKey;
    if (!imageKey) continue;
    for (const variant of variants) {
      if (!force && Number(row[`has_${variant}`]) === 1) continue;
      const taskKey = `${imageKey}:${variant}`;
      if (seen.has(taskKey)) continue;
      seen.add(taskKey);
      tasks.push({ imageKey, variant });
    }
  }
  return tasks;
}

function latestRunSql() {
  return `WITH latest AS (
  SELECT id FROM runs ORDER BY generated_at DESC LIMIT 1
)
SELECT
  i.image_key,
  i.listing_key,
  i.source_url,
  MAX(CASE WHEN v.variant = 'thumb' AND v.status = 'created' THEN 1 ELSE 0 END) AS has_thumb,
  MAX(CASE WHEN v.variant = 'deck' AND v.status = 'created' THEN 1 ELSE 0 END) AS has_deck,
  MAX(CASE WHEN v.variant = 'full' AND v.status = 'created' THEN 1 ELSE 0 END) AS has_full
FROM latest
JOIN run_listings rl ON rl.run_id = latest.id
JOIN images i ON i.listing_key = rl.listing_key
LEFT JOIN image_variants v ON v.image_key = i.image_key
WHERE i.status = 'copied'
GROUP BY i.image_key
ORDER BY MIN(rl.sort_order), MIN(i.created_at);`;
}

function allImagesSql() {
  return `SELECT
  i.image_key,
  i.listing_key,
  i.source_url,
  MAX(CASE WHEN v.variant = 'thumb' AND v.status = 'created' THEN 1 ELSE 0 END) AS has_thumb,
  MAX(CASE WHEN v.variant = 'deck' AND v.status = 'created' THEN 1 ELSE 0 END) AS has_deck,
  MAX(CASE WHEN v.variant = 'full' AND v.status = 'created' THEN 1 ELSE 0 END) AS has_full
FROM images i
LEFT JOIN image_variants v ON v.image_key = i.image_key
WHERE i.status = 'copied'
GROUP BY i.image_key
ORDER BY i.created_at;`;
}

async function runPool(items, concurrency, worker) {
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

async function loadEnvFile(path) {
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch {
    return;
  }
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

function imageAccessHeaders() {
  const accessClientId = process.env.CF_ACCESS_CLIENT_ID || "";
  const accessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET || "";
  return accessClientId && accessClientSecret
    ? {
        "CF-Access-Client-Id": accessClientId,
        "CF-Access-Client-Secret": accessClientSecret,
      }
    : {};
}

function valueArg(name) {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : "";
}

function parseVariantList(value) {
  const allowed = new Set(["thumb", "deck", "full"]);
  const seen = new Set();
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => {
      if (!allowed.has(item) || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let unitIndex = 0;
  let amount = value;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount.toFixed(amount >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function printHelp() {
  console.log(`Warm Beachcar image variants by requesting /api/images/:imageKey?variant=...

Dry run, latest published run:
  bun scripts/warm-image-variants.mjs

Warm latest run thumb/deck variants:
  bun scripts/warm-image-variants.mjs --execute

Warm all copied images:
  bun scripts/warm-image-variants.mjs --all --execute

Options:
  --variants deck,thumb,full   Variants to warm. Default: deck,thumb
  --limit N                    Limit variant requests, after missing-only filtering
  --concurrency N              Parallel fetches. Default: 8
  --force                      Request variants even when D1 says created
  --database NAME              D1 database name. Default: beach-car-watch
  --execute                    Send warming requests; omitted means dry run
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
