#!/usr/bin/env bun
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateSourceQualitySchemaGate } from "./lib/cloudflare-rollout.ts";

const args = process.argv.slice(2);
const flags = new Set(args);

if (flags.has("--help") || flags.has("-h")) {
  printHelp();
  process.exit(0);
}

const applyResources = flags.has("--apply-resources");
const writeConfig = flags.has("--write-config");
const migrate = flags.has("--migrate");
const dryRunDeploy = flags.has("--dry-run-deploy");
const deploy = flags.has("--deploy");
const yes = flags.has("--yes");
const deployContainers = flags.has("--deploy-containers");
const secretsFile = valueArg("--secrets-file") ? resolve(valueArg("--secrets-file")) : "";
const runnerMode = normalizeRunnerMode(process.env.BEACHCAR_RUNNER_MODE);
const ownerEmails = normalizeEmailList(valueArg("--owner-emails") || process.env.BEACHCAR_BOOTSTRAP_OWNER_EMAILS || process.env.BOOTSTRAP_OWNER_EMAILS || "");
const remoteMutationRequested = applyResources || migrate || deploy;

if (remoteMutationRequested && !yes) {
  fail("Remote Cloudflare mutations require --yes plus the specific action flag, for example --yes --apply-resources.");
}

if (deploy && !dryRunDeploy) {
  fail("Deploy requires --dry-run-deploy in the same invocation so the bundle is validated immediately before upload.");
}

if (deploy && !migrate) {
  fail("Deploy requires --migrate in the same invocation so remote D1 schema is checked immediately before upload.");
}

if (secretsFile && !deploy) {
  fail("--secrets-file is only accepted with --deploy so secret changes are uploaded atomically with a Worker version.");
}

if (secretsFile) {
  const metadata = await stat(secretsFile).catch(() => null);
  if (!metadata?.isFile()) fail("--secrets-file must point to a readable regular file.");
  if ((metadata.mode & 0o077) !== 0) fail("--secrets-file must not be readable or writable by group or other users (expected mode 0600).");
}

const wranglerPath = resolve("wrangler.jsonc");
let wrangler = await readJsonc(wranglerPath);
const d1Binding = wrangler?.d1_databases?.[0] || {};
const d1Name = stringValue(d1Binding.database_name) || "beachcar-watch";
const r2Name = stringValue(wrangler?.r2_buckets?.[0]?.bucket_name) || "beachcar-watch-images";
const workerName = stringValue(wrangler?.name) || "beachcar-watch";
const configuredOwnerEmails = ownerEmails.length ? ownerEmails : configuredBootstrapOwnerEmails(wrangler);

let check = await inspectCloudflare({ strictAccount: remoteMutationRequested });
let exactD1 = findD1(check, d1Name);
const r2Exists = check.resources.r2Buckets.includes(r2Name);

console.log("Beachcar Cloudflare rollout bootstrap");
console.log(`Worker: ${workerName}`);
if (check.accountId) console.log(`Account: ${check.accountId}`);
if (dryRunDeploy || deploy) {
  console.log(
    shouldSkipContainerRollout()
      ? `Container image rollout: skipped (BEACHCAR_RUNNER_MODE=${runnerMode}; pass --deploy-containers to update it).`
      : "Container image rollout: enabled.",
  );
}
console.log("");

if (!exactD1) {
  console.log(`D1 ${d1Name}: missing`);
  if (applyResources) {
    await runWrangler(["d1", "create", d1Name], { label: `Create D1 ${d1Name}` });
    check = await inspectCloudflare({ strictAccount: true });
    exactD1 = findD1(check, d1Name);
    if (!exactD1) fail(`D1 ${d1Name} was created but not found by read-back inspection.`);
  }
} else {
  console.log(`D1 ${d1Name}: ${exactD1.uuid}`);
}

if (!r2Exists) {
  console.log(`R2 ${r2Name}: missing`);
  if (applyResources) {
    await runWrangler(["r2", "bucket", "create", r2Name], { label: `Create R2 ${r2Name}` });
    check = await inspectCloudflare({ strictAccount: true });
    if (!check.resources.r2Buckets.includes(r2Name)) fail(`R2 ${r2Name} was created but not found by read-back inspection.`);
  }
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
  const args = deployCommandArgs(["--dry-run"]);
  await runWrangler(args, { label: "Dry-run Worker deploy" });
}

if (migrate) {
  if (!exactD1) fail(`Cannot apply migrations until D1 ${d1Name} exists.`);
  await runWrangler(["d1", "migrations", "apply", d1Name, "--remote"], { label: `Apply remote D1 migrations to ${d1Name}` });
  await verifySourceQualityD1Schema();
}

if (deploy) {
  const args = deployCommandArgs();
  await runWrangler(args, { label: "Deploy Worker" });
}

await printNextSteps({ exactD1, r2Exists: check.resources.r2Buckets.includes(r2Name) });

