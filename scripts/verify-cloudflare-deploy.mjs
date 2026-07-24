#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { missingVerificationGateStatus } from "./lib/cloudflare-rollout.ts";

const args = process.argv.slice(2);
if (hasFlag("--help") || hasFlag("-h")) {
  printHelp();
  process.exit(0);
}
await loadEnvFile(resolve(".dev.vars"));
await loadEnvFile(resolve(".publish.env"));

const jsonOutput = hasFlag("--json");
const baseUrl = normalizeBaseUrl(valueArg("--url") || process.env.BEACHCAR_DEPLOY_URL || "http://127.0.0.1:8787");
const testEmail = firstEmail(valueArg("--email"), process.env.SMOKE_TEST_EMAIL, process.env.BOOTSTRAP_OWNER_EMAILS, process.env.ALLOWED_EMAILS, process.env.ALLOWED_EMAIL, "you@example.com");
const clerkToken = valueArg("--clerk-token") || process.env.BEACHCAR_CLERK_TOKEN || "";
const publishToken = valueArg("--publish-token") || process.env.PUBLISH_TOKEN || "";
const mcpToken = valueArg("--mcp-token") || process.env.BEACHCAR_MCP_TOKEN || "";
const strictPublic = hasFlag("--strict");
const requireAuthenticated = hasFlag("--require-authenticated");
const requireClerk = requireAuthenticated || hasFlag("--require-clerk");
const expectedRunnerMode = valueArg("--expected-runner-mode");
const requirePublish = requireAuthenticated || hasFlag("--require-publish") || Boolean(expectedRunnerMode);
const requireMcp = requireAuthenticated || hasFlag("--require-mcp");
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
  requirements: {
    strictPublic,
    clerk: requireClerk,
    publish: requirePublish,
    mcp: requireMcp,
  },
};

await checkAppShell();
await checkMcpDiscovery();
await checkRemoteAuthFallback();
const publicOriginFailed = report.checks.some((check) => check.status === "fail");
if (!publicOriginFailed) {
  await checkOAuthAuthorizationCodeFlow();
  await checkSignedInSurface();
  await checkAdminSurface();
  await checkAuthenticatedMcp();
} else {
  addCheck(
    "Authenticated verification is withheld after a public origin failure",
    false,
    "No Clerk, publish, or MCP credential was sent.",
    "Fix the public deployment/origin failures before any authenticated gate runs.",
  );
}

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printReport();
}

const failed = report.checks.filter((check) => check.status === "fail");
if (failed.length) process.exit(1);

