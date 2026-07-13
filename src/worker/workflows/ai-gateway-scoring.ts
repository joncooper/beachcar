import { recordAiUsageEvent } from "../db";
import type {
  AiCandidateScore,
  CandidateAiScorer,
  CandidateAiScoringInput,
  CandidateAiScoringResult,
  ScoredCandidate,
} from "./source-discovery";

interface ScorerConfig {
  endpoint: string;
  authHeaderName: "Authorization" | "cf-aig-authorization";
  token: string;
  model: string;
  gatewayId: string | null;
  microsPerThousandTokens: number;
}

interface ChatCompletionResponse {
  id?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    cost_micros?: number;
    total_cost_micros?: number;
    cost?: number;
    total_cost?: number;
  };
}

interface ParsedAiScores {
  scores?: AiCandidateScore[];
}

export function createAiGatewayCandidateScorer(
  env: Env,
  input: { userId: string; agentRunId: string; mode: "managed" | "byok" | null; gatewayKeyRef?: string | null },
): CandidateAiScorer | null {
  // Never fall back to the operator credential for a legacy/inconsistent BYOK
  // row that has no Gateway alias. Heuristic scoring remains available.
  if (input.mode === "byok" && !input.gatewayKeyRef?.trim()) return null;
  const config = scorerConfigFromEnv(env);
  if (!config) return null;

  return {
    async scoreCandidates(scoringInput: CandidateAiScoringInput): Promise<CandidateAiScoringResult> {
      return scoreCandidatesWithGateway(env, config, input, scoringInput);
    },
  };
}

export function aiGatewayRuntimeConfigured(env: Env): boolean {
  return scorerConfigFromEnv(env) !== null;
}

function scorerConfigFromEnv(env: Env): ScorerConfig | null {
  // Wrangler's operator credential is never a runtime model credential. Using
  // it here would couple deploy authority to user-triggered model requests and
  // could disclose an account-wide token to a configured third-party endpoint.
  const token = firstNonEmpty(env.BEACHCAR_AI_GATEWAY_TOKEN);
  if (!token) return null;

  const configuredBaseEndpoint = trimToNull(env.BEACHCAR_AI_GATEWAY_BASE_URL);
  const allowLocalTestEndpoint = env.BEACHCAR_AI_GATEWAY_ALLOW_LOCAL_TEST?.trim().toLowerCase() === "true";
  const baseEndpoint = normalizeEndpoint(configuredBaseEndpoint || undefined, allowLocalTestEndpoint);
  if (configuredBaseEndpoint && !baseEndpoint) return null;
  const accountId = trimToNull(env.CLOUDFLARE_ACCOUNT_ID);
  const endpoint = baseEndpoint || (accountId ? `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions` : null);
  if (!endpoint) return null;

  return {
    endpoint,
    authHeaderName: endpoint.includes("gateway.ai.cloudflare.com") ? "cf-aig-authorization" : "Authorization",
    token,
    model: trimToNull(env.BEACHCAR_AI_GATEWAY_MODEL) || "openai/gpt-4.1",
    gatewayId: trimToNull(env.BEACHCAR_AI_GATEWAY_ID) || null,
    microsPerThousandTokens: positiveNumber(env.BEACHCAR_AI_ESTIMATED_MICROS_PER_1K_TOKENS, 2000),
  };
}

