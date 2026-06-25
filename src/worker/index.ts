import { getAgentByName } from "agents";
import { getContainer } from "@cloudflare/containers";
import type { UserProfile } from "../shared/types";
import type { ImportPayload } from "../shared/types";
import { AuthError, requirePublisher, requireUser, userIdForEmail } from "./auth";
import {
  acceptInvite,
  assertAiBudgetAvailable,
  createAutomationToken,
  claimAgentRun,
  claimNextAgentRun,
  claimRunnerTask,
  completeRunnerTask,
  createInvite,
  deleteAccountData,
  deleteFeedback,
  ensureUser,
  exportAccount,
  exportFeedback,
  defaultAutomationScopes,
  getAiUsageEvents,
  getAiUsageSummary,
  getAgentRunById,
  getAutomationEvents,
  getFeedback,
  getLatestAgentRun,
  getLatestRun,
  getNextQueuedAgentRun,
  getNextRunnerTask,
  getRunnerTaskById,
  getSourceCacheStatus,
  getUserPayload,
  importRun,
  listAdminUsers,
  failRunnerTask,
  markAgentRunFailed,
  markAgentRunPublished,
  listAutomationTokens,
  recordAiUsageEvent,
  recordAutomationEvent,
  createPreferenceEvent,
  revokeAutomationToken,
  type UserScope,
  upsertAiSettings,
  upsertProfile,
  upsertSourceSettings,
  upsertFeedback,
} from "./db";
import { errorResponse, jsonResponse, readJson } from "./http";
import { mirrorImage, prewarmImportedImages, serveImage, uploadImage } from "./image-cache";
import { automationBundleMarkdown } from "./automation-bundle";
import { handleMcpRequest } from "./mcp";
import { ingestBringATrailerRssCache } from "./source-cache";
export { BeachcarAgent } from "./agents/beachcar-agent";
export { BeachcarRunnerContainer } from "./containers/beachcar-runner-container";
export { BeachcarRunWorkflow } from "./workflows/beachcar-run-workflow";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/mcp") {
        return await handleMcpRequest(request, env, ctx);
      }
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, env, ctx, url);
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof AuthError) return errorResponse(error.message, error.status);
      const message = error instanceof Error ? error.message : "Unexpected error";
      console.error(JSON.stringify({ level: "error", message, path: url.pathname }));
      return errorResponse(message, 500);
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(refreshScheduledSourceCaches(env, event.cron));
  },
};

