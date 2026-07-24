import type { AgentRunRecord } from "../shared/types";

export const invalidAgentRunRequestIdMessage = "requestId must be a canonical UUID";
export const agentRunRequestConflictMessage = "requestId conflicts with an existing Agent run request";

const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function scheduledAgentRunRequestId(userId: string, scheduledFor: string): Promise<string> {
  const normalizedUserId = userId.trim();
  const scheduledAt = new Date(scheduledFor.trim());
  if (!normalizedUserId) throw new Error("Scheduled Agent run requires a user id");
  if (!scheduledFor.trim() || !Number.isFinite(scheduledAt.getTime())) {
    throw new Error("Scheduled Agent run requires a valid scheduledFor timestamp");
  }

  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`beachcar:scheduled-agent-run:v1\0${normalizedUserId}\0${scheduledAt.toISOString()}`),
    ),
  ).slice(0, 16);
  // RFC 9562 UUIDv8 reserves the payload bits for application-defined identities.
  digest[6] = (digest[6] & 0x0f) | 0x80;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function onboardingAgentRunRequestId(userId: string): Promise<string> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error("Onboarding Agent run requires a user id");
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`beachcar:onboarding-agent-run:v1\0${normalizedUserId}`)),
  ).slice(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x80;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function normalizeAgentRunRequestId(value: unknown): string {
  const requestId = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!canonicalUuidPattern.test(requestId)) throw new Error(invalidAgentRunRequestIdMessage);
  return requestId;
}

export function agentRunIdForRequest(value: unknown): string {
  return `agent-run-request-${normalizeAgentRunRequestId(value)}`;
}

export function normalizeAgentRunReason(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 240) : null;
}

export function agentRunNeedsWorkflowDispatch(run: Pick<AgentRunRecord, "status" | "workflowInstanceId" | "progress">): boolean {
  return (
    run.status === "queued" &&
    !run.workflowInstanceId &&
    run.progress.handoff === "queued_for_cloudflare_agent"
  );
}

export function assertMatchingAgentRunRequest(
  run: Pick<AgentRunRecord, "userId" | "progress">,
  input: { userId: string; source: "manual" | "schedule"; reason: string | null; requestId: string },
): void {
  const progress = run.progress;
  const storedReason = typeof progress.reason === "string" ? progress.reason : null;
  if (
    run.userId !== input.userId ||
    progress.source !== input.source ||
    progress.requestId !== input.requestId ||
    storedReason !== input.reason
  ) {
    throw new Error(agentRunRequestConflictMessage);
  }
}
