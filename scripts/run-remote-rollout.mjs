#!/usr/bin/env bun
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  collectRolloutWorkerSecrets,
  collectWorkerSecrets,
  evaluateDurableObjectRollbackGate,
  evaluateSourceQualitySchemaGate,
  guardedWorkerDeployArgs,
  isSafeSourceQualityMigrationSet,
  missingRequiredWorkerSecrets,
  pendingD1MigrationFiles,
  verificationRequirementArgs,
  workerMigrationTagFromServiceMetadata,
} from "./lib/cloudflare-rollout.ts";

const args = process.argv.slice(2);
const flags = new Set(args);
const execute = flags.has("--execute");
const yes = flags.has("--yes");
const dryRunOnly = flags.has("--dry-run");
const skipVerify = flags.has("--skip-verify");
const deployContainers = flags.has("--deploy-containers");

if (flags.has("--help") || flags.has("-h")) {
  printHelp();
  process.exit(0);
}

if (execute && !yes) {
  fail("Remote rollout execution requires --yes. Use --dry-run to validate without mutating Cloudflare.");
}

if (execute && dryRunOnly) {
  fail("Use either --execute or --dry-run, not both.");
}

const devEnv = await loadEnvFile(resolve(".dev.vars"));
const publishEnv = await loadEnvFile(resolve(".publish.env"));
const deployFileEnv = await loadEnvFile(resolve(".deploy.env"));
const env = {
  ...devEnv,
  ...publishEnv,
  ...deployFileEnv,
  ...process.env,
};
const wrangler = await readJsonc(resolve("wrangler.jsonc"));
const workerName = stringValue(wrangler?.name) || "beachcar-watch";
const d1Name = stringValue(wrangler?.d1_databases?.[0]?.database_name) || "beach-car-watch";
const d1Id = stringValue(wrangler?.d1_databases?.[0]?.database_id);
const expectedAccountId = stringValue(wrangler?.account_id);
const configuredDurableObjectMigrations = Array.isArray(wrangler?.migrations) ? wrangler.migrations : [];
const expectedDurableObjectMigrationTag = stringValue(configuredDurableObjectMigrations.at(-1)?.tag);
const configuredRunnerMode = stringValue(deployFileEnv.BEACHCAR_RUNNER_MODE).toLowerCase();
const validRunnerMode = configuredRunnerMode === "deterministic" || configuredRunnerMode === "codex";
if (execute && !validRunnerMode) {
  fail("Remote rollout execution requires explicit BEACHCAR_RUNNER_MODE=deterministic or codex in .deploy.env.");
}
const rolloutRunnerMode = validRunnerMode ? configuredRunnerMode : "deterministic";
if (deployContainers !== (rolloutRunnerMode === "codex")) {
  fail(
    rolloutRunnerMode === "codex"
      ? "BEACHCAR_RUNNER_MODE=codex requires --deploy-containers."
      : "--deploy-containers requires BEACHCAR_RUNNER_MODE=codex in .deploy.env.",
  );
}
env.BEACHCAR_RUNNER_MODE = rolloutRunnerMode;

if (!execute && !dryRunOnly) {
  printPlan();
  process.exit(0);
}

let protectedSecretsFile = "";
let protectedSecretsDirectory = "";

