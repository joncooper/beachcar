#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { guardedWorkerDeployArgs } from "./lib/cloudflare-rollout.ts";

const args = process.argv.slice(2);
const flags = new Set(args);

if (flags.has("--help") || flags.has("-h")) {
  printHelp();
  process.exit(0);
}

const writeConfig = flags.has("--write-config");
const dryRunDeploy = flags.has("--dry-run-deploy");
const deployContainers = flags.has("--deploy-containers");
const runnerMode = normalizeRunnerMode(process.env.BEACHCAR_RUNNER_MODE);
const ownerEmails = normalizeEmailList(valueArg("--owner-emails") || process.env.BEACHCAR_BOOTSTRAP_OWNER_EMAILS || process.env.BOOTSTRAP_OWNER_EMAILS || "");
const forbiddenRemoteFlags = ["--apply-resources", "--migrate", "--deploy", "--secrets-file", "--yes"].filter((flag) => flags.has(flag));
if (forbiddenRemoteFlags.length) {
  fail(
    `Direct remote Cloudflare mutations are disabled (${forbiddenRemoteFlags.join(", ")}). Use bun run deploy:remote -- --execute --yes so account, identity, rollback, backup, migration, and strict-config gates all run first.`,
  );
}

const wranglerPath = resolve("wrangler.jsonc");
let wrangler = await readJsonc(wranglerPath);
const d1Binding = wrangler?.d1_databases?.[0] || {};
const d1Name = stringValue(d1Binding.database_name) || "beachcar-watch";
const r2Name = stringValue(wrangler?.r2_buckets?.[0]?.bucket_name) || "beachcar-watch-images";
const workerName = stringValue(wrangler?.name) || "beachcar-watch";
const configuredOwnerEmails = ownerEmails.length ? ownerEmails : configuredBootstrapOwnerEmails(wrangler);

const check = await inspectCloudflare();
const exactD1 = findD1(check, d1Name);
const r2Exists = check.resources.r2Buckets.includes(r2Name);

console.log("Beachcar Cloudflare rollout bootstrap");
console.log(`Worker: ${workerName}`);
if (check.accountId) console.log(`Account: ${check.accountId}`);
if (dryRunDeploy) {
  console.log(
    shouldSkipContainerRollout()
      ? `Container image rollout: skipped (BEACHCAR_RUNNER_MODE=${runnerMode}; pass --deploy-containers to update it).`
      : "Container image rollout: enabled.",
  );
}
console.log("");

if (!exactD1) {
  console.log(`D1 ${d1Name}: missing`);
} else {
  console.log(`D1 ${d1Name}: ${exactD1.uuid}`);
}

if (!r2Exists) {
  console.log(`R2 ${r2Name}: missing`);
} else {
  console.log(`R2 ${r2Name}: present`);
}

if (writeConfig) {
  let changed = false;
  if (exactD1 && d1Binding.database_id !== exactD1.uuid) {
    wrangler.d1_databases[0].database_id = exactD1.uuid;
    changed = true;
    console.log(`Config: set D1 database_id to ${exactD1.uuid}`);
  }
  if (ownerEmails.length) {
    wrangler.vars = wrangler.vars || {};
    const nextOwners = ownerEmails.join(",");
    if (wrangler.vars.BOOTSTRAP_OWNER_EMAILS !== nextOwners) {
      wrangler.vars.BOOTSTRAP_OWNER_EMAILS = nextOwners;
      changed = true;
      console.log(`Config: set BOOTSTRAP_OWNER_EMAILS to ${redactOwners(ownerEmails)}`);
    }
  }
  if (changed) {
    await writeFile(wranglerPath, `${JSON.stringify(wrangler, null, 2)}\n`);
  } else {
    console.log("Config: already up to date");
  }
}

if (dryRunDeploy) {
  await runWrangler(
    guardedWorkerDeployArgs({ dryRun: true, skipContainerRollout: shouldSkipContainerRollout() }),
    { label: "Strictly dry-run Worker deploy" },
  );
}

