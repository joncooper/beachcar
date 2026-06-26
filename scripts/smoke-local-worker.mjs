#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

await loadEnvFile(resolve(".dev.vars"));
await loadEnvFile(resolve(".publish.env"));

const baseUrl = (process.env.AUCTION_WATCH_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");
const publishToken = process.env.PUBLISH_TOKEN || "";
const smokeEmail = (process.env.SMOKE_TEST_EMAIL || process.env.ALLOWED_EMAIL || "you@example.com").trim().toLowerCase();
const pollAttempts = numberFromEnv("SMOKE_WORKFLOW_POLLS", 60);
const pollDelayMs = numberFromEnv("SMOKE_WORKFLOW_POLL_MS", 300);

if (!publishToken) {
  fail("Set PUBLISH_TOKEN in the environment, .dev.vars, or .publish.env before running the local Worker smoke test.");
}

if (!smokeEmail || !smokeEmail.includes("@")) {
  fail("Set SMOKE_TEST_EMAIL or ALLOWED_EMAIL to a valid local smoke-test email.");
}

const me = await requestJson("/api/me");
assert(me.email === smokeEmail, `Expected /api/me email ${smokeEmail}; received ${me.email || "(missing)"}`);
assert(me.status === "active", `Expected ${smokeEmail} to be active. Set ALLOWED_EMAIL=${smokeEmail} for local smoke tests.`);

const profilePayload = {
  displayName: "Local Smoke Owner",
  niche: "Beach cars and runabouts",
  budgetMax: 30000,
  stretchBudget: 2000,
  homeRegion: "Northeast",
  timezone: "America/New_York",
  scheduleCron: "0 8 * * *",
  profile: {
    tasteNotes: "workflow smoke likes simple beach-town cars",
    avoidNotes: "rust and salvage",
    lanes: ["family", "solo", "curiosity"],
    sources: ["bringatrailer", "carsandbids"],
    sourcePreferences: [
      {
        source: "bringatrailer",
        enabled: true,
        settings: { maxDistanceMiles: 750, maxBudgetCents: 3200000, noReserveOnly: false, browserRunner: false },
      },
      {
        source: "carsandbids",
        enabled: true,
        settings: { maxDistanceMiles: 750, maxBudgetCents: 3200000, noReserveOnly: false, browserRunner: true },
      },
    ],
    notifications: {
      channel: "email",
      runDigest: true,
      strongFitAlerts: true,
      digestTime: "08:00",
    },
  },
  completeOnboarding: true,
};
const profiled = await requestJson("/api/profile", { method: "PUT", body: profilePayload });
assert(profiled.onboarding?.completed === true, "Expected profile save to complete onboarding.");
const ownerSources = await requestJson("/api/source-settings", {
  method: "PUT",
  body: {
    sources: [
      {
        source: "bringatrailer",
        enabled: true,
        settings: { maxDistanceMiles: 750, maxBudgetCents: 3200000, noReserveOnly: false, browserRunner: false, searchNotes: "Thing, Samurai" },
      },
      {
        source: "carsandbids",
        enabled: true,
        settings: { maxDistanceMiles: 750, maxBudgetCents: 3200000, noReserveOnly: false, browserRunner: true, searchNotes: "small 4x4" },
      },
      { source: "marketplace", enabled: false, settings: { maxDistanceMiles: 150, browserRunner: true } },
    ],
  },
});
assert(ownerSources.sourceSettings?.some((setting) => setting.source === "bringatrailer" && setting.enabled), "Expected owner source settings to save.");
assert(
  ownerSources.profile?.profile?.notifications?.strongFitAlerts === true,
  "Expected owner notification preferences to round-trip through the profile.",
);
assert(
  ownerSources.sourceSettings?.some((setting) => setting.source === "carsandbids" && setting.settings?.browserRunner === true),
  "Expected Cars & Bids browser-runner preference to round-trip.",
);

const managed = await requestJson("/api/ai-settings", {
  method: "PUT",
  body: { mode: "managed", dailyBudgetCents: 300, monthlyBudgetCents: 3000 },
});
assert(managed.aiSettings?.mode === "managed", "Expected managed AI settings to save.");

const rawKeyResponse = await rawRequest("/api/ai-settings", {
  method: "PUT",
  body: { mode: "byok", gatewayKeyRef: "sk-proj-local-smoke-not-real", dailyBudgetCents: 300, monthlyBudgetCents: 3000 },
});
assert(rawKeyResponse.status === 400, `Expected raw provider key rejection; received HTTP ${rawKeyResponse.status}.`);
assert(
  typeof rawKeyResponse.body?.error === "string" && rawKeyResponse.body.error.includes("AI Gateway BYOK"),
  "Expected raw provider key rejection to direct users to AI Gateway BYOK.",
);

const byok = await requestJson("/api/ai-settings", {
  method: "PUT",
  body: { mode: "byok", gatewayKeyRef: "gateway-key-ref-local-smoke", dailyBudgetCents: 300, monthlyBudgetCents: 3000 },
});
assert(byok.aiSettings?.mode === "byok", "Expected BYOK AI settings to save.");
assert(byok.aiSettings?.gatewayKeyRef === "gateway-key-ref-local-smoke", "Expected BYOK gateway reference to round-trip.");

const agentRun = await requestJson("/api/agent-runs", {
  method: "POST",
  body: { reason: `local smoke workflow ${new Date().toISOString()}` },
});
assert(agentRun.id, "Expected manual agent run to return an id.");
assert(agentRun.workflowInstanceId, "Expected manual agent run to start a Cloudflare Workflow instance.");

const published = await pollLatestAgentRun(agentRun.id);
assert(published.status === "published", `Expected agent run ${agentRun.id} to publish; received ${published.status}.`);
assert(published.workflowInstanceId, "Expected published agent run to retain a Workflow instance id.");
assert(published.progress?.handoff === "cloudflare_workflow", "Expected agent run progress handoff to be cloudflare_workflow.");
assert(typeof published.progress?.publishedRunId === "string", "Expected published run id in agent run progress.");

const latestRun = await requestJson("/api/runs/latest");
assert(latestRun.id === published.progress.publishedRunId, "Expected /api/runs/latest to return the Workflow-published run.");
assert(Array.isArray(latestRun.listings) && latestRun.listings.length > 0, "Expected Workflow-published run to include listings.");
assert(
  latestRun.sourceSummary?.publisher === "cloudflare-workflow-source-discovery",
  "Expected latest run to identify the Cloudflare Workflow source-discovery publisher.",
);
assert(
  Array.isArray(latestRun.sourceSummary?.checkedSources) &&
    latestRun.sourceSummary.checkedSources.some((check) => check.source === "bringatrailer"),
  "Expected latest run source summary to include Bring a Trailer source checks.",
);
assert(
  Array.isArray(latestRun.sourceSummary?.runnerTasks) &&
    latestRun.sourceSummary.runnerTasks.some((task) => task.source === "carsandbids" && task.status === "queued"),
  "Expected blocked Cars & Bids source to create a queued runner task.",
);
const nextRunnerTask = await requestJson("/api/admin/runner-tasks/next", { admin: true });
assert(nextRunnerTask.task?.source === "carsandbids", "Expected the next runner task to target Cars & Bids.");
const claimedRunnerTask = await requestJson("/api/admin/runner-tasks/claim", {
  admin: true,
  method: "POST",
  body: { runnerId: "local-smoke-container-runner" },
});
assert(claimedRunnerTask.task?.status === "running", "Expected runner task claim to mark the task running.");
assert(claimedRunnerTask.task?.agentRunId === agentRun.id, "Expected runner task to remain linked to the owner agent run.");
assert(claimedRunnerTask.task?.input?.sourceSettings?.browserRunner === true, "Expected runner task input to include source-specific settings.");
const completedRunnerTask = await requestJson(`/api/admin/runner-tasks/${encodeURIComponent(claimedRunnerTask.task.id)}/complete`, {
  admin: true,
  method: "POST",
  body: {
    runnerId: "local-smoke-container-runner",
    result: {
      runtime: "local-smoke",
      status: "blocked_without_browser_session",
      normalizedCandidates: [],
    },
    aiUsage: {
      provider: "local-simulator",
      model: "none",
      operation: "runner_task:browser_source",
      status: "cached",
      costMicros: 0,
      metadata: { smoke: true },
    },
  },
});
assert(completedRunnerTask.task?.status === "completed", "Expected runner task completion to persist.");
const firstDeckImage = latestRun.listings.find((listing) => Array.isArray(listing.images) && listing.images[0]?.startsWith("/api/images/"))?.images?.[0];
assert(firstDeckImage, "Expected Workflow-published source listings to use local image variant URLs.");
const warmedImage = await rawBinaryRequest(firstDeckImage);
assert(warmedImage.status === 200, `Expected prewarmed deck image to return 200; received HTTP ${warmedImage.status}.`);
assert(warmedImage.headers.get("x-beachcar-image-variant") === "deck", "Expected image response to identify the deck variant.");
assert(warmedImage.headers.get("x-beachcar-image-cache") === "hit", "Expected image response to be served from prewarmed variant cache.");
assert(warmedImage.byteLength > 0, "Expected prewarmed deck image response to include bytes.");

const next = await requestJson("/api/admin/agent-runs/next", { admin: true });
assert(next.agentRun === null, "Expected no queued fallback agent run after Workflow completion.");

const deletedFriend = await smokeAccountExportAndDeletion();

console.log(`Local Worker smoke passed for ${smokeEmail}.`);
console.log(`Agent run: ${published.id}; Workflow: ${published.workflowInstanceId}; published run: ${latestRun.id}.`);
console.log(`Listings: ${latestRun.listings.length}; AI mode: ${byok.aiSettings.mode}.`);
console.log(`Export/delete: ${deletedFriend.email}; deleted runs: ${deletedFriend.deleted.runs}.`);

async function smokeAccountExportAndDeletion() {
  const friendEmail = `smoke-${Date.now()}@example.com`;
  const invite = await requestJson("/api/admin/invites", {
    admin: true,
    method: "POST",
    body: { email: friendEmail },
  });

  const accepted = await requestJson("/api/invites/accept", {
    email: friendEmail,
    method: "POST",
    body: { code: invite.code },
  });
  assert(accepted.status === "active", "Expected invited smoke friend to become active.");

  await requestJson("/api/profile", {
    email: friendEmail,
    method: "PUT",
    body: {
      displayName: "Export Delete Smoke",
      niche: "Beach cars and runabouts",
      budgetMax: 18000,
      stretchBudget: 1000,
      homeRegion: "Northeast",
      timezone: "America/New_York",
      scheduleCron: "0 9 * * *",
      profile: {
        tasteNotes: "temporary export smoke account",
        avoidNotes: "temporary delete smoke account",
        lanes: ["family", "solo"],
        sources: ["bringatrailer"],
        sourcePreferences: [
          {
            source: "bringatrailer",
            enabled: true,
            settings: { maxDistanceMiles: 500, maxBudgetCents: 1900000, noReserveOnly: true, browserRunner: false },
          },
        ],
        notifications: {
          channel: "email",
          runDigest: true,
          strongFitAlerts: false,
          digestTime: "09:00",
        },
      },
      completeOnboarding: true,
    },
  });
  await requestJson("/api/source-settings", {
    email: friendEmail,
    method: "PUT",
  body: {
    sources: [
        { source: "bringatrailer", enabled: true, settings: { maxDistanceMiles: 500, maxBudgetCents: 1900000, noReserveOnly: true, browserRunner: false } },
        { source: "carsandbids", enabled: false, settings: { maxDistanceMiles: 500, browserRunner: true } },
        { source: "marketplace", enabled: false, settings: { maxDistanceMiles: 100, browserRunner: true } },
      ],
    },
  });
  await requestJson("/api/ai-settings", {
    email: friendEmail,
    method: "PUT",
    body: { mode: "managed", dailyBudgetCents: 150, monthlyBudgetCents: 1200 },
  });
  const usage = await requestJson("/api/admin/ai-usage", {
    admin: true,
    method: "POST",
    body: {
      userId: accepted.id,
      provider: "openai",
      model: "gpt-5-mini",
      operation: "local-smoke-model-call",
      mode: "managed",
      gatewayId: "local-smoke-gateway",
      gatewayRequestId: `local-smoke-${Date.now()}`,
      inputTokens: 1000,
      outputTokens: 250,
      costCents: 17,
      metadata: { smoke: true },
    },
  });
  assert(usage.event?.costMicros === 170000, "Expected AI usage ingestion to store cost in micros.");
  assert(usage.summary?.daily?.spendMicros >= 170000, "Expected AI usage ingestion to update the daily summary.");
  assert(usage.summary?.budgetExceeded === false, "Expected temporary friend AI budget to remain available.");

  const usageReadback = await requestJson("/api/ai-usage", { email: friendEmail });
  assert(usageReadback.summary?.daily?.spendMicros >= 170000, "Expected friend AI usage summary to be readable.");
  assert(Array.isArray(usageReadback.events) && usageReadback.events.some((event) => event.gatewayId === "local-smoke-gateway"), "Expected friend AI usage events to round-trip.");

  await requestJson("/api/ai-settings", {
    email: friendEmail,
    method: "PUT",
    body: { mode: "managed", dailyBudgetCents: 10, monthlyBudgetCents: 1200 },
  });
  const cappedFriend = await requestJson("/api/me", { email: friendEmail });
  assert(cappedFriend.aiUsage?.budgetExceeded === true, "Expected friend to show AI budget exceeded after lowering the daily cap.");
  assert(cappedFriend.capabilities?.canRunNow === false, "Expected AI budget exhaustion to disable run capability.");
  const cappedRun = await rawRequest("/api/agent-runs", {
    email: friendEmail,
    method: "POST",
    body: { reason: "budget exceeded smoke" },
  });
  assert(cappedRun.status === 402, `Expected budget-exceeded run request to return HTTP 402; received HTTP ${cappedRun.status}.`);
  assert(cappedRun.body?.error === "AI budget exceeded for this user", "Expected budget-exceeded run request to explain the AI cap.");
  await requestJson("/api/ai-settings", {
    email: friendEmail,
    method: "PUT",
    body: { mode: "managed", dailyBudgetCents: 150, monthlyBudgetCents: 1200 },
  });
  const uncappedFriend = await requestJson("/api/me", { email: friendEmail });
  assert(uncappedFriend.aiUsage?.budgetExceeded === false, "Expected friend AI budget to recover after raising the daily cap.");
  assert(uncappedFriend.capabilities?.canRunNow === true, "Expected run capability to recover after raising the daily cap.");

  const friendRun = await requestJson("/api/agent-runs", {
    email: friendEmail,
    method: "POST",
    body: { reason: "account export delete smoke" },
  });
  assert(friendRun.workflowInstanceId, "Expected temporary friend run to start a Workflow.");
  const friendPublished = await pollLatestAgentRun(friendRun.id, friendEmail);
  assert(friendPublished.status === "published", "Expected temporary friend Workflow run to publish.");

  const mcpRun = await smokeRemoteMcp(friendEmail);

  const account = await requestJson("/api/account/export", { email: friendEmail });
  assert(account.kind === "beachcar-account-export", "Expected account export kind.");
  assert(account.user?.email === friendEmail, "Expected account export to include the temporary friend.");
  assert(account.user?.sourceSettings?.some((setting) => setting.source === "bringatrailer" && setting.enabled), "Expected account export to include source settings.");
  assert(
    account.user?.sourceSettings?.some((setting) => setting.source === "bringatrailer" && setting.settings?.noReserveOnly === true),
    "Expected account export to include source-specific settings.",
  );
  assert(account.user?.profile?.profile?.notifications?.digestTime === "09:00", "Expected account export to include notification preferences.");
  assert(account.user?.aiUsage?.daily?.spendMicros >= 170000, "Expected account export user payload to include AI usage summary.");
  assert(Array.isArray(account.aiUsageEvents) && account.aiUsageEvents.some((event) => event.gatewayId === "local-smoke-gateway"), "Expected account export to include AI usage events.");
  assert(Array.isArray(account.aiUsageEvents) && account.aiUsageEvents.some((event) => event.gatewayRequestId === mcpRun.gatewayRequestId), "Expected account export to include MCP-recorded AI usage events.");
  assert(Array.isArray(account.runs) && account.runs.some((run) => run.id === friendPublished.progress.publishedRunId), "Expected account export to include the Workflow-published run.");
  assert(Array.isArray(account.runs) && account.runs.some((run) => run.id === mcpRun.runId), "Expected account export to include the MCP-published run.");
  assert(Array.isArray(account.automationTokens) && account.automationTokens.some((token) => token.id === mcpRun.tokenId && token.revokedAt), "Expected account export to include revoked automation tokens.");
  assert(Array.isArray(account.oauthAccessTokens) && account.oauthAccessTokens.some((token) => token.id === mcpRun.oauthAccessTokenId && token.revokedAt), "Expected account export to include revoked OAuth access tokens.");
  assert(Array.isArray(account.automationEvents) && account.automationEvents.some((event) => event.eventType === "tool.publish_run"), "Expected account export to include automation events.");
  assert(account.feedback?.kind === "auction-watch-feedback", "Expected account export to include feedback export payload.");
  assert(Array.isArray(account.agentRuns) && account.agentRuns.some((run) => run.id === friendRun.id), "Expected account export to include agent run history.");

  const deleted = await requestJson("/api/account", {
    email: friendEmail,
    method: "DELETE",
    body: { confirmEmail: friendEmail },
  });
  assert(deleted.ok === true, "Expected account deletion to return ok.");
  assert(deleted.deleted.profiles >= 1, "Expected account deletion to remove profile data.");
  assert(deleted.deleted.sourceSettings >= 1, "Expected account deletion to remove source settings.");
  assert(deleted.deleted.aiSettings >= 1, "Expected account deletion to remove AI settings.");
  assert(deleted.deleted.aiUsageEvents >= 1, "Expected account deletion to remove AI usage events.");
  assert(deleted.deleted.runs >= 1, "Expected account deletion to remove user-scoped runs.");
  assert(deleted.deleted.agentRuns >= 1, "Expected account deletion to remove agent runs.");
  assert(deleted.deleted.automationTokens >= 1, "Expected account deletion to remove automation tokens.");
  assert(deleted.deleted.oauthAccessTokens >= 1, "Expected account deletion to remove OAuth access tokens.");
  assert(deleted.deleted.automationEvents >= 1, "Expected account deletion to remove automation events.");

  const deletedMe = await requestJson("/api/me", { email: friendEmail });
  assert(deletedMe.status === "disabled", "Expected deleted account to be disabled.");
  const blocked = await rawRequest("/api/runs/latest", { email: friendEmail });
  assert(blocked.status === 403, `Expected deleted account to be blocked from runs; received HTTP ${blocked.status}.`);
  assert(blocked.body?.error === "Account disabled", "Expected deleted account to receive Account disabled.");

  const users = await requestJson("/api/admin/users", { admin: true });
  const deletedUser = users.find((user) => user.email === friendEmail);
  assert(deletedUser?.status === "disabled", "Expected admin users list to show the deleted account as disabled.");

  return { email: friendEmail, deleted: deleted.deleted };
}

async function smokeRemoteMcp(friendEmail) {
  const status = await requestJson("/api/automation/status", { email: friendEmail });
  assert(typeof status.mcpEndpoint === "string" && status.mcpEndpoint.endsWith("/mcp"), "Expected automation status to include the MCP endpoint.");
  assert(
    typeof status.protectedResourceMetadataEndpoint === "string" && status.protectedResourceMetadataEndpoint.endsWith("/.well-known/oauth-protected-resource/mcp"),
    "Expected automation status to include the OAuth protected-resource metadata endpoint.",
  );
  assert(status.oauth?.status === "authorization_code_ready", "Expected automation status to describe OAuth authorization-code readiness.");
  assert(typeof status.oauth?.authorizationServerMetadataEndpoint === "string", "Expected automation status to include the OAuth authorization-server metadata endpoint.");
  assert(typeof status.oauth?.authorizationEndpoint === "string", "Expected automation status to include the OAuth authorization endpoint.");
  assert(typeof status.oauth?.tokenEndpoint === "string", "Expected automation status to include the OAuth token endpoint.");
  assert(typeof status.oauth?.registrationEndpoint === "string", "Expected automation status to include the OAuth registration endpoint.");

  const metadata = await requestJson("/.well-known/oauth-protected-resource/mcp", { email: friendEmail });
  assert(metadata.resource === status.mcpEndpoint, "Expected protected-resource metadata to describe the MCP endpoint as the resource.");
  assert(Array.isArray(metadata.authorization_servers) && metadata.authorization_servers.includes(baseUrl), "Expected protected-resource metadata to advertise this authorization server.");
  assert(Array.isArray(metadata.scopes_supported) && metadata.scopes_supported.includes("runs:publish"), "Expected protected-resource metadata to list MCP scopes.");
  assert(Array.isArray(metadata.bearer_methods_supported) && metadata.bearer_methods_supported.includes("header"), "Expected metadata to advertise header bearer tokens.");
  const authServer = await requestJson("/.well-known/oauth-authorization-server", { email: friendEmail });
  assert(authServer.authorization_endpoint === `${baseUrl}/oauth/authorize`, "Expected authorization-server metadata to advertise the authorization endpoint.");
  assert(authServer.token_endpoint === `${baseUrl}/oauth/token`, "Expected authorization-server metadata to advertise the token endpoint.");
  assert(Array.isArray(authServer.code_challenge_methods_supported) && authServer.code_challenge_methods_supported.includes("S256"), "Expected authorization-server metadata to advertise S256 PKCE support.");

  const unauthorized = await rawRequest("/mcp", {
    method: "POST",
    body: { jsonrpc: "2.0", id: "smoke-unauthorized", method: "tools/list" },
  });
  const challenge = unauthorized.headers.get("www-authenticate") || "";
  assert(unauthorized.status === 401, `Expected unauthenticated MCP request to return HTTP 401; received ${unauthorized.status}.`);
  assert(challenge.includes("resource_metadata="), "Expected unauthenticated MCP response to advertise resource metadata.");
  assert(challenge.includes("/.well-known/oauth-protected-resource/mcp"), "Expected MCP auth challenge to point at the protected-resource metadata endpoint.");

  const oauthRun = await smokeOAuthMcp(friendEmail, status.mcpEndpoint);

  const created = await requestJson("/api/automation/tokens", {
    email: friendEmail,
    method: "POST",
    body: { label: "Local smoke cloud agent" },
  });
  assert(created.token?.startsWith("bcauto_"), "Expected automation token secret to be returned once.");
  assert(created.record?.id, "Expected automation token creation to return a redacted record.");

  const tools = await mcpRequest(created.token, "tools/list");
  assert(Array.isArray(tools.tools) && tools.tools.some((tool) => tool.name === "publish_run"), "Expected MCP tools/list to expose publish_run.");

  const setup = await mcpTool(created.token, "get_setup_context", {});
  assert(setup.user?.email === friendEmail, "Expected MCP setup context to be scoped to the friend.");
  const batCache = await mcpTool(created.token, "search_bat_cache", { terms: ["samurai"], limit: 5 });
  assert(batCache.mode === "d1_cache", "Expected search_bat_cache to use the D1 source cache.");
  assert(["hit", "miss", "refreshed", "stale_refresh_failed"].includes(batCache.cacheStatus), "Expected search_bat_cache to report cache status.");
  assert(batCache.status?.source === "bringatrailer", "Expected search_bat_cache to return Bring a Trailer cache status.");

  const runId = `mcp-smoke-${Date.now()}`;
  const published = await mcpTool(created.token, "publish_run", {
    runId,
    reportMarkdown: "Local smoke MCP run.",
    sourceSummary: { smoke: true, source: "remote-mcp-smoke" },
    listings: [
      {
        section: "Strong fits",
        lane: "family",
        site: "Local MCP Smoke",
        title: "Smoke Test Beach Runabout",
        url: `https://example.com/beachcar-mcp-smoke/${runId}`,
        bid: "$10,500",
        total: "$11,025 incl. buyer fee estimate",
        location: "Northeast",
        timeLeft: "manual smoke",
        why: "Exercises remote MCP publish_run without a live source fetch.",
        concerns: "Synthetic smoke listing; do not treat as a real auction.",
        images: [],
      },
    ],
  });
  assert(published.import?.runId === runId, "Expected MCP publish_run to import the requested run id.");
  const latestAfterMcp = await requestJson("/api/runs/latest", { email: friendEmail });
  assert(latestAfterMcp.id === runId, "Expected MCP-published run to become the friend's latest run.");

  const gatewayRequestId = `mcp-smoke-usage-${Date.now()}`;
  const usage = await mcpTool(created.token, "record_usage", {
    provider: "local-smoke",
    model: "none",
    operation: "remote-mcp-smoke",
    status: "cached",
    gatewayRequestId,
    inputTokens: 12,
    outputTokens: 4,
    costMicros: 0,
    metadata: { smoke: true },
  });
  assert(usage.event?.gatewayRequestId === gatewayRequestId, "Expected MCP record_usage to write an AI usage event.");

  const events = await requestJson("/api/automation/events", { email: friendEmail });
  assert(Array.isArray(events.events) && events.events.some((event) => event.eventType === "tool.publish_run"), "Expected automation events to include publish_run.");

  await requestJson(`/api/automation/tokens/${encodeURIComponent(created.record.id)}`, {
    email: friendEmail,
    method: "DELETE",
  });
  const revokedStatus = await requestJson("/api/automation/status", { email: friendEmail });
  assert(revokedStatus.tokens.some((token) => token.id === created.record.id && token.revokedAt), "Expected automation status to show the revoked token.");

  return { runId, tokenId: created.record.id, oauthAccessTokenId: oauthRun.oauthAccessTokenId, gatewayRequestId };
}

async function smokeOAuthMcp(friendEmail, resource) {
  const scope = "setup:read sources:read runs:publish usage:write events:read";
  const redirectUri = "http://127.0.0.1:8787/oauth/callback-smoke";
  const registered = await requestJson("/oauth/register", {
    method: "POST",
    body: {
      client_name: "Local smoke OAuth MCP client",
      redirect_uris: [redirectUri],
      scope,
      token_endpoint_auth_method: "none",
    },
  });
  assert(typeof registered.client_id === "string", "Expected OAuth client registration to return a client_id.");
  const verifier = randomBase64Url(48);
  const challenge = await pkceChallenge(verifier);
  const authorizeUrl = new URL(`${baseUrl}/oauth/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", registered.client_id);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", scope);
  authorizeUrl.searchParams.set("state", "local-smoke-oauth");
  authorizeUrl.searchParams.set("resource", resource);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  const authorize = await fetch(authorizeUrl, {
    headers: { "X-Beachcar-Test-Email": friendEmail },
    redirect: "manual",
  });
  const location = authorize.headers.get("location") || "";
  const redirected = location ? new URL(location) : null;
  const code = redirected?.searchParams.get("code") || "";
  assert(authorize.status === 302 && code, `Expected OAuth authorize to redirect with a code; received HTTP ${authorize.status}.`);
  assert(redirected?.searchParams.get("state") === "local-smoke-oauth", "Expected OAuth authorize to preserve state.");
  const token = await requestJson("/oauth/token", {
    method: "POST",
    body: {
      grant_type: "authorization_code",
      code,
      client_id: registered.client_id,
      redirect_uri: redirectUri,
      resource,
      code_verifier: verifier,
    },
  });
  assert(typeof token.access_token === "string" && token.access_token.startsWith("bcoauth_"), "Expected OAuth token exchange to return a Beachcar OAuth access token.");
  const oauthTools = await mcpRequest(token.access_token, "tools/list");
  assert(Array.isArray(oauthTools.tools) && oauthTools.tools.some((tool) => tool.name === "publish_run"), "Expected OAuth MCP tools/list to expose publish_run.");
  await requestJson("/oauth/revoke", {
    method: "POST",
    body: { token: token.access_token },
  });
  const revoked = await rawRequest("/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${token.access_token}` },
    body: { jsonrpc: "2.0", id: "smoke-oauth-revoked", method: "tools/list" },
  });
  assert(revoked.status === 401, `Expected revoked OAuth access token to be rejected; received HTTP ${revoked.status}.`);
  return { oauthAccessTokenId: token.access_token.match(/^bcoauth_([^.]*)\./)?.[1] || null };
}

