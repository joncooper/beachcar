import type { ImportPayload } from "../shared/types";
import { normalizeListing } from "../shared/normalize";
import { primaryBootstrapOwnerId } from "./auth";
import {
  authenticateAutomationToken,
  authenticateOAuthAccessToken,
  exportFeedback,
  getAiUsageEvents,
  getAiUsageSummary,
  getAutomationEvents,
  getLatestRun,
  getUserPayload,
  importRun,
  recordAiUsageEvent,
  recordAutomationEvent,
  touchAutomationToken,
  touchOAuthAccessToken,
  upsertProfile,
  type AuthenticatedAutomationToken,
  type UserScope,
} from "./db";
import { jsonResponse } from "./http";
import { prewarmImportedImages } from "./image-cache";
import { mcpProtectedResourceMetadataEndpoint, mcpWwwAuthenticateHeader } from "./oauth-metadata";
import { searchBringATrailerCache } from "./source-cache";
import type { SourceCandidate } from "./sources/types";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

interface McpSession {
  token: AuthenticatedAutomationToken;
  user: Awaited<ReturnType<typeof getUserPayload>>;
  scope: UserScope;
}

export const localCodexExecutionPolicy = {
  id: "local-codex-browser-v1",
  executor: "local-codex",
  browserSession: "user-signed-in-local-browser",
  cloudAgent: false,
  managedAiAccounting: "none",
  usageAccounting: "explicit-known-external-cost-only",
} as const;

export const localCodexResearchSteps = [
  "Run this plan from Codex on the user's desktop.",
  "Use public source tools first. For rendered or authenticated sites, use the user's signed-in local Codex browser and ask the user to sign in when needed.",
  "Never hand browsing or research to a cloud agent.",
  "Validate each candidate against budget, location, title/rust/project risk, and the feedback steering lists.",
  "Call submit_candidates before publish_run when candidate data came from browser research, scraping, or manual extraction.",
  "Do not call record_usage for local Codex or local browser work. Only call it when the user explicitly asks to record a real, known external cost.",
  "Call publish_run once with the final shortlist, then call verify_latest_run and confirm the run id and listing count.",
] as const;

