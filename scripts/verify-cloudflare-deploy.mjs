#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);
await loadEnvFile(resolve(".dev.vars"));
await loadEnvFile(resolve(".publish.env"));

const jsonOutput = hasFlag("--json");
const baseUrl = normalizeBaseUrl(valueArg("--url") || process.env.BEACHCAR_DEPLOY_URL || "http://127.0.0.1:8787");
const testEmail = valueArg("--email") || process.env.SMOKE_TEST_EMAIL || process.env.ALLOWED_EMAIL || "you@example.com";
const clerkToken = valueArg("--clerk-token") || process.env.BEACHCAR_CLERK_TOKEN || "";
const publishToken = valueArg("--publish-token") || process.env.PUBLISH_TOKEN || "";
const mcpToken = valueArg("--mcp-token") || process.env.BEACHCAR_MCP_TOKEN || "";
const failOnWarn = hasFlag("--strict");
const isLocal = isLocalUrl(baseUrl);

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  checks: [],
  optional: {
    clerkToken: Boolean(clerkToken),
    publishToken: Boolean(publishToken),
    mcpToken: Boolean(mcpToken),
  },
};

await checkAppShell();
await checkMcpDiscovery();
await checkRemoteAuthFallback();
await checkSignedInSurface();
await checkAdminSurface();
await checkAuthenticatedMcp();

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printReport();
}

const failed = report.checks.filter((check) => check.status === "fail" || (failOnWarn && check.status === "warn"));
if (failed.length) process.exit(1);

async function checkAppShell() {
  const response = await request("/");
  const text = await response.text();
  addCheck("App shell responds", response.ok && /<html/i.test(text), `HTTP ${response.status}`, "Worker assets did not return an HTML shell.");
  addCheck(
    "App shell includes client mount",
    text.includes('id="root"') || text.includes("/assets/"),
    "Client mount or bundled assets found.",
    "The root response did not look like the built Beachcar PWA.",
  );
}

async function checkMcpDiscovery() {
  const mcpResponse = await request("/mcp");
  const mcp = await readJson(mcpResponse);
  addCheck("MCP metadata responds", mcpResponse.ok && mcp?.name === "beachcar-remote-mcp", `HTTP ${mcpResponse.status}`, "GET /mcp did not return server metadata.");
  addCheck(
    "MCP metadata advertises tools",
    Array.isArray(mcp?.tools) && mcp.tools.some((tool) => tool?.name === "publish_run"),
    "publish_run is advertised.",
    "GET /mcp did not advertise expected MCP tools.",
  );

  const metadataResponse = await request("/.well-known/oauth-protected-resource/mcp");
  const metadata = await readJson(metadataResponse);
  addCheck(
    "OAuth protected-resource metadata responds",
    metadataResponse.ok && metadata?.resource === absoluteUrl("/mcp"),
    metadata?.resource || `HTTP ${metadataResponse.status}`,
    "Protected-resource metadata did not describe this Worker MCP endpoint.",
  );
  addCheck(
    "OAuth metadata lists automation scopes",
    Array.isArray(metadata?.scopes_supported) && metadata.scopes_supported.includes("runs:publish"),
    "runs:publish is listed.",
    "Protected-resource metadata did not list expected automation scopes.",
  );

  const unauthorized = await request("/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "verify-unauthorized", method: "tools/list" }),
  });
  const challenge = unauthorized.headers.get("www-authenticate") || "";
  addCheck(
    "Unauthenticated MCP request is challenged",
    unauthorized.status === 401 && challenge.includes("resource_metadata="),
    `HTTP ${unauthorized.status}; ${challenge}`,
    "MCP should reject missing tokens with a WWW-Authenticate resource metadata challenge.",
  );
}

async function checkRemoteAuthFallback() {
  if (isLocal) {
    const response = await request("/api/me", { headers: { "X-Beachcar-Test-Email": testEmail } });
    const me = await readJson(response);
    addCheck(
      "Local test auth works",
      response.ok && typeof me?.email === "string" && me.email.includes("@"),
      me?.email || `HTTP ${response.status}`,
      "Local Worker did not accept the development test email header.",
    );
    return;
  }

  const response = await request("/api/me", { headers: { "X-Beachcar-Test-Email": "verify@example.com" } });
  addCheck(
    "Remote host rejects local test auth header",
    response.status === 403 || response.status === 401,
    `HTTP ${response.status}`,
    "Remote deployment accepted X-Beachcar-Test-Email, which would be a production auth bypass.",
  );
}