async function mcpTool(token, name, args) {
  const result = await mcpRequest(token, "tools/call", { name, arguments: args });
  assert(result && result.isError !== true, `Expected MCP tool ${name} to succeed.`);
  return result.structuredContent;
}

async function mcpRequest(token, method, params = {}) {
  const response = await rawRequest("/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: { jsonrpc: "2.0", id: `smoke-${Date.now()}`, method, params },
  });
  if (response.status < 200 || response.status >= 300 || response.body?.error) {
    fail(`MCP ${method} failed: HTTP ${response.status} ${formatBody(response.body)}`);
  }
  return response.body.result;
}

async function pollLatestAgentRun(expectedId, email = smokeEmail) {
  let last = null;
  for (let attempt = 1; attempt <= pollAttempts; attempt += 1) {
    last = await requestJson("/api/agent-runs/latest", { email });
    if (last?.id === expectedId && (last.status === "published" || last.status === "failed")) return last;
    await delay(pollDelayMs);
  }
  fail(`Timed out waiting for agent run ${expectedId} to finish. Last response: ${JSON.stringify(last)}`);
}

async function requestJson(path, options = {}) {
  const response = await rawRequest(path, options);
  if (response.status < 200 || response.status >= 300) {
    fail(`${options.method || "GET"} ${path} failed: HTTP ${response.status} ${formatBody(response.body)}`);
  }
  return response.body;
}