try {
  await run(["bun", "scripts/validate-deploy-env.mjs", "--strict", "--allow-remote-secrets"], { env, label: "Validate deploy environment" });
  await run(["bun", "scripts/build-client.mjs"], { env, label: "Build production client assets" });
  await run(["bun", "scripts/bootstrap-cloudflare-rollout.mjs", "--dry-run-deploy", ...containerDeployArgs()], {
    env,
    label: "Validate Cloudflare deploy bundle",
  });

  if (!execute) {
    console.log("\nDry-run completed. No remote migrations, secrets, or deploy were applied.");
    process.exit(0);
  }

  const localSecrets = collectRolloutWorkerSecrets({
    deployFileEnv,
    ambientEnv: process.env,
    runnerMode: rolloutRunnerMode,
    deployContainers,
  });
  if (!collectWorkerSecrets(env).PUBLISH_TOKEN) {
    throw new Error("Remote rollout execution requires a real local PUBLISH_TOKEN so the effective runtime mode can be verified after deploy.");
  }
  if (rolloutRunnerMode === "codex" && !localSecrets.OPENAI_API_KEY) {
    throw new Error("Codex runner rollout requires OPENAI_API_KEY to be explicitly supplied in .deploy.env.");
  }
  const localSecretNames = Object.keys(localSecrets);
  const resourceReport = await inspectCloudflareForRollout(localSecretNames);
  const remoteSecretNames = Array.isArray(resourceReport.resources?.workerSecrets) ? resourceReport.resources.workerSecrets : [];
  const missingSecrets = missingRequiredWorkerSecrets(remoteSecretNames, localSecretNames);
  if (missingSecrets.length) {
    throw new Error(`Required Worker secret names are unavailable locally and remotely: ${missingSecrets.join(", ")}.`);
  }
  const aiGatewayTokenAvailable = remoteSecretNames.includes("BEACHCAR_AI_GATEWAY_TOKEN") || localSecretNames.includes("BEACHCAR_AI_GATEWAY_TOKEN");
  console.log(
    aiGatewayTokenAvailable
      ? "\nManaged scoring mode: Cloudflare AI Gateway runtime token is available."
      : "\nManaged scoring mode: explicit heuristic-only pilot (no BEACHCAR_AI_GATEWAY_TOKEN available locally or remotely).",
  );

  await captureRolloutSafetyArtifacts(resourceReport);
  protectedSecretsFile = await writeProtectedSecretsFile(localSecrets);

  await run(
    [
      "bunx",
      "wrangler",
      ...guardedWorkerDeployArgs({
        dryRun: true,
        secretsFile: protectedSecretsFile,
        skipContainerRollout: shouldSkipContainerRollout(),
      }),
    ],
    {
      env,
      label: "Strictly validate the exact Worker, binding, var, and secret deployment before migration",
      sensitive: Boolean(protectedSecretsFile),
    },
  );

  await run(
    ["bunx", "wrangler", "d1", "migrations", "apply", d1Name, "--remote"],
    { env, label: `Apply the gated remote D1 migration to ${d1Name}` },
  );
  await verifyRemoteSourceQualitySchema();

  const deployResult = await run([
    "bunx",
    "wrangler",
    ...guardedWorkerDeployArgs({
      secretsFile: protectedSecretsFile,
      skipContainerRollout: shouldSkipContainerRollout(),
    }),
  ], {
    env,
    sensitive: Boolean(protectedSecretsFile),
    label: protectedSecretsFile
      ? `Strictly deploy Worker with ${localSecretNames.length} supplied secret value(s) in one version`
      : "Strictly deploy Worker while preserving existing remote secrets",
  });
  await removeProtectedSecretsFile();

  const deployedUrl = value("BEACHCAR_DEPLOY_URL") || deployedUrlFromOutput(`${deployResult.stdout}\n${deployResult.stderr}`);
  if (!skipVerify && deployedUrl) {
    const verificationArgs = [
      "bun",
      "scripts/verify-cloudflare-deploy.mjs",
      "--url",
      deployedUrl,
      "--strict",
      "--expected-runner-mode",
      rolloutRunnerMode,
      ...verificationRequirementArgs(env),
    ];
    await run(verificationArgs, {
      env: { ...env, BEACHCAR_DEPLOY_URL: deployedUrl },
      label: "Strictly verify the public Worker surface and supplied authenticated gates",
    });
  } else if (!skipVerify) {
    throw new Error("Remote deploy completed, but no deployed URL was found for strict verification. Set BEACHCAR_DEPLOY_URL or use --skip-verify explicitly.");
  }

  await run(["bun", "scripts/check-cloudflare-resources.mjs", "--strict"], { env, label: "Strictly verify remote Cloudflare resources" });

  console.log("\nRemote rollout command completed.");
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await removeProtectedSecretsFile();
}

async function inspectCloudflareForRollout(localSecretNames) {
  const command = ["bun", "scripts/check-cloudflare-resources.mjs", "--json", "--strict"];
  for (const name of localSecretNames) command.push("--local-secret", name);
  const result = await run(command, {
    env,
    label: "Confirm the production account, resources, and required Worker secret names",
    quiet: true,
  });
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("Cloudflare resource inspection did not return valid JSON; rollout stopped before backup or migration.");
  }
}

