import type { ImportPayload } from "../shared/types";
import { normalizeListing } from "../shared/normalize";
import { userIdForEmail } from "./auth";
import {
  authenticateAutomationToken,
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
  type AuthenticatedAutomationToken,
  type UserScope,
} from "./db";
import { jsonResponse } from "./http";
import { prewarmImportedImages } from "./image-cache";
import { parseBringATrailerRssFeed, type SourceCandidate } from "./workflows/source-discovery";

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

const batRssFeed = "https://bringatrailer.com/auctions/feed/";

export const mcpToolDefinitions = [
  {
    name: "get_setup_context",
    description: "Read the signed-in friend's Beachcar setup context: profile, source settings, AI budget status, feedback steering, and latest run summary.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "plan_daily_research",
    description: "Create a practical daily research plan from the user's profile, enabled sources, feedback, and current budget constraints.",
    inputSchema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Optional reason for this run, such as schedule, manual, or catch-up." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_bat_cache",
    description: "Search Bring a Trailer's public auctions RSS feed for candidate listings. This preview fetches the live public feed and does not persist a D1 cache yet.",
    inputSchema: {
      type: "object",
      properties: {
        terms: {
          type: "array",
          items: { type: "string" },
          description: "Optional terms to match against title and description. Defaults to saved taste/source notes.",
        },
        limit: { type: "number", description: "Maximum candidate count to return. Default 12, max 50." },
      },
      additionalProperties: false,
    },
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
  },
  {
    name: "record_usage",
    description: "Record AI/token/cost usage for this user's external automation run.",
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
  },
  {
    name: "verify_latest_run",
    description: "Read back the latest user-scoped run after publishing, including listings and feedback overlay.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
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
  },
] as const;

export async function handleMcpRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method === "GET") {
    return jsonResponse({
      name: "beachcar-remote-mcp",
      transport: "streamable-http-json-rpc",
      endpoint: new URL("/mcp", request.url).toString(),
      authorization: "Bearer automation token from Beachcar Preferences > Connect Automation",
      tools: mcpToolDefinitions.map(({ name, description }) => ({ name, description })),
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
  if (!session) return jsonRpcError(rpc.id, -32001, "Unauthorized automation token", 401);
  if (session.user.status !== "active") return jsonRpcError(rpc.id, -32003, "User account is not active", 403);

  await touchAutomationToken(env.DB, session.token.id);

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
    steps: [
      "Use source tools for public feeds first; use a browser-capable cloud agent for sites that require rendered pages or user sessions.",
      "Validate each candidate against budget, location, title/rust/project risk, and the feedback steering lists.",
      "Call submit_candidates before publish_run if the candidate payload was produced from scraped or handwritten data.",
      "Call record_usage for every model/tool harness call with token and cost estimates.",
      "Call publish_run once with the final shortlist, then verify_latest_run.",
    ],
    publishContract: {
      endpoint: "MCP tool publish_run",
      requiredListingFields: ["site", "title", "url", "lane", "section", "bid", "total", "why", "concerns", "images"],
      imageGuidance: "Include useful source image URLs; Beachcar will mirror and serve cached thumb/deck/full variants.",
    },
  };
}

async function searchBatPublicFeed(session: McpSession, env: Env, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  assertScope(session, "sources:read");
  const limit = limitFromUnknown(args.limit, 12, 50);
  const terms = termsFromArgs(args, session.user);
  const response = await fetch(batRssFeed, {
    headers: {
      Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
      "User-Agent": "BeachcarRemoteMCP/0.1 (+https://beachcar.local)",
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Bring a Trailer RSS returned HTTP ${response.status}`);
  const candidates = parseBringATrailerRssFeed(text)
    .filter((candidate) => matchesTerms(candidate, terms))
    .slice(0, limit);
  await recordToolEvent(env, session, "tool.search_bat_cache", {
    source: "bringatrailer",
    feed: batRssFeed,
    termCount: terms.length,
    candidateCount: candidates.length,
    mode: "public_rss_live",
  });
  return {
    source: "bringatrailer",
    site: "Bring a Trailer",
    mode: "public_rss_live",
    cacheStatus: "not_persisted_yet",
    feed: batRssFeed,
    terms,
    candidateCount: candidates.length,
    candidates: candidates.map(publicCandidate),
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
      automationTokenId: session.token.id,
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
    automationTokenId: session.token.id,
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
  const token = await authenticateAutomationToken(env.DB, rawToken);
  if (!token) return null;
  const user = await getUserPayload(env.DB, token.userId);
  return {
    token,
    user,
    scope: {
      userId: token.userId,
      includeLegacyData: token.userId === userIdForEmail(env.ALLOWED_EMAIL || ""),
    },
  };
}

async function recordToolEvent(env: Env, session: McpSession, eventType: string, metadata: Record<string, unknown>): Promise<void> {
  await recordAutomationEvent(env.DB, {
    userId: session.token.userId,
    tokenId: session.token.id,
    actor: "remote-mcp",
    eventType,
    metadata,
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

function matchesTerms(candidate: SourceCandidate, terms: string[]): boolean {
  if (!terms.length) return true;
  const text = `${candidate.title} ${candidate.summary} ${candidate.sourceQuery}`.toLowerCase();
  return terms.some((term) => text.includes(term));
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

function limitFromUnknown(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(max, Math.floor(parsed)) : fallback;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}