async function rawRequest(path, options = {}) {
  const email = options.email || smokeEmail;
  const headers = {
    Accept: "application/json",
    ...(options.admin ? { "X-Publish-Token": publishToken } : { "X-Beachcar-Test-Email": email }),
    ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(options.headers || {}),
  };
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, headers: response.headers, body: await readResponse(response) };
}

async function rawBinaryRequest(path, options = {}) {
  const email = options.email || smokeEmail;
  const response = await fetch(new URL(path, baseUrl), {
    method: options.method || "GET",
    headers: {
      ...(options.admin ? { "X-Publish-Token": publishToken } : { "X-Beachcar-Test-Email": email }),
      ...(options.headers || {}),
    },
  });
  const body = await response.arrayBuffer();
  return { status: response.status, headers: response.headers, byteLength: body.byteLength };
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function loadEnvFile(path) {
  const text = await readOptional(path);
  if (!text) return;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals < 1) continue;
    const key = trimmed.slice(0, equals).trim();
    const value = unquote(trimmed.slice(equals + 1).trim());
    if (!process.env[key]) process.env[key] = value;
  }
}

async function readResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  return response.text();
}

function numberFromEnv(key, fallback) {
  const parsed = Number(process.env[key] || "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function formatBody(body) {
  return typeof body === "string" ? body.slice(0, 500) : JSON.stringify(body).slice(0, 500);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
