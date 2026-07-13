#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import { nextDailyRunAt } from "../src/worker/daily-schedule.ts";
import {
  DEFAULT_TRUSTED_LEGACY_TICKET_ORIGIN,
  SOURCE_QUALITY_PILOT_SOURCES,
  atomicReplacePrivateFile,
  beachcarUserIdForEmail,
  enabledSourceNames,
  evaluateManagedAiProof,
  evaluateRunProvenance,
  evaluateSourceProof,
  extractClerkPublishableKeys,
  isClerkPublishableKey,
  jwtSubject,
  listingsHaveExplicitLocationStatus,
  prepareTicketRedemption,
  redactSensitive,
  sameOriginDeckImageUrl,
  validManagedScheduleStatus,
} from "./lib/managed-production-verifier.ts";

const args = process.argv.slice(2);
const execute = hasFlag("--execute");
const yes = hasFlag("--yes");
const jsonOutput = hasFlag("--json");
const configurePilot = hasFlag("--configure-pilot");
const allowRunnerHandoffOnly = hasFlag("--allow-runner-handoff-only");
const explicitRunnerMerge = hasFlag("--require-runner-merge");
if (allowRunnerHandoffOnly && explicitRunnerMerge) {
  fail("Choose either --require-runner-merge or --allow-runner-handoff-only, not both.");
}
const requireRunnerMerge = !allowRunnerHandoffOnly;
const requireHeuristicFlag = hasFlag("--require-heuristic");
if (requireHeuristicFlag) fail("Managed Research requires AI Gateway scoring; --require-heuristic is no longer supported.");
const timeoutMs = numberArg("--timeout-ms", 5 * 60 * 1_000);
const runnerTimeoutMs = numberArg("--runner-timeout-ms", timeoutMs);
const checkpointPath = resolve(".tmp", "managed-production-verification.json");

if (hasFlag("--help") || hasFlag("-h")) {
  printHelp();
  process.exit(0);
}
if (!execute || !yes) fail("This single-use Clerk ticket verifier requires --execute --yes.");

const env = {
  ...(await loadEnvFile(resolve(".env.local"))),
  ...(await loadEnvFile(resolve(".publish.env"))),
  ...(await loadEnvFile(resolve(".deploy.env"))),
  ...process.env,
};
const storedSignInUrl = value("CLERK_DEV_APP_SIGN_IN_URL");
const configuredDeployUrl = value("BEACHCAR_DEPLOY_URL");
const requestedTargetUrl = valueArg("--url") || configuredDeployUrl;
const publishToken = value("PUBLISH_TOKEN");
const publishableKey = value("VITE_CLERK_PUBLISHABLE_KEY");
const expectedPilotEmail = normalizeEmail(value("BEACHCAR_EXPECTED_PILOT_EMAIL") || value("CLERK_DEV_EMAIL"));
const expectedClerkUserId = value("CLERK_DEV_USER_ID");
const expectedBeachcarUserId = beachcarUserIdForEmail(expectedPilotEmail);
const trustedLegacyOrigin = value("BEACHCAR_TRUSTED_LEGACY_TICKET_ORIGIN") || DEFAULT_TRUSTED_LEGACY_TICKET_ORIGIN;

if (!storedSignInUrl) fail("Missing CLERK_DEV_APP_SIGN_IN_URL in .env.local.");
if (!configuredDeployUrl) fail("BEACHCAR_DEPLOY_URL is required.");
if (!publishToken) fail("PUBLISH_TOKEN is required for the pre-ticket pilot-state gate.");
if (!isClerkPublishableKey(publishableKey)) fail("VITE_CLERK_PUBLISHABLE_KEY is missing or malformed.");
if (!expectedPilotEmail) fail("Set BEACHCAR_EXPECTED_PILOT_EMAIL or CLERK_DEV_EMAIL.");
if (!expectedClerkUserId) fail("CLERK_DEV_USER_ID is required to bind the ticket to the intended Clerk user.");

let ticketRedemption;
try {
  ticketRedemption = prepareTicketRedemption({
    storedSignInUrl,
    targetUrl: requestedTargetUrl,
    configuredDeployUrl,
    trustedLegacyOrigins: [trustedLegacyOrigin],
  });
} catch (error) {
  fail(redactSensitive(error));
}

const baseUrl = ticketRedemption.targetOrigin;
const sensitiveValues = new Set([ticketRedemption.ticket, publishToken]);
const operation = newOperation();
const verificationId = operation.verificationId;
const requestId = operation.requestId;
const verificationReason = operation.reason;

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  mode: "managed-run",
  verificationId,
  requestId,
  configurePilot,
  requireRunnerMerge,
  aiProofMode: "ai-gateway",
  checks: [],
};

