#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const strict = process.argv.includes("--strict");
const jsonOutput = process.argv.includes("--json");
const report = {
  generatedAt: new Date().toISOString(),
  workerName: null,
  accountId: null,
  checks: [],
  resources: {
    d1: [],
    r2Buckets: [],
    workerDeployments: null,
    workerSecrets: null,
  },
};

const wrangler = await readJsonc(resolve("wrangler.jsonc"));
report.workerName = stringValue(wrangler?.name);

addCheck("wrangler.jsonc is readable", !!wrangler, "wrangler.jsonc loaded.", "Run this from the Beachcar repo root.");
addCheck("Worker name is configured", !!report.workerName, report.workerName || null, "Set name in wrangler.jsonc.");

const whoami = await runWrangler(["whoami"]);
report.accountId = accountIdFromWhoami(whoami.stdout);
addCheck("Wrangler is logged in", whoami.ok, report.accountId ? `Account ${report.accountId}.` : "Wrangler returned user settings.", "Run bunx wrangler login before remote resource inspection.");
if (report.accountId) addCheck("Cloudflare account id detected", true, report.accountId);

const configuredD1 = wrangler?.d1_databases?.[0] || {};
const configuredD1Name = stringValue(configuredD1.database_name);
const configuredD1Id = stringValue(configuredD1.database_id);
const d1List = await runWrangler(["d1", "list", "--json"]);
if (d1List.ok) {
  report.resources.d1 = parseJson(d1List.stdout, []);
  const exactD1 = report.resources.d1.find((db) => db?.name === configuredD1Name);
  const configuredIdMatch = configuredD1Id && !isPlaceholder(configuredD1Id) ? report.resources.d1.find((db) => db?.uuid === configuredD1Id) : null;
  const similarD1 = report.resources.d1.find((db) => normalizeName(db?.name) === normalizeName(configuredD1Name));
  addCheck("Remote D1 list is readable", true, `${report.resources.d1.length} database(s) visible.`);
  addCheck(
    "Configured D1 database exists remotely by name",
    !!exactD1,
    exactD1 ? `${exactD1.name} (${exactD1.uuid}).` : null,
    similarD1
      ? `No exact remote D1 named ${configuredD1Name}; similar database exists: ${similarD1.name} (${similarD1.uuid}).`
      : `Create remote D1 ${configuredD1Name} or update wrangler.jsonc to an existing database.`,
  );
  addCheck(
    "Configured D1 database_id matches a remote database",
    !!configuredIdMatch,
    configuredIdMatch ? `${configuredIdMatch.name} (${configuredIdMatch.uuid}).` : null,
    isPlaceholder(configuredD1Id)
      ? `Replace placeholder database_id with the remote D1 id before deploy. ${exactD1 ? `Candidate: ${exactD1.uuid}.` : ""}`
      : `Configured database_id ${configuredD1Id || "(missing)"} was not found in the account.`,
  );
} else {
  addCheck("Remote D1 list is readable", false, null, summarizeFailure(d1List));
}

const configuredBucketName = stringValue(wrangler?.r2_buckets?.[0]?.bucket_name);
const r2List = await runWrangler(["r2", "bucket", "list"]);
if (r2List.ok) {
  report.resources.r2Buckets = r2BucketNamesFromText(r2List.stdout);
  addCheck("Remote R2 bucket list is readable", true, `${report.resources.r2Buckets.length} bucket(s) visible.`);
  addCheck(
    "Configured R2 image bucket exists remotely",
    report.resources.r2Buckets.includes(configuredBucketName),
    configuredBucketName,
    `Create remote R2 bucket ${configuredBucketName} or update wrangler.jsonc to an existing bucket.`,
  );
} else {
  addCheck("Remote R2 bucket list is readable", false, null, summarizeFailure(r2List));
}