async function checkAppShell() {
  const response = await request("/");
  const text = await response.text();
  addCheck("App shell responds", response.ok && /<html/i.test(text), `HTTP ${response.status}`, "Worker assets did not return an HTML shell.");
  addCheck(
    "App shell prevents credential referrer leakage",
    response.headers.get("referrer-policy") === "no-referrer",
    response.headers.get("referrer-policy") || "missing",
    "The app shell must send Referrer-Policy: no-referrer before a Clerk ticket is redeemed.",
  );
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
    Array.isArray(metadata?.scopes_supported) && metadata.scopes_supported.includes("runs:publish") && metadata.scopes_supported.includes("setup:write"),
    "runs:publish and setup:write are listed.",
    "Protected-resource metadata did not list expected automation scopes.",
  );
  addCheck(
    "OAuth metadata advertises authorization server",
    Array.isArray(metadata?.authorization_servers) && metadata.authorization_servers.includes(new URL(baseUrl).origin),
    JSON.stringify(metadata?.authorization_servers || []),
    "Protected-resource metadata did not advertise this Worker as an authorization server.",
  );

  const authServerResponse = await request("/.well-known/oauth-authorization-server");
  const authServer = await readJson(authServerResponse);
  addCheck(
    "OAuth authorization-server metadata responds",
    authServerResponse.ok && authServer?.authorization_endpoint === absoluteUrl("/oauth/authorize") && authServer?.token_endpoint === absoluteUrl("/oauth/token"),
    `HTTP ${authServerResponse.status}`,
    "Authorization-server metadata did not advertise authorize/token endpoints.",
  );
  addCheck(
    "OAuth authorization-server metadata supports PKCE",
    Array.isArray(authServer?.code_challenge_methods_supported) && authServer.code_challenge_methods_supported.includes("S256"),
    "S256 is listed.",
    "Authorization-server metadata did not list S256 PKCE support.",
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

async function checkOAuthAuthorizationCodeFlow() {
  const canAuthorize = isLocal || Boolean(clerkToken);
  if (!canAuthorize) {
    addMissingGate(
      "OAuth authorization-code PKCE smoke",
      "Set BEACHCAR_CLERK_TOKEN or run against localhost to verify the OAuth code flow.",
      requireClerk,
    );
    return;
  }

  try {
    const redirectUri = isLocal ? "http://127.0.0.1:8787/oauth/callback-test" : "https://client.example.com/beachcar/oauth/callback";
    const scope = "setup:read setup:write sources:read runs:publish usage:write events:read";
    const registeredResponse = await request("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Beachcar verifier",
        redirect_uris: [redirectUri],
        scope,
        token_endpoint_auth_method: "none",
      }),
    });
    const registered = await readJson(registeredResponse);
    if (!registeredResponse.ok || !registered?.client_id) {
      throw new Error(`client registration failed: HTTP ${registeredResponse.status}`);
    }

    const verifier = randomBase64Url(48);
    const challenge = await pkceChallenge(verifier);
    const authorizeUrl = new URL(absoluteUrl("/oauth/authorize"));
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", registered.client_id);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("scope", scope);
    authorizeUrl.searchParams.set("state", "verify-state");
    authorizeUrl.searchParams.set("resource", absoluteUrl("/mcp"));
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    const authorizeHeaders = isLocal ? { "X-Beachcar-Test-Email": testEmail } : { Authorization: `Bearer ${clerkToken}` };
    const authorizeResponse = await fetch(authorizeUrl, { headers: authorizeHeaders, redirect: "manual" });
    const location = authorizeResponse.headers.get("location") || "";
    const redirected = location ? new URL(location) : null;
    const code = redirected?.searchParams.get("code") || "";
    if (authorizeResponse.status !== 302 || !code || redirected?.searchParams.get("state") !== "verify-state") {
      throw new Error(`authorize failed: HTTP ${authorizeResponse.status} ${location}`);
    }

    const tokenResponse = await request("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: registered.client_id,
        redirect_uri: redirectUri,
        resource: absoluteUrl("/mcp"),
        code_verifier: verifier,
      }).toString(),
    });
    const token = await readJson(tokenResponse);
    if (!tokenResponse.ok || typeof token?.access_token !== "string") {
      throw new Error(`token exchange failed: HTTP ${tokenResponse.status}`);
    }

    const toolsResponse = await request("/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: "verify-oauth-tools", method: "tools/list" }),
    });
    const tools = await readJson(toolsResponse);
    if (!toolsResponse.ok || !Array.isArray(tools?.result?.tools) || !tools.result.tools.some((tool) => tool?.name === "publish_run")) {
      throw new Error(`OAuth MCP tools/list failed: HTTP ${toolsResponse.status}`);
    }

    await request("/oauth/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: token.access_token }).toString(),
    });
    const revokedResponse = await request("/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: "verify-oauth-revoked", method: "tools/list" }),
    });
    if (revokedResponse.status !== 401) {
      throw new Error(`revoked OAuth token was still accepted: HTTP ${revokedResponse.status}`);
    }

    addCheck("OAuth authorization-code PKCE smoke", true, `client ${registered.client_id}; tools ${tools.result.tools.length}`, "");
  } catch (error) {
    addCheck("OAuth authorization-code PKCE smoke", false, error instanceof Error ? error.message : "OAuth code flow failed", "");
  }
}

