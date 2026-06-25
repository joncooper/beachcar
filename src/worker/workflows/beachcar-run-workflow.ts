import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep, DefaultProgress } from "agents/workflows";
import type { ImportPayload, SourceSetting } from "../../shared/types";
import type { BeachcarAgent } from "../agents/beachcar-agent";
import {
  createRunnerTask,
  exportFeedback,
  getLatestRun,
  getUserPayload,
  importRun,
  markAgentRunFailed,
  markAgentRunPublished,
  markAgentRunRunning,
  type UserScope,
} from "../db";
import { prewarmImportedImages } from "../image-cache";
import { createAiGatewayCandidateScorer } from "./ai-gateway-scoring";
import {
  discoverAndScoreCandidates,
  SOURCE_DISCOVERY_PUBLISHER,
  type DiscoveryContext,
  type DiscoverySourceSetting,
  type SourceDiscoveryCheck,
} from "./source-discovery";

export interface BeachcarRunWorkflowParams {
  userId: string;
  runId: string;
  source: "manual" | "schedule";
  reason?: string | null;
}

type BeachcarRunProgress = DefaultProgress & {
  stage?: "starting" | "context" | "discovery" | "publish" | "complete";
  agentRunId?: string;
  listingCount?: number;
};

export class BeachcarRunWorkflow extends AgentWorkflow<BeachcarAgent, BeachcarRunWorkflowParams, BeachcarRunProgress, Env> {
  async run(event: AgentWorkflowEvent<BeachcarRunWorkflowParams>, step: AgentWorkflowStep): Promise<unknown> {
    const params = event.payload;
    try {
      const running = await step.do("mark agent run running", async () => {
        const updated = await markAgentRunRunning(this.env.DB, {
          runId: params.runId,
          workflowInstanceId: this.workflowId,
          runnerId: "cloudflare-workflow",
        });
        return { updatedAt: updated.updatedAt };
      });
      await step.mergeAgentState({
        userId: params.userId,
        latestRunId: params.runId,
        latestStatus: "running",
        phase: "queued",
        updatedAt: running.updatedAt,
      });
      await this.reportProgress({ stage: "starting", status: "running", percent: 0.15, agentRunId: params.runId });

      const context = await step.do("load user context", async () => {
        const scope: UserScope = { userId: params.userId, includeLegacyData: false };
        const [user, feedback, latestRun] = await Promise.all([
          getUserPayload(this.env.DB, params.userId),
          exportFeedback(this.env.DB, scope),
          getLatestRun(this.env.DB, scope),
        ]);
        const profile = user.profile;
        return {
          userId: params.userId,
          email: user.email,
          niche: profile?.niche || "Beach cars and runabouts",
          budgetMax: profile?.budgetMax || 30000,
          stretchBudget: profile?.stretchBudget || 0,
          homeRegion: profile?.homeRegion || "Northeast",
          timezone: profile?.timezone || "America/New_York",
          tasteNotes: stringProfileValue(profile?.profile || {}, "tasteNotes", "Open-air, simple, beach-town practical."),
          avoidNotes: stringProfileValue(profile?.profile || {}, "avoidNotes", "Major rust, salvage titles, fragile projects."),
          aiMode: user.aiSettings?.mode || null,
          gatewayKeyRef: user.aiSettings?.gatewayKeyRef || null,
          enabledSources: (user.sourceSettings || []).filter((setting) => setting.enabled).map((setting) => setting.source),
          sourceSettings: discoverySourceSettings(user.sourceSettings || []),
          feedbackCount: feedback.counts.total,
          latestRunId: latestRun?.id || null,
        } satisfies DiscoveryContext;
      });
      await this.reportProgress({ stage: "context", status: "complete", percent: 0.35, agentRunId: params.runId });

      const draft = await step.do("discover and score source candidates", async () => {
        const aiScorer = createAiGatewayCandidateScorer(this.env, {
          userId: params.userId,
          agentRunId: params.runId,
          mode: context.aiMode === "managed" || context.aiMode === "byok" ? context.aiMode : null,
          gatewayKeyRef: context.gatewayKeyRef,
        });
        return discoverAndScoreCandidates(context, params, { aiScorer });
      });

      const runnerTasks = await step.do("queue blocked-source runner tasks", async () => {
        return queueBlockedSourceRunnerTasks(this.env, params, context, draft.blockedSources);
      });
      await this.reportProgress({
        stage: "discovery",
        status: "complete",
        percent: 0.7,
        agentRunId: params.runId,
        listingCount: draft.listings.length,
      });

      const imported = await step.do("publish workflow run", async () => {
        const payload: ImportPayload = {
          runId: runIdForAgentRun(params.runId),
          generatedAt: draft.generatedAt,
          reportMarkdown: draft.reportMarkdown,
          sourceSummary: {
            publisher: SOURCE_DISCOVERY_PUBLISHER,
            agentRunId: params.runId,
            workflowInstanceId: this.workflowId,
            source: params.source,
            reason: params.reason || null,
            userId: params.userId,
            feedbackCount: context.feedbackCount,
            enabledSources: context.enabledSources,
            sourceSettings: sourceSettingsSummary(context.sourceSettings || []),
            previousRunId: context.latestRunId,
            profile: profileSummary(context),
            checkedSources: draft.checkedSources,
            blockedSources: draft.blockedSources,
            fallbackUsed: draft.fallbackUsed,
            rawCandidateCount: draft.rawCandidateCount,
            aiScoring: draft.aiScoring,
            runnerTasks,
          },
          listings: draft.listings,
        };
        const result = await importRun(this.env.DB, payload, params.userId);
        return {
          runId: result.runId,
          listingCount: result.listingCount,
          imageCount: result.imageCount,
          images: result.images,
        };
      });

      const imageWarmup = await step.do("prewarm image variants", async () => {
        return prewarmImportedImages(this.env, imported.images);
      });

      const published = await step.do("mark agent run published", async () => {
        const updated = await markAgentRunPublished(this.env.DB, {
          runId: params.runId,
          publishedRunId: imported.runId,
          listingCount: imported.listingCount,
          imageCount: imported.imageCount,
        });
        return {
          agentRunUpdatedAt: updated.updatedAt,
          publishedRunId: imported.runId,
          listingCount: imported.listingCount,
          imageCount: imported.imageCount,
          imageWarmup,
        };
      });

      await step.mergeAgentState({
        userId: params.userId,
        latestRunId: params.runId,
        latestStatus: "published",
        phase: "idle",
        updatedAt: published.agentRunUpdatedAt,
      });
      await this.reportProgress({
        stage: "complete",
        status: "complete",
        percent: 1,
        agentRunId: params.runId,
        listingCount: published.listingCount,
      });
      await step.reportComplete({
        agentRunId: params.runId,
        publishedRunId: published.publishedRunId,
        listingCount: published.listingCount,
        imageWarmup: published.imageWarmup,
      });
      return published;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await step.do("mark agent run failed", async () => {
        const updated = await markAgentRunFailed(this.env.DB, { runId: params.runId, error: message });
        return { updatedAt: updated.updatedAt };
      });
      await step.mergeAgentState({
        userId: params.userId,
        latestRunId: params.runId,
        latestStatus: "failed",
        phase: "idle",
        updatedAt: failed.updatedAt,
      });
      await step.reportError(message);
      throw error;
    }
  }
}