let browser;
let context;
let page;
let agentRunId = "";
let adminPilot = null;
let pilotConfigurationDrift = false;

try {
  const preflight = await runPublicPreflight();
  adminPilot = preflight.adminPilot;
  pilotConfigurationDrift = preflight.pilotConfigurationDrift;
  if (hasFailures()) throw new Error("Public/admin preflight failed before Clerk ticket exchange.");

  await writeCheckpoint({ stage: "preflight-ready" });
  browser = await launchBrowser();
  context = await browser.newContext({ serviceWorkers: "block" });
  page = await context.newPage();
  const navigation = await page.goto(ticketRedemption.redemptionUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  }).catch(() => {
    throw new Error("Clerk ticket navigation failed.");
  });
  addCheck("Ticket redemption loaded the current production app", Boolean(navigation?.ok()), `HTTP ${navigation?.status() || "unknown"}`);
  const authOutcome = await page
    .waitForFunction(
      (expectedOrigin) => {
        const current = new URL(window.location.href);
        if (
          current.origin === expectedOrigin &&
          Boolean(window.Clerk?.session) &&
          !current.searchParams.has("__clerk_ticket") &&
          !current.searchParams.has("ticket")
        ) {
          return { status: "signed-in" };
        }
        const authError = document.querySelector(".auth-error")?.textContent?.trim();
        return authError ? { status: "error", message: authError } : null;
      },
      baseUrl,
      { timeout: 60_000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => {
      throw new Error("Clerk ticket did not create a cleaned active session on the current production origin.");
    });
  if (authOutcome?.status === "error") {
    throw new Error(`Clerk ticket redemption failed: ${authOutcome.message || "unknown Clerk error"}`);
  }
  const finalBrowserUrl = new URL(page.url());
  addCheck(
    "Clerk ticket was redeemed only on the current production origin",
    finalBrowserUrl.origin === baseUrl && !finalBrowserUrl.searchParams.has("__clerk_ticket") && !finalBrowserUrl.searchParams.has("ticket"),
    ticketRedemption.rebased ? "trusted legacy ticket rebased in memory" : "current-origin ticket",
  );
  await markTicketConsumed();

  const initialToken = await clerkToken(page);
  addCheck("Clerk session belongs to the expected ticket user", jwtSubject(initialToken) === expectedClerkUserId, "subject matched");
  await writeCheckpoint({ stage: "ticket-exchanged" });

  let meResult = await authorizedJson(page, "/api/me");
  addCheck("Signed-in API accepts the Clerk session", meResult.response.ok && Boolean(meResult.body?.id), `HTTP ${meResult.response.status}`);
  addCheck("Signed-in API maps the Clerk subject to the exact Beachcar pilot", meResult.body?.id === expectedBeachcarUserId, "stable email-scoped user id");
  addCheck("Signed-in pilot email matches the protected ticket", normalizeEmail(meResult.body?.email) === expectedPilotEmail, expectedPilotEmail);
  addCheck("Pilot user is active", meResult.body?.status === "active", meResult.body?.status || "missing status");
  addCheck("Pilot onboarding is complete", meResult.body?.onboarding?.completed === true, meResult.body?.onboarding?.completed ? "complete" : "incomplete");
  addCheck(
    "Pilot Clerk session grants managed_research",
    meResult.body?.managedResearchEntitlement?.active === true,
    meResult.body?.managedResearchEntitlement?.active ? "active" : "missing or inactive",
  );

  if (pilotConfigurationDrift) {
    if (!configurePilot) throw new Error("Pilot managed/source settings drifted; rerun explicitly with --configure-pilot after reviewing the admin preflight.");
    meResult = await configurePilotState(page, meResult.body);
  }
  const me = meResult.body;
  const configuredSources = enabledSourceNames(me?.sourceSettings);
  addCheck(
    "Pilot research mode and AI settings are managed and active",
    me?.researchSettings?.mode === "managed" && me?.aiSettings?.mode === "managed" && me?.aiSettings?.status === "active",
    `${me?.researchSettings?.mode || "missing"}; ${me?.aiSettings?.mode || "missing"}`,
  );
  addCheck(
    "Pilot has every Source Quality v1 source enabled",
    SOURCE_QUALITY_PILOT_SOURCES.every((source) => configuredSources.includes(source)),
    configuredSources.join(", ") || "none",
  );
  addCheck(
    "Pilot browser-runner handoffs are enabled",
    hasRequiredRunnerSettings(me?.sourceSettings),
    hasRequiredRunnerSettings(me?.sourceSettings) ? "carsandbids, hemmings" : "missing runner setting",
  );
  addCheck("Managed Run now is enabled", me?.capabilities?.canRunNow === true, me?.capabilities?.canRunNow ? "enabled" : "disabled");

  const automation = await authorizedJson(page, "/api/automation/status");
  addCheck(
    "Signed-in automation status points at production MCP",
    automation.response.ok && automation.body?.mcpEndpoint === `${baseUrl}/mcp`,
    automation.body?.mcpEndpoint || `HTTP ${automation.response.status}`,
  );
  if (hasFailures()) throw new Error("Signed-in preflight failed; managed run was not queued.");

  await writeCheckpoint({ stage: "queueing" });
  const queued = await authorizedJson(
    page,
    "/api/agent-runs",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: verificationReason, requestId }),
    },
    3,
  );
  addCheck(
    "Managed run request was accepted idempotently",
    [200, 201].includes(queued.response.status) && Boolean(queued.body?.id),
    queued.response.status === 200 ? "HTTP 200; same request reused" : `HTTP ${queued.response.status}`,
  );
  if (!queued.response.ok || !queued.body?.id) throw new Error(`Managed run was not accepted: HTTP ${queued.response.status}`);
  agentRunId = queued.body.id;
  await writeCheckpoint({ stage: "queued", agentRunId });

  const finished = await pollManagedRun(page, agentRunId, timeoutMs);
  addCheck("Managed Workflow reached published", finished?.status === "published", finished?.status || "timed out");
  addCheck("Agent run retained this exact idempotency request", finished?.progress?.requestId === requestId, "exact requestId");
  if (finished?.status !== "published") throw new Error(finished?.error || `Managed Workflow ended as ${finished?.status || "unknown"}.`);
  await writeCheckpoint({ stage: "published", agentRunId });

  const publishedRunId = typeof finished?.progress?.publishedRunId === "string" ? finished.progress.publishedRunId : "";
  const workflowInstanceId = typeof finished?.workflowInstanceId === "string" ? finished.workflowInstanceId : "";
  addCheck("Agent run records its concrete published run", Boolean(publishedRunId), publishedRunId ? "recorded" : "missing");
  if (!publishedRunId) throw new Error("Published Agent run did not record its concrete run id.");

  let published = await authorizedJson(page, `/api/runs/${encodeURIComponent(publishedRunId)}`);
  addCheck("Published run is addressable by its exact id", published.response.ok && published.body?.id === publishedRunId, `HTTP ${published.response.status}`);
  if (!published.response.ok || published.body?.id !== publishedRunId) throw new Error("Exact published run could not be read.");

  await writeCheckpoint({
    stage: requireRunnerMerge ? "waiting-runner-merges" : "runner-handoff-recorded",
    agentRunId,
    publishedRunId,
    runnerTaskIds: runnerTaskIds(published.body?.sourceSummary?.runnerTasks),
  });
  if (requireRunnerMerge) {
    published = await pollRequiredRunnerMerges(page, publishedRunId, me, runnerTimeoutMs);
  }

  const listings = Array.isArray(published.body?.listings) ? published.body.listings : [];
  const summary = published.body?.sourceSummary || {};
  const provenance = evaluateRunProvenance(summary, {
    agentRunId,
    userId: me.id,
    workflowInstanceId,
    reason: verificationReason,
  });
  addCheck("Published run came from the managed source-discovery publisher", provenance.publisher, summary.publisher || "missing");
  addCheck("Published run is linked to this exact Agent run", provenance.agentRunId, "exact agentRunId");
  addCheck("Published run belongs to this exact pilot user", provenance.userId, "exact userId");
  addCheck("Published run is linked to this exact Workflow instance", provenance.workflowInstanceId, workflowInstanceId ? "exact workflowInstanceId" : "missing");
  addCheck("Published run records a manual request", provenance.source, summary.source || "missing");
  addCheck("Published run records this verification request", provenance.reason, summary.reason || "missing");
  addCheck("Managed run avoided transparent fallback", provenance.directDiscovery, summary.fallbackUsed === true ? "fallback used" : "missing or invalid fallback flag");
  addCheck("Published shortlist contains listings", listings.length > 0, `${listings.length} listing(s)`);
  addCheck(
    "Every listing has an explicit usable-or-missing location state",
    listingsHaveExplicitLocationStatus(listings),
    `${listings.length} listing(s) checked`,
  );

  const sourceProof = addSourceProofChecks(me, summary, requireRunnerMerge);
  await writeCheckpoint({
    stage: "run-proof",
    agentRunId,
    publishedRunId,
    runnerTaskIds: runnerTaskIds(summary.runnerTasks),
  });

  await verifyDeckImage(listings);

  const usage = await authorizedJson(page, "/api/ai-usage?limit=500");
  const aiProof = evaluateManagedAiProof({
    user: me,
    sourceSummary: summary,
    usage: usage.body,
    agentRunId,
  });
  addCheck("Managed pilot AI settings remained active", usage.response.ok && aiProof.settings, `HTTP ${usage.response.status}`);
  addCheck("AI Gateway scored this exact run", aiProof.scoring, aiProof.mode);
  addCheck("This exact run has a successful managed AI usage event", aiProof.usageEvent, aiProof.mode);
  addCheck("Managed budget remains below its limits", aiProof.budgetHealthy, usage.body?.summary?.budgetExceeded === true ? "budget exceeded" : "healthy");

  await verifySignedInDom(listings, {
    agentRunId,
    workflowInstanceId,
    publishedRunId,
    generatedAt: published.body?.generatedAt,
  });

  if (hasFailures()) throw new Error("Managed run/source/image/AI proof failed; schedule state was left untouched.");

  // Schedule synchronization is intentionally the final Beachcar API mutation,
  // after every run/source/image/AI proof has succeeded.
  const scheduleSyncStartedAt = new Date();
  const expectedNextScheduleRunAt = nextDailyRunAt(
    me.profile.scheduleCron,
    me.profile.timezone,
    scheduleSyncStartedAt,
  ).toISOString();
  const scheduleSync = await authorizedJson(page, "/api/agent-schedule/sync", { method: "POST" });
  addCheck("Pilot schedule synchronization succeeded", scheduleSync.response.ok, `HTTP ${scheduleSync.response.status}`);
  const scheduleStatus = await authorizedJson(page, "/api/agent-schedule");
  const scheduleProof = validManagedScheduleStatus({
    status: scheduleStatus.body,
    user: me,
    expectedNextRunAt: expectedNextScheduleRunAt,
    now: scheduleSyncStartedAt,
  });
  addCheck(
    "Pilot schedule status matches the saved profile and next timezone occurrence",
    scheduleStatus.response.ok && scheduleProof,
    scheduleStatus.response.ok ? `expected ${expectedNextScheduleRunAt}` : `HTTP ${scheduleStatus.response.status}`,
  );

  if (hasFailures()) throw new Error("Final schedule synchronization/status proof failed.");
  await writeCheckpoint({
    stage: "complete",
    agentRunId,
    publishedRunId,
    runnerTaskIds: runnerTaskIds(summary.runnerTasks),
    completedAt: new Date().toISOString(),
    sourceProof,
  });
} catch (error) {
  report.error = redactSensitive(error, sensitiveValues);
  await writeCheckpoint({ stage: "error", agentRunId: agentRunId || null, error: report.error }).catch(() => {});
} finally {
  if (page) {
    await page.evaluate(async () => {
      try {
        await window.Clerk?.signOut?.();
      } catch {
        // The ephemeral browser context is closed below even if Clerk cleanup fails.
      }
    }).catch(() => {});
  }
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
}

