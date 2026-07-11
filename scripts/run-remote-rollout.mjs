#!/usr/bin/env bun
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  collectWorkerSecrets,
  isSafeSourceQualityMigrationSet,
  missingRequiredWorkerSecrets,
  pendingD1MigrationFiles,
  verificationRequirementArgs,
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
const deploySecretEnv = {
  ...deployFileEnv,
  ...process.env,
};
const wrangler = await readJsonc(resolve("wrangler.jsonc"));
const workerName = stringValue(wrangler?.name) || "beachcar-watch";
const d1Name = stringValue(wrangler?.d1_databases?.[0]?.database_name) || "beach-car-watch";

if (!execute && !dryRunOnly) {
  printPlan();
  process.exit(0);
}

let protectedSecretsFile = "";

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

  const localSecrets = collectWorkerSecrets(deploySecretEnv);
  const localSecretNames = Object.keys(localSecrets);
  const resourceReport = await inspectCloudflareForRollout(localSecretNames);
  const remoteSecretNames = Array.isArray(resourceReport.resources?.workerSecrets) ? resourceReport.resources.workerSecrets : [];
  const missingSecrets = missingRequiredWorkerSecrets(remoteSecretNames, localSecretNames);
  if (missingSecrets.length) {
    throw new Error(`Required Worker secret names are unavailable locally and remotely: ${missingSecrets.join(", ")}.`);
  }

  const artifactDirectory = await captureRolloutSafetyArtifacts();
  protectedSecretsFile = await writeProtectedSecretsFile(artifactDirectory, localSecrets);

  const deployCommand = [
    "bun",
    "scripts/bootstrap-cloudflare-rollout.mjs",
    "--yes",
    "--migrate",
    "--dry-run-deploy",
    "--deploy",
    ...containerDeployArgs(),
  ];
  if (protectedSecretsFile) deployCommand.push("--secrets-file", protectedSecretsFile);

  const deployResult = await run(deployCommand, {
    env,
    label: protectedSecretsFile
      ? `Apply migrations and deploy Worker with ${localSecretNames.length} supplied secret value(s) in one version`
      : "Apply migrations and deploy Worker while preserving existing remote secrets",
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

async function captureRolloutSafetyArtifacts() {
  const previousUmask = process.umask(0o077);
  let directory = "";
  try {
    directory = await mkdtemp(join(tmpdir(), "beachcar-rollout-"));
    await chmod(directory, 0o700);

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
        file: "d1-time-travel-before.json",
        command: ["bunx", "wrangler", "d1", "time-travel", "info", d1Name, "--json"],
        label: "Capture D1 Time Travel bookmark",
      },
    ];

    for (const capture of captures) {
      const result = await run(capture.command, { env, label: capture.label, quiet: true });
      if (!result.stdout.trim()) throw new Error(`${capture.label} returned no output.`);
      await writePrivateFile(join(directory, capture.file), `${result.stdout.trim()}\n`);
    }

    const migrationsResult = await run(
      ["bunx", "wrangler", "d1", "migrations", "list", d1Name, "--remote"],
      { env, label: "Capture and validate pending D1 migrations", quiet: true },
    );
    await writePrivateFile(join(directory, "d1-migrations-before.txt"), `${migrationsResult.stdout.trim()}\n`);
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

    await writePrivateFile(
      join(directory, "manifest.json"),
      `${JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          workerName,
          d1Name,
          files: captures
            .map((capture) => capture.file)
            .concat("d1-migrations-before.txt", "d1-before.sql", "d1-before.sql.sha256"),
        },
        null,
        2,
      )}\n`,
    );

    console.log(`\nPre-migration recovery artifacts saved in ${directory}`);
    console.log("Directory mode: 0700; artifact modes: 0600. Preserve this directory until rollout verification is complete.");
    return directory;
  } catch (error) {
    if (directory) console.error(`Pre-migration artifact capture stopped; inspect the private partial directory at ${directory}.`);
    throw error;
  } finally {
    process.umask(previousUmask);
  }
}

async function writeProtectedSecretsFile(directory, secrets) {
  const names = Object.keys(secrets);
  if (!names.length) return "";
  const file = join(directory, "worker-secrets.json");
  try {
    await writePrivateFile(file, `${JSON.stringify(secrets, null, 2)}\n`);
    console.log(`Prepared ${names.length} locally supplied Worker secret value(s) for the atomic deploy; values remain hidden.`);
    return file;
  } catch (error) {
    await rm(file, { force: true });
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
  if (!protectedSecretsFile) return;
  const file = protectedSecretsFile;
  protectedSecretsFile = "";
  await rm(file, { force: true });
}

async function run(command, options = {}) {
  if (!options.quiet) console.log(`\n==> ${options.label || command.join(" ")}`);
  const proc = Bun.spawn(command, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...(options.env || {}),
      WRANGLER_LOG_PATH: resolve(".wrangler-logs"),
    },
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

function deployedUrlFromOutput(output) {
  const match = output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev\b/i);
  return match ? match[0] : "";
}

function containerDeployArgs() {
  return deployContainers ? ["--deploy-containers"] : [];
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
  3. Run Wrangler deploy dry-run.
  4. Strictly confirm the configured production account, resources, and required remote/local secret names.
  5. Capture Worker deployments/versions, a D1 Time Travel bookmark, pending migrations, and a full D1 export under a private /tmp/beachcar-rollout-* directory.
  6. Dry-run again, apply remote D1 migrations, and deploy Worker beachcar-watch once. Any locally supplied secrets are included atomically with wrangler deploy --secrets-file; omitted remote secrets are preserved.
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