if (report.workerName) {
  const secrets = await runWrangler(["secret", "list", "--format", "json", "--name", report.workerName]);
  if (secrets.ok) {
    addCheck("Configured Worker exists remotely", true, `Worker ${report.workerName} accepted secret inspection.`);
    const deployments = await runWrangler(["deployments", "list", "--json", "--name", report.workerName]);
    report.resources.workerDeployments = deployments.ok ? parseJson(deployments.stdout, []) : { error: summarizeFailure(deployments) };
    report.resources.workerSecrets = secretNames(parseJson(secrets.stdout, []));
    const requiredSecrets = ["PUBLISH_TOKEN", "CLERK_SECRET_KEY", "CLERK_JWT_ISSUER"];
    const recommendedSecrets = ["BEACHCAR_AI_GATEWAY_TOKEN"];
    addCheck("Remote Worker secrets are readable", true, `${report.resources.workerSecrets.length} secret name(s) returned.`);
    for (const name of requiredSecrets) {
      addCheck(`Required remote secret ${name} is set`, report.resources.workerSecrets.includes(name), name, `Set ${name} with wrangler secret put ${name}.`);
    }
    for (const name of recommendedSecrets) {
      addCheck(`Recommended remote secret ${name} is set`, report.resources.workerSecrets.includes(name), name, `Set ${name} before remote AI Gateway scoring rehearsal.`, "warn");
    }
  } else {
    report.resources.workerDeployments = null;
    report.resources.workerSecrets = { error: summarizeFailure(secrets) };
    addCheck("Configured Worker exists remotely", false, null, summarizeFailure(secrets));
    addCheck("Remote Worker secrets are readable", false, null, "Deploy the Worker first, then run this check again.");
  }
}

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printReport(report);
}

const failures = report.checks.filter((check) => check.status === "todo");
if (strict && failures.length) process.exit(1);

async function runWrangler(args) {
  const proc = Bun.spawn(["bunx", "wrangler", ...args], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { ok: exitCode === 0, exitCode, stdout, stderr, command: `bunx wrangler ${args.join(" ")}` };
}

function addCheck(label, ok, okDetail, failDetail = "", severity = "todo") {
  report.checks.push({ label, status: ok ? "ok" : severity, detail: ok ? okDetail : failDetail });
}

async function readJsonc(path) {
  const text = await readFile(path, "utf8");
  return JSON.parse(stripJsonComments(text));
}

function stripJsonComments(text) {
  let output = "";
  let inString = false;
  let quote = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inString) {
      output += char;
      if (char === "\\" && next) {
        output += next;
        index += 1;
      } else if (char === quote) {
        inString = false;
      }
    } else if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
    } else if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      output += "\n";
    } else if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1;
      index += 1;
    } else {
      output += char;
    }
  }
  return output;
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function accountIdFromWhoami(text) {
  const match = text.match(/\b[a-f0-9]{32}\b/i);
  return match ? match[0] : null;
}

function r2BucketNamesFromText(text) {
  return Array.from(text.matchAll(/^name:\s+(.+)$/gm), (match) => match[1].trim()).filter(Boolean);
}

function secretNames(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry : stringValue(entry?.name)))
    .filter(Boolean)
    .sort();
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isPlaceholder(value) {
  return !value || /REPLACE|TODO|CHANGEME|placeholder/i.test(value);
}

function normalizeName(value) {
  return stringValue(value).replace(/[^0-9a-z]/gi, "").toLowerCase();
}

function summarizeFailure(result) {
  return (result.stderr || result.stdout || `exit code ${result.exitCode}`).replace(/\u001b\[[0-9;]*m/g, "").trim().split(/\r?\n/).filter(Boolean).slice(0, 3).join(" ");
}

function printReport(value) {
  console.log("Beachcar Cloudflare resource check (read-only)");
  console.log(`Generated: ${value.generatedAt}`);
  console.log(`Worker: ${value.workerName || "(missing)"}`);
  if (value.accountId) console.log(`Account: ${value.accountId}`);
  console.log("");
  for (const check of value.checks) {
    const marker = check.status === "ok" ? "OK" : check.status === "warn" ? "WARN" : "TODO";
    console.log(`${marker} ${check.label}`);
    if (check.detail) console.log(`    ${check.detail}`);
  }
  const counts = value.checks.reduce((acc, check) => {
    acc[check.status] = (acc[check.status] || 0) + 1;
    return acc;
  }, {});
  console.log("");
  console.log(`Summary: ${counts.ok || 0} ok, ${counts.warn || 0} warnings, ${counts.todo || 0} todos.`);
  console.log("No Cloudflare resources were created, changed, or deployed.");
}
