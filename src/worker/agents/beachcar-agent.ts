import { Agent } from "agents";
import type { AgentRunRecord } from "../../shared/types";
import { createAgentRunRequest, getProfile, markAgentRunPrepared, markAgentRunRunning } from "../db";
import { isDailyCron, nextDailyRunAt, normalizeTimezone } from "../daily-schedule";
import type { BeachcarRunWorkflowParams } from "../workflows/beachcar-run-workflow";

export interface BeachcarAgentState {
  userId: string | null;
  scheduleCron: string | null;
  scheduleTimezone: string | null;
  scheduleId: string | null;
  nextRunAt: string | null;
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

interface ScheduledRunPayload {
  userId: string;
  scheduleCron: string;
  timezone: string;
  scheduledFor?: string;
}

interface ScheduledRunCallbackPayload {
  userId: string;
  scheduleCron?: string;
  timezone?: string;
  scheduledFor?: string;
}

export class BeachcarAgent extends Agent<Env, BeachcarAgentState, BeachcarAgentProps> {
  static options = { sendIdentityOnConnect: false };

  initialState: BeachcarAgentState = {
    userId: null,
    scheduleCron: null,
    scheduleTimezone: null,
    scheduleId: null,
    nextRunAt: null,
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

  async syncSchedule(input: {
    userId: string;
    scheduleCron?: string | null;
    timezone?: string | null;
    enabled?: boolean;
  }): Promise<BeachcarAgentState> {
    const scheduleCron = normalizeCron(input.scheduleCron);
    const scheduleTimezone = normalizeTimezone(input.timezone);
    const nextRun = input.enabled && scheduleCron && isDailyCron(scheduleCron) ? nextDailyRunAt(scheduleCron, scheduleTimezone) : null;

    let scheduleId: string | null = null;
    let nextRunAt: string | null = null;
    if (input.enabled && scheduleCron) {
      const scheduled = await this.scheduleNextDailyRun({ userId: input.userId, scheduleCron, timezone: scheduleTimezone }, nextRun);
      const { schedule } = scheduled;
      scheduleId = schedule.id;
      nextRunAt = scheduled.nextRunAt;
      await this.cancelDailySchedules(schedule.id);
    } else {
      await this.cancelDailySchedules();
    }

    const nextState: BeachcarAgentState = {
      ...this.state,
      userId: input.userId,
      scheduleCron,
      scheduleTimezone,
      scheduleId,
      nextRunAt,
      phase: scheduleId ? "scheduled" : this.state.latestStatus === "queued" ? "queued" : "idle",
      updatedAt: new Date().toISOString(),
    };
    this.setState(nextState);
    return nextState;
  }

  async queueScheduledRun(input: ScheduledRunCallbackPayload): Promise<AgentRunRecord | null> {
    const profile = await getProfile(this.env.DB, input.userId);
    if (!profile?.onboardingCompletedAt) {
      await this.cancelDailySchedules();
      this.setState({
        ...this.state,
        userId: input.userId,
        scheduleCron: null,
        scheduleTimezone: null,
        scheduleId: null,
        nextRunAt: null,
        phase: "idle",
        updatedAt: new Date().toISOString(),
      });
      console.log(JSON.stringify({ level: "info", message: "scheduled_agent.cancelled_missing_profile", userId: input.userId }));
      return null;
    }
    const scheduleCron = normalizeCron(profile.scheduleCron) || normalizeCron(input.scheduleCron) || normalizeCron(this.state.scheduleCron) || "0 8 * * *";
    const timezone = normalizeTimezone(profile.timezone || input.timezone || this.state.scheduleTimezone);
    const scheduled = await this.scheduleNextDailyRun({ userId: input.userId, scheduleCron, timezone });
    await this.cancelDailySchedules(scheduled.schedule.id);
    this.setState({
      ...this.state,
      userId: input.userId,
      scheduleCron,
      scheduleTimezone: timezone,
      scheduleId: scheduled.schedule.id,
      nextRunAt: scheduled.nextRunAt,
      phase: "scheduled",
      updatedAt: new Date().toISOString(),
    });

    let run: AgentRunRecord;
    try {
      run = await createAgentRunRequest(this.env.DB, { userId: input.userId, source: "schedule", reason: "scheduled_agent" });
    } catch (error) {
      if (error instanceof Error && error.message.includes("AI budget exceeded")) {
        console.log(
          JSON.stringify({
            level: "info",
            message: "scheduled_agent.skipped_budget",
            userId: input.userId,
            scheduledFor: input.scheduledFor || null,
            nextRunAt: scheduled.nextRunAt,
          }),
        );
        return null;
      }
      if (error instanceof Error && error.message.includes("Active user required")) {
        await this.cancelDailySchedules();
        this.setState({
          ...this.state,
          userId: input.userId,
          scheduleId: null,
          nextRunAt: null,
          phase: "idle",
          updatedAt: new Date().toISOString(),
        });
        console.log(JSON.stringify({ level: "info", message: "scheduled_agent.cancelled_inactive_user", userId: input.userId }));
        return null;
      }
      throw error;
    }
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

  private async cancelDailySchedules(exceptId?: string): Promise<void> {
    const schedules = await this.listSchedules();
    await Promise.all(
      schedules
        .filter((schedule) => schedule.callback === "queueScheduledRun" && schedule.id !== exceptId)
        .map((schedule) => this.cancelSchedule(schedule.id)),
    );
  }

  private async scheduleNextDailyRun(input: {
    userId: string;
    scheduleCron: string;
    timezone: string;
  }, nextRun: Date | null = isDailyCron(input.scheduleCron) ? nextDailyRunAt(input.scheduleCron, input.timezone) : null): Promise<{
    schedule: Awaited<ReturnType<BeachcarAgent["schedule"]>>;
    nextRunAt: string;
  }> {
    if (!nextRun) {
      const schedule = await this.schedule<ScheduledRunPayload>(
        input.scheduleCron,
        "queueScheduledRun",
        input,
        { idempotent: true },
      );
      const nextRunAt = new Date(schedule.time * 1_000).toISOString();
      console.log(
        JSON.stringify({
          level: "warn",
          message: "scheduled_agent.legacy_utc_cron",
          userId: input.userId,
          scheduleCron: input.scheduleCron,
          nextRunAt,
        }),
      );
      return { schedule, nextRunAt };
    }

    const nextRunAt = nextRun.toISOString();
    const schedule = await this.schedule<ScheduledRunPayload>(
      nextRun,
      "queueScheduledRun",
      { ...input, scheduledFor: nextRunAt },
      { idempotent: true },
    );
    return { schedule, nextRunAt };
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
