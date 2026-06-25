import { Agent } from "agents";
import type { AgentRunRecord } from "../../shared/types";
import { createAgentRunRequest, markAgentRunPrepared, markAgentRunRunning } from "../db";
import type { BeachcarRunWorkflowParams } from "../workflows/beachcar-run-workflow";

export interface BeachcarAgentState {
  userId: string | null;
  scheduleCron: string | null;
  scheduleId: string | null;
  latestRunId: string | null;
  latestStatus: AgentRunRecord["status"] | null;
  phase: "idle" | "scheduled" | "queued";
  updatedAt: string | null;
}

interface BeachcarAgentProps {
  [key: string]: unknown;
  userId?: string;
}

interface QueuePayload {
  userId: string;
  runId: string;
}

export class BeachcarAgent extends Agent<Env, BeachcarAgentState, BeachcarAgentProps> {
  static options = { sendIdentityOnConnect: false };

  initialState: BeachcarAgentState = {
    userId: null,
    scheduleCron: null,
    scheduleId: null,
    latestRunId: null,
    latestStatus: null,
    phase: "idle",
    updatedAt: null,
  };

  async onStart(props?: BeachcarAgentProps): Promise<void> {
    if (props?.userId && this.state.userId !== props.userId) {
      this.setState({ ...this.state, userId: props.userId, updatedAt: new Date().toISOString() });
    }
  }

  async queueManualRun(input: { userId: string; reason?: unknown }): Promise<AgentRunRecord> {
    const run = await createAgentRunRequest(this.env.DB, { userId: input.userId, source: "manual", reason: input.reason });
    const started = await this.startRunWorkflow(run, {
      userId: input.userId,
      runId: run.id,
      source: "manual",
      reason: typeof input.reason === "string" ? input.reason.trim().slice(0, 240) : null,
    });
    this.setState({
      ...this.state,
      userId: input.userId,
      latestRunId: run.id,
      latestStatus: started.status,
      phase: started.status === "running" ? "queued" : "queued",
      updatedAt: started.updatedAt,
    });
    return started;
  }

  async syncSchedule(input: { userId: string; scheduleCron?: string | null; enabled?: boolean }): Promise<BeachcarAgentState> {
    await this.cancelDailySchedules();

    const scheduleCron = normalizeCron(input.scheduleCron);
    let scheduleId: string | null = null;
    if (input.enabled && scheduleCron) {
      const schedule = await this.schedule(scheduleCron, "queueScheduledRun", { userId: input.userId }, { idempotent: true });
      scheduleId = schedule.id;
    }

    const nextState: BeachcarAgentState = {
      ...this.state,
      userId: input.userId,
      scheduleCron,
      scheduleId,
      phase: scheduleId ? "scheduled" : this.state.latestStatus === "queued" ? "queued" : "idle",
      updatedAt: new Date().toISOString(),
    };
    this.setState(nextState);
    return nextState;
  }

  async queueScheduledRun(input: { userId: string }): Promise<AgentRunRecord> {
    const run = await createAgentRunRequest(this.env.DB, { userId: input.userId, source: "schedule", reason: "scheduled_agent" });
    const started = await this.startRunWorkflow(run, {
      userId: input.userId,
      runId: run.id,
      source: "schedule",
      reason: "scheduled_agent",
    });
    this.setState({
      ...this.state,
      userId: input.userId,
      latestRunId: run.id,
      latestStatus: started.status,
      phase: "queued",
      updatedAt: started.updatedAt,
    });
    return started;
  }

  async prepareQueuedRun(input: QueuePayload): Promise<{ runId: string; handoff: "queued_for_external_runner" }> {
    const run = await markAgentRunPrepared(this.env.DB, {
      userId: input.userId,
      runId: input.runId,
      handoff: "queued_for_external_runner",
    });
    this.setState({
      ...this.state,
      userId: input.userId,
      latestRunId: input.runId,
      latestStatus: run?.status || "queued",
      phase: "queued",
      updatedAt: run?.updatedAt || new Date().toISOString(),
    });
    return { runId: input.runId, handoff: "queued_for_external_runner" };
  }

  async markRunRunning(input: QueuePayload): Promise<BeachcarAgentState> {
    const nextState: BeachcarAgentState = {
      ...this.state,
      userId: input.userId,
      latestRunId: input.runId,
      latestStatus: "running",
      phase: "queued",
      updatedAt: new Date().toISOString(),
    };
    this.setState(nextState);
    return nextState;
  }

  async markRunPublished(input: QueuePayload): Promise<BeachcarAgentState> {
    const nextState: BeachcarAgentState = {
      ...this.state,
      userId: input.userId,
      latestRunId: input.runId,
      latestStatus: "published",
      phase: this.state.scheduleId ? "scheduled" : "idle",
      updatedAt: new Date().toISOString(),
    };
    this.setState(nextState);
    return nextState;
  }

  async markRunFailed(input: QueuePayload): Promise<BeachcarAgentState> {
    const nextState: BeachcarAgentState = {
      ...this.state,
      userId: input.userId,
      latestRunId: input.runId,
      latestStatus: "failed",
      phase: this.state.scheduleId ? "scheduled" : "idle",
      updatedAt: new Date().toISOString(),
    };
    this.setState(nextState);
    return nextState;
  }

  private async cancelDailySchedules(): Promise<void> {
    const schedules = await this.listSchedules({ type: "cron" });
    await Promise.all(schedules.filter((schedule) => schedule.callback === "queueScheduledRun").map((schedule) => this.cancelSchedule(schedule.id)));
  }

  private async startRunWorkflow(run: AgentRunRecord, params: BeachcarRunWorkflowParams): Promise<AgentRunRecord> {
    try {
      const workflowInstanceId = await this.runWorkflow("BEACHCAR_RUN_WORKFLOW", params, {
        id: workflowInstanceIdFor(run.id),
        metadata: { userId: params.userId, agentRunId: run.id, source: params.source },
        agentBinding: "BeachcarAgent",
      });
      return markAgentRunRunning(this.env.DB, {
        runId: run.id,
        workflowInstanceId,
        runnerId: "cloudflare-workflow",
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "warn",
          message: error instanceof Error ? error.message : String(error),
          runId: run.id,
          userId: params.userId,
        }),
      );
      await this.queue("prepareQueuedRun", { userId: params.userId, runId: run.id });
      return run;
    }
  }
}

function normalizeCron(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function workflowInstanceIdFor(agentRunId: string): string {
  return `workflow-${agentRunId.replace(/[^0-9a-z-]/gi, "-").toLowerCase()}`;
}