async function captureRolloutSafetyArtifacts(resourceReport) {
  const previousUmask = process.umask(0o077);
  let directory = "";
  try {
    directory = await mkdtemp(join(tmpdir(), "beachcar-rollout-"));
    await chmod(directory, 0o700);
    const files = [];

    const captures = [
      {
        file: "deployments-before.json",
        command: ["bunx", "wrangler", "deployments", "list", "--name", workerName, "--json"],
        label: "Capture current Worker deployments",
      },
      {
        file: "versions-before.json",
        command: ["bunx", "wrangler", "versions", "list", "--name", workerName, "--json"],
        label: "Capture current Worker versions",
      },
      {
        file: "deployment-status-before.json",
        command: ["bunx", "wrangler", "deployments", "status", "--name", workerName, "--json"],
        label: "Capture active Worker deployment",
      },
    ];

    let deploymentStatus = null;
    for (const capture of captures) {
      const result = await run(capture.command, { env, label: capture.label, quiet: true });
      if (!result.stdout.trim()) throw new Error(`${capture.label} returned no output.`);
      await writePrivateFile(join(directory, capture.file), `${result.stdout.trim()}\n`);
      files.push(capture.file);
      if (capture.file === "deployment-status-before.json") {
        deploymentStatus = parseJsonOrThrow(result.stdout, "Active Worker deployment");
      }
    }

    const workerServiceMetadata = await fetchWorkerServiceMetadata();
    const workerRollbackEvidence = minimalWorkerServiceRollbackEvidence(workerServiceMetadata);
    await writePrivateFile(join(directory, "worker-rollback-evidence-before.json"), `${JSON.stringify(workerRollbackEvidence, null, 2)}\n`);
    files.push("worker-rollback-evidence-before.json");
    const rollbackGate = evaluateDurableObjectRollbackGate({
      deploymentStatus,
      expectedMigrationTag: expectedDurableObjectMigrationTag,
      remoteMigrationTag: workerRollbackEvidence.migrationTag,
    });
    await writePrivateFile(join(directory, "rollback-gate.json"), `${JSON.stringify(rollbackGate, null, 2)}\n`);
    files.push("rollback-gate.json");
    if (!rollbackGate.ok) {
      throw new Error(
        `Worker rollback gate failed before D1 backup or migration: ${rollbackGate.reason} A deploy could apply a Durable Object migration or overwrite an active split, making the captured pre-rollout version unsafe or unavailable for rollback.`,
      );
    }

    const timeTravel = await run(
      ["bunx", "wrangler", "d1", "time-travel", "info", d1Name, "--json"],
      { env, label: "Capture D1 Time Travel bookmark", quiet: true },
    );
    if (!timeTravel.stdout.trim()) throw new Error("D1 Time Travel bookmark returned no output.");
    await writePrivateFile(join(directory, "d1-time-travel-before.json"), `${timeTravel.stdout.trim()}\n`);
    files.push("d1-time-travel-before.json");

    const migrationsResult = await run(
      ["bunx", "wrangler", "d1", "migrations", "list", d1Name, "--remote"],
      { env, label: "Capture and validate pending D1 migrations", quiet: true },
    );
    await writePrivateFile(join(directory, "d1-migrations-before.txt"), `${migrationsResult.stdout.trim()}\n`);
    files.push("d1-migrations-before.txt");
    assertExpectedPendingMigrations(migrationsResult.stdout);

    const exportPath = join(directory, "d1-before.sql");
    await run(
      ["bunx", "wrangler", "d1", "export", d1Name, "--remote", "--skip-confirmation", "--output", exportPath],
      { env, label: "Export full D1 schema and data", quiet: true },
    );
    await chmod(exportPath, 0o600);
    const exportMetadata = await stat(exportPath);
    if (!exportMetadata.isFile() || exportMetadata.size === 0) throw new Error("D1 export did not create a non-empty backup file.");
    const exportDigest = createHash("sha256").update(new Uint8Array(await Bun.file(exportPath).arrayBuffer())).digest("hex");
    await writePrivateFile(join(directory, "d1-before.sql.sha256"), `${exportDigest}  d1-before.sql\n`);
    files.push("d1-before.sql", "d1-before.sql.sha256");

    await writePrivateFile(
      join(directory, "manifest.json"),
      `${JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          accountId: stringValue(resourceReport?.expectedAccountId) || expectedAccountId,
          workerName,
          d1Name,
          d1Id,
          activeWorkerVersionId: rollbackGate.activeVersionId,
          durableObjectMigrationTag: rollbackGate.remoteMigrationTag,
          rollbackAvailable: true,
          files,
        },
        null,
        2,
      )}\n`,
    );

    console.log(`\nPre-migration recovery artifacts saved in ${directory}`);
    console.log("Directory mode: 0700; artifact modes: 0600. It never contains Worker secret staging. Preserve this directory until rollout verification is complete.");
    return directory;
  } catch (error) {
    if (directory) console.error(`Pre-migration artifact capture stopped; inspect the private partial directory at ${directory}.`);
    throw error;
  } finally {
    process.umask(previousUmask);
  }
}