async function handleApi(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const imageMatch = url.pathname.match(/^\/api\/images\/([^/]+)$/);
  if (imageMatch && request.method === "GET") {
    return serveImage(env, decodeURIComponent(imageMatch[1]), url);
  }

  if (url.pathname.startsWith("/api/admin/")) {
    await requirePublisher(request, env);
    return handleAdmin(request, env, ctx, url);
  }

  const authUser = await requireUser(request, env);
  const userPayload = await ensureUser(env.DB, authUser, { isOwner: isBootstrapOwner(authUser, env) });
  const scope = scopeForUser(authUser, env);

  if (request.method === "GET" && url.pathname === "/api/me") {
    return jsonResponse(userPayload);
  }

  if (request.method === "POST" && url.pathname === "/api/invites/accept") {
    const body = await readJson<{ code?: unknown }>(request);
    return jsonResponse(await acceptInvite(env.DB, authUser, body.code));
  }

  requireActiveUser(userPayload);

  if (request.method === "PUT" && url.pathname === "/api/profile") {
    const body = await readJson<{
      displayName?: unknown;
      niche?: unknown;
      budgetMin?: unknown;
      budgetMax?: unknown;
      stretchBudget?: unknown;
      homeRegion?: unknown;
      timezone?: unknown;
      scheduleCron?: unknown;
      profile?: unknown;
      completeOnboarding?: unknown;
    }>(request);
    const profile = await upsertProfile(env.DB, authUser.id, body);
    await syncUserAgentSchedule(env, authUser.id, profile);
    return jsonResponse(await getUserPayload(env.DB, authUser.id));
  }

  if (request.method === "PUT" && url.pathname === "/api/ai-settings") {
    const body = await readJson<{
      mode?: unknown;
      gatewayKeyRef?: unknown;
      monthlyBudgetCents?: unknown;
      dailyBudgetCents?: unknown;
    }>(request);
    try {
      await upsertAiSettings(env.DB, authUser.id, body);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : "Could not save AI settings", 400);
    }
    return jsonResponse(await getUserPayload(env.DB, authUser.id));
  }

  if (request.method === "PUT" && url.pathname === "/api/source-settings") {
    const body = await readJson<{ sources?: unknown }>(request);
    await upsertSourceSettings(env.DB, authUser.id, body);
    return jsonResponse(await getUserPayload(env.DB, authUser.id));
  }

  if (request.method === "GET" && url.pathname === "/api/account/export") {
    return jsonResponse(await exportAccount(env.DB, scope));
  }

  if (request.method === "GET" && url.pathname === "/api/ai-usage") {
    return jsonResponse({
      summary: await getAiUsageSummary(env.DB, authUser.id),
      events: await getAiUsageEvents(env.DB, authUser.id, limitFromUrl(url, 50)),
    });
  }

  if (request.method === "GET" && url.pathname === "/api/automation/status") {
    return jsonResponse({
      ...automationEndpoints(request),
      oauth: {
        status: "planned",
        message: "Remote MCP OAuth is the target production handshake; this preview uses revocable scoped automation tokens.",
      },
      defaultScopes: defaultAutomationScopes,
      tokens: await listAutomationTokens(env.DB, authUser.id),
      recentEvents: await getAutomationEvents(env.DB, authUser.id, 20),
    });
  }

  if (request.method === "POST" && url.pathname === "/api/automation/tokens") {
    const body = await readJson<{ label?: unknown; scopes?: unknown }>(request);
    const created = await createAutomationToken(env.DB, { userId: authUser.id, label: body.label, scopes: body.scopes });
    await recordAutomationEvent(env.DB, {
      userId: authUser.id,
      tokenId: created.record.id,
      actor: "user",
      eventType: "automation_token.created",
      metadata: { label: created.record.label, scopes: created.record.scopes },
    });
    return jsonResponse(created, { status: 201 });
  }

  const automationTokenMatch = url.pathname.match(/^\/api\/automation\/tokens\/([^/]+)$/);
  if (automationTokenMatch && request.method === "DELETE") {
    const token = await revokeAutomationToken(env.DB, authUser.id, decodeURIComponent(automationTokenMatch[1]));
    await recordAutomationEvent(env.DB, {
      userId: authUser.id,
      tokenId: token.id,
      actor: "user",
      eventType: "automation_token.revoked",
      metadata: { label: token.label },
    });
    return jsonResponse(token);
  }

  if (request.method === "GET" && url.pathname === "/api/automation/events") {
    return jsonResponse({ events: await getAutomationEvents(env.DB, authUser.id, limitFromUrl(url, 50)) });
  }

  if (request.method === "GET" && url.pathname === "/api/automation/bundle") {
    const endpoints = automationEndpoints(request);
    return jsonResponse({
      filename: "beachcar-daily-run.SKILL.md",
      contentType: "text/markdown",
      mcpEndpoint: endpoints.mcpEndpoint,
      markdown: automationBundleMarkdown(endpoints.mcpEndpoint),
    });
  }

  if (request.method === "DELETE" && url.pathname === "/api/account") {
    const body = await readJson<{ confirmEmail?: unknown }>(request);
    const confirmEmail = typeof body.confirmEmail === "string" ? body.confirmEmail.trim().toLowerCase() : "";
    if (confirmEmail !== authUser.email.toLowerCase()) return errorResponse("Email confirmation does not match this account", 400);
    return jsonResponse(await deleteAccountData(env.DB, authUser.id));
  }

  if (request.method === "GET" && url.pathname === "/api/runs/latest") {
    const run = await getLatestRun(env.DB, scope);
    if (!run) return jsonResponse({ id: null, generatedAt: null, listings: [], feedback: [] });
    return jsonResponse(run);
  }

  if (request.method === "GET" && url.pathname === "/api/agent-runs/latest") {
    return jsonResponse(await getLatestAgentRun(env.DB, authUser.id));
  }

  if (request.method === "POST" && url.pathname === "/api/agent-runs") {
    const body = await readJson<{ reason?: unknown }>(request);
    try {
      await assertAiBudgetAvailable(env.DB, authUser.id);
      const agent = await getBeachcarAgent(env, authUser.id);
      return jsonResponse(await agent.queueManualRun({ userId: authUser.id, reason: body.reason }), { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("AI budget exceeded")) return errorResponse(message, 402);
      throw error;
    }
  }

  if (request.method === "GET" && url.pathname === "/api/feedback") {
    return jsonResponse(await getFeedback(env.DB, scope));
  }

  if (request.method === "GET" && url.pathname === "/api/feedback/export") {
    return jsonResponse(await exportFeedback(env.DB, scope));
  }

  if (request.method === "POST" && url.pathname === "/api/preference-events") {
    const body = await readJson<{ listingKey?: unknown; eventType?: unknown; note?: unknown; transcript?: unknown; tags?: unknown }>(request);
    return jsonResponse(await createPreferenceEvent(env.DB, scope, body), { status: 201 });
  }

  const feedbackMatch = url.pathname.match(/^\/api\/feedback\/([^/]+)$/);
  if (feedbackMatch && request.method === "PUT") {
    const body = await readJson<{ action: unknown; note?: unknown; tags?: unknown }>(request);
    return jsonResponse(await upsertFeedback(env.DB, scope, decodeURIComponent(feedbackMatch[1]), body));
  }
  if (feedbackMatch && request.method === "DELETE") {
    await deleteFeedback(env.DB, scope, decodeURIComponent(feedbackMatch[1]));
    return jsonResponse({ ok: true });
  }

  return errorResponse("Not found", 404);
}

