#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const strict = process.argv.includes("--strict");
const allowRemoteSecrets = process.argv.includes("--allow-remote-secrets");
const env = {
  ...(await loadEnvFile(resolve(".dev.vars"))),
  ...(await loadEnvFile(resolve(".publish.env"))),
  ...(await loadEnvFile(resolve(".deploy.env"))),
  ...process.env,
};
const checks = [];

checkWorkerSecret("PUBLISH_TOKEN", () => value("PUBLISH_TOKEN").length >= 24, "Use a random token at least 24 characters long.");
check("VITE_CLERK_PUBLISHABLE_KEY is available", hasRealValue("VITE_CLERK_PUBLISHABLE_KEY"), "Set VITE_CLERK_PUBLISHABLE_KEY for production client builds.");
check(
  "VITE_CLERK_PUBLISHABLE_KEY has a Clerk publishable-key shape",
  hasRealValue("VITE_CLERK_PUBLISHABLE_KEY") && /^pk_(test|live)_/.test(value("VITE_CLERK_PUBLISHABLE_KEY")),
  "Expected a Clerk key beginning with pk_test_ or pk_live_.",
);
checkWorkerSecret("CLERK_SECRET_KEY", () => /^sk_(test|live)_/.test(value("CLERK_SECRET_KEY")), "Expected a Clerk key beginning with sk_test_ or sk_live_.");
checkWorkerSecret("CLERK_JWT_ISSUER", () => isHttpsUrl(value("CLERK_JWT_ISSUER")), "Use the Clerk issuer URL, usually https://<instance>.clerk.accounts.dev.");

const gatewayToken = hasRealValue("BEACHCAR_AI_GATEWAY_TOKEN");
const gatewayTarget = hasRealValue("BEACHCAR_AI_GATEWAY_BASE_URL") || (hasRealValue("CLOUDFLARE_ACCOUNT_ID") && hasRealValue("BEACHCAR_AI_GATEWAY_ID"));
if (!gatewayToken && !gatewayTarget) {
  warn("AI Gateway credentials are not configured", "First deploy can run deterministic scoring; configure AI Gateway before proving managed AI spend.");
} else {
  check("AI Gateway token is available", gatewayToken, "Set BEACHCAR_AI_GATEWAY_TOKEN. Reserve CLOUDFLARE_API_TOKEN for Wrangler authentication.");
  check("AI Gateway target is available", gatewayTarget, "Set BEACHCAR_AI_GATEWAY_BASE_URL or CLOUDFLARE_ACCOUNT_ID plus BEACHCAR_AI_GATEWAY_ID.");
}

if (hasValue("BEACHCAR_DEPLOY_URL")) {
  check("BEACHCAR_DEPLOY_URL is an HTTPS URL", hasRealValue("BEACHCAR_DEPLOY_URL") && isHttpsUrl(value("BEACHCAR_DEPLOY_URL")), "Set BEACHCAR_DEPLOY_URL to the deployed Worker HTTPS URL.");
} else {
  warn("BEACHCAR_DEPLOY_URL is not configured", "Set it after the first Worker deploy to run remote verification.");
}

printReport();

const failures = checks.filter((entry) => entry.status === "fail");
if (strict && failures.length) process.exit(1);

function check(label, ok, remediation) {
  checks.push({ label, status: ok ? "ok" : "fail", remediation });
}

function warn(label, remediation) {
  checks.push({ label, status: "warn", remediation });
}

function checkWorkerSecret(name, validate, invalidRemediation) {
  if (!hasRealValue(name)) {
    if (allowRemoteSecrets) {
      warn(`${name} is not supplied locally`, `The guarded rollout must confirm that ${name} already exists remotely before migration.`);
    } else {
      check(`${name} is available`, false, `Set ${name} locally or use the guarded remote rollout to retain an existing remote secret.`);
    }
    return;
  }
  check(`${name} is available`, true, "");
  check(`${name} has a valid shape`, validate(), invalidRemediation);
}

function value(name) {
  return String(env[name] || "").trim();
}

function hasValue(name) {
  return value(name) !== "";
}

function hasRealValue(name) {
  const current = value(name);
  return current !== "" && !isPlaceholder(current);
}

function isPlaceholder(input) {
  return /\.\.\.|<[^>]+>|your-|example|reuse-dev-token|generate-a-long-random-token/i.test(input);
}

function isHttpsUrl(input) {
  try {
    return new URL(input).protocol === "https:";
  } catch {
    return false;
  }
}

async function loadEnvFile(path) {
  try {
    const text = await readFile(path, "utf8");
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

function printReport() {
  console.log("Beachcar deploy environment check (secret values hidden)\n");
  for (const entry of checks) {
    const marker = entry.status === "ok" ? "OK" : entry.status === "warn" ? "WARN" : "TODO";
    console.log(`${marker} ${entry.label}`);
    if (entry.status !== "ok") console.log(`    ${entry.remediation}`);
  }
  const counts = checks.reduce(
    (memo, entry) => {
      memo[entry.status] += 1;
      return memo;
    },
    { ok: 0, warn: 0, fail: 0 },
  );
  console.log(`\nSummary: ${counts.ok} ok, ${counts.warn} warnings, ${counts.fail} todos.`);
  if (counts.fail && !strict) console.log("Run with --strict to make todos exit non-zero.");
}
