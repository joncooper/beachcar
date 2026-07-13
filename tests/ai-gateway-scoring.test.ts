import { afterEach, describe, expect, it, vi } from "vitest";
import { recordAiUsageEvent } from "../src/worker/db";
import { aiGatewayRuntimeConfigured, createAiGatewayCandidateScorer } from "../src/worker/workflows/ai-gateway-scoring";

vi.mock("../src/worker/db", () => ({
  recordAiUsageEvent: vi.fn(),
}));

const gatewayEnv = {
  BEACHCAR_AI_GATEWAY_TOKEN: "dedicated-runtime-token",
  CLOUDFLARE_ACCOUNT_ID: "b8873e78bf5e48fcdc91e87f2324cf55",
  DB: {},
} as unknown as Env;

function scoringInput(urls: string[]) {
  return {
    context: {},
    params: {},
    candidates: urls.map((url, index) => ({
      candidate: {
        url,
        title: `Candidate ${index + 1}`,
        site: "Bring a Trailer",
        sourceQuery: "beach car",
        bid: "$10,000",
        total: "10 bids",
        summary: "A submitted auction candidate.",
      },
      score: 20,
      matches: [],
      penalties: [],
    })),
  } as never;
}

function gatewayResponse(scores: Array<Record<string, unknown>>): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ scores }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    }),
    { status: 200, headers: { "cf-aig-request-id": "gateway-request-1" } },
  );
}