async function handleAdmin(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  if (request.method === "POST" && url.pathname === "/api/admin/invites") {
    const body = await readJson<{ email?: unknown; expiresAt?: unknown }>(request);
    return jsonResponse(await createInvite(env.DB, body), { status: 201 });
  }

  if (request.method === "GET" && url.pathname === "/api/admin/users") {
    return jsonResponse(await listAdminUsers(env.DB));
  }

  if (request.method === "GET" && url.pathname === "/api/admin/source-cache/status") {
    return jsonResponse({ sources: { bringatrailer: await getSourceCacheStatus(env.DB, "bringatrailer") } });
  }

  if (request.method === "POST" && url.pathname === "/api/admin/source-cache/ingest") {
    return jsonResponse({ source: "bringatrailer", ingestion: await ingestBringATrailerRssCache(env.DB) }, { status: 201 });
  }

  if (request.method === "GET" && url.pathname === "/api/admin/runner-tasks/next") {
    const task = await getRunnerTaskById(env.DB, url.searchParams.get("taskId") || "");
    if (task) return jsonResponse({ task });
    return jsonResponse({ task: await getNextRunnerTask(env.DB, url.searchParams.get("agentRunId")) });
  }

  if (request.method === "POST" && url.pathname === "/api/admin/runner-tasks/claim") {
    const body = await readJson<{ taskId?: unknown; agentRunId?: unknown; runnerId?: unknown }>(request);
    return jsonResponse({ task: await claimRunnerTask(env.DB, body) });
  }

  const runnerTaskContainerMatch = url.pathname.match(/^\/api\/admin\/runner-tasks\/([^/]+)\/run-container$/);
  if (runnerTaskContainerMatch && request.method === "POST") {
    try {
      return jsonResponse(await runRunnerTaskInContainer(env, decodeURIComponent(runnerTaskContainerMatch[1])));
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : "Container runner failed", 500);
    }
  }

  const runnerTaskCompleteMatch = url.pathname.match(/^\/api\/admin\/runner-tasks\/([^/]+)\/complete$/);
  if (runnerTaskCompleteMatch && request.method === "POST") {
    const body = await readJson<{
      runnerId?: unknown;
      result?: unknown;
      aiUsage?: {
        provider?: unknown;
        model?: unknown;
        operation?: unknown;
        mode?: unknown;
        gatewayId?: unknown;
        gatewayKeyRef?: unknown;
        gatewayRequestId?: unknown;
        inputTokens?: unknown;
        outputTokens?: unknown;
        totalTokens?: unknown;
        costMicros?: unknown;
        costCents?: unknown;
        status?: unknown;
        metadata?: unknown;
        occurredAt?: unknown;
      };
    }>(request);
    const task = await completeRunnerTask(env.DB, decodeURIComponent(runnerTaskCompleteMatch[1]), body);
    if (body.aiUsage) {
      await recordAiUsageEvent(env.DB, {
        ...body.aiUsage,
        userId: task.userId,
        agentRunId: task.agentRunId,
        operation: body.aiUsage.operation || `runner_task:${task.kind}`,
      });
    }
    return jsonResponse({ task });
  }

  const runnerTaskFailMatch = url.pathname.match(/^\/api\/admin\/runner-tasks\/([^/]+)\/fail$/);
  if (runnerTaskFailMatch && request.method === "POST") {
    const body = await readJson<{ error?: unknown; runnerId?: unknown }>(request);
    return jsonResponse({ task: await failRunnerTask(env.DB, decodeURIComponent(runnerTaskFailMatch[1]), body) });
  }

  if (request.method === "POST" && url.pathname === "/api/admin/ai-usage") {
    const body = await readJson<{
      userId?: unknown;
      agentRunId?: unknown;
      provider?: unknown;
      model?: unknown;
      operation?: unknown;
      mode?: unknown;
      gatewayId?: unknown;
      gatewayKeyRef?: unknown;
      gatewayRequestId?: unknown;
      inputTokens?: unknown;
      outputTokens?: unknown;
      totalTokens?: unknown;
      costMicros?: unknown;
      costCents?: unknown;
      status?: unknown;
      metadata?: unknown;
      occurredAt?: unknown;
    }>(request);
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    if (!userId) return errorResponse("userId is required", 400);
    const event = await recordAiUsageEvent(env.DB, { ...body, userId });
    return jsonResponse({ event, summary: await getAiUsageSummary(env.DB, userId) }, { status: 201 });
  }

  const adminAiUsageMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/ai-usage$/);
  if (adminAiUsageMatch && request.method === "GET") {
    const userId = decodeURIComponent(adminAiUsageMatch[1]);
    return jsonResponse({
      summary: await getAiUsageSummary(env.DB, userId),
      events: await getAiUsageEvents(env.DB, userId, limitFromUrl(url, 100)),
    });
  }

  if (request.method === "POST" && url.pathname === "/api/admin/agent-runs/claim") {
    const body = await readJson<{ runId?: unknown; runnerId?: unknown }>(request);
    const runId = typeof body.runId === "string" && body.runId.trim() ? body.runId.trim() : null;
    const agentRun = runId ? await claimAgentRun(env.DB, runId, body) : await claimNextAgentRun(env.DB, body);
    if (!agentRun) return jsonResponse({ agentRun: null });
    await syncAgentRunState(env, agentRun, "running");
    return jsonResponse(await agentRunContext(env, agentRun));
  }

  if (request.method === "GET" && url.pathname === "/api/admin/agent-runs/next") {
    const agentRun = await getAgentRunById(env.DB, url.searchParams.get("runId") || "");
    if (agentRun) return jsonResponse(await agentRunContext(env, agentRun));
    const next = await getNextQueuedAgentRun(env.DB);
    return jsonResponse(next ? await agentRunContext(env, next) : { agentRun: null });
  }

  const agentRunPublishMatch = url.pathname.match(/^\/api\/admin\/agent-runs\/([^/]+)\/publish$/);
  if (agentRunPublishMatch && request.method === "POST") {
    const agentRunId = decodeURIComponent(agentRunPublishMatch[1]);
    const agentRun = await getAgentRunById(env.DB, agentRunId);
    if (!agentRun) return errorResponse("Agent run not found", 404);
    const payload = await readJson<ImportPayload>(request);
    const result = await importRun(env.DB, payload, agentRun.userId);
    ctx.waitUntil(prewarmImportedImages(env, result.images));
    const updated = await markAgentRunPublished(env.DB, {
      runId: agentRun.id,
      publishedRunId: result.runId,
      listingCount: result.listingCount,
      imageCount: result.imageCount,
    });
    await syncAgentRunState(env, updated, "published");
    return jsonResponse({ agentRun: updated, import: result }, { status: 201 });
  }

  const agentRunFailMatch = url.pathname.match(/^\/api\/admin\/agent-runs\/([^/]+)\/fail$/);
  if (agentRunFailMatch && request.method === "POST") {
    const body = await readJson<{ error?: unknown }>(request);
    const updated = await markAgentRunFailed(env.DB, { runId: decodeURIComponent(agentRunFailMatch[1]), error: body.error });
    await syncAgentRunState(env, updated, "failed");
    return jsonResponse({ agentRun: updated });
  }

  if (request.method === "POST" && url.pathname === "/api/admin/import") {
    const payload = await readJson<ImportPayload>(request);
    const scope = adminScope(url, env, payload.userId);
    const result = await importRun(env.DB, payload, scope.userId);
    ctx.waitUntil(prewarmImportedImages(env, result.images));
    return jsonResponse(result, { status: 201 });
  }

  const userImportMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/runs\/import$/);
  if (userImportMatch && request.method === "POST") {
    const payload = await readJson<ImportPayload>(request);
    const userId = decodeURIComponent(userImportMatch[1]);
    const result = await importRun(env.DB, payload, userId);
    ctx.waitUntil(prewarmImportedImages(env, result.images));
    return jsonResponse(result, { status: 201 });
  }

  if (request.method === "GET" && url.pathname === "/api/admin/feedback/export") {
    return jsonResponse(await exportFeedback(env.DB, adminScope(url, env)));
  }

  const userFeedbackExportMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/feedback\/export$/);
  if (userFeedbackExportMatch && request.method === "GET") {
    return jsonResponse(await exportFeedback(env.DB, { userId: decodeURIComponent(userFeedbackExportMatch[1]), includeLegacyData: false }));
  }

  const uploadMatch = url.pathname.match(/^\/api\/admin\/images\/([^/]+)\/([^/]+)$/);
  if (uploadMatch && request.method === "PUT") {
    return uploadImage(request, env, decodeURIComponent(uploadMatch[1]), decodeURIComponent(uploadMatch[2]));
  }

  const mirrorMatch = url.pathname.match(/^\/api\/admin\/mirror-image$/);
  if (mirrorMatch && request.method === "POST") {
    const body = await readJson<{ listingKey: string; sourceUrl: string }>(request);
    return mirrorImage(env, body.listingKey, body.sourceUrl);
  }

  return errorResponse("Not found", 404);
}

