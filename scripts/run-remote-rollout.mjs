#!/usr/bin/env bun
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

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

const env = {
  ...(await loadEnvFile(resolve(".dev.vars"))),
  ...(await loadEnvFile(resolve(".publish.env"))),
  ...(await loadEnvFile(resolve(".deploy.env"))),
  ...process.env,
};

if (!execute && !dryRunOnly) {
  printPlan();
  process.exit(0);
}

try {
  await run(["bun", "scripts/validate-deploy-env.mjs", "--strict"], { env, label: "Validate deploy environment" });
  await run(["bun", "scripts/build-client.mjs"], { env, label: "Build production client assets" });
  await run(["bun", "scripts/bootstrap-cloudflare-rollout.mjs", "--dry-run-deploy", ...containerDeployArgs()], {
    env,
    label: "Validate Cloudflare deploy bundle",
  });

  if (!execute) {
    console.log("\nDry-run completed. No remote migrations, secrets, or deploy were applied.");
    process.exit(0);
  }

  const deployResult = await run(["bun", "scripts/bootstrap-cloudflare-rollout.mjs", "--yes", "--migrate", "--dry-run-deploy", "--deploy", ...containerDeployArgs()], {
    env,
    label: "Apply migrations and deploy Worker",
  });

  await setWorkerSecrets(env);

  const deployedUrl = value("BEACHCAR_DEPLOY_URL") || deployedUrlFromOutput(`${deployResult.stdout}\n${deployResult.stderr}`);
  if (!skipVerify && deployedUrl) {
    await run(["bun", "scripts/verify-cloudflare-deploy.mjs", "--url", deployedUrl], {
      env: { ...env, BEACHCAR_DEPLOY_URL: deployedUrl },
      label: "Verify deployed Worker surface",
    });
  } else if (!skipVerify) {
    console.log("\nRemote deploy completed, but no deployed URL was found. Set BEACHCAR_DEPLOY_URL and run bun run cloudflare:verify.");
  }

  await run(["bun", "scripts/check-cloudflare-resources.mjs"], { env, label: "Inspect remote Cloudflare resources" });

  console.log("\nRemote rollout command completed.");
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

async function setWorkerSecrets(sourceEnv) {
  const secrets = {};
  for (const name of [
    "PUBLISH_TOKEN",
    "CLERK_SECRET_KEY",
    "CLERK_JWT_ISSUER",
    "BEACHCAR_AI_GATEWAY_TOKEN",
    "BEACHCAR_AI_GATEWAY_BASE_URL",
    "BEACHCAR_AI_GATEWAY_ID",
    "CLOUDFLARE_ACCOUNT_ID",
    "BEACHCAR_AI_GATEWAY_MODEL",
    "BEACHCAR_AI_ESTIMATED_MICROS_PER_1K_TOKENS",
    "BEACHCAR_RUNNER_MODE",
    "BEACHCAR_CODEX_MODEL",
    "OPENAI_API_KEY",
  ]) {
    if (hasRealValue(name)) secrets[name] = sourceEnv[name];
  }

  const dir = await mkdtemp(join(tmpdir(), "beachcar-secrets-"));
  const file = join(dir, "worker-secrets.json");
  try {
    await writeFile(file, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
    await run(["bunx", "wrangler", "secret", "bulk", file], {
      env: sourceEnv,
      label: `Set ${Object.keys(secrets).length} Worker secret(s)`,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function run(command, options = {}) {
  console.log(`\n==> ${options.label || command.join(" ")}`);
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
  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
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

function value(name) {
  return String(env[name] || "").trim();
}

function hasRealValue(name) {
  const current = value(name);
  return current !== "" && !isPlaceholder(current);
}

function isPlaceholder(input) {
  return /\.\.\.|<[^>]+>|your-|example|reuse-dev-token|generate-a-long-random-token/i.test(input);
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
  4. Apply remote D1 migrations.
  5. Deploy Worker beachcar-watch, skipping the Container image rollout unless BEACHCAR_RUNNER_MODE=codex or --deploy-containers is set.
  6. Set Worker secrets via a temporary wrangler secret bulk JSON file.
  7. Verify the deployed Worker and inspect Cloudflare resources.

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