await printNextSteps({ exactD1, r2Exists: check.resources.r2Buckets.includes(r2Name) });

async function inspectCloudflare() {
  const result = await run(["bun", "scripts/check-cloudflare-resources.mjs", "--json"], { label: "Inspect Cloudflare resources", quiet: true });
  return JSON.parse(result.stdout);
}

function findD1(checkResult, name) {
  return checkResult.resources.d1.find((db) => db?.name === name) || null;
}

async function printNextSteps(state) {
  console.log("");
  console.log("Next steps:");
  if (!state.exactD1) {
    console.log("- Stop: the guarded production rollout requires its configured D1 to exist before execution.");
  } else if (isPlaceholder(wrangler?.d1_databases?.[0]?.database_id)) {
    console.log(`- Write D1 id into wrangler.jsonc: bun scripts/bootstrap-cloudflare-rollout.mjs --write-config`);
  }
  if (!state.r2Exists) {
    console.log("- Stop: the guarded production rollout requires its configured R2 bucket to exist before execution.");
  }
  if (!configuredOwnerEmails.length) {
    console.log(`- Set owner emails in config: bun scripts/bootstrap-cloudflare-rollout.mjs --write-config --owner-emails "owner@example.com"`);
  }
  console.log("- Rehearse the sole production path: bun run deploy:remote -- --dry-run");
  console.log("- Execute only through: bun run deploy:remote -- --execute --yes");
  console.log("This bootstrap command never creates, migrates, or deploys remote resources.");
}

async function runWrangler(commandArgs, options = {}) {
  return run(["bunx", "wrangler", ...commandArgs], options);
}

function shouldSkipContainerRollout() {
  return !deployContainers && runnerMode !== "codex";
}

async function run(command, options = {}) {
  if (!options.quiet) console.log(`\n==> ${options.label || command.join(" ")}`);
  const proc = Bun.spawn(command, {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (!options.quiet && stdout.trim()) console.log(stdout.trim());
  if (!options.quiet && stderr.trim()) console.error(stderr.trim());
  if (exitCode !== 0) {
    const detail = (stderr || stdout || `exit code ${exitCode}`).trim();
    throw new Error(`${options.label || command.join(" ")} failed: ${detail}`);
  }
  return { stdout, stderr, exitCode };
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

function valueArg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || "" : "";
}

function normalizeEmailList(value) {
  return Array.from(
    new Set(
      String(value || "")
        .split(/[,\s]+/)
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email.includes("@")),
    ),
  );
}

function configuredBootstrapOwnerEmails(config) {
  const vars = config?.vars || {};
  const explicit = normalizeEmailList([vars.BOOTSTRAP_OWNER_EMAILS, vars.ALLOWED_EMAILS].filter(Boolean).join(","));
  return explicit.length ? explicit : normalizeEmailList(vars.ALLOWED_EMAIL || "");
}

function redactOwners(emails) {
  return emails.map((email) => email.replace(/^(.).+(@.*)$/, "$1***$2")).join(",");
}

function isPlaceholder(value) {
  return !value || /REPLACE|TODO|CHANGEME|placeholder/i.test(String(value));
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeRunnerMode(value) {
  const mode = stringValue(value).toLowerCase();
  return mode === "codex" ? "codex" : "deterministic";
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`Beachcar Cloudflare rollout bootstrap

Default mode is read-only. This helper cannot create, migrate, or deploy remote resources.

Options:
  --write-config             Update wrangler.jsonc with discovered D1 id and/or owner emails.
  --owner-emails <emails>    Comma- or space-separated bootstrap owner emails.
  --dry-run-deploy           Run wrangler deploy --strict --keep-vars --dry-run.
  --deploy-containers        Include Container build validation in the dry run.

Examples:
  bun scripts/bootstrap-cloudflare-rollout.mjs
  bun scripts/bootstrap-cloudflare-rollout.mjs --write-config --owner-emails "owner@example.com"
  bun scripts/bootstrap-cloudflare-rollout.mjs --dry-run-deploy

Production mutation is available only through:
  bun run deploy:remote -- --execute --yes
`);
}
