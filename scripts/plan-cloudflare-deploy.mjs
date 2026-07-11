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
  const d1IdentityReady = checkStatus(check, "Configured D1 name and database_id identify the same remote database") === "ok";
  const r2Exists = check.resources.r2Buckets.includes(configuredR2Name);
  const workerExists = checkStatus(check, "Configured Worker exists remotely") === "ok";
  const accountReady =
    checkStatus(check, "Wrangler selected account matches expected production account") === "ok" &&
    checkStatus(check, "Authenticated credentials can access expected production account") === "ok";
  const ownerEmails = configuredBootstrapOwnerEmails(wranglerConfig);
  const ownerEmailReady = ownerEmails.length > 0 && ownerEmails.every((email) => !isExampleEmail(email));

  const steps = [];

  steps.push({
    title: "Confirm target account",
    kind: "read-only",
    status: accountReady ? "ready" : "blocked",
    commands: ["bun scripts/check-cloudflare-resources.mjs --strict"],
    detail: accountReady
      ? `Wrangler selected expected production account ${check.expectedAccountId}.`
      : `Selected account ${check.accountId || "(unknown)"} has not been proven to match and access expected account ${check.expectedAccountId || "(missing)"}.`,
  });

  if (exactD1 && d1IdentityReady) {
    steps.push({
      title: "Use the exact configured D1 database",
      kind: "read-only",
      status: "ready",
      commands: ["bun scripts/check-cloudflare-resources.mjs --strict"],
      detail: `Remote D1 ${configuredD1Name} and configured UUID ${exactD1.uuid} identify the same database.`,
    });
  } else {
    steps.push({
      title: "Resolve the production D1 prerequisite",
      kind: "read-only",
      status: "blocked",
      commands: ["bun scripts/check-cloudflare-resources.mjs --strict"],
      detail: exactD1
        ? `The configured D1 name and UUID do not identify the same remote database. Correct wrangler.jsonc through a separately reviewed infrastructure change before rollout.`
        : similarD1
          ? `No exact D1 named ${configuredD1Name} exists; a similar database exists (${similarD1.name}, ${similarD1.uuid}). Provision or select the intended database through a separately reviewed infrastructure change before rollout.`
          : `Provision ${configuredD1Name} through a separately reviewed infrastructure change before rollout. deploy:remote never auto-creates production resources.`,
    });
  }

  steps.push({
    title: "Confirm R2 image bucket",
    kind: "read-only",
    status: r2Exists ? "ready" : "blocked",
    commands: ["bunx wrangler r2 bucket list"],
    detail: r2Exists
      ? `Remote R2 bucket ${configuredR2Name} exists.`
      : `Provision ${configuredR2Name} through a separately reviewed infrastructure change before rollout. deploy:remote never auto-creates production resources.`,
  });

  steps.push({
    title: "Set production owner email list",
    kind: "file-edit",
    status: ownerEmailReady ? "ready" : "required",
    commands: ["# Replace vars.BOOTSTRAP_OWNER_EMAILS or vars.ALLOWED_EMAIL in wrangler.jsonc with the real owner email(s)"],
    detail: ownerEmailReady
      ? `Bootstrap owner email list is configured for ${ownerEmails.length} owner(s).`
      : "Current deploy readiness treats example bootstrap owner emails as a friend-release blocker. Multiple comma-separated owner emails are supported.",
  });

  steps.push({
    title: "Dry-run the production bundle",
    kind: "read-only",
    status: "ready",
    commands: ["bun run deploy:remote -- --dry-run"],
    detail: "Validates the deployment environment, Worker assets, bindings, and deterministic container-skip path without mutating Cloudflare.",
  });

  steps.push({
    title: "Prepare optional atomic Worker secret changes",
    kind: "file-edit",
    status: workerExists ? "ready" : "required",
    commands: ["# Put only new or rotated Worker secret values in the ignored .deploy.env; leave existing remote values empty."],
    detail: workerExists
      ? "The guarded rollout accepts existing required remote secret names. Any supplied local values are included with the Worker deployment; omitted secrets are preserved."
      : "A first deploy needs local values for every required Worker secret because no remote values exist yet.",
  });

  steps.push({
    title: workerExists ? "Run guarded migration and single-version deployment" : "Run guarded first deployment",
    kind: "mutating",
    status: exactD1 && d1IdentityReady && r2Exists ? "ready-after-dry-run" : "blocked",
    commands: ["bun run deploy:remote -- --execute --yes"],
    detail: `Requires one active 100%-traffic Worker already on the final Durable Object migration tag, captures minimal private rollback evidence plus D1 recovery artifacts, accepts only migration 0011 (or none), validates the applied schema, and strictly deploys ${workerName} once while preserving audited remote vars and omitted secrets.`,
  });

  steps.push({
    title: "Run post-deploy verification",
    kind: "read-only",
    status: "after-deploy",
    commands: [
      `BEACHCAR_DEPLOY_URL=https://${workerName}.<your-subdomain>.workers.dev bun run cloudflare:verify -- --strict`,
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
    recommendation: exactD1 && d1IdentityReady
      ? `Use configured D1 ${configuredD1Name} (${exactD1.uuid}) through the guarded rollout, which gates pending migration 0011 and verifies the schema before deploy.`
      : `Resolve the configured D1 name/UUID identity through a separately reviewed infrastructure change before the guarded rollout.`,
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

function configuredBootstrapOwnerEmails(config) {
  const vars = config?.vars || {};
  const explicit = emailList(vars.BOOTSTRAP_OWNER_EMAILS, vars.ALLOWED_EMAILS);
  return explicit.length ? explicit : emailList(vars.ALLOWED_EMAIL);
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