if (jsonOutput) console.log(JSON.stringify(report, null, 2));
else printReport();

if (report.error || hasFailures()) process.exit(1);

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    return chromium.launch({ headless: true, channel: "chrome" });
  }
}

async function runPublicPreflight() {
  const shell = await fetchTarget(baseUrl, { headers: { Accept: "text/html" } }, 3);
  const shellText = await shell.text();
  addCheck(
    "Production app shell is reachable without redirects",
    shell.ok && (shell.headers.get("content-type") || "").includes("text/html"),
    `HTTP ${shell.status}`,
  );
  addCheck("Production app shell disables referrer disclosure", shell.headers.get("referrer-policy") === "no-referrer", shell.headers.get("referrer-policy") || "missing");

  const deployedKeys = await deployedPublishableKeys(shellText);
  addCheck(
    "Production app is built with the expected Clerk publishable key",
    deployedKeys.length === 1 && deployedKeys[0] === publishableKey,
    deployedKeys.length === 1 ? "exact key match" : `${deployedKeys.length} key marker(s)`,
  );

  const metadata = await fetchJson(`${baseUrl}/mcp`, {}, 3);
  addCheck("Production MCP metadata is reachable", metadata.response.ok && metadata.body?.name === "beachcar-remote-mcp", `HTTP ${metadata.response.status}`);

  const adminHeaders = { "X-Publish-Token": publishToken };
  const runtime = await fetchJson(`${baseUrl}/api/admin/runtime`, { headers: adminHeaders }, 3);
  const runtimeModeKnown =
    runtime.response.ok &&
    typeof runtime.body?.aiGatewayConfigured === "boolean" &&
    ["deterministic", "codex"].includes(runtime.body?.runnerMode);
  const runtimeHasAiGateway = runtime.body?.aiGatewayConfigured === true;
  addCheck(
    "Admin preflight exposes the effective non-secret runtime mode",
    runtimeModeKnown,
    runtimeModeKnown
      ? `${runtime.body.runnerMode}; ${runtimeHasAiGateway ? "AI Gateway" : "managed scoring unavailable"}`
      : `HTTP ${runtime.response.status}; invalid capability response`,
  );
  addCheck(
    "Managed AI Gateway is configured before ticket exchange",
    runtimeModeKnown && runtimeHasAiGateway,
    runtimeHasAiGateway ? "AI Gateway ready" : "managed_research must remain disabled",
  );
  const sourceCache = await fetchJson(`${baseUrl}/api/admin/source-cache/status`, { headers: adminHeaders }, 3);
  const cache = sourceCache.body?.sources?.bringatrailer;
  addCheck(
    "Admin source-cache status has the expected shape",
    sourceCache.response.ok && cache?.source === "bringatrailer" && Number.isFinite(cache?.itemCount),
    `HTTP ${sourceCache.response.status}`,
  );

  const adminUsers = await fetchJson(`${baseUrl}/api/admin/users`, { headers: adminHeaders }, 3);
  const users = Array.isArray(adminUsers.body) ? adminUsers.body : [];
  const pilot =
    users.find(
      (entry) => normalizeEmail(entry?.email) === expectedPilotEmail && entry?.id === expectedBeachcarUserId,
    ) || null;
  addCheck(
    "Admin preflight found the exact stable Beachcar pilot identity",
    adminUsers.response.ok && Boolean(pilot),
    pilot ? `${expectedPilotEmail}; exact user id` : `HTTP ${adminUsers.response.status}; email/user id mismatch or missing`,
  );
  addCheck("Admin preflight confirms the pilot is active", pilot?.status === "active", pilot?.status || "missing");
  addCheck("Admin preflight confirms onboarding is complete", Boolean(pilot?.onboardingCompletedAt), pilot?.onboardingCompletedAt ? "complete" : "incomplete");
  addCheck("Admin preflight confirms the budget is healthy", pilot?.aiUsage?.budgetExceeded === false, pilot?.aiUsage?.budgetExceeded === true ? "budget exceeded" : "missing");
  addCheck(
    "Admin preflight confirms managed_research entitlement",
    pilot?.managedResearchEntitlement?.active === true,
    pilot?.managedResearchEntitlement?.active ? "active" : "missing or inactive",
  );

  const pilotSources = enabledSourceNames(pilot?.sourceSettings);
  const aiDrift =
    pilot?.researchSettings?.mode !== "managed" ||
    pilot?.aiSettings?.mode !== "managed" ||
    pilot?.aiSettings?.status !== "active";
  const sourceDrift =
    !SOURCE_QUALITY_PILOT_SOURCES.every((source) => pilotSources.includes(source)) ||
    !hasRequiredRunnerSettings(pilot?.sourceSettings);
  const pilotConfigurationDrift = aiDrift || sourceDrift;
  addCheck(
    "Admin preflight confirms managed research and all pilot sources",
    !pilotConfigurationDrift || configurePilot,
    pilotConfigurationDrift
      ? configurePilot
        ? "drift found; explicit repair authorized"
        : "drift found; use --configure-pilot to repair after ticket exchange"
      : "ready",
  );
  return { adminPilot: pilot, pilotConfigurationDrift };
}