export const mcpToolDefinitions = [
  {
    name: "get_setup_context",
    description: "Read the signed-in user's Beachcar setup context: profile, source settings, AI budget status, feedback steering, and latest run summary.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "plan_daily_research",
    description: "Create a local-Codex research plan that uses the user's signed-in local browser, never a cloud browsing agent.",
    inputSchema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Optional reason for this run, such as schedule, manual, or catch-up." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "save_taste_calibration",
    description: "Save a confirmed taste calibration for this user's local Beachcar automation. This updates only taste/avoid memory and never enables managed research or a cloud schedule.",
    inputSchema: {
      type: "object",
      properties: {
        showMore: {
          type: "array",
          items: { type: "string", enum: ["open-air", "simple", "kid-plausible", "small-4x4", "no-reserve", "quirky-clean"] },
          description: "Structured tastes to seek out.",
        },
        avoid: {
          type: "array",
          items: { type: "string", enum: ["rust", "salvage", "heavy-project", "overbuilt", "fragile", "price-chasing"] },
          description: "Structured deal-breakers to avoid.",
        },
        notes: { type: "string", description: "Optional plain-language tastes, priorities, or examples." },
        avoidNotes: { type: "string", description: "Optional plain-language deal-breakers." },
      },
      required: ["showMore", "avoid"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "search_bat_cache",
    description: "Search cached Bring a Trailer public RSS candidates. The cache refreshes from the public auctions feed when empty or stale.",
    inputSchema: {
      type: "object",
      properties: {
        terms: {
          type: "array",
          items: { type: "string" },
          description: "Optional terms to match against title and description. Defaults to saved taste/source notes.",
        },
        limit: { type: "number", description: "Maximum candidate count to return. Default 12, max 50." },
        refresh: { type: "boolean", description: "Set false to skip stale-cache refresh and search only current D1 rows." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "submit_candidates",
    description: "Validate and normalize a set of candidate listings before publishing. This does not write a run.",
    inputSchema: {
      type: "object",
      properties: {
        listings: { type: "array", items: { type: "object" } },
      },
      required: ["listings"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "publish_run",
    description: "Publish a normalized user-scoped run. This imports listings, queues image warmup, and makes the latest run visible in the web and iOS apps.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        generatedAt: { type: "string" },
        reportMarkdown: { type: "string" },
        sourceSummary: { type: "object" },
        listings: { type: "array", items: { type: "object" } },
        items: { type: "array", items: { type: "object" } },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "record_usage",
    description: "Record a real, known external AI cost only when the user explicitly asks. Never use this for local Codex or local browser work.",
    inputSchema: {
      type: "object",
      properties: {
        agentRunId: { type: "string" },
        provider: { type: "string" },
        model: { type: "string" },
        operation: { type: "string" },
        mode: { type: "string", enum: ["managed", "byok"] },
        gatewayId: { type: "string" },
        gatewayKeyRef: { type: "string" },
        gatewayRequestId: { type: "string" },
        inputTokens: { type: "number" },
        outputTokens: { type: "number" },
        totalTokens: { type: "number" },
        costMicros: { type: "number" },
        costCents: { type: "number" },
        status: { type: "string", enum: ["ok", "error", "cached"] },
        metadata: { type: "object" },
        occurredAt: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "verify_latest_run",
    description: "Read back the latest user-scoped run after publishing, including listings and feedback overlay.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "list_automation_events",
    description: "List recent events emitted by this remote automation token.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum event count. Default 50, max 200." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
] as const;

export async function handleMcpRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method === "GET") {
    return jsonResponse({
      name: "beachcar-remote-mcp",
      transport: "streamable-http-json-rpc",
      endpoint: new URL("/mcp", request.url).toString(),
      protectedResourceMetadataEndpoint: mcpProtectedResourceMetadataEndpoint(request),
      authorization: "Bearer automation token from Beachcar Preferences > Connect Automation",
      tools: mcpToolDefinitions.map(({ name, description, annotations }) => ({ name, description, annotations })),
    });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405, headers: { Allow: "GET, POST" } });
  }

  let rpc: JsonRpcRequest;
  try {
    rpc = (await request.json()) as JsonRpcRequest;
  } catch {
    return jsonRpcError(null, -32700, "Parse error", 400);
  }

  if (!rpc || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
    return jsonRpcError(rpc?.id ?? null, -32600, "Invalid Request", 400);
  }

  if (rpc.id === undefined) return new Response(null, { status: 202 });

  const session = await authenticateMcpSession(request, env);
  if (!session) return mcpUnauthorizedError(request, rpc.id);
  if (session.user.status !== "active") return jsonRpcError(rpc.id, -32003, "User account is not active", 403);

  if (session.token.kind === "oauth") {
    await touchOAuthAccessToken(env.DB, session.token.id);
  } else {
    await touchAutomationToken(env.DB, session.token.id);
  }

  if (rpc.method === "initialize") {
    return jsonRpcResult(rpc.id, {
      protocolVersion: protocolVersionFromParams(rpc.params),
      capabilities: { tools: {} },
      serverInfo: { name: "beachcar-remote-mcp", version: "0.1.0" },
    });
  }

  if (rpc.method === "tools/list") {
    await recordToolEvent(env, session, "tools/list", {});
    return jsonRpcResult(rpc.id, { tools: mcpToolDefinitions });
  }

  if (rpc.method === "tools/call") {
    const params = recordFromUnknown(rpc.params);
    const name = typeof params.name === "string" ? params.name : "";
    const args = recordFromUnknown(params.arguments);
    if (!name) return jsonRpcError(rpc.id, -32602, "Tool name is required", 400);

    try {
      const result = await callTool(name, args, session, env, ctx);
      return jsonRpcResult(rpc.id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonRpcResult(rpc.id, {
        isError: true,
        content: [{ type: "text", text: message }],
      });
    }
  }

  return jsonRpcError(rpc.id, -32601, "Method not found", 404);
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  session: McpSession,
  env: Env,
  ctx: ExecutionContext,
): Promise<Record<string, unknown>> {
  if (name === "get_setup_context") return getSetupContext(session, env);
  if (name === "plan_daily_research") return planDailyResearch(session, env, args);
  if (name === "save_taste_calibration") return saveTasteCalibration(session, env, args);
  if (name === "search_bat_cache") return searchBatPublicFeed(session, env, args);
  if (name === "submit_candidates") return submitCandidates(session, env, args);
  if (name === "publish_run") return publishRun(session, env, ctx, args);
  if (name === "record_usage") return recordUsage(session, env, args);
  if (name === "verify_latest_run") return verifyLatestRun(session, env);
  if (name === "list_automation_events") return listAutomationEvents(session, env, args);
  throw new Error(`Unknown tool: ${name}`);
}

async function getSetupContext(session: McpSession, env: Env): Promise<Record<string, unknown>> {
  assertScope(session, "setup:read");
  const [feedback, latestRun, aiUsage, aiUsageEvents] = await Promise.all([
    exportFeedback(env.DB, session.scope),
    getLatestRun(env.DB, session.scope),
    getAiUsageSummary(env.DB, session.token.userId),
    getAiUsageEvents(env.DB, session.token.userId, 20),
  ]);
  await recordToolEvent(env, session, "tool.get_setup_context", {
    latestRunId: latestRun?.id || null,
    feedbackCount: feedback.counts.total,
  });
  return {
    user: redactedUserContext(session.user),
    feedback: {
      counts: feedback.counts,
      steering: feedback.steering,
    },
    latestRun: latestRunSummary(latestRun),
    aiUsage,
    recentAiUsageEvents: aiUsageEvents,
  };
}

async function planDailyResearch(session: McpSession, env: Env, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  assertScope(session, "setup:read");
  assertScope(session, "sources:read");
  const [feedback, latestRun] = await Promise.all([exportFeedback(env.DB, session.scope), getLatestRun(env.DB, session.scope)]);
  const profile = session.user.profile;
  const profileData = recordFromUnknown(profile?.profile);
  const sourceSettings = session.user.sourceSettings || [];
  const enabledSources = sourceSettings.filter((source) => source.enabled).map((source) => source.source);
  const reason = typeof args.reason === "string" && args.reason.trim() ? args.reason.trim() : "remote_mcp";
  const budgetMax = typeof profile?.budgetMax === "number" ? profile.budgetMax : 30_000;
  const stretchBudget = typeof profile?.stretchBudget === "number" ? profile.stretchBudget : 0;
  await recordToolEvent(env, session, "tool.plan_daily_research", { reason, enabledSources });
  return {
    reason,
    user: redactedUserContext(session.user),
    constraints: {
      niche: profile?.niche || "Beach cars and runabouts",
      homeRegion: profile?.homeRegion || "unspecified",
      budgetMax,
      stretchBudget,
      totalCeiling: budgetMax + stretchBudget,
      tasteNotes: stringValue(profileData.tasteNotes),
      avoidNotes: stringValue(profileData.avoidNotes),
    },
    sources: sourceSettings.map((source) => ({
      source: source.source,
      enabled: source.enabled,
      settings: source.settings,
    })),
    feedbackSteering: feedback.steering,
    latestRun: latestRunSummary(latestRun),
    executionPolicy: localCodexExecutionPolicy,
    steps: localCodexResearchSteps,
    publishContract: {
      endpoint: "MCP tool publish_run",
      requiredListingFields: ["site", "title", "url", "lane", "section", "bid", "total", "why", "concerns", "images"],
      optionalDossierFields: ["dossier.summary", "dossier.specs", "dossier.listing", "dossier.equipment", "dossier.service", "dossier.bidLog", "dossier.comments", "dossier.beachUse", "dossier.valueScore"],
      dossierGuidance: "Attach an optional `dossier` object (rich detail from the listing page) to power the app's full per-car view; every field is optional, invalid types are dropped, and valueScore is a 0..1 CHEAP..RICH position. See docs/publishing.md.",
      imageGuidance: "Include useful source image URLs; Beachcar will mirror and serve cached thumb/deck/full variants.",
    },
  };
}

const tasteCalibrationIds = new Set(["open-air", "simple", "kid-plausible", "small-4x4", "no-reserve", "quirky-clean"]);
const avoidCalibrationIds = new Set(["rust", "salvage", "heavy-project", "overbuilt", "fragile", "price-chasing"]);

async function saveTasteCalibration(session: McpSession, env: Env, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  assertScope(session, "setup:write");
  const showMore = calibrationIds(args.showMore, tasteCalibrationIds, "showMore");
  const avoid = calibrationIds(args.avoid, avoidCalibrationIds, "avoid");
  const notes = boundedCalibrationNote(args.notes, "notes");
  const avoidNotes = boundedCalibrationNote(args.avoidNotes, "avoidNotes");
  const existingProfile = recordFromUnknown(session.user.profile?.profile);
  const profile = await upsertProfile(env.DB, session.token.userId, {
    profile: {
      ...existingProfile,
      tasteNotes: calibrationNarrative("Selected tastes", showMore, notes),
      avoidNotes: calibrationNarrative("Selected avoids", avoid, avoidNotes),
      tasteNotesFreeform: notes,
      avoidNotesFreeform: avoidNotes,
      tasteCalibration: showMore,
      avoidCalibration: avoid,
      localCodexTasteUpdatedAt: new Date().toISOString(),
    },
  });
  await recordToolEvent(env, session, "tool.save_taste_calibration", {
    tasteCount: showMore.length,
    avoidCount: avoid.length,
    hasTasteNotes: Boolean(notes),
    hasAvoidNotes: Boolean(avoidNotes),
  });
  return {
    ok: true,
    profile,
    calibration: { showMore, avoid, notes, avoidNotes },
  };
}

async function searchBatPublicFeed(session: McpSession, env: Env, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  assertScope(session, "sources:read");
  const limit = limitFromUnknown(args.limit, 12, 50);
  const terms = termsFromArgs(args, session.user);
  const result = await searchBringATrailerCache(env.DB, { terms, limit, refresh: args.refresh !== false });
  await recordToolEvent(env, session, "tool.search_bat_cache", {
    source: "bringatrailer",
    feed: result.feed,
    termCount: terms.length,
    candidateCount: result.candidateCount,
    mode: result.mode,
    cacheStatus: result.cacheStatus,
    latestIngestionAt: result.status.latestIngestion?.finishedAt || null,
  });
  return {
    ...result,
    candidates: result.candidates.map(publicCandidate),
  };
}

async function submitCandidates(session: McpSession, env: Env, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  assertScope(session, "runs:publish");
  const rawListings = arrayFromUnknown(args.listings);
  if (!rawListings.length) throw new Error("listings must include at least one candidate");
  const normalized = rawListings.map((listing) => normalizeListing(recordFromUnknown(listing)));
  const warnings = normalized.flatMap((listing, index) => candidateWarnings(listing, index));
  await recordToolEvent(env, session, "tool.submit_candidates", {
    listingCount: normalized.length,
    warningCount: warnings.length,
  });
  return {
    ok: warnings.length === 0,
    listingCount: normalized.length,
    warnings,
    listings: normalized,
  };
}

async function publishRun(session: McpSession, env: Env, ctx: ExecutionContext, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  assertScope(session, "runs:publish");
  const providedSummary = recordFromUnknown(args.sourceSummary);
  const payload: ImportPayload = {
    runId: typeof args.runId === "string" ? args.runId : undefined,
    generatedAt: typeof args.generatedAt === "string" ? args.generatedAt : undefined,
    reportMarkdown: typeof args.reportMarkdown === "string" ? args.reportMarkdown : undefined,
    sourceSummary: {
      ...providedSummary,
      publisher: "remote-mcp",
      automationTokenId: session.token.automationTokenId ?? (session.token.kind === "oauth" ? null : session.token.id),
      oauthAccessTokenId: session.token.kind === "oauth" ? session.token.id : null,
      oauthClientId: session.token.clientId || null,
      automationTokenLabel: session.token.label,
      publishedAt: new Date().toISOString(),
    },
    listings: arrayFromUnknown(args.listings).length ? arrayFromUnknown(args.listings).map((listing) => normalizeListing(recordFromUnknown(listing))) : undefined,
    items: arrayFromUnknown(args.items).length ? arrayFromUnknown(args.items).map((listing) => normalizeListing(recordFromUnknown(listing))) : undefined,
  };
  const result = await importRun(env.DB, payload, session.token.userId);
  ctx.waitUntil(prewarmImportedImages(env, result.images));
  await recordToolEvent(env, session, "tool.publish_run", {
    runId: result.runId,
    listingCount: result.listingCount,
    imageCount: result.imageCount,
  });
  return {
    ok: true,
    import: result,
    latestRun: latestRunSummary(await getLatestRun(env.DB, session.scope)),
  };
}

async function recordUsage(session: McpSession, env: Env, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  assertScope(session, "usage:write");
  const metadata = {
    ...recordFromUnknown(args.metadata),
    automationTokenId: session.token.automationTokenId ?? (session.token.kind === "oauth" ? null : session.token.id),
    oauthAccessTokenId: session.token.kind === "oauth" ? session.token.id : null,
    oauthClientId: session.token.clientId || null,
    automationTokenLabel: session.token.label,
  };
  const event = await recordAiUsageEvent(env.DB, {
    ...args,
    userId: session.token.userId,
    metadata,
  });
  await recordToolEvent(env, session, "tool.record_usage", {
    provider: event.provider,
    model: event.model,
    totalTokens: event.totalTokens,
    costMicros: event.costMicros,
  });
  return {
    event,
    summary: await getAiUsageSummary(env.DB, session.token.userId),
  };
}

async function verifyLatestRun(session: McpSession, env: Env): Promise<Record<string, unknown>> {
  assertScope(session, "setup:read");
  const latestRun = await getLatestRun(env.DB, session.scope);
  await recordToolEvent(env, session, "tool.verify_latest_run", {
    runId: latestRun?.id || null,
    listingCount: latestRun?.listings.length || 0,
  });
  return {
    latestRun,
    summary: latestRunSummary(latestRun),
  };
}

async function listAutomationEvents(session: McpSession, env: Env, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  assertScope(session, "events:read");
  const events = await getAutomationEvents(env.DB, session.token.userId, limitFromUnknown(args.limit, 50, 200));
  return { events };
}

async function authenticateMcpSession(request: Request, env: Env): Promise<McpSession | null> {
  const rawToken = bearerToken(request);
  if (!rawToken) return null;
  const token = rawToken.startsWith("bcoauth_")
    ? await authenticateOAuthAccessToken(env.DB, rawToken, new URL("/mcp", request.url).toString())
    : await authenticateAutomationToken(env.DB, rawToken);
  if (!token) return null;
  const user = await getUserPayload(env.DB, token.userId);
  return {
    token,
    user,
    scope: {
      userId: token.userId,
      includeLegacyData: token.userId === primaryBootstrapOwnerId(env),
    },
  };
}

async function recordToolEvent(env: Env, session: McpSession, eventType: string, metadata: Record<string, unknown>): Promise<void> {
  await recordAutomationEvent(env.DB, {
    userId: session.token.userId,
    tokenId: session.token.kind === "oauth" ? null : session.token.id,
    actor: "remote-mcp",
    eventType,
    metadata: {
      ...metadata,
      authKind: session.token.kind || "manual",
      oauthAccessTokenId: session.token.kind === "oauth" ? session.token.id : null,
      oauthClientId: session.token.clientId || null,
    },
  });
}

function assertScope(session: McpSession, scope: AuthenticatedAutomationToken["scopes"][number]): void {
  if (!session.token.scopes.includes(scope)) throw new Error(`Automation token is missing scope: ${scope}`);
}

function jsonRpcResult(id: JsonRpcId, result: unknown): Response {
  return jsonResponse({ jsonrpc: "2.0", id, result });
}

function jsonRpcError(id: JsonRpcId, code: number, message: string, status = 200): Response {
  return jsonResponse({ jsonrpc: "2.0", id, error: { code, message } }, { status });
}

function mcpUnauthorizedError(request: Request, id: JsonRpcId): Response {
  return jsonResponse(
    { jsonrpc: "2.0", id, error: { code: -32001, message: "Unauthorized automation token" } },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": mcpWwwAuthenticateHeader(request, "invalid_token", "Missing, invalid, or revoked Beachcar automation token"),
      },
    },
  );
}

function protocolVersionFromParams(params: unknown): string {
  const record = recordFromUnknown(params);
  return typeof record.protocolVersion === "string" && record.protocolVersion.trim() ? record.protocolVersion.trim() : "2024-11-05";
}

function redactedUserContext(user: McpSession["user"]): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    onboarding: user.onboarding,
    profile: user.profile,
    sourceSettings: user.sourceSettings || [],
    aiSettings: user.aiSettings
      ? {
          mode: user.aiSettings.mode,
          monthlyBudgetCents: user.aiSettings.monthlyBudgetCents,
          dailyBudgetCents: user.aiSettings.dailyBudgetCents,
          status: user.aiSettings.status,
          hasGatewayKeyRef: Boolean(user.aiSettings.gatewayKeyRef),
          updatedAt: user.aiSettings.updatedAt,
        }
      : null,
  };
}

function latestRunSummary(run: Awaited<ReturnType<typeof getLatestRun>>): Record<string, unknown> | null {
  if (!run) return null;
  return {
    id: run.id,
    generatedAt: run.generatedAt,
    listingCount: run.listings.length,
    feedbackCount: run.feedback.length,
  };
}

function termsFromArgs(args: Record<string, unknown>, user: McpSession["user"]): string[] {
  const explicit = arrayFromUnknown(args.terms)
    .map((term) => (typeof term === "string" ? term.trim().toLowerCase() : ""))
    .filter((term) => term.length >= 3);
  if (explicit.length) return [...new Set(explicit)];

  const profile = recordFromUnknown(user.profile?.profile);
  const sourceNotes = (user.sourceSettings || [])
    .map((source) => stringValue(recordFromUnknown(source.settings).searchNotes))
    .filter(Boolean);
  return [
    ...sourceNotes,
    stringValue(profile.tasteNotes),
    "volkswagen thing",
    "mini moke",
    "suzuki samurai",
    "geo tracker",
    "vespa",
  ]
    .flatMap((value) => value.split(/[,;\n]+/))
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length >= 3)
    .slice(0, 20);
}

function publicCandidate(candidate: SourceCandidate): Record<string, unknown> {
  return {
    source: candidate.source,
    site: candidate.site,
    sourceQuery: candidate.sourceQuery,
    title: candidate.title,
    url: candidate.url,
    bid: candidate.bid,
    total: candidate.total,
    location: candidate.location,
    locationRaw: candidate.locationRaw,
    locationCity: candidate.locationCity,
    locationRegion: candidate.locationRegion,
    locationCountry: candidate.locationCountry,
    distanceMiles: candidate.distanceMiles,
    locationStatus: candidate.locationStatus,
    missingData: candidate.missingData,
    timeLeft: candidate.timeLeft,
    bids: candidate.bids,
    bidders: candidate.bidders,
    comments: candidate.comments,
    imageUrls: candidate.imageUrls,
    summary: candidate.summary,
    sourceUrl: candidate.sourceUrl,
  };
}

function candidateWarnings(listing: ReturnType<typeof normalizeListing>, index: number): string[] {
  const warnings: string[] = [];
  if (!listing.url) warnings.push(`listings[${index}].url is empty`);
  if (!listing.title || listing.title === "Untitled listing") warnings.push(`listings[${index}].title is missing`);
  if (!listing.why) warnings.push(`listings[${index}].why is empty`);
  if (!listing.concerns) warnings.push(`listings[${index}].concerns is empty`);
  if (!listing.location) warnings.push(`listings[${index}].location is missing`);
  if (!listing.images.length) warnings.push(`listings[${index}].images is empty`);
  return warnings;
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function arrayFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function calibrationIds(value: unknown, allowed: Set<string>, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  const values = value.map((item) => stringValue(item)).filter(Boolean);
  if (values.length > 12) throw new Error(`${field} may contain at most 12 items`);
  const unique = [...new Set(values)];
  const invalid = unique.find((item) => !allowed.has(item));
  if (invalid) throw new Error(`${field} contains an unsupported calibration id: ${invalid}`);
  return unique;
}

function boundedCalibrationNote(value: unknown, field: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value.trim().slice(0, 1_000);
}

function calibrationNarrative(label: string, selected: string[], notes: string): string {
  const calibration = selected.length ? `${label}: ${selected.join(", ")}.` : "";
  return [notes, calibration].filter(Boolean).join(" ");
}

function limitFromUnknown(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(max, Math.floor(parsed)) : fallback;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}
