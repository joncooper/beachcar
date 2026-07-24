import { describe, expect, it } from "vitest";
import {
  agentRunIdForRequest,
  agentRunNeedsWorkflowDispatch,
  agentRunRequestConflictMessage,
  assertMatchingAgentRunRequest,
  invalidAgentRunRequestIdMessage,
  onboardingAgentRunRequestId,
  normalizeAgentRunReason,
  normalizeAgentRunRequestId,
} from "../src/worker/agent-run-idempotency";

describe("Agent-run request idempotency", () => {
  const requestId = "550e8400-e29b-41d4-a716-446655440000";

  it("normalizes canonical UUIDs and derives a stable Agent-run id", () => {
    expect(normalizeAgentRunRequestId(`  ${requestId.toUpperCase()}  `)).toBe(requestId);
    expect(agentRunIdForRequest(requestId)).toBe(`agent-run-request-${requestId}`);
  });

  it("derives exactly one stable first-run request per user", async () => {
    const first = await onboardingAgentRunRequestId("email:friend@example.com");
    expect(await onboardingAgentRunRequestId("email:friend@example.com")).toBe(first);
    expect(await onboardingAgentRunRequestId("email:other@example.com")).not.toBe(first);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects malformed, non-canonical, and non-string request ids", () => {
    for (const value of [undefined, null, "", "not-a-uuid", "550e8400e29b41d4a716446655440000", 42]) {
      expect(() => normalizeAgentRunRequestId(value)).toThrow(invalidAgentRunRequestIdMessage);
    }
  });

  it("normalizes reasons before they become immutable request identity", () => {
    expect(normalizeAgentRunReason("  source-quality pilot  ")).toBe("source-quality pilot");
    expect(normalizeAgentRunReason(" ")).toBeNull();
    expect(normalizeAgentRunReason("x".repeat(300))).toHaveLength(240);
  });

  it("only retries Workflow dispatch for an undispatched Cloudflare-Agent handoff", () => {
    const queued = {
      status: "queued" as const,
      workflowInstanceId: null,
      progress: { handoff: "queued_for_cloudflare_agent" },
    };

    expect(agentRunNeedsWorkflowDispatch(queued)).toBe(true);
    expect(agentRunNeedsWorkflowDispatch({ ...queued, workflowInstanceId: "workflow-existing" })).toBe(false);
    expect(agentRunNeedsWorkflowDispatch({ ...queued, status: "running" })).toBe(false);
    expect(agentRunNeedsWorkflowDispatch({ ...queued, progress: { handoff: "queued_for_external_runner" } })).toBe(false);
  });

  it("allows exact reuse and rejects user, source, reason, or request-id conflicts", () => {
    const run = {
      userId: "email:friend@example.com",
      progress: { source: "manual", reason: "source-quality pilot", requestId },
    };
    const input = {
      userId: "email:friend@example.com",
      source: "manual" as const,
      reason: "source-quality pilot",
      requestId,
    };

    expect(() => assertMatchingAgentRunRequest(run, input)).not.toThrow();
    expect(() => assertMatchingAgentRunRequest(run, { ...input, userId: "email:other@example.com" })).toThrow(agentRunRequestConflictMessage);
    expect(() => assertMatchingAgentRunRequest(run, { ...input, source: "schedule" })).toThrow(agentRunRequestConflictMessage);
    expect(() => assertMatchingAgentRunRequest(run, { ...input, reason: "changed" })).toThrow(agentRunRequestConflictMessage);
    expect(() => assertMatchingAgentRunRequest(run, { ...input, requestId: "018f47a0-93d5-7f12-b345-123456789abc" })).toThrow(
      agentRunRequestConflictMessage,
    );
  });
});