async function fetchWorkerServiceMetadata() {
  const authResult = await run(["bunx", "wrangler", "auth", "token", "--json"], {
    env,
    label: "Acquire in-memory Cloudflare authentication for read-only rollback inspection",
    quiet: true,
    sensitive: true,
  });
  const auth = parseJsonOrThrow(authResult.stdout, "Wrangler authentication metadata");
  const headers = cloudflareAuthHeaders(auth);
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(expectedAccountId)}/workers/services/${encodeURIComponent(workerName)}`,
    { headers, redirect: "error" },
  );
  if (new URL(response.url).origin !== "https://api.cloudflare.com") {
    throw new Error("Read-only Worker rollback inspection escaped the Cloudflare API origin.");
  }
  const text = await response.text();
  const envelope = parseJsonOrThrow(text, "Cloudflare Worker service metadata");
  if (!response.ok || envelope?.success !== true || !envelope?.result) {
    const messages = Array.isArray(envelope?.errors)
      ? envelope.errors.map((entry) => stringValue(entry?.message)).filter(Boolean).slice(0, 3).join("; ")
      : "";
    throw new Error(`Read-only Worker rollback inspection failed with HTTP ${response.status}${messages ? `: ${messages}` : "."}`);
  }
  return envelope.result;
}

function minimalWorkerServiceRollbackEvidence(metadata) {
  const defaultEnvironment = objectValue(metadata, "default_environment");
  const script = objectValue(defaultEnvironment, "script");
  return {
    workerName,
    environment: stringValue(objectValue(defaultEnvironment, "environment")),
    migrationTag: workerMigrationTagFromServiceMetadata(metadata),
    lastDeployedFrom: stringValue(objectValue(script, "last_deployed_from")),
    modifiedOn: stringValue(objectValue(script, "modified_on")),
  };
}

function cloudflareAuthHeaders(auth) {
  if ((auth?.type === "oauth" || auth?.type === "api_token") && stringValue(auth?.token)) {
    return { Authorization: `Bearer ${auth.token}` };
  }
  if (auth?.type === "api_key" && stringValue(auth?.key) && stringValue(auth?.email)) {
    return { "X-Auth-Key": auth.key, "X-Auth-Email": auth.email };
  }
  throw new Error("Wrangler did not return a supported in-memory Cloudflare credential for rollback inspection.");
}

async function verifyRemoteSourceQualitySchema() {
  const columnsSql = `SELECT COUNT(*) AS found_columns FROM pragma_table_info('source_items') WHERE name IN ('bid_num','location','location_city','location_region','location_country','ends_at','no_reserve','last_detail_at','detail_status','detail_error','is_live','dossier_json')`;
  const indexesSql = `SELECT COUNT(*) AS found_indexes FROM sqlite_master WHERE type = 'index' AND name IN ('idx_source_items_source_live_ends','idx_source_items_source_bid','idx_source_items_source_location')`;
  const [columns, indexes, quickCheck] = await Promise.all([
    run(["bunx", "wrangler", "d1", "execute", d1Name, "--remote", "--json", "--command", columnsSql], {
      env,
      label: "Verify Source Quality v1 D1 columns",
      quiet: true,
    }),
    run(["bunx", "wrangler", "d1", "execute", d1Name, "--remote", "--json", "--command", indexesSql], {
      env,
      label: "Verify Source Quality v1 D1 indexes",
      quiet: true,
    }),
    run(["bunx", "wrangler", "d1", "execute", d1Name, "--remote", "--json", "--command", "PRAGMA quick_check"], {
      env,
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

async function writeProtectedSecretsFile(secrets) {
  const names = Object.keys(secrets);
  if (!names.length) return "";
  try {
    protectedSecretsDirectory = await mkdtemp(join(tmpdir(), "beachcar-worker-secrets-"));
    await chmod(protectedSecretsDirectory, 0o700);
    const file = join(protectedSecretsDirectory, "worker-secrets.json");
    await writePrivateFile(file, `${JSON.stringify(secrets, null, 2)}\n`);
    console.log(
      `Prepared ${names.length} locally supplied Worker secret value(s) in a separate private temporary directory for the atomic deploy; values remain hidden and are never part of the recovery bundle.`,
    );
    return file;
  } catch (error) {
    await removeProtectedSecretsFile();
    throw error;
  }
}

function assertExpectedPendingMigrations(output) {
  if (isSafeSourceQualityMigrationSet(output)) return;
  const pending = pendingD1MigrationFiles(output);
  const detail = pending.length ? pending.join(", ") : "unrecognized migration-list output";
  throw new Error(
    `Remote migration gate expected no pending migration or exactly 0011_source_cache_listing_fields.sql; found ${detail}.`,
  );
}

async function writePrivateFile(path, contents) {
  await writeFile(path, contents, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function removeProtectedSecretsFile() {
  const file = protectedSecretsFile;
  const directory = protectedSecretsDirectory;
  protectedSecretsFile = "";
  protectedSecretsDirectory = "";
  if (file) await rm(file, { force: true });
  if (directory) await rm(directory, { recursive: true, force: true });
}

async function run(command, options = {}) {
  if (!options.quiet) console.log(`\n==> ${options.label || command.join(" ")}`);
  const childEnv = {
    ...process.env,
    ...(options.env || {}),
  };
  if (options.sensitive) {
    delete childEnv.WRANGLER_LOG_PATH;
    childEnv.WRANGLER_WRITE_LOGS = "false";
    childEnv.WRANGLER_LOG_SANITIZE = "true";
  } else {
    childEnv.WRANGLER_LOG_PATH = resolve(".wrangler-logs");
  }
  const proc = Bun.spawn(command, {
    cwd: process.cwd(),
    env: childEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (!options.quiet && stdout.trim()) console.log(stdout.trim());
  if (!options.quiet && stderr.trim()) console.error(stderr.trim());
  if (exitCode !== 0) {
    throw new Error(`${options.label || command.join(" ")} failed with exit code ${exitCode}.`);
  }
  return { stdout, stderr, exitCode };
}

async function loadEnvFile(path) {
  try {
    const text = await Bun.file(path).text();
    const values = {};
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator === -1) continue;
      const key = line.slice(0, separator).trim();
      const rawValue = line.slice(separator + 1).trim();
      values[key] = rawValue.replace(/^['"]|['"]$/g, "");
    }
    return values;
  } catch {
    return {};
  }
}

async function readJsonc(path) {
  const text = await Bun.file(path).text();
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

function value(name) {
  return String(env[name] || "").trim();
}

function stringValue(input) {
  return typeof input === "string" ? input.trim() : "";
}

function objectValue(input, key) {
  return input && typeof input === "object" && !Array.isArray(input) ? input[key] : undefined;
}

function parseJsonOrThrow(input, label) {
  try {
    return JSON.parse(input);
  } catch {
    throw new Error(`${label} did not return valid JSON; rollout stopped before migration.`);
  }
}

function deployedUrlFromOutput(output) {
  const match = output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev\b/i);
  return match ? match[0] : "";
}

function containerDeployArgs() {
  return deployContainers ? ["--deploy-containers"] : [];
}

function shouldSkipContainerRollout() {
  return rolloutRunnerMode === "deterministic";
}

function printPlan() {
  console.log(`Beachcar remote rollout orchestrator