async function configurePilotState(activePage, currentUser) {
  const existingSources = new Map(
    (Array.isArray(currentUser?.sourceSettings) ? currentUser.sourceSettings : []).map((entry) => [String(entry?.source || "").toLowerCase(), entry]),
  );
  const sources = SOURCE_QUALITY_PILOT_SOURCES.map((source) => {
    const existing = existingSources.get(source);
    return {
      source,
      enabled: true,
      settings: {
        ...(existing?.settings && typeof existing.settings === "object" ? existing.settings : {}),
        ...(["carsandbids", "hemmings"].includes(source) ? { browserRunner: true } : {}),
      },
    };
  });
  const research = await authorizedJson(activePage, "/api/research-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "managed" }),
  });
  addCheck(
    "Explicit pilot repair selected managed research",
    research.response.ok && research.body?.researchSettings?.mode === "managed" && research.body?.managedResearchEntitlement?.active === true,
    `HTTP ${research.response.status}`,
  );
  const sourceResult = await authorizedJson(activePage, "/api/source-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sources }),
  });
  const enabled = enabledSourceNames(sourceResult.body?.sourceSettings);
  addCheck(
    "Explicit pilot repair enabled all Source Quality v1 sources",
    sourceResult.response.ok && SOURCE_QUALITY_PILOT_SOURCES.every((source) => enabled.includes(source)),
    `HTTP ${sourceResult.response.status}`,
  );
  if (hasFailures()) throw new Error("Explicit pilot configuration repair failed; no run was queued.");
  return authorizedJson(activePage, "/api/me");
}