function scopeForUser(user: { id: string; email: string }, env: Env): UserScope {
  const legacyOwnerId = userIdForEmail(env.ALLOWED_EMAIL || "");
  return {
    userId: user.id,
    includeLegacyData: user.id === legacyOwnerId,
  };
}

function isBootstrapOwner(user: { id: string }, env: Env): boolean {
  return user.id === userIdForEmail(env.ALLOWED_EMAIL || "");
}

function requireActiveUser(user: { status: string }): void {
  if (user.status !== "active") {
    throw new AuthError(user.status === "disabled" ? "Account disabled" : "Invite required", 403);
  }
}

function adminScope(url: URL, env: Env, userId?: string): UserScope {
  const requestedUserId = url.searchParams.get("userId") || userId || "";
  if (requestedUserId.trim()) {
    return { userId: requestedUserId.trim(), includeLegacyData: false };
  }
  return { userId: userIdForEmail(env.ALLOWED_EMAIL || ""), includeLegacyData: true };
}

function automationEndpoints(request: Request): { mcpEndpoint: string; bundleEndpoint: string } {
  const url = new URL(request.url);
  return {
    mcpEndpoint: new URL("/mcp", url.origin).toString(),
    bundleEndpoint: new URL("/api/automation/bundle", url.origin).toString(),
  };
}

