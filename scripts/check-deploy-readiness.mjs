#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const strict = process.argv.includes("--strict");
const root = process.cwd();
const checks = [];

const wrangler = await readJsonc(resolve("wrangler.jsonc"));
const env = await loadEnvHints([".env.local", ".dev.vars", ".publish.env"]);
const migrationFiles = await safeReaddir(resolve("migrations"));
const runnerPackage = await readOptionalJson(resolve("runner/package.json"));
const packageJson = await readOptionalJson(resolve("package.json"));
const explicitBootstrapOwnerEmails = emailList(
  wrangler?.vars?.BOOTSTRAP_OWNER_EMAILS,
  wrangler?.vars?.ALLOWED_EMAILS,
  stringEnv("BOOTSTRAP_OWNER_EMAILS"),
  stringEnv("ALLOWED_EMAILS"),
);
const bootstrapOwnerEmails = explicitBootstrapOwnerEmails.length ? explicitBootstrapOwnerEmails : emailList(wrangler?.vars?.ALLOWED_EMAIL, stringEnv("ALLOWED_EMAIL"));

check("wrangler.jsonc is readable", !!wrangler, "Add wrangler.jsonc before deployment.");
check("Worker compatibility date is current for this build", compareDate(wrangler?.compatibility_date, "2026-06-25") >= 0, "Set compatibility_date to 2026-06-25 or later.");
check("D1 binding is configured", hasBinding(wrangler?.d1_databases, "DB"), "Add DB D1 binding.");
check(
  "D1 database_id is not a placeholder",
  !isPlaceholder(wrangler?.d1_databases?.[0]?.database_id),
  "Create the production D1 database and copy its database_id into wrangler.jsonc before deploying.",
  "required-before-deploy",
);
check("R2 image bucket binding is configured", hasBinding(wrangler?.r2_buckets, "IMAGES"), "Add IMAGES R2 bucket binding.");
check("Assets binding is configured", wrangler?.assets?.binding === "ASSETS", "Configure the ASSETS binding for the PWA.");
check(
  "Well-known metadata routes run through Worker",
  Array.isArray(wrangler?.assets?.run_worker_first) && wrangler.assets.run_worker_first.includes("/.well-known/*"),
  "Add /.well-known/* to assets.run_worker_first so OAuth protected-resource metadata is not served by the SPA fallback.",
);
check(
  "OAuth routes run through Worker",
  Array.isArray(wrangler?.assets?.run_worker_first) && wrangler.assets.run_worker_first.includes("/oauth/*"),
  "Add /oauth/* to assets.run_worker_first so authorization, token, registration, and revocation endpoints are not served by the SPA fallback.",
);
check("BeachcarAgent Durable Object binding exists", hasClassBinding(wrangler?.durable_objects?.bindings, "BeachcarAgent"), "Add BeachcarAgent Durable Object binding.");
check(
  "Container Durable Object binding exists",
  hasClassBinding(wrangler?.durable_objects?.bindings, "BeachcarRunnerContainer"),
  "Add BeachcarRunnerContainer Durable Object binding.",
);
check("Workflow binding exists", hasClassBinding(wrangler?.workflows, "BeachcarRunWorkflow"), "Add BEACHCAR_RUN_WORKFLOW workflow binding.");
check("Source cache cron trigger exists", Array.isArray(wrangler?.triggers?.crons) && wrangler.triggers.crons.includes("*/15 * * * *"), "Add a scheduled trigger to refresh public source caches.");
check("Container image config exists", Array.isArray(wrangler?.containers) && wrangler.containers.some((entry) => entry.class_name === "BeachcarRunnerContainer"), "Add the BeachcarRunnerContainer containers config.");
check("Local dev keeps containers disabled by default", wrangler?.dev?.enable_containers === false, "Set dev.enable_containers=false so local smoke stays Docker-free.");
check("Bootstrap owner email is configured", bootstrapOwnerEmails.length > 0, "Set vars.BOOTSTRAP_OWNER_EMAILS, vars.ALLOWED_EMAILS, or vars.ALLOWED_EMAIL to at least one owner email.");
check(
  "Bootstrap owner email is not the example address",
  bootstrapOwnerEmails.length > 0 && bootstrapOwnerEmails.every((email) => !isExampleEmail(email)),
  "Replace bootstrap owner placeholders with the real owner email(s) before inviting friends.",
  "required-before-friends",
);
check("Production environment var is set", wrangler?.vars?.ENVIRONMENT === "production", "Set vars.ENVIRONMENT to production.");
check("Multi-user migration is present", migrationFiles.includes("0005_multi_user_beta.sql"), "Add/apply 0005_multi_user_beta.sql.");
check("AI usage migration is present", migrationFiles.includes("0006_ai_usage.sql"), "Add/apply 0006_ai_usage.sql.");
check("Runner tasks migration is present", migrationFiles.includes("0007_runner_tasks.sql"), "Add/apply 0007_runner_tasks.sql.");
check("Remote MCP automation migration is present", migrationFiles.includes("0008_remote_mcp_automation.sql"), "Add/apply 0008_remote_mcp_automation.sql.");
check("Source cache migration is present", migrationFiles.includes("0009_source_cache.sql"), "Add/apply 0009_source_cache.sql.");
check("MCP OAuth migration is present", migrationFiles.includes("0010_mcp_oauth.sql"), "Add/apply 0010_mcp_oauth.sql.");
check("Preflight script is available", !!packageJson?.scripts?.preflight, "Add bun run preflight.");
check("Local Worker preflight script is available", !!packageJson?.scripts?.["preflight:local"], "Add bun run preflight:local.");
check("Full preflight script is available", !!packageJson?.scripts?.["preflight:full"], "Add bun run preflight:full.");
check("Runner package includes Codex SDK", !!runnerPackage?.dependencies?.["@openai/codex-sdk"], "Add @openai/codex-sdk to runner/package.json.");