async function clerkToken(activePage) {
  const token = await activePage.evaluate(() => window.Clerk?.session?.getToken());
  if (!token) throw new Error("Clerk session did not return a bearer token.");
  sensitiveValues.add(token);
  return token;
}

async function authorizedJson(activePage, pathname, init = {}, attemptsOverride) {
  const token = await clerkToken(activePage);
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  const attempts = attemptsOverride || (init.method && init.method !== "GET" ? 1 : 3);
  return fetchJson(`${baseUrl}${pathname}`, { ...init, headers }, attempts);
}

async function fetchJson(url, init = {}, attempts = 1) {
  const headers = new Headers(init.headers || {});
  headers.set("Accept", "application/json");
  const response = await fetchTarget(url, { ...init, headers }, attempts);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { text };
  }
  return { response, body };
}

async function fetchTarget(url, init = {}, attempts = 1) {
  const target = new URL(url, baseUrl);
  if (target.origin !== baseUrl) throw new Error("Verifier refused a request outside the exact production origin.");
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(target, { ...init, redirect: "error" });
      if (new URL(response.url).origin !== baseUrl) throw new Error("Verifier response escaped the exact production origin.");
      if (response.status >= 500 && attempt < attempts) {
        await response.arrayBuffer().catch(() => {});
        await Bun.sleep(attempt * 250);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) throw error;
      await Bun.sleep(attempt * 250);
    }
  }
  throw lastError || new Error("Production request failed.");
}