async function inspectCloudflare(options = {}) {
  const command = ["bun", "scripts/check-cloudflare-resources.mjs", "--json"];
  if (options.strictAccount) command.push("--strict-account");
  const result = await run(command, { label: "Inspect Cloudflare resources", quiet: true });
  return JSON.parse(result.stdout);
}

function findD1(checkResult, name) {
  return checkResult.resources.d1.find((db) => db?.name === name) || null;
}

async function printNextSteps(state) {
  console.log("");
  console.log("Next steps:");
  if (!state.exactD1) {
    console.log(`- Create D1 and update config: bun scripts/bootstrap-cloudflare-rollout.mjs --yes --apply-resources --write-config`);
  } else if (isPlaceholder(wrangler?.d1_databases?.[0]?.database_id)) {
    console.log(`- Write D1 id into wrangler.jsonc: bun scripts/bootstrap-cloudflare-rollout.mjs --write-config`);
  }
  if (!configuredOwnerEmails.length) {
    console.log(`- Set owner emails in config: bun scripts/bootstrap-cloudflare-rollout.mjs --write-config --owner-emails "owner@example.com"`);
  }
  console.log("- Keep required Worker secrets set remotely, or pass a protected --secrets-file during deploy.");
  console.log("- Then run: bun scripts/bootstrap-cloudflare-rollout.mjs --yes --migrate --dry-run-deploy");
  console.log("- Actual deploy is explicit: bun scripts/bootstrap-cloudflare-rollout.mjs --yes --migrate --dry-run-deploy --deploy");
  console.log("No deploy is performed unless --deploy is present.");
}

async function runWrangler(commandArgs, options = {}) {
  return run(["bunx", "wrangler", ...commandArgs], options);
}

async function verifySourceQualityD1Schema() {
  const columnsSql = `SELECT COUNT(*) AS found_columns FROM pragma_table_info('source_items') WHERE name IN ('bid_num','location','location_city','location_region','location_country','ends_at','no_reserve','last_detail_at','detail_status','detail_error','is_live','dossier_json')`;
  const indexesSql = `SELECT COUNT(*) AS found_indexes FROM sqlite_master WHERE type = 'index' AND name IN ('idx_source_items_source_live_ends','idx_source_items_source_bid','idx_source_items_source_location')`;
  const [columns, indexes, quickCheck] = await Promise.all([
    runWrangler(["d1", "execute", d1Name, "--remote", "--json", "--command", columnsSql], {
      label: "Verify Source Quality v1 D1 columns",
      quiet: true,
    }),
    runWrangler(["d1", "execute", d1Name, "--remote", "--json", "--command", indexesSql], {
      label: "Verify Source Quality v1 D1 indexes",
      quiet: true,
    }),
    runWrangler(["d1", "execute", d1Name, "--remote", "--json", "--command", "PRAGMA quick_check"], {
      label: "Run remote D1 quick_check",
      quiet: true,
    }),
  ]);
  const gate = evaluateSourceQualitySchemaGate({
    columns: columns.stdout,
    indexes: indexes.stdout,
    quickCheck: quickCheck.stdout,
  });
  if (!gate.ok) {
    throw new Error(
      `Post-migration D1 gate failed: expected 12 Source Quality columns, 3 indexes, and quick_check=ok; found ${gate.columnCount} columns, ${gate.indexCount} indexes, quick_check=${gate.quickCheck || "unreadable"}. The Worker was not deployed.`,
    );
  }
  console.log("\nD1 post-migration gate passed: 12 Source Quality columns, 3 indexes, quick_check=ok.");
}

function deployCommandArgs(extraArgs = []) {
  const args = ["deploy", ...extraArgs];
  if (secretsFile) args.push("--secrets-file", secretsFile);
  if (shouldSkipContainerRollout()) {
    args.push("--containers-rollout", "none");
  }
  return args;
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

Default mode is read-only. Remote mutations require --yes plus the requested action.

Options:
  --write-config             Update wrangler.jsonc with discovered D1 id and/or owner emails.
  --owner-emails <emails>    Comma- or space-separated bootstrap owner emails.
  --apply-resources          Create missing D1/R2 resources.
  --migrate                  Apply D1 migrations remotely.
  --dry-run-deploy           Run wrangler deploy --dry-run.
  --deploy                   Deploy the Worker. Requires --dry-run-deploy in the same run.
  --secrets-file <path>      Protected 0600 JSON/.env file passed to wrangler deploy; requires --deploy.
  --deploy-containers        Also build/update the Cloudflare Container image. By default this is skipped unless BEACHCAR_RUNNER_MODE=codex.
  --yes                      Required for --apply-resources, --migrate, or --deploy.

Examples:
  bun scripts/bootstrap-cloudflare-rollout.mjs
  bun scripts/bootstrap-cloudflare-rollout.mjs --write-config --owner-emails "owner@example.com"
  bun scripts/bootstrap-cloudflare-rollout.mjs --yes --apply-resources --write-config
  bun scripts/bootstrap-cloudflare-rollout.mjs --yes --migrate --dry-run-deploy --deploy
`);
}
