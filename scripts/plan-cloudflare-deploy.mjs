#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const jsonOutput = process.argv.includes("--json");
const wrangler = await readJsonc(resolve("wrangler.jsonc"));
const check = await runCheck();
const plan = buildPlan(check, wrangler);

if (jsonOutput) {
  console.log(JSON.stringify(plan, null, 2));
} else {
  printMarkdown(plan);
}

async function runCheck() {
  const proc = Bun.spawn(["bun", "scripts/check-cloudflare-resources.mjs", "--json"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (exitCode !== 0) {
    throw new Error(`Cloudflare resource inspection failed: ${(stderr || stdout).trim()}`);
  }
  return JSON.parse(stdout);
}

function buildPlan(check, wranglerConfig) {
  const workerName = check.workerName || stringValue(wranglerConfig?.name) || "beachcar-watch";
  const configuredD1Name = stringValue(wranglerConfig?.d1_databases?.[0]?.database_name) || "beachcar-watch";
  const configuredR2Name = stringValue(wranglerConfig?.r2_buckets?.[0]?.bucket_name) || "beachcar-watch-images";
  const exactD1 = check.resources.d1.find((db) => db?.name === configuredD1Name) || null;
  const similarD1 = check.resources.d1.find((db) => normalizeName(db?.name) === normalizeName(configuredD1Name)) || null;
  const r2Exists = check.resources.r2Buckets.includes(configuredR2Name);
  const workerExists = checkStatus(check, "Configured Worker exists remotely") === "ok";

  const steps = [];

  steps.push({
    title: "Confirm target account",
    kind: "read-only",
    status: check.accountId ? "ready" : "blocked",
    commands: ["bunx wrangler whoami"],
    detail: check.accountId ? `Wrangler is logged into account ${check.accountId}.` : "Wrangler account id was not detected.",
  });

  if (exactD1) {
    steps.push({
      title: "Use existing matching D1 database",
      kind: "file-edit",
      status: "ready",
      commands: [`# Set wrangler.jsonc d1_databases[0].database_id to ${exactD1.uuid}`],
      detail: `Remote D1 ${configuredD1Name} already exists.`,
    });
  } else {
    steps.push({
      title: "Create the production D1 database",
      kind: "mutating",
      status: "required",
      commands: [`bunx wrangler d1 create ${configuredD1Name}`, "# Copy the returned database_id into wrangler.jsonc"],
      detail: similarD1
        ? `Recommended: create a fresh ${configuredD1Name}. A similar legacy database exists (${similarD1.name}, ${similarD1.uuid}); inspect it before intentionally reusing it.`
        : `Create ${configuredD1Name} so the remote name matches wrangler.jsonc.`,
    });
  }

  steps.push({
    title: "Apply D1 migrations remotely",
    kind: "mutating",
    status: exactD1 ? "ready" : "after-d1-created",
    commands: [`bunx wrangler d1 migrations apply ${configuredD1Name} --remote`],
    detail: "Run only after wrangler.jsonc contains the real production D1 database_id.",
  });

  steps.push({
    title: "Confirm R2 image bucket",
    kind: r2Exists ? "read-only" : "mutating",
    status: r2Exists ? "ready" : "required",
    commands: r2Exists ? ["bunx wrangler r2 bucket list"] : [`bunx wrangler r2 bucket create ${configuredR2Name}`],
    detail: r2Exists ? `Remote R2 bucket ${configuredR2Name} exists.` : `Create ${configuredR2Name} before first deploy.`,
  });

  steps.push({
    title: "Set production owner email list",
    kind: "file-edit",
    status: "required",
    commands: ["# Replace vars.BOOTSTRAP_OWNER_EMAILS or vars.ALLOWED_EMAIL in wrangler.jsonc with the real owner email(s)"],
    detail: "Current deploy readiness treats example bootstrap owner emails as a friend-release blocker. Multiple comma-separated owner emails are supported.",
  });

  steps.push({
    title: "Dry-run the production bundle",
    kind: "read-only",
    status: "ready",
    commands: ["bunx wrangler deploy --dry-run"],
    detail: "Validates Worker assets, bindings, and Container image without deploying.",
  });

  steps.push({
    title: workerExists ? "Deploy an updated Worker version" : "Deploy the Worker for the first time",
    kind: "mutating",
    status: exactD1 ? "ready-after-dry-run" : "after-d1-created",
    commands: ["bunx wrangler deploy"],
    detail: workerExists
      ? `Worker ${workerName} already exists; deploy creates a new version.`
      : `Worker ${workerName} is not deployed yet; secrets cannot be inspected until after this first deploy.`,
  });

  steps.push({
    title: "Set required Worker secrets",
    kind: "mutating",
    status: workerExists ? "ready" : "after-first-deploy",
    commands: [
      "bunx wrangler secret put PUBLISH_TOKEN",
      "bunx wrangler secret put CLERK_SECRET_KEY",
      "bunx wrangler secret put CLERK_JWT_ISSUER",
    ],
    detail: "Use Wrangler's interactive prompt or file-based secret input. Do not echo secret values into shell history.",
  });

  steps.push({
    title: "Set optional AI Gateway secrets for remote scoring",
    kind: "mutating",
    status: "before-ai-gateway-rehearsal",
    commands: [
      "bunx wrangler secret put BEACHCAR_AI_GATEWAY_TOKEN",
      "# Also configure BEACHCAR_AI_GATEWAY_BASE_URL or CLOUDFLARE_ACCOUNT_ID + BEACHCAR_AI_GATEWAY_ID in the environment/secrets model you choose.",
    ],
    detail: "Not needed for deterministic first deploy, but required before proving real remote Gateway budgets and scoring.",
  });

  steps.push({
    title: "Run post-deploy verification",
    kind: "read-only",
    status: "after-deploy-and-secrets",
    commands: [
      `BEACHCAR_DEPLOY_URL=https://${workerName}.<your-subdomain>.workers.dev bun run cloudflare:verify`,
      "bun scripts/check-cloudflare-resources.mjs --strict",
      `curl -fsS https://${workerName}.<your-subdomain>.workers.dev/.well-known/oauth-protected-resource/mcp`,
      `curl -sS -D - -o /tmp/beachcar-mcp-unauth.json -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":"verify","method":"tools/list"}' https://${workerName}.<your-subdomain>.workers.dev/mcp`,
      "# Then open the deployed app in a browser, sign in with Clerk, accept an invite, complete onboarding, request a run, and verify the latest run.",
    ],
    detail: "Replace the workers.dev hostname with the actual deployed URL. The verifier checks the app shell, MCP discovery, auth challenge, and production test-header safety; authenticated app smoke needs a real Clerk session.",
  });

  return {
    generatedAt: new Date().toISOString(),
    accountId: check.accountId,
    workerName,
    recommendation: `Create a fresh D1 database named ${configuredD1Name} unless you intentionally decide to inspect and reuse a legacy similarly named database.`,
    currentFindings: check.checks.filter((entry) => entry.status !== "ok"),
    steps,
    mutatingCommandsPresent: steps.some((step) => step.kind === "mutating"),
    note: "This is a plan only. The script did not create, change, migrate, or deploy Cloudflare resources.",
  };
}

function checkStatus(check, label) {
  return check.checks.find((entry) => entry.label === label)?.status || "missing";
}

function normalizeName(value) {
  return String(value || "").replace(/[^0-9a-z]/gi, "").toLowerCase();
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
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

function printMarkdown(plan) {
  console.log("# Beachcar Cloudflare Deployment Rehearsal Plan");
  console.log("");
  console.log(`Generated: ${plan.generatedAt}`);
  if (plan.accountId) console.log(`Account: ${plan.accountId}`);
  console.log(`Worker: ${plan.workerName}`);
  console.log("");
  console.log(`Recommendation: ${plan.recommendation}`);
  console.log("");
  if (plan.currentFindings.length) {
    console.log("Current blockers:");
    for (const finding of plan.currentFindings) {
      console.log(`- ${finding.label}: ${finding.detail}`);
    }
    console.log("");
  }
  console.log("Steps:");
  for (const [index, step] of plan.steps.entries()) {
    console.log("");
    console.log(`${index + 1}. ${step.title} (${step.kind}, ${step.status})`);
    console.log(`   ${step.detail}`);
    for (const command of step.commands) {
      console.log(`   ${command}`);
    }
  }
  console.log("");
  console.log(plan.note);
}