async function pollManagedRun(activePage, runId, timeout) {
  const deadline = Date.now() + timeout;
  let latest = null;
  while (Date.now() < deadline) {
    const result = await authorizedJson(activePage, `/api/agent-runs/${encodeURIComponent(runId)}`);
    latest = result.body;
    if (!result.response.ok) throw new Error(`Could not read queued Agent run: HTTP ${result.response.status}`);
    if (["published", "failed", "cancelled"].includes(latest?.status)) return latest;
    await Bun.sleep(2_000);
  }
  return latest;
}

async function pollRequiredRunnerMerges(activePage, publishedRunId, user, timeout) {
  const deadline = Date.now() + timeout;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await authorizedJson(activePage, `/api/runs/${encodeURIComponent(publishedRunId)}`);
    if (!latest.response.ok) throw new Error(`Could not read published run while waiting for runner merges: HTTP ${latest.response.status}`);
    const summary = latest.body?.sourceSummary || {};
    const proof = evaluateSourceProof({
      userSourceSettings: user?.sourceSettings,
      summaryEnabledSources: summary.enabledSources,
      checkedSources: summary.checkedSources,
      runnerTasks: summary.runnerTasks,
    });
    if (proof.runnerMerges.carsandbids && proof.runnerMerges.hemmings) return latest;
    const tasks = Array.isArray(summary.runnerTasks) ? summary.runnerTasks : [];
    const terminalFailure = tasks.some(
      (task) => ["carsandbids", "hemmings"].includes(String(task?.source || "").toLowerCase()) && ["failed", "cancelled"].includes(String(task?.status || "").toLowerCase()),
    );
    if (terminalFailure) return latest;
    await Bun.sleep(2_000);
  }
  return latest || authorizedJson(activePage, `/api/runs/${encodeURIComponent(publishedRunId)}`);
}

function addSourceProofChecks(user, summary, requireMerges) {
  const proof = evaluateSourceProof({
    userSourceSettings: user?.sourceSettings,
    summaryEnabledSources: summary.enabledSources,
    checkedSources: summary.checkedSources,
    runnerTasks: summary.runnerTasks,
  });
  addCheck("Run source snapshot matches the signed-in pilot settings", proof.enabledSourcesMatch, "exact enabled-source set");
  addCheck("Run includes all three Source Quality v1 sources", proof.requiredSourcesEnabled, SOURCE_QUALITY_PILOT_SOURCES.join(", "));
  for (const source of SOURCE_QUALITY_PILOT_SOURCES) {
    addCheck(`Run records explicit ${source} diagnostics`, proof.diagnostics[source], proof.diagnostics[source] ? "present" : "missing");
  }
  const tasks = Array.isArray(summary.runnerTasks) ? summary.runnerTasks : [];
  for (const source of ["carsandbids", "hemmings"]) {
    const ids = tasks.filter((task) => String(task?.source || "").toLowerCase() === source).map((task) => task?.id).filter(Boolean);
    addCheck(
      requireMerges ? `${source} runner reached an accepted terminal merge result` : `${source} runner handoff is recorded`,
      requireMerges ? proof.runnerMerges[source] : proof.runnerHandoffs[source],
      ids.length ? ids.join(", ") : "missing task id",
    );
  }
  return proof;
}