checkSecretHint("PUBLISH_TOKEN", "Needed for admin import, invite admin console, and local Worker smoke.");
checkSecretHint("CLERK_SECRET_KEY", "Needed for production Clerk token verification.");
checkSecretHint("CLERK_JWT_ISSUER", "Needed for production Clerk token verification.");

const hasGatewayToken = hasEnv("BEACHCAR_AI_GATEWAY_TOKEN") || hasEnv("CLOUDFLARE_API_TOKEN");
const hasGatewayTarget = hasEnv("BEACHCAR_AI_GATEWAY_BASE_URL") || (hasEnv("CLOUDFLARE_ACCOUNT_ID") && hasEnv("BEACHCAR_AI_GATEWAY_ID"));
check(
  "AI Gateway credentials are available for remote scoring rehearsal",
  hasGatewayToken && hasGatewayTarget,
  "Configure BEACHCAR_AI_GATEWAY_TOKEN/CLOUDFLARE_API_TOKEN plus BEACHCAR_AI_GATEWAY_BASE_URL or CLOUDFLARE_ACCOUNT_ID+BEACHCAR_AI_GATEWAY_ID before remote AI budget validation.",
  "recommended-before-friends",
);

const runnerMode = stringEnv("BEACHCAR_RUNNER_MODE") || "deterministic";
check("Container runner mode is deterministic or codex", runnerMode === "deterministic" || runnerMode === "codex", "Use BEACHCAR_RUNNER_MODE=deterministic or BEACHCAR_RUNNER_MODE=codex.");
if (runnerMode === "codex") {
  checkSecretHint("OPENAI_API_KEY", "Required only when BEACHCAR_RUNNER_MODE=codex.");
} else if (hasEnv("OPENAI_API_KEY")) {
  warn("OPENAI_API_KEY is present locally but BEACHCAR_RUNNER_MODE is not codex", "The key will be unused unless the deployed runner is intentionally switched to Codex mode.");
}

printReport();

const failures = checks.filter((entry) => entry.status === "fail");
if (strict && failures.length) process.exit(1);

function check(label, ok, remediation, category = "required") {
  checks.push({ label, status: ok ? "ok" : "fail", remediation, category });
}

function warn(label, remediation) {
  checks.push({ label, status: "warn", remediation, category: "warning" });
}

function checkSecretHint(name, remediation) {
  check(`${name} is present in local env hints`, hasEnv(name), `${remediation} Configure it as a Wrangler secret before deploying.`, "secret-hint");
}

function hasEnv(name) {
  return typeof process.env[name] === "string" && process.env[name] !== "" || typeof env[name] === "string" && env[name] !== "";
}

function stringEnv(name) {
  return (process.env[name] || env[name] || "").trim();
}

function emailList(...values) {
  return Array.from(
    new Set(
      values
        .filter(Boolean)
        .join(",")
        .split(/[,\s]+/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function isExampleEmail(email) {
  return email === "you@example.com" || email.endsWith("@example.com");
}

function hasBinding(bindings, name) {
  return Array.isArray(bindings) && bindings.some((entry) => entry?.binding === name);
}

function hasClassBinding(bindings, className) {
  return Array.isArray(bindings) && bindings.some((entry) => entry?.class_name === className);
}

function isPlaceholder(value) {
  return !value || /REPLACE_WITH|placeholder|example/i.test(String(value));
}

function compareDate(actual, minimum) {
  if (!actual || !/^\d{4}-\d{2}-\d{2}$/.test(actual)) return -1;
  return actual.localeCompare(minimum);
}

async function readJsonc(path) {
  const contents = await readOptional(path);
  if (!contents) return null;
  return JSON.parse(stripJsonComments(contents));
}

async function readOptionalJson(path) {
  const contents = await readOptional(path);
  return contents ? JSON.parse(contents) : null;
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function safeReaddir(path) {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function loadEnvHints(files) {
  const values = {};
  for (const file of files) {
    const contents = await readOptional(resolve(root, file));
    if (!contents) continue;
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator === -1) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && !values[key]) values[key] = value;
    }
  }
  return values;
}

function stripJsonComments(input) {
  let output = "";
  let inString = false;
  let quote = "";
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (inString) {
      output += char;
      if (char === "\\") {
        output += next || "";
        index += 1;
      } else if (char === quote) {
        inString = false;
        quote = "";
      }
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < input.length && input[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < input.length && !(input[index] === "*" && input[index + 1] === "/")) index += 1;
      index += 1;
      continue;
    }
    output += char;
  }
  return output;
}

function printReport() {
  console.log("Beachcar deploy readiness check (no deploy performed)\n");
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
  if (counts.fail && !strict) {
    console.log("Run with --strict to make todos exit non-zero in a deploy rehearsal gate.");
  }
}