async function runRunnerTaskInContainer(env: Env, taskId: string): Promise<unknown> {
  const runnerId = "cloudflare-container";
  const task = await claimRunnerTask(env.DB, { taskId, runnerId });
  if (!task) throw new Error("Runner task not found");

  const container = getContainer(env.BEACHCAR_RUNNER_CONTAINER, task.id);
  await container.startAndWaitForPorts({
    ports: 8788,
    startOptions: {
      enableInternet: true,
      envVars: runnerContainerEnvVars(env, runnerId),
      labels: {
        app: "beachcar",
        taskId: task.id,
        source: task.source,
      },
    },
  });

  const response = await container.fetch(
    new Request("https://beachcar-runner.local/run-task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task }),
    }),
  );
  const runnerResponse = await readContainerResponse(response);

  if (!response.ok) {
    const failed = await failRunnerTask(env.DB, task.id, {
      runnerId,
      error: typeof runnerResponse.error === "string" ? runnerResponse.error : `Container runner returned HTTP ${response.status}`,
    });
    return { task: failed, runnerResponse };
  }

  const result = normalizeRecord(runnerResponse.result || runnerResponse);
  const completed = await completeRunnerTask(env.DB, task.id, { runnerId, result });
  if (isRecord(runnerResponse.aiUsage)) {
    await recordAiUsageEvent(env.DB, {
      ...runnerResponse.aiUsage,
      userId: task.userId,
      agentRunId: task.agentRunId,
      operation: runnerResponse.aiUsage.operation || `runner_task:${task.kind}`,
    });
  }
  return { task: completed, runnerResponse: result };
}

