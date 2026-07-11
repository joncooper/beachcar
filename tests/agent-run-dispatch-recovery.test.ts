import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRunRecord } from "../src/shared/types";
import type { BeachcarRunWorkflowParams } from "../src/worker/workflows/beachcar-run-workflow";

const dbMocks = vi.hoisted(() => ({
  createAgentRunRequest: vi.fn(),
  createIdempotentAgentRunRequest: vi.fn(),
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

const requestId = "550e8400-e29b-41d4-a716-446655440000";
const userId = "email:friend@example.com";

describe("BeachcarAgent manual-run dispatch recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resumes the same queued row after interruption between insert and Workflow dispatch", async () => {
    const run = queuedRun();
    let storedRun = run;
    let inserted = false;
    dbMocks.createIdempotentAgentRunRequest.mockImplementation(async () => {
      const created = !inserted;
      inserted = true;
      return { run: storedRun, created };
    });

    const workflowIds = new Set<string>();
    const startRunWorkflow = vi.fn(async (candidate: AgentRunRecord) => {
      if (startRunWorkflow.mock.calls.length === 1) {
        throw new Error("simulated termination before Workflow dispatch");
      }
      const workflowInstanceId = `workflow-${candidate.id}`;
      workflowIds.add(workflowInstanceId);
      storedRun = { ...candidate, status: "running", workflowInstanceId };
      return storedRun;
    });
    const agent = fakeAgent({ startRunWorkflow });

    await expect(
      BeachcarAgent.prototype.queueManualRun.call(agent, { userId, reason: "source-quality pilot", requestId }),
    ).rejects.toThrow("simulated termination before Workflow dispatch");
    const recovered = await BeachcarAgent.prototype.queueManualRun.call(agent, {
      userId,
      reason: "source-quality pilot",
      requestId,
    });
    const exactRetry = await BeachcarAgent.prototype.queueManualRun.call(agent, {
      userId,
      reason: "source-quality pilot",
      requestId,
    });

    expect(dbMocks.createIdempotentAgentRunRequest).toHaveBeenCalledTimes(3);
    expect(startRunWorkflow).toHaveBeenCalledTimes(2);
    expect(workflowIds).toEqual(new Set([`workflow-${run.id}`]));
    expect(recovered.id).toBe(run.id);
    expect(recovered.workflowInstanceId).toBe(`workflow-${run.id}`);
    expect(recovered.progress.idempotentReused).toBe(true);
    expect(exactRetry.id).toBe(run.id);
    expect(exactRetry.progress.idempotentReused).toBe(true);
  });

  it("reconciles the deterministic Workflow when dispatch succeeded before the D1 running update", async () => {
    const run = queuedRun();
    dbMocks.createIdempotentAgentRunRequest.mockResolvedValue({ run, created: false });
    dbMocks.markAgentRunRunning.mockImplementation(async (_db, input: { workflowInstanceId: string }) => ({
      ...run,
      status: "running" as const,
      workflowInstanceId: input.workflowInstanceId,
    }));

    const status = vi.fn().mockResolvedValue({ status: "queued" });
    const get = vi.fn().mockResolvedValue({ status });
    const runWorkflow = vi.fn().mockRejectedValue(new Error("Workflow instance already exists"));
    const queue = vi.fn();
    const startRunWorkflow = Reflect.get(BeachcarAgent.prototype, "startRunWorkflow") as (
      this: BeachcarAgent,
      run: AgentRunRecord,
      params: BeachcarRunWorkflowParams,
    ) => Promise<AgentRunRecord>;
    const agent = fakeAgent({
      env: { DB: {}, BEACHCAR_RUN_WORKFLOW: { get } },
      queue,
      runWorkflow,
      startRunWorkflow,
    });

    const recovered = await BeachcarAgent.prototype.queueManualRun.call(agent, {
      userId,
      reason: "source-quality pilot",
      requestId,
    });
    const expectedWorkflowId = `workflow-${run.id}`;

    expect(runWorkflow).toHaveBeenCalledTimes(1);
    expect(runWorkflow.mock.calls[0]?.[2]?.id).toBe(expectedWorkflowId);
    expect(get).toHaveBeenCalledWith(expectedWorkflowId);
    expect(status).toHaveBeenCalledTimes(1);
    expect(dbMocks.markAgentRunRunning).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ runId: run.id, workflowInstanceId: expectedWorkflowId }),
    );
    expect(queue).not.toHaveBeenCalled();
    expect(recovered.workflowInstanceId).toBe(expectedWorkflowId);
    expect(recovered.progress.idempotentReused).toBe(true);
  });
});

function queuedRun(): AgentRunRecord {
  const now = "2026-07-11T12:00:00.000Z";
  return {
    id: `agent-run-request-${requestId}`,
    userId,
    status: "queued",
    workflowInstanceId: null,
    progress: {
      source: "manual",
      reason: "source-quality pilot",
      requestId,
      handoff: "queued_for_cloudflare_agent",
    },
    createdAt: now,
    updatedAt: now,
  };
}

function fakeAgent(overrides: Record<string, unknown> = {}): BeachcarAgent {
  const state: BeachcarAgentState = {
    userId,
    scheduleCron: null,
    scheduleTimezone: null,
    scheduleId: null,
    nextRunAt: null,
    latestRunId: null,
    latestStatus: null,
    phase: "idle",
    updatedAt: null,
  };
  const agent = Object.create(BeachcarAgent.prototype) as BeachcarAgent;
  Object.assign(agent, {
    env: { DB: {} },
    state,
    setState(nextState: BeachcarAgentState) {
      this.state = nextState;
    },
    ...overrides,
  });
  return agent;
}