async function verifyDeckImage(listings) {
  const imageUrl = sameOriginDeckImageUrl(listings, baseUrl);
  if (!imageUrl) {
    addCheck("Beachcar deck image is served and cached", false, "No same-origin /api/images/ URL was published.");
    return;
  }
  const imageTarget = new URL(imageUrl);
  imageTarget.searchParams.set("variant", "deck");
  const firstImage = await fetchTarget(imageTarget, {}, 3);
  const firstBytes = await firstImage.arrayBuffer();
  const secondImage = await fetchTarget(imageTarget, {}, 3);
  const secondBytes = await secondImage.arrayBuffer();
  const ok =
    firstImage.ok &&
    secondImage.ok &&
    firstBytes.byteLength > 0 &&
    secondBytes.byteLength > 0 &&
    (firstImage.headers.get("content-type") || "").startsWith("image/") &&
    (secondImage.headers.get("content-type") || "").startsWith("image/") &&
    firstImage.headers.get("X-Beachcar-Image-Variant") === "deck" &&
    secondImage.headers.get("X-Beachcar-Image-Variant") === "deck" &&
    secondImage.headers.get("X-Beachcar-Image-Cache") === "hit" &&
    (secondImage.headers.get("cache-control") || "").includes("immutable");
  addCheck(
    "Beachcar deck image is served and cached",
    ok,
    `HTTP ${firstImage.status}/${secondImage.status}; ${firstBytes.byteLength}/${secondBytes.byteLength} bytes; second cache ${secondImage.headers.get("X-Beachcar-Image-Cache") || "missing"}`,
  );
}

async function verifySignedInDom(listings, expectedRun) {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('section[aria-label="Run status"]', { timeout: 60_000 });
  const titles = listings.map((listing) => (typeof listing?.title === "string" ? listing.title : "")).filter(Boolean);
  await page.waitForFunction(
    (expectedTitles) => expectedTitles.some((title) => document.body.innerText.includes(title)),
    titles,
    { timeout: 60_000 },
  );
  addCheck("Signed-in app renders a listing from the expected published run", true, "expected listing visible");

  await page.locator('section[aria-label="Run status"] button.run-status-main').click();
  const dialog = page.locator('[aria-label="Run detail"]');
  await dialog.waitFor({ state: "visible", timeout: 30_000 });
  const renderedRun = await dialog.locator(".run-detail-sheet").evaluate((element) => ({
    agentRunId: element.getAttribute("data-agent-run-id") || "",
    workflowInstanceId: element.getAttribute("data-workflow-instance-id") || "",
    publishedRunId: element.getAttribute("data-published-run-id") || "",
    generatedAt: element.getAttribute("data-run-generated-at") || "",
  }));
  const exactRunRendered =
    renderedRun.agentRunId === expectedRun.agentRunId &&
    renderedRun.workflowInstanceId === expectedRun.workflowInstanceId &&
    renderedRun.publishedRunId === expectedRun.publishedRunId &&
    renderedRun.generatedAt === expectedRun.generatedAt;
  addCheck(
    "Signed-in Run detail is bound to this exact Agent, Workflow, and published run",
    exactRunRendered,
    exactRunRendered ? "all exact ids and generatedAt matched" : "run identity mismatch",
  );
  const detailText = await dialog.innerText();
  const requiredText = ["Run detail", "Sources", "AI", "Runner tasks", "Hemmings"];
  addCheck(
    "Signed-in Run detail renders source, AI, runner, and Hemmings evidence",
    requiredText.every((text) => detailText.includes(text)),
    requiredText.filter((text) => !detailText.includes(text)).join(", ") || "all required sections visible",
  );
}

async function deployedPublishableKeys(shellText) {
  const keys = new Set(extractClerkPublishableKeys(shellText));
  const scriptUrls = [];
  for (const match of shellText.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    const url = new URL(match[1], baseUrl);
    if (url.origin !== baseUrl) continue;
    scriptUrls.push(url.toString());
  }
  for (const url of Array.from(new Set(scriptUrls)).slice(0, 8)) {
    const response = await fetchTarget(url, { headers: { Accept: "text/javascript" } }, 3);
    if (!response.ok) continue;
    for (const key of extractClerkPublishableKeys(await response.text())) keys.add(key);
  }
  return [...keys].sort();
}

function runnerTaskIds(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (typeof entry?.id === "string" ? entry.id : "")).filter(Boolean);
}