describe("AI Gateway runtime credential isolation", () => {
  const context = { userId: "user-1", agentRunId: "agent-run-1", mode: "managed" as const };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("never treats the Wrangler operator token as a model credential", () => {
    const env = {
      CLOUDFLARE_API_TOKEN: "operator-token-must-not-enter-the-worker-runtime",
      CLOUDFLARE_ACCOUNT_ID: "b8873e78bf5e48fcdc91e87f2324cf55",
    } as unknown as Env;

    expect(createAiGatewayCandidateScorer(env, context)).toBeNull();
  });

  it("enables managed scoring only with the dedicated runtime token", () => {
    const env = {
      BEACHCAR_AI_GATEWAY_TOKEN: "dedicated-runtime-token",
      CLOUDFLARE_ACCOUNT_ID: "b8873e78bf5e48fcdc91e87f2324cf55",
    } as unknown as Env;

    expect(createAiGatewayCandidateScorer(env, context)).not.toBeNull();
  });

  it("never sends the dedicated Cloudflare token to an arbitrary configured host", () => {
    const env = {
      BEACHCAR_AI_GATEWAY_TOKEN: "dedicated-runtime-token",
      BEACHCAR_AI_GATEWAY_BASE_URL: "https://example.invalid/collect",
    } as unknown as Env;

    expect(createAiGatewayCandidateScorer(env, context)).toBeNull();
  });

  it("fails closed instead of falling back when an explicit base endpoint is invalid", () => {
    const env = {
      BEACHCAR_AI_GATEWAY_TOKEN: "dedicated-runtime-token",
      BEACHCAR_AI_GATEWAY_BASE_URL: "https://example.invalid/collect",
      CLOUDFLARE_ACCOUNT_ID: "b8873e78bf5e48fcdc91e87f2324cf55",
    } as unknown as Env;

    expect(createAiGatewayCandidateScorer(env, context)).toBeNull();
    expect(aiGatewayRuntimeConfigured(env)).toBe(false);
  });

  it("allows an HTTP loopback scorer only behind the explicit local-test flag", () => {
    const base = {
      BEACHCAR_AI_GATEWAY_TOKEN: "local-test-token",
      BEACHCAR_AI_GATEWAY_BASE_URL: "http://127.0.0.1:8790/v1/chat/completions",
    } as unknown as Env;

    expect(createAiGatewayCandidateScorer(base, context)).toBeNull();
    expect(createAiGatewayCandidateScorer({ ...base, BEACHCAR_AI_GATEWAY_ALLOW_LOCAL_TEST: "true" }, context)).not.toBeNull();
    expect(
      createAiGatewayCandidateScorer(
        { ...base, BEACHCAR_AI_GATEWAY_BASE_URL: "http://example.invalid/collect", BEACHCAR_AI_GATEWAY_ALLOW_LOCAL_TEST: "true" },
        context,
      ),
    ).toBeNull();
  });

  it("does not follow redirects with the dedicated Gateway credential", async () => {
    let requestInit: RequestInit | undefined;
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestInit = init;
      return new Response("redirect refused", {
        status: 302,
        headers: { location: "https://example.invalid/credential-collector" },
      });
    });
    const env = {
      BEACHCAR_AI_GATEWAY_TOKEN: "dedicated-runtime-token",
      CLOUDFLARE_ACCOUNT_ID: "b8873e78bf5e48fcdc91e87f2324cf55",
      DB: {
        prepare: (sql: string) => ({
          bind() {
            return this;
          },
          async first() {
            return sql.includes("SELECT * FROM ai_usage_events")
              ? {
                  id: "ai-usage-fixture",
                  user_id: "user-1",
                  agent_run_id: "agent-run-1",
                  provider: "cloudflare-ai-gateway",
                  model: "openai/gpt-4.1",
                  operation: "candidate_scoring",
                  mode: "managed",
                  gateway_id: null,
                  gateway_key_ref: null,
                  gateway_request_id: "ai-gateway-score-agent-run-1",
                  input_tokens: null,
                  output_tokens: null,
                  total_tokens: null,
                  cost_micros: 0,
                  status: "error",
                  metadata_json: "{}",
                  occurred_at: new Date().toISOString(),
                  created_at: new Date().toISOString(),
                }
              : null;
          },
          async run() {
            return { success: true };
          },
        }),
      },
    } as unknown as Env;
    const scorer = createAiGatewayCandidateScorer(env, context);

    const result = await scorer!.scoreCandidates({ context: {}, params: {}, candidates: [] } as never);

    expect(requestInit?.redirect).toBe("manual");
    expect(result.status).toBe("failed");
  });

  it("keeps only scores for exact URLs submitted to the Gateway", async () => {
    const submittedUrl = "https://bringatrailer.com/listing/valid-candidate/";
    vi.stubGlobal("fetch", vi.fn(async () => gatewayResponse([
      { url: "https://example.invalid/hallucinated", scoreDelta: 20 },
      { url: submittedUrl, scoreDelta: 7, why: "Matches the requested profile." },
      { url: `${submittedUrl}?changed=1`, scoreDelta: 19 },
    ])));
    const scorer = createAiGatewayCandidateScorer(gatewayEnv, context);

    const result = await scorer!.scoreCandidates(scoringInput([submittedUrl]));

    expect(result.status).toBe("ok");
    expect(result.scores).toEqual([
      expect.objectContaining({ url: submittedUrl, scoreDelta: 7 }),
    ]);
    expect(recordAiUsageEvent).toHaveBeenCalledWith(
      gatewayEnv.DB,
      expect.objectContaining({
        status: "ok",
        metadata: expect.objectContaining({ scoreCount: 1, rejectedScoreCount: 2 }),
      }),
    );
  });

  it("rejects unrelated-only scores and records failed Gateway evidence", async () => {
    const submittedUrl = "https://bringatrailer.com/listing/submitted-candidate/";
    vi.stubGlobal("fetch", vi.fn(async () => gatewayResponse([
      { url: "https://example.invalid/hallucinated", scoreDelta: 20 },
      { url: `${submittedUrl}different`, scoreDelta: 18 },
    ])));
    const scorer = createAiGatewayCandidateScorer(gatewayEnv, context);

    const result = await scorer!.scoreCandidates(scoringInput([submittedUrl]));

    expect(result.status).toBe("failed");
    expect(result.scores).toEqual([]);
    expect(recordAiUsageEvent).toHaveBeenCalledWith(
      gatewayEnv.DB,
      expect.objectContaining({
        status: "error",
        metadata: expect.objectContaining({ scoreCount: 0, rejectedScoreCount: 2 }),
      }),
    );
  });
});