async function readContainerResponse(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return normalizeRecord(await response.json());
  return { text: await response.text() };
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function runnerContainerEnvVars(env: Env, runnerId: string): Record<string, string> {
  const requestedMode = (env.BEACHCAR_RUNNER_MODE || "deterministic").trim().toLowerCase();
  const mode = requestedMode === "codex" ? "codex" : "deterministic";
  return {
    BEACHCAR_RUNNER_ID: runnerId,
    BEACHCAR_RUNNER_MODE: mode,
    ...(env.BEACHCAR_CODEX_MODEL ? { BEACHCAR_CODEX_MODEL: env.BEACHCAR_CODEX_MODEL } : {}),
    ...(mode === "codex" && env.OPENAI_API_KEY ? { OPENAI_API_KEY: env.OPENAI_API_KEY } : {}),
  };
}

async function getBeachcarAgent(env: Env, userId: string): Promise<DurableObjectStub<import("./agents/beachcar-agent").BeachcarAgent>> {
  return getAgentByName(env.BeachcarAgent, beachcarAgentName(userId), { props: { userId } });
}

async function syncUserAgentSchedule(env: Env, userId: string, profile: UserProfile): Promise<void> {
  if (!profile.onboardingCompletedAt) return;
  const agent = await getBeachcarAgent(env, userId);
  await agent.syncSchedule({ userId, scheduleCron: profile.scheduleCron, enabled: true });
}

async function agentRunContext(env: Env, agentRun: Awaited<ReturnType<typeof getAgentRunById>>): Promise<unknown> {
  if (!agentRun) return { agentRun: null };
  const scope = scopeForUserId(agentRun.userId, env);
  const [user, feedback, latestRun] = await Promise.all([
    getUserPayload(env.DB, agentRun.userId),
    exportFeedback(env.DB, scope),
    getLatestRun(env.DB, scope),
  ]);
  return { agentRun, user, feedback, latestRun };
}

async function syncAgentRunState(env: Env, agentRun: NonNullable<Awaited<ReturnType<typeof getAgentRunById>>>, status: "running" | "published" | "failed"): Promise<void> {
  try {
    const agent = await getBeachcarAgent(env, agentRun.userId);
    if (status === "running") {
      await agent.markRunRunning({ userId: agentRun.userId, runId: agentRun.id });
    } else if (status === "published") {
      await agent.markRunPublished({ userId: agentRun.userId, runId: agentRun.id });
    } else {
      await agent.markRunFailed({ userId: agentRun.userId, runId: agentRun.id });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ level: "warn", message, runId: agentRun.id, userId: agentRun.userId }));
  }
}

function scopeForUserId(userId: string, env: Env): UserScope {
  return {
    userId,
    includeLegacyData: userId === userIdForEmail(env.ALLOWED_EMAIL || ""),
  };
}

function beachcarAgentName(userId: string): string {
  return `user:${userId}`;
}

function limitFromUrl(url: URL, fallback: number): number {
  const parsed = Number(url.searchParams.get("limit") || "");
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(500, Math.floor(parsed)) : fallback;
}

async function refreshScheduledSourceCaches(env: Env, cron: string): Promise<void> {
  try {
    const result = await ingestBringATrailerRssCache(env.DB);
    console.log(JSON.stringify({ level: "info", message: "source_cache.ingested", cron, source: result.source, itemCount: result.itemCount, newItemCount: result.newItemCount }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ level: "error", message, cron, source: "bringatrailer" }));
  }
}