async function checkSignedInSurface() {
  if (!clerkToken) {
    addCheck("Signed-in API smoke", false, "Set BEACHCAR_CLERK_TOKEN or pass --clerk-token to verify /api/me and automation status.", "", "warn");
    return;
  }

  const authHeaders = { Authorization: `Bearer ${clerkToken}` };
  const meResponse = await request("/api/me", { headers: authHeaders });
  const me = await readJson(meResponse);
  addCheck("Signed-in /api/me works", meResponse.ok && me?.id && me?.email, me?.email || `HTTP ${meResponse.status}`, "Signed-in /api/me failed.");

  const automationResponse = await request("/api/automation/status", { headers: authHeaders });
  const automation = await readJson(automationResponse);
  addCheck(
    "Signed-in automation status works",
    automationResponse.ok && automation?.mcpEndpoint === absoluteUrl("/mcp"),
    automation?.mcpEndpoint || `HTTP ${automationResponse.status}`,
    "Automation status did not return the deployed MCP endpoint.",
  );
}

async function checkAdminSurface() {
  if (!publishToken) {
    addCheck("Admin source-cache smoke", false, "Set PUBLISH_TOKEN or pass --publish-token to verify admin source-cache status.", "", "warn");
    return;
  }

  const response = await request("/api/admin/source-cache/status", { headers: { "X-Publish-Token": publishToken } });
  const status = await readJson(response);
  addCheck(
    "Admin source-cache status works",
    response.ok && status?.sources?.bringatrailer,
    `HTTP ${response.status}`,
    "Admin source-cache status failed with the provided publish token.",
  );
}

async function checkAuthenticatedMcp() {
  if (!mcpToken) {
    addCheck("Authenticated MCP tools/list", false, "Set BEACHCAR_MCP_TOKEN or pass --mcp-token to verify a scoped automation token.", "", "warn");
    return;
  }

  const response = await request("/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mcpToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: "verify-tools", method: "tools/list" }),
  });
  const body = await readJson(response);
  addCheck(
    "Authenticated MCP tools/list works",
    response.ok && Array.isArray(body?.result?.tools) && body.result.tools.some((tool) => tool?.name === "publish_run"),
    `HTTP ${response.status}`,
    "Authenticated MCP tools/list failed with the provided token.",
  );
}

async function request(path, init = {}) {
  return fetch(absoluteUrl(path), {
    ...init,
    headers: {
      Accept: "application/json, text/html;q=0.9, */*;q=0.8",
      ...(init.headers || {}),
    },
  });
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function addCheck(label, ok, detail, failDetail, severity = "fail") {
  report.checks.push({
    label,
    status: ok ? "ok" : severity,
    detail: ok ? detail : failDetail || detail,
  });
}

function printReport() {
  console.log("Beachcar deployed Worker verification");
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`URL: ${report.baseUrl}`);
  console.log("");
  for (const check of report.checks) {
    const marker = check.status === "ok" ? "OK" : check.status === "warn" ? "WARN" : "FAIL";
    console.log(`${marker} ${check.label}`);
    if (check.detail) console.log(`    ${check.detail}`);
  }
  const counts = report.checks.reduce((acc, check) => {
    acc[check.status] = (acc[check.status] || 0) + 1;
    return acc;
  }, {});
  console.log("");
  console.log(`Summary: ${counts.ok || 0} ok, ${counts.warn || 0} warnings, ${counts.fail || 0} failures.`);
  console.log("No Cloudflare resources were created, changed, migrated, or deployed.");
}

function absoluteUrl(path) {
  return new URL(path, `${baseUrl}/`).toString();
}

function normalizeBaseUrl(value) {
  if (!value) throw new Error("Missing --url or BEACHCAR_DEPLOY_URL.");
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function isLocalUrl(value) {
  const hostname = new URL(value).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function hasFlag(name) {
  return args.includes(name);
}

function valueArg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || "" : "";
}

async function loadEnvFile(path) {
  try {
    const text = await readFile(path, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && !process.env[key]) process.env[key] = value;
    }
  } catch {
    // Local env files are optional.
  }
}