Default mode is a plan only. No Cloudflare resources are changed.

Dry-run validation:
  bun run deploy:remote -- --dry-run

Remote execution after explicit approval and .deploy.env is filled:
  bun run deploy:remote -- --execute --yes

Container image rollout is skipped while BEACHCAR_RUNNER_MODE is deterministic. To intentionally build/update the Cloudflare Container image for Codex mode:
  bun run deploy:remote -- --execute --yes --deploy-containers

Execution sequence:
  1. Validate .deploy.env without printing secrets.
  2. Build production client assets with VITE_CLERK_PUBLISHABLE_KEY.
  3. Run a strict, keep-vars Wrangler deploy dry-run.
  4. Strictly confirm the production account, coupled D1 name/UUID, resources, and required remote/local secret names; explicitly report Gateway-backed or heuristic-only scoring mode.
  5. Require one active Worker version at 100% traffic whose remote Durable Object migration tag already matches configured v2. Capture only minimal rollback evidence, plus a D1 Time Travel bookmark, pending migrations, and a full D1 export under a private /tmp/beachcar-rollout-* directory. Worker secret staging is never stored in that recovery directory.
  6. Stage locally supplied secrets in a separate private temporary directory, strictly dry-run the exact code/vars/secrets again, apply only the gated remote D1 migration, verify its schema and quick_check, then strictly deploy Worker beachcar-watch once with --keep-vars. Locally supplied secrets are included atomically; omitted remote secrets are preserved. Secret staging is removed after deploy or failure.
  7. Strictly verify the public Worker surface, run authenticated gates for tokens supplied locally, and re-check Cloudflare resources.

Use --skip-verify only if BEACHCAR_DEPLOY_URL is not known yet.
`);
}

function printHelp() {
  printPlan();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