function runIdForAgentRun(agentRunId: string): string {
  return `run-from-${agentRunId.replace(/[^0-9a-z-]/gi, "-").toLowerCase()}`;
}

function profileSummary(context: DiscoveryContext): Record<string, string | number | null> {
  return {
    niche: context.niche,
    budgetMax: context.budgetMax,
    stretchBudget: context.stretchBudget,
    homeRegion: context.homeRegion,
    timezone: context.timezone,
    aiMode: context.aiMode,
  };
}

function discoverySourceSettings(settings: SourceSetting[]): DiscoverySourceSetting[] {
  return settings.map((setting) => ({
    source: setting.source,
    enabled: setting.enabled,
    settings: serializableSettings(setting.settings),
  }));
}

function sourceSettingsSummary(settings: DiscoverySourceSetting[]): Array<{ source: string; enabled: boolean; settings: Record<string, string | number | boolean | null> }> {
  return settings.map((setting) => ({
    source: setting.source,
    enabled: setting.enabled,
    settings: setting.settings,
  }));
}

function sourceSettingsForSource(context: DiscoveryContext, source: string): Record<string, string | number | boolean | null> {
  return context.sourceSettings?.find((setting) => setting.source === source)?.settings || {};
}

function serializableSettings(settings: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const serializable: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      serializable[key] = value;
    }
  }
  return serializable;
}

function stringProfileValue(profile: Record<string, unknown>, key: string, fallback: string): string {
  const value = profile[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

async function queueBlockedSourceRunnerTasks(
  env: Env,
  params: BeachcarRunWorkflowParams,
  context: DiscoveryContext,
  blockedSources: SourceDiscoveryCheck[],
): Promise<Array<{ id: string; source: string; kind: string; status: string }>> {
  const taskable = blockedSources.filter((source) => source.status === "blocked");
  const tasks = [];
  for (const source of taskable) {
    const task = await createRunnerTask(env.DB, {
      userId: params.userId,
      agentRunId: params.runId,
      kind: source.source === "carsandbids" || source.source === "marketplace" ? "browser_source" : "source_discovery",
      source: source.source,
      priority: source.source === "carsandbids" ? 80 : 50,
      input: {
        source,
        sourceSettings: sourceSettingsForSource(context, source.source),
        profile: profileSummary(context),
        tasteNotes: context.tasteNotes,
        avoidNotes: context.avoidNotes,
        latestRunId: context.latestRunId,
        agentRunId: params.runId,
        requestedBy: params.source,
        runner: {
          preferredRuntime: "cloudflare-container",
          allowedTools: ["codex-sdk", "browser", "http-fetch"],
          output: "normalized auction candidates or a concrete blocked reason",
        },
      },
    });
    tasks.push({ id: task.id, source: task.source, kind: task.kind, status: task.status });
  }
  return tasks;
}