async function scoreCandidatesWithGateway(
  env: Env,
  config: ScorerConfig,
  usageContext: { userId: string; agentRunId: string; mode: "managed" | "byok" | null; gatewayKeyRef?: string | null },
  input: CandidateAiScoringInput,
): Promise<CandidateAiScoringResult> {
  const gatewayRequestIdFallback = `ai-gateway-score-${usageContext.agentRunId}`;
  const headers = new Headers({
    "Content-Type": "application/json",
    [config.authHeaderName]: `Bearer ${config.token}`,
    "cf-aig-metadata": JSON.stringify({
      user_id: usageContext.userId,
      agent_run: usageContext.agentRunId,
      operation: "candidate_scoring",
      mode: usageContext.mode || "managed",
      app: "beachcar",
    }),
  });

  if (config.gatewayId && config.endpoint.startsWith("https://api.cloudflare.com/")) {
    headers.set("cf-aig-gateway-id", config.gatewayId);
  }

  if (usageContext.mode === "byok" && usageContext.gatewayKeyRef) {
    headers.set("cf-aig-byok-alias", usageContext.gatewayKeyRef);
  }

  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(buildGatewayRequest(config.model, input)),
      redirect: "manual",
    });
    const text = await response.text();
    const requestId = response.headers.get("cf-aig-request-id") || response.headers.get("cf-aig-log-id") || response.headers.get("x-request-id") || gatewayRequestIdFallback;

    if (!response.ok) {
      await recordAiUsageEvent(env.DB, {
        userId: usageContext.userId,
        agentRunId: usageContext.agentRunId,
        provider: "cloudflare-ai-gateway",
        model: config.model,
        operation: "candidate_scoring",
        mode: usageContext.mode,
        gatewayId: config.gatewayId,
        gatewayKeyRef: usageContext.gatewayKeyRef,
        gatewayRequestId: requestId,
        status: "error",
        costMicros: 0,
        metadata: {
          status: response.status,
          message: truncate(text, 500),
        },
      });
      return {
        status: "failed",
        provider: "cloudflare-ai-gateway",
        model: config.model,
        gatewayId: config.gatewayId,
        gatewayKeyRef: usageContext.gatewayKeyRef || null,
        requestId,
        message: `AI Gateway returned HTTP ${response.status}; the managed run was not published.`,
        scores: [],
      };
    }

    const json = parseJsonObject<ChatCompletionResponse>(text);
    const content = json?.choices?.[0]?.message?.content || "";
    const normalizedScores = normalizeAiScores(parseAiScoreContent(content));
    const submittedCandidateUrls = new Set(input.candidates.slice(0, 8).map((candidate) => candidate.candidate.url));
    const scores = normalizedScores.filter((score) => submittedCandidateUrls.has(score.url));
    const usage = usageFromResponse(json, config);

    await recordAiUsageEvent(env.DB, {
      userId: usageContext.userId,
      agentRunId: usageContext.agentRunId,
      provider: "cloudflare-ai-gateway",
      model: config.model,
      operation: "candidate_scoring",
      mode: usageContext.mode,
      gatewayId: config.gatewayId,
      gatewayKeyRef: usageContext.gatewayKeyRef,
      gatewayRequestId: requestId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      costMicros: usage.costMicros,
      status: scores.length ? "ok" : "error",
      metadata: {
        estimatedCost: usage.estimatedCost,
        scoreCount: scores.length,
        rejectedScoreCount: normalizedScores.length - scores.length,
      },
    });

    return {
      status: scores.length ? "ok" : "failed",
      provider: "cloudflare-ai-gateway",
      model: config.model,
      gatewayId: config.gatewayId,
      gatewayKeyRef: usageContext.gatewayKeyRef || null,
      requestId,
      message: scores.length ? "AI Gateway reranked the source candidates." : "AI Gateway returned no usable scores; the managed run was not published.",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      costMicros: usage.costMicros,
      scores,
    };
  } catch (error) {
    await recordAiUsageEvent(env.DB, {
      userId: usageContext.userId,
      agentRunId: usageContext.agentRunId,
      provider: "cloudflare-ai-gateway",
      model: config.model,
      operation: "candidate_scoring",
      mode: usageContext.mode,
      gatewayId: config.gatewayId,
      gatewayKeyRef: usageContext.gatewayKeyRef,
      gatewayRequestId: gatewayRequestIdFallback,
      status: "error",
      costMicros: 0,
      metadata: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return {
      status: "failed",
      provider: "cloudflare-ai-gateway",
      model: config.model,
      gatewayId: config.gatewayId,
      gatewayKeyRef: usageContext.gatewayKeyRef || null,
      requestId: gatewayRequestIdFallback,
      message: "AI Gateway scoring failed; the managed run was not published.",
      scores: [],
    };
  }
}

function buildGatewayRequest(model: string, input: CandidateAiScoringInput): Record<string, unknown> {
  return {
    model,
    temperature: 0.1,
    max_tokens: 900,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You rerank auction candidates for a beach-car watch app. Return compact JSON only. Do not invent facts; use only the provided candidate fields. Keep summary <= 90 chars; include beachNote only when the candidate fields clearly support it.",
      },
      {
        role: "user",
        content: JSON.stringify({
          output_schema: {
            scores: [
              {
                url: "candidate URL",
                scoreDelta: "integer -20..20; positive means better fit than heuristic",
                lane: "family|solo|curiosity optional",
                section: "short optional section label",
                why: "one sentence fit note",
                concerns: "one sentence caution",
                valueScore: "optional number 0..1; 0=very cheap for what it is, 1=priced rich",
                summary: "optional one-line dossier headline, <= 90 chars",
                beachNote: "optional one sentence on real beach usability",
              },
            ],
          },
          profile: {
            niche: input.context.niche,
            budgetMax: input.context.budgetMax,
            stretchBudget: input.context.stretchBudget,
            homeRegion: input.context.homeRegion,
            tasteNotes: input.context.tasteNotes,
            avoidNotes: input.context.avoidNotes,
            feedbackCount: input.context.feedbackCount,
            feedbackSteering: boundedFeedbackSteering(input.context.feedbackSteering),
          },
          run: input.params,
          candidates: input.candidates.slice(0, 8).map(candidateForPrompt),
        }),
      },
    ],
  };
}

