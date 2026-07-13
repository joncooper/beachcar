import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRunRecord } from "../src/shared/types";

const dbMocks = vi.hoisted(() => ({
  createAgentRunRequest: vi.fn(),
  createIdempotentAgentRunRequest: vi.fn(),
  getManagedResearchAccess: vi.fn(),
  getProfile: vi.fn(),
  markAgentRunPrepared: vi.fn(),
  markAgentRunRunning: vi.fn(),
}));

vi.mock("agents", () => ({ Agent: class {} }));
vi.mock("../src/worker/db", () => ({
  ...dbMocks,
  inactiveAiSettingsError: "Active managed or BYOK AI settings are required before running",
  missingByokAliasError: "BYOK mode requires an AI Gateway key alias",
}));

import { BeachcarAgent, type BeachcarAgentState } from "../src/worker/agents/beachcar-agent";

describe("BeachcarAgent scheduled-run retries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getProfile.mockResolvedValue({
      onboardingCompletedAt: "2026-07-01T12:00:00.000Z",
      scheduleCron: "0 8 * * *",
      timezone: "America/New_York",
    });
    dbMocks.getManagedResearchAccess.mockResolvedValue({
      settings: { mode: "managed" },
      entitlement: { feature: "managed_research", active: true, source: "clerk_session" },
      allowed: true,
    });
  });

  it("creates one Agent run and starts one Workflow for duplicate callback delivery", async () => {
    const createdRuns = new Map<string, AgentRunRecord>();
    dbMocks.createIdempotentAgentRunRequest.mockImplementation(async (_db, input: { requestId: string }) => {
      const existing = createdRuns.get(input.requestId);
      if (existing) return { run: existing, created: false };
      const now = "2026-07-11T12:00:00.000Z";
      const run: AgentRunRecord = {
        id: `agent-run-request-${input.requestId}`,
        userId: "email:friend@example.com",
        status: "queued",
        progress: { source: "schedule", reason: "scheduled_agent", requestId: input.requestId },
        createdAt: now,
        updatedAt: now,
      };
      createdRuns.set(input.requestId, run);
      return { run, created: true };
    });

    const initialState: BeachcarAgentState = {
      userId: "email:friend@example.com",
      scheduleCron: "0 8 * * *",
      scheduleTimezone: "America/New_York",
      scheduleId: "current-schedule",
      nextRunAt: "2026-07-11T12:00:00.000Z",
      latestRunId: null,
      latestStatus: null,
      phase: "scheduled",
      updatedAt: "2026-07-10T12:00:00.000Z",
    };
    const startRunWorkflow = vi.fn(async (run: AgentRunRecord) => {
      const started = {
        ...run,
        status: "running" as const,
        workflowInstanceId: `workflow-${run.id}`,
      };
      const requestId = String(run.progress.requestId);
      createdRuns.set(requestId, started);
      return started;
    });
    const agent = {
      env: { DB: {} },
      state: initialState,
      setState(nextState: BeachcarAgentState) {
        this.state = nextState;
      },
      scheduleNextDailyRun: vi.fn().mockResolvedValue({
        schedule: { id: "next-schedule" },
        nextRunAt: "2026-07-12T12:00:00.000Z",
      }),
      cancelDailySchedules: vi.fn().mockResolvedValue(undefined),
      startRunWorkflow,
    };
    const input = {
      userId: "email:friend@example.com",
      scheduleCron: "0 8 * * *",
      timezone: "America/New_York",
      scheduledFor: "2026-07-11T12:00:00.000Z",
    };

    const first = await BeachcarAgent.prototype.queueScheduledRun.call(agent as unknown as BeachcarAgent, input);
    const duplicate = await BeachcarAgent.prototype.queueScheduledRun.call(agent as unknown as BeachcarAgent, input);

    expect(createdRuns.size).toBe(1);
    expect(dbMocks.createIdempotentAgentRunRequest).toHaveBeenCalledTimes(2);
    expect(dbMocks.createIdempotentAgentRunRequest.mock.calls[0]?.[1]?.requestId).toBe(
      dbMocks.createIdempotentAgentRunRequest.mock.calls[1]?.[1]?.requestId,
    );
    expect(dbMocks.createAgentRunRequest).not.toHaveBeenCalled();
    expect(startRunWorkflow).toHaveBeenCalledTimes(1);
    expect(first?.workflowInstanceId).toBe(`workflow-${first?.id}`);
    expect(duplicate?.id).toBe(first?.id);
    expect(duplicate?.progress.idempotentReused).toBe(true);
  });
});