function hasRequiredRunnerSettings(settings) {
  if (!Array.isArray(settings)) return false;
  return ["carsandbids", "hemmings"].every((source) => {
    const entry = settings.find((candidate) => String(candidate?.source || "").trim().toLowerCase() === source);
    return entry?.enabled === true && entry?.settings?.browserRunner === true;
  });
}

function newOperation() {
  const id = randomUUID();
  return {
    verificationId: id,
    requestId: id,
    reason: `source-quality-v1-production-verification:${id}`,
  };
}

async function markTicketConsumed() {
  const path = resolve(".env.local");
  const consumedAt = new Date().toISOString();
  const replacements = {
    CLERK_DEV_SIGN_IN_TOKEN: "",
    CLERK_DEV_SIGN_IN_URL: "",
    CLERK_DEV_APP_SIGN_IN_URL: "",
    CLERK_DEV_SIGN_IN_CONSUMED_AT: consumedAt,
  };
  const lines = (await readFile(path, "utf8")).split(/\r?\n/);
  const seen = new Set();
  const next = lines.map((line) => {
    const index = line.indexOf("=");
    const key = index >= 0 ? line.slice(0, index).trim() : "";
    if (!(key in replacements)) return line;
    seen.add(key);
    return `${key}=${JSON.stringify(replacements[key])}`;
  });
  for (const [key, value] of Object.entries(replacements)) {
    if (!seen.has(key)) next.push(`${key}=${JSON.stringify(value)}`);
  }
  await atomicReplacePrivateFile(path, `${next.filter((line, index) => index < next.length - 1 || line).join("\n")}\n`);
  addCheck("Consumed Clerk ticket fields were cleared from the protected env file", true, "token id and pilot identity retained");
}

async function writeCheckpoint(fields) {
  const checkpoint = {
    version: 1,
    baseUrl,
    verificationId,
    requestId,
    reason: verificationReason,
    updatedAt: new Date().toISOString(),
    ...fields,
  };
  await mkdir(dirname(checkpointPath), { recursive: true });
  await writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 });
}

function addCheck(label, ok, detail) {
  report.checks.push({ label, status: ok ? "ok" : "fail", detail });
}

function hasFailures() {
  return report.checks.some((entry) => entry.status === "fail");
}

function value(name) {
  return String(env[name] || "").trim();
}

function hasFlag(name) {
  return args.includes(name);
}

function valueArg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "").trim() : "";
}

function numberArg(name, fallback) {
  const current = Number(valueArg(name));
  return Number.isFinite(current) && current > 0 ? current : fallback;
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function loadEnvFile(path) {
  try {
    const text = await readFile(path, "utf8");
    return Object.fromEntries(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
        }),
    );
  } catch {
    return {};
  }
}

function printReport() {
  console.log(`Beachcar managed production verification (${report.mode})`);
  console.log(`Target: ${report.baseUrl}`);
  console.log(`Request: ${report.requestId}\n`);
  for (const entry of report.checks) console.log(`${entry.status === "ok" ? "OK" : "FAIL"} ${entry.label}: ${entry.detail}`);
  if (report.error) console.log(`\nFAIL ${report.error}`);
}

function printHelp() {
  console.log(`Beachcar managed production verifier

Exchanges the protected Clerk sign-in ticket in .env.local inside an ephemeral
browser without printing or persisting the ticket or bearer token. A ticket
stored for the exact trusted legacy Worker is extracted in memory and redeemed
only on BEACHCAR_DEPLOY_URL.

All public/admin gates run before ticket exchange. The verifier then queues one
UUID-idempotent managed Workflow request, follows its exact Agent/run ids, proves
accepted terminal C&B/Hemmings results, the three-source shortlist, same-origin
image cache, active managed_research entitlement, required AI Gateway scoring,
and healthy budget, then synchronizes and reads
back the daily schedule last.

  bun scripts/verify-managed-production.mjs --execute --yes

Options:
  --execute                    Required; queues one real idempotent managed run.
  --yes                        Required acknowledgement of production effects.
  --url <origin>               Must exactly match BEACHCAR_DEPLOY_URL.
  --configure-pilot            Select managed research + repair required source settings.
                                Clerk must already grant managed_research.
  --require-runner-merge       Explicitly require the default terminal runner gate.
  --allow-runner-handoff-only  Diagnostic only: accept queued/running runner handoffs.
                                This is not valid release evidence.
  --timeout-ms <number>        Workflow polling timeout (default: 300000).
  --runner-timeout-ms <number> Runner merge timeout (defaults to --timeout-ms).
  --json                       Emit a machine-readable, credential-redacted report.

The non-secret evidence checkpoint is .tmp/managed-production-verification.json.
Runner task ids are included in the report/checkpoint for targeted execution.
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