function boundedFeedbackSteering(steering: CandidateAiScoringInput["context"]["feedbackSteering"]): Record<string, unknown> | null {
  if (!steering) return null;
  return {
    prioritizeSimilarTo: steering.prioritizeSimilarTo.slice(0, 12).map((entry) => ({
      title: truncate(entry.title, 120),
      tags: entry.tags.slice(0, 12),
    })),
    suppressExactUrls: steering.suppressExactUrls.slice(0, 40),
    avoidSimilarTo: steering.avoidSimilarTo.slice(0, 12).map((entry) => ({
      title: truncate(entry.title, 120),
      tags: entry.tags.slice(0, 12),
    })),
    notes: steering.notes.slice(0, 10).map((entry) => ({
      title: entry.title ? truncate(entry.title, 120) : undefined,
      note: truncate(entry.note, 240),
      tags: entry.tags.slice(0, 12),
    })),
  };
}

function candidateForPrompt(candidate: ScoredCandidate): Record<string, unknown> {
  return {
    url: candidate.candidate.url,
    title: candidate.candidate.title,
    site: candidate.candidate.site,
    sourceQuery: candidate.candidate.sourceQuery,
    bid: candidate.candidate.bid,
    bidNum: candidate.candidate.bidNum ?? null,
    total: candidate.candidate.total,
    location: candidate.candidate.location ?? null,
    heuristicScore: candidate.score,
    heuristicMatches: candidate.matches,
    heuristicPenalties: candidate.penalties,
    summary: truncate(candidate.candidate.summary, 600),
  };
}

function parseAiScoreContent(content: string): ParsedAiScores | null {
  const direct = parseJsonObject<ParsedAiScores>(content);
  if (direct) return direct;
  const match = content.match(/\{[\s\S]*\}/);
  return match ? parseJsonObject<ParsedAiScores>(match[0]) : null;
}

function normalizeAiScores(parsed: ParsedAiScores | null): AiCandidateScore[] {
  if (!parsed || !Array.isArray(parsed.scores)) return [];
  return parsed.scores
    .map((score): AiCandidateScore | null => {
      if (!score || typeof score.url !== "string" || !score.url.trim()) return null;
      return {
        url: score.url.trim(),
        scoreDelta: clampInteger(score.scoreDelta, -20, 20),
        why: stringOrUndefined(score.why, 260),
        concerns: stringOrUndefined(score.concerns, 260),
        lane: score.lane === "family" || score.lane === "solo" || score.lane === "curiosity" ? score.lane : undefined,
        section: stringOrUndefined(score.section, 48),
        valueScore: clampUnit(score.valueScore),
        summary: stringOrUndefined(score.summary, 90),
        beachNote: stringOrUndefined(score.beachNote, 160),
      };
    })
    .filter((score): score is AiCandidateScore => score !== null);
}

function usageFromResponse(response: ChatCompletionResponse | null, config: ScorerConfig): {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costMicros: number;
  estimatedCost: boolean;
} {
  const usage = response?.usage || {};
  const inputTokens = integerOrNull(usage.prompt_tokens) ?? integerOrNull(usage.input_tokens);
  const outputTokens = integerOrNull(usage.completion_tokens) ?? integerOrNull(usage.output_tokens);
  const totalTokens = integerOrNull(usage.total_tokens) ?? (inputTokens === null && outputTokens === null ? null : (inputTokens || 0) + (outputTokens || 0));
  const directCost = integerOrNull(usage.cost_micros) ?? integerOrNull(usage.total_cost_micros) ?? dollarsToMicros(usage.cost) ?? dollarsToMicros(usage.total_cost);
  if (directCost !== null) {
    return { inputTokens, outputTokens, totalTokens, costMicros: directCost, estimatedCost: false };
  }
  const costMicros = totalTokens === null ? 0 : Math.ceil((totalTokens / 1000) * config.microsPerThousandTokens);
  return { inputTokens, outputTokens, totalTokens, costMicros, estimatedCost: true };
}

function normalizeEndpoint(value: string | undefined, allowLocalTestEndpoint = false): string | null {
  const trimmed = trimToNull(value);
  if (!trimmed) return null;
  try {
    const endpoint = new URL(trimmed);
    const isProductionGateway =
      endpoint.protocol === "https:" && ["api.cloudflare.com", "gateway.ai.cloudflare.com"].includes(endpoint.hostname);
    const isLocalTestGateway =
      allowLocalTestEndpoint &&
      endpoint.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || (!isProductionGateway && !isLocalTestGateway)) {
      return null;
    }
    const normalized = endpoint.toString().replace(/\/+$/, "");
    return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
  } catch {
    return null;
  }
}

function firstNonEmpty(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    const trimmed = trimToNull(value);
    if (trimmed) return trimmed;
  }
  return null;
}

function trimToNull(value: string | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function integerOrNull(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
}

function dollarsToMicros(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 1_000_000)) : null;
}

function clampInteger(value: unknown, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function clampUnit(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.min(1, parsed));
}

function stringOrUndefined(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.trim() ? truncate(value.trim(), maxLength) : undefined;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function parseJsonObject<T>(value: string): T | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}