async function checkSignedInSurface() {
  if (!clerkToken) {
    addMissingGate(
      "Signed-in API smoke",
      "Set BEACHCAR_CLERK_TOKEN or pass --clerk-token to verify /api/me and automation status.",
      requireClerk,
    );
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
    addMissingGate(
      "Admin source-cache smoke",
      "Set PUBLISH_TOKEN or pass --publish-token to verify admin source-cache status.",
      requirePublish,
    );
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

  const runtimeResponse = await request("/api/admin/runtime", { headers: { "X-Publish-Token": publishToken } });
  const runtime = await readJson(runtimeResponse);
  addCheck(
    "Admin runtime capability is readable",
    runtimeResponse.ok && typeof runtime?.aiGatewayConfigured === "boolean" && ["deterministic", "codex"].includes(runtime?.runnerMode),
    `HTTP ${runtimeResponse.status}; ${runtime?.runnerMode || "unknown"}`,
    "Admin runtime capability did not return the effective non-secret scoring/runner modes.",
  );
  if (expectedRunnerMode) {
    addCheck(
      "Effective runner mode matches the rollout choice",
      runtimeResponse.ok && runtime?.runnerMode === expectedRunnerMode,
      runtime?.runnerMode || `HTTP ${runtimeResponse.status}`,
      `Expected ${expectedRunnerMode}; production reported ${runtime?.runnerMode || "unknown"}.`,
    );
  }
}

async function checkAuthenticatedMcp() {
  if (!mcpToken) {
    addMissingGate(
      "Authenticated MCP tools/list",
      "Set BEACHCAR_MCP_TOKEN or pass --mcp-token to verify a scoped automation token.",
      requireMcp,
    );
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
  const response = await fetch(absoluteUrl(path), {
    ...init,
    redirect: "error",
    headers: {
      Accept: "application/json, text/html;q=0.9, */*;q=0.8",
      "Cache-Control": "no-cache",
      ...(init.headers || {}),
    },
  });
  if (new URL(response.url).origin !== new URL(baseUrl).origin) {
    throw new Error("Verification response escaped the configured deployment origin.");
  }
  return response;
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

function addMissingGate(label, detail, required) {
  report.checks.push({
    label,
    status: missingVerificationGateStatus(required),
    detail: required ? `${detail} This gate was explicitly required.` : detail,
  });
}

function printReport() {
  console.log("Beachcar deployed Worker verification");
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`URL: ${report.baseUrl}`);
  console.log("");
  for (const check of report.checks) {
    const marker = check.status === "ok" ? "OK" : check.status === "skip" ? "SKIP" : check.status === "warn" ? "WARN" : "FAIL";
    console.log(`${marker} ${check.label}`);
    if (check.detail) console.log(`    ${check.detail}`);
  }
  const counts = report.checks.reduce((acc, check) => {
    acc[check.status] = (acc[check.status] || 0) + 1;
    return acc;
  }, {});
  console.log("");
  console.log(`Summary: ${counts.ok || 0} ok, ${counts.skip || 0} skipped, ${counts.warn || 0} warnings, ${counts.fail || 0} failures.`);
  console.log("No Cloudflare resources were created, changed, migrated, or deployed.");
}

function printHelp() {
  console.log(`Beachcar deployed Worker verifier

Usage:
  bun scripts/verify-cloudflare-deploy.mjs --url <https-url> [options]

Options:
  --strict                  Strictly require all public/core checks to pass. Missing optional tokens are reported as skipped.
  --require-clerk           Require Clerk-backed OAuth and signed-in API checks; fails if BEACHCAR_CLERK_TOKEN is absent.
  --require-publish         Require the admin source-cache check; fails if PUBLISH_TOKEN is absent.
  --require-mcp             Require authenticated MCP tools/list; fails if BEACHCAR_MCP_TOKEN is absent.
  --require-authenticated   Require all Clerk, publishing, and MCP token-gated checks.
  --json                    Print the verification report as JSON.

Token values should be supplied through the environment, not command arguments or shell history.
`);
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

function firstEmail(...values) {
  return (
    values
      .filter(Boolean)
      .join(",")
      .split(/[,\s]+/)
      .map((email) => email.trim().toLowerCase())
      .find(Boolean) || ""
  );
}

async function pkceChallenge(verifier) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(hash));
}

function randomBase64Url(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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
