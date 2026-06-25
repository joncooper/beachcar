import { looksLikeRawProviderKey } from "../shared/ai-keys";
import { imageKeyFor, inferTags, listingKeyFor, normalizeAction, normalizeListing, r2KeyFor } from "../shared/normalize";
import type {
  AccountDeletionResult,
  AccountExport,
  AiUsageEventRecord,
  AiUsageSummary,
  AgentRunRecord,
  AuctionListing,
  FeedbackExport,
  FeedbackRecord,
  ImageStatus,
  ImportPayload,
  PreferenceEvent,
  RunPayload,
  RunnerTaskRecord,
  SourceSetting,
  UserAiSettings,
  UserPayload,
  UserProfile,
} from "../shared/types";
import type { AuthUser } from "./auth";

export interface UserScope {
  userId: string;
  includeLegacyData?: boolean;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  status: UserPayload["status"];
}

interface AdminUserRow extends UserRow {
  created_at: string;
  last_seen_at: string;
  onboarding_completed_at: string | null;
  latest_run_at: string | null;
}

interface InviteRow {
  id: string;
  email: string;
  accepted_by_user_id: string | null;
  expires_at: string | null;
  created_at: string;
  accepted_at: string | null;
}

interface ProfileRow {
  user_id: string;
  display_name: string | null;
  niche: string;
  budget_min: number | null;
  budget_max: number | null;
  stretch_budget: number | null;
  home_region: string | null;
  timezone: string;
  schedule_cron: string;
  profile_json: string;
  onboarding_completed_at: string | null;
  updated_at: string;
}

interface SourceSettingRow {
  source: string;
  enabled: number;
  settings_json: string;
  updated_at: string;
}

interface UserAiSettingsRow {
  user_id: string;
  mode: UserAiSettings["mode"];
  gateway_key_ref: string | null;
  monthly_budget_cents: number | null;
  daily_budget_cents: number | null;
  status: UserAiSettings["status"];
  updated_at: string;
}

interface AiUsageEventRow {
  id: string;
  user_id: string;
  agent_run_id: string | null;
  provider: string;
  model: string | null;
  operation: string;
  mode: UserAiSettings["mode"] | null;
  gateway_id: string | null;
  gateway_key_ref: string | null;
  gateway_request_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cost_micros: number;
  status: AiUsageEventRecord["status"];
  metadata_json: string;
  occurred_at: string;
  created_at: string;
}

interface RunnerTaskRow {
  id: string;
  user_id: string;
  agent_run_id: string | null;
  kind: RunnerTaskRecord["kind"];
  source: string;
  status: RunnerTaskRecord["status"];
  priority: number;
  input_json: string;
  result_json: string | null;
  error: string | null;
  runner_id: string | null;
  claimed_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ImageRow {
  image_key: string;
  listing_key: string;
  source_url: string;
  r2_key: string;
  content_type: string | null;
  byte_length: number | null;
  status: "pending" | "copied" | "failed";
  error: string | null;
}

interface ImageVariantRow {
  image_key: string;
  variant: string;
  r2_key: string;
  width: number | null;
  height: number | null;
  content_type: string | null;
  byte_length: number | null;
  status: "pending" | "created" | "failed";
  error: string | null;
}

interface FeedbackRow {
  user_id: string | null;
  listing_key: string;
  action: FeedbackRecord["action"];
  tags_json: string;
  note: string | null;
  updated_at: string;
}

interface PreferenceEventRow {
  id: string;
  user_id: string | null;
  listing_key: string | null;
  event_type: PreferenceEvent["eventType"];
  note: string | null;
  transcript: string | null;
  tags_json: string;
  created_at: string;
}

interface RunRow {
  id: string;
  user_id: string | null;
  generated_at: string;
  report_markdown: string | null;
  source_summary_json: string | null;
}

interface AgentRunRow {
  id: string;
  user_id: string;
  workflow_instance_id: string | null;
  status: AgentRunRecord["status"];
  progress_json: string;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

interface UsageSumRow {
  spend: number | null;
}

interface RunListingRow {
  listing_key: string;
  payload_json: string;
}

export interface ImportResult {
  runId: string;
  listingCount: number;
  imageCount: number;
  images: Array<{ listingKey: string; imageKey: string; sourceUrl: string; r2Key: string }>;
}

export async function ensureUser(db: D1Database, authUser: AuthUser, input: { isOwner?: boolean } = {}): Promise<UserPayload> {
  const now = new Date().toISOString();
  const insertStatus = input.isOwner ? "active" : "invited";
  await db
    .prepare(
      `INSERT INTO users (id, auth_provider, auth_subject, email, status, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         auth_provider = excluded.auth_provider,
         auth_subject = excluded.auth_subject,
         email = excluded.email,
         status = CASE
           WHEN ? = 1 AND users.status != 'disabled' THEN 'active'
           ELSE users.status
         END,
         last_seen_at = excluded.last_seen_at`,
    )
    .bind(authUser.id, authUser.provider, authUser.subject, authUser.email, insertStatus, now, now, input.isOwner ? 1 : 0)
    .run();

  return getUserPayload(db, authUser.id);
}

export async function createInvite(
  db: D1Database,
  input: { email?: unknown; invitedByUserId?: string | null; expiresAt?: unknown },
): Promise<{ id: string; email: string; code: string; createdAt: string; expiresAt: string | null }> {
  const email = typeof input.email === "string" && input.email.trim() ? input.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) throw new Error("Invite email is required");
  const createdAt = new Date().toISOString();
  const id = `invite-${createdAt.replace(/[^0-9a-z]/gi, "-").toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
  const code = crypto.randomUUID().replace(/-/g, "");
  const codeHash = await sha256Hex(code);
  const expiresAt = typeof input.expiresAt === "string" && input.expiresAt.trim() ? input.expiresAt.trim() : null;

  await db
    .prepare(
      `INSERT INTO invites (id, email, code_hash, invited_by_user_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, email, codeHash, input.invitedByUserId || null, expiresAt, createdAt)
    .run();

  return { id, email, code, createdAt, expiresAt };
}

export async function acceptInvite(db: D1Database, authUser: AuthUser, code: unknown): Promise<UserPayload> {
  const rawCode = typeof code === "string" ? code.trim() : "";
  if (!rawCode) throw new Error("Invite code is required");
  const codeHash = await sha256Hex(rawCode);
  const invite = await db
    .prepare("SELECT id, email, accepted_by_user_id, expires_at, created_at, accepted_at FROM invites WHERE code_hash = ?")
    .bind(codeHash)
    .first<InviteRow>();
  if (!invite) throw new Error("Invite code is invalid");
  if (invite.accepted_at || invite.accepted_by_user_id) throw new Error("Invite has already been accepted");
  if (invite.email.toLowerCase() !== authUser.email.toLowerCase()) throw new Error("Invite email does not match signed-in account");
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) throw new Error("Invite has expired");

  const acceptedAt = new Date().toISOString();
  await db
    .prepare("UPDATE users SET status = 'active', last_seen_at = ? WHERE id = ?")
    .bind(acceptedAt, authUser.id)
    .run();
  await db
    .prepare("UPDATE invites SET accepted_by_user_id = ?, accepted_at = ? WHERE id = ?")
    .bind(authUser.id, acceptedAt, invite.id)
    .run();
  await recordAuditEvent(db, { userId: authUser.id, actorUserId: authUser.id, eventType: "invite.accepted", metadata: { inviteId: invite.id } });

  return getUserPayload(db, authUser.id);
}

export async function listAdminUsers(db: D1Database): Promise<
  Array<{
    id: string;
    email: string;
    displayName?: string | null;
    status: UserPayload["status"];
    onboardingCompletedAt?: string | null;
    latestRunAt?: string | null;
    aiUsage?: AiUsageSummary | null;
    createdAt: string;
    lastSeenAt: string;
  }>
> {
  const { results } = await db
    .prepare(
      `SELECT
         users.id,
         users.email,
         users.display_name,
         users.status,
         users.created_at,
         users.last_seen_at,
         profiles.onboarding_completed_at,
         MAX(runs.generated_at) AS latest_run_at
       FROM users
       LEFT JOIN profiles ON profiles.user_id = users.id
       LEFT JOIN runs ON runs.user_id = users.id
       GROUP BY users.id, users.email, users.display_name, users.status, users.created_at, users.last_seen_at, profiles.onboarding_completed_at
       ORDER BY users.created_at DESC`,
    )
    .all<AdminUserRow>();
  return Promise.all(
    results.map(async (row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      status: row.status,
      onboardingCompletedAt: row.onboarding_completed_at,
      latestRunAt: row.latest_run_at,
      aiUsage: await getAiUsageSummary(db, row.id),
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    })),
  );
}

export async function getUserPayload(db: D1Database, userId: string): Promise<UserPayload> {
  const user = await db.prepare("SELECT id, email, display_name, status FROM users WHERE id = ?").bind(userId).first<UserRow>();
  if (!user) throw new Error("Unknown user");
  const [profile, sourceSettings, aiSettings, aiUsage] = await Promise.all([
    getProfile(db, userId),
    getSourceSettings(db, userId),
    getAiSettings(db, userId),
    getAiUsageSummary(db, userId),
  ]);
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    status: user.status,
    profile,
    sourceSettings,
    aiSettings,
    aiUsage,
    onboarding: {
      completed: Boolean(profile?.onboardingCompletedAt),
      completedAt: profile?.onboardingCompletedAt || null,
    },
    capabilities: {
      canUseManagedAi: true,
      canUseByok: true,
      canRunNow: user.status === "active" && !aiUsage.budgetExceeded,
    },
  };
}

export async function upsertProfile(
  db: D1Database,
  userId: string,
  input: {
    displayName?: unknown;
    niche?: unknown;
    budgetMin?: unknown;
    budgetMax?: unknown;
    stretchBudget?: unknown;
    homeRegion?: unknown;
    timezone?: unknown;
    scheduleCron?: unknown;
    profile?: unknown;
    completeOnboarding?: unknown;
  },
): Promise<UserProfile> {
  const existing = await getProfile(db, userId);
  const now = new Date().toISOString();
  const profileJson = normalizeJsonObject(input.profile, existing?.profile || {});
  const onboardingCompletedAt =
    input.completeOnboarding === true ? existing?.onboardingCompletedAt || now : existing?.onboardingCompletedAt || null;

  const next = {
    displayName: stringOrNull(input.displayName, existing?.displayName ?? null),
    niche: stringOrDefault(input.niche, existing?.niche || "Beach cars and runabouts"),
    budgetMin: numberOrNull(input.budgetMin, existing?.budgetMin ?? null),
    budgetMax: numberOrNull(input.budgetMax, existing?.budgetMax ?? null),
    stretchBudget: numberOrNull(input.stretchBudget, existing?.stretchBudget ?? null),
    homeRegion: stringOrNull(input.homeRegion, existing?.homeRegion ?? null),
    timezone: stringOrDefault(input.timezone, existing?.timezone || "America/New_York"),
    scheduleCron: stringOrDefault(input.scheduleCron, existing?.scheduleCron || "0 8 * * *"),
    profileJson,
    onboardingCompletedAt,
  };

  await db
    .prepare(
      `INSERT INTO profiles (
         user_id, display_name, niche, budget_min, budget_max, stretch_budget, home_region,
         timezone, schedule_cron, profile_json, onboarding_completed_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         display_name = excluded.display_name,
         niche = excluded.niche,
         budget_min = excluded.budget_min,
         budget_max = excluded.budget_max,
         stretch_budget = excluded.stretch_budget,
         home_region = excluded.home_region,
         timezone = excluded.timezone,
         schedule_cron = excluded.schedule_cron,
         profile_json = excluded.profile_json,
         onboarding_completed_at = excluded.onboarding_completed_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      userId,
      next.displayName,
      next.niche,
      next.budgetMin,
      next.budgetMax,
      next.stretchBudget,
      next.homeRegion,
      next.timezone,
      next.scheduleCron,
      JSON.stringify(next.profileJson),
      next.onboardingCompletedAt,
      now,
    )
    .run();

  const saved = await getProfile(db, userId);
  if (!saved) throw new Error("Could not save profile");
  return saved;
}

export async function upsertAiSettings(
  db: D1Database,
  userId: string,
  input: {
    mode?: unknown;
    gatewayKeyRef?: unknown;
    monthlyBudgetCents?: unknown;
    dailyBudgetCents?: unknown;
  },
): Promise<UserAiSettings> {
  const existing = await getAiSettings(db, userId);
  const mode: UserAiSettings["mode"] =
    input.mode === "byok" || input.mode === "managed" ? input.mode : existing?.mode || "managed";
  const gatewayKeyRef = mode === "byok" ? stringOrNull(input.gatewayKeyRef, existing?.gatewayKeyRef ?? null) : null;
  if (gatewayKeyRef && looksLikeRawProviderKey(gatewayKeyRef)) {
    throw new Error("Store provider keys in AI Gateway BYOK, then save the gateway key reference here");
  }

  const monthlyBudgetCents = numberOrNull(input.monthlyBudgetCents, existing?.monthlyBudgetCents ?? null);
  const dailyBudgetCents = numberOrNull(input.dailyBudgetCents, existing?.dailyBudgetCents ?? null);
  const status: UserAiSettings["status"] = mode === "managed" || gatewayKeyRef ? "active" : "not_configured";
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO user_ai_settings (
         user_id, mode, gateway_key_ref, monthly_budget_cents, daily_budget_cents, status, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         mode = excluded.mode,
         gateway_key_ref = excluded.gateway_key_ref,
         monthly_budget_cents = excluded.monthly_budget_cents,
         daily_budget_cents = excluded.daily_budget_cents,
         status = excluded.status,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, mode, gatewayKeyRef, monthlyBudgetCents, dailyBudgetCents, status, now)
    .run();

  const saved = await getAiSettings(db, userId);
  if (!saved) throw new Error("Could not save AI settings");
  return saved;
}

export async function getAiUsageSummary(db: D1Database, userId: string, now = new Date()): Promise<AiUsageSummary> {
  const settings = await getAiSettings(db, userId);
  const daily = usageWindow(now, "daily");
  const monthly = usageWindow(now, "monthly");
  const [dailySpend, monthlySpend] = await Promise.all([
    sumAiUsageMicros(db, userId, daily.startsAt, daily.endsAt),
    sumAiUsageMicros(db, userId, monthly.startsAt, monthly.endsAt),
  ]);

  const dailyBudgetCents = settings?.dailyBudgetCents ?? null;
  const monthlyBudgetCents = settings?.monthlyBudgetCents ?? null;
  const dailyWindow = {
    ...daily,
    spendMicros: dailySpend,
    budgetCents: dailyBudgetCents,
    remainingMicros: remainingMicros(dailyBudgetCents, dailySpend),
    limitExceeded: limitExceeded(dailyBudgetCents, dailySpend),
  };
  const monthlyWindow = {
    ...monthly,
    spendMicros: monthlySpend,
    budgetCents: monthlyBudgetCents,
    remainingMicros: remainingMicros(monthlyBudgetCents, monthlySpend),
    limitExceeded: limitExceeded(monthlyBudgetCents, monthlySpend),
  };

  return {
    generatedAt: now.toISOString(),
    daily: dailyWindow,
    monthly: monthlyWindow,
    budgetExceeded: dailyWindow.limitExceeded || monthlyWindow.limitExceeded,
  };
}

export async function assertAiBudgetAvailable(db: D1Database, userId: string): Promise<void> {
  const summary = await getAiUsageSummary(db, userId);
  if (!summary.budgetExceeded) return;
  throw new Error("AI budget exceeded for this user");
}

export async function recordAiUsageEvent(
  db: D1Database,
  input: {
    userId: string;
    agentRunId?: unknown;
    provider?: unknown;
    model?: unknown;
    operation?: unknown;
    mode?: unknown;
    gatewayId?: unknown;
    gatewayKeyRef?: unknown;
    gatewayRequestId?: unknown;
    inputTokens?: unknown;
    outputTokens?: unknown;
    totalTokens?: unknown;
    costMicros?: unknown;
    costCents?: unknown;
    status?: unknown;
    metadata?: unknown;
    occurredAt?: unknown;
  },
): Promise<AiUsageEventRecord> {
  const now = new Date().toISOString();
  const id = `ai-usage-${now.replace(/[^0-9a-z]/gi, "-").toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
  const costMicros = normalizeCostMicros(input.costMicros, input.costCents);
  const inputTokens = integerOrNull(input.inputTokens);
  const outputTokens = integerOrNull(input.outputTokens);
  const totalTokens = integerOrNull(input.totalTokens) ?? (inputTokens === null && outputTokens === null ? null : (inputTokens || 0) + (outputTokens || 0));
  const occurredAt = isoDateOrDefault(input.occurredAt, now);
  const status: AiUsageEventRecord["status"] = input.status === "error" || input.status === "cached" ? input.status : "ok";
  const mode = input.mode === "managed" || input.mode === "byok" ? input.mode : null;
  const metadata = normalizeJsonObject(input.metadata, {});
  const gatewayRequestId = stringOrNull(input.gatewayRequestId, null);
  const existing = gatewayRequestId
    ? await db.prepare("SELECT id FROM ai_usage_events WHERE gateway_request_id = ?").bind(gatewayRequestId).first<{ id: string }>()
    : null;

  if (existing) {
    await db
      .prepare(
        `UPDATE ai_usage_events
         SET user_id = ?,
             agent_run_id = ?,
             provider = ?,
             model = ?,
             operation = ?,
             mode = ?,
             gateway_id = ?,
             gateway_key_ref = ?,
             input_tokens = ?,
             output_tokens = ?,
             total_tokens = ?,
             cost_micros = ?,
             status = ?,
             metadata_json = ?,
             occurred_at = ?
         WHERE id = ?`,
      )
      .bind(
        input.userId,
        stringOrNull(input.agentRunId, null),
        stringOrDefault(input.provider, "unknown"),
        stringOrNull(input.model, null),
        stringOrDefault(input.operation, "model_call"),
        mode,
        stringOrNull(input.gatewayId, null),
        stringOrNull(input.gatewayKeyRef, null),
        inputTokens,
        outputTokens,
        totalTokens,
        costMicros,
        status,
        JSON.stringify(metadata),
        occurredAt,
        existing.id,
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO ai_usage_events (
         id, user_id, agent_run_id, provider, model, operation, mode, gateway_id, gateway_key_ref,
         gateway_request_id, input_tokens, output_tokens, total_tokens, cost_micros, status,
         metadata_json, occurred_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.userId,
        stringOrNull(input.agentRunId, null),
        stringOrDefault(input.provider, "unknown"),
        stringOrNull(input.model, null),
        stringOrDefault(input.operation, "model_call"),
        mode,
        stringOrNull(input.gatewayId, null),
        stringOrNull(input.gatewayKeyRef, null),
        gatewayRequestId,
        inputTokens,
        outputTokens,
        totalTokens,
        costMicros,
        status,
        JSON.stringify(metadata),
        occurredAt,
      )
      .run();
  }

  const row = gatewayRequestId
    ? await db.prepare("SELECT * FROM ai_usage_events WHERE gateway_request_id = ?").bind(gatewayRequestId).first<AiUsageEventRow>()
    : await db.prepare("SELECT * FROM ai_usage_events WHERE id = ?").bind(id).first<AiUsageEventRow>();
  if (!row) throw new Error("Could not record AI usage");
  return aiUsageEventFromRow(row);
}

export async function getAiUsageEvents(db: D1Database, userId: string, limit = 100): Promise<AiUsageEventRecord[]> {
  const { results } = await db
    .prepare("SELECT * FROM ai_usage_events WHERE user_id = ? ORDER BY occurred_at DESC, created_at DESC LIMIT ?")
    .bind(userId, Math.max(1, Math.min(500, Math.floor(limit))))
    .all<AiUsageEventRow>();
  return results.map(aiUsageEventFromRow);
}

export async function createRunnerTask(
  db: D1Database,
  input: {
    userId: string;
    agentRunId?: string | null;
    kind: RunnerTaskRecord["kind"];
    source: string;
    priority?: number;
    input: Record<string, unknown>;
  },
): Promise<RunnerTaskRecord> {
  const now = new Date().toISOString();
  const source = input.source.trim().toLowerCase();
  const idBase = `${input.kind}-${source}-${input.agentRunId || input.userId}`;
  const id = `runner-task-${idBase.replace(/[^0-9a-z-]/gi, "-").toLowerCase()}`.slice(0, 180);
  await db
    .prepare(
      `INSERT INTO runner_tasks (
         id, user_id, agent_run_id, kind, source, status, priority, input_json, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         input_json = excluded.input_json,
         priority = excluded.priority,
         updated_at = excluded.updated_at`,
    )
    .bind(id, input.userId, input.agentRunId || null, input.kind, source, Math.max(0, Math.floor(input.priority || 0)), JSON.stringify(input.input), now, now)
    .run();
  const task = await getRunnerTaskById(db, id);
  if (!task) throw new Error("Could not create runner task");
  return task;
}

export async function getRunnerTasks(db: D1Database, userId: string, limit = 100): Promise<RunnerTaskRecord[]> {
  const { results } = await db
    .prepare("SELECT * FROM runner_tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
    .bind(userId, Math.max(1, Math.min(500, Math.floor(limit))))
    .all<RunnerTaskRow>();
  return results.map(runnerTaskFromRow);
}

export async function getNextRunnerTask(db: D1Database, agentRunId?: string | null): Promise<RunnerTaskRecord | null> {
  const row = agentRunId
    ? await db
        .prepare("SELECT * FROM runner_tasks WHERE status = 'queued' AND agent_run_id = ? ORDER BY priority DESC, created_at ASC LIMIT 1")
        .bind(agentRunId)
        .first<RunnerTaskRow>()
    : await db
        .prepare("SELECT * FROM runner_tasks WHERE status = 'queued' ORDER BY priority DESC, created_at ASC LIMIT 1")
        .first<RunnerTaskRow>();
  return row ? runnerTaskFromRow(row) : null;
}

export async function getRunnerTaskById(db: D1Database, id: string): Promise<RunnerTaskRecord | null> {
  const row = await db.prepare("SELECT * FROM runner_tasks WHERE id = ?").bind(id).first<RunnerTaskRow>();
  return row ? runnerTaskFromRow(row) : null;
}

export async function claimRunnerTask(
  db: D1Database,
  input: { taskId?: unknown; agentRunId?: unknown; runnerId?: unknown } = {},
): Promise<RunnerTaskRecord | null> {
  const taskId = stringOrNull(input.taskId, null);
  const agentRunId = stringOrNull(input.agentRunId, null);
  const task = taskId ? await getRunnerTaskById(db, taskId) : await getNextRunnerTask(db, agentRunId);
  if (!task) return null;
  if (task.status !== "queued") return task;

  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE runner_tasks
       SET status = 'running',
           runner_id = ?,
           claimed_at = ?,
           error = NULL,
           updated_at = ?
       WHERE id = ? AND status = 'queued'`,
    )
    .bind(stringOrNull(input.runnerId, null), now, now, task.id)
    .run();
  return getRunnerTaskById(db, task.id);
}

export async function completeRunnerTask(
  db: D1Database,
  id: string,
  input: { result?: unknown; runnerId?: unknown } = {},
): Promise<RunnerTaskRecord> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE runner_tasks
       SET status = 'completed',
           result_json = ?,
           error = NULL,
           runner_id = COALESCE(?, runner_id),
           finished_at = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(JSON.stringify(normalizeJsonObject(input.result, {})), stringOrNull(input.runnerId, null), now, now, id)
    .run();
  const task = await getRunnerTaskById(db, id);
  if (!task) throw new Error("Runner task not found");
  return task;
}

export async function failRunnerTask(db: D1Database, id: string, input: { error?: unknown; runnerId?: unknown } = {}): Promise<RunnerTaskRecord> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE runner_tasks
       SET status = 'failed',
           error = ?,
           runner_id = COALESCE(?, runner_id),
           finished_at = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(String(input.error || "Runner task failed").slice(0, 1000), stringOrNull(input.runnerId, null), now, now, id)
    .run();
  const task = await getRunnerTaskById(db, id);
  if (!task) throw new Error("Runner task not found");
  return task;
}

export async function upsertSourceSettings(
  db: D1Database,
  userId: string,
  input: { sources?: unknown },
): Promise<SourceSetting[]> {
  const sources = normalizeSourceSettings(input.sources);
  if (sources.length === 0) return getSourceSettings(db, userId);

  const now = new Date().toISOString();
  for (const source of sources) {
    await db
      .prepare(
        `INSERT INTO source_settings (user_id, source, enabled, settings_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, source) DO UPDATE SET
           enabled = excluded.enabled,
           settings_json = excluded.settings_json,
           updated_at = excluded.updated_at`,
      )
      .bind(userId, source.source, source.enabled ? 1 : 0, JSON.stringify(source.settings), now, now)
      .run();
  }

  return getSourceSettings(db, userId);
}

export async function importRun(db: D1Database, payload: ImportPayload | AuctionListing[], userId?: string): Promise<ImportResult> {
  const rawListings = Array.isArray(payload) ? payload : payload.listings || payload.items || [];
  if (!Array.isArray(rawListings) || rawListings.length === 0) {
    throw new Error("Import payload must include at least one listing");
  }

  const runUserId = userId || (Array.isArray(payload) ? undefined : payload.userId);
  const generatedAt = Array.isArray(payload) ? new Date().toISOString() : payload.generatedAt || new Date().toISOString();
  const requestedRunId = Array.isArray(payload) ? "" : typeof payload.runId === "string" ? payload.runId.trim() : "";
  const runId = requestedRunId || `run-${generatedAt.replace(/[^0-9a-z]/gi, "-").toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
  const sourceSummary = Array.isArray(payload) ? null : payload.sourceSummary ?? null;
  const reportMarkdown = Array.isArray(payload) ? null : payload.reportMarkdown ?? null;
  const importedImages: ImportResult["images"] = [];

  const existingRun = await db.prepare("SELECT id FROM runs WHERE id = ?").bind(runId).first<{ id: string }>();
  if (existingRun) {
    return { runId, listingCount: rawListings.length, imageCount: 0, images: [] };
  }

  await db
    .prepare("INSERT INTO runs (id, user_id, generated_at, report_markdown, source_summary_json, status, completed_at) VALUES (?, ?, ?, ?, ?, 'published', ?)")
    .bind(runId, runUserId || null, generatedAt, reportMarkdown, sourceSummary === null ? null : JSON.stringify(sourceSummary), new Date().toISOString())
    .run();

  for (let index = 0; index < rawListings.length; index += 1) {
    const listing = normalizeListing(rawListings[index]);
    const listingKey = await listingKeyFor(listing.site, listing.url, listing.title);
    const now = new Date().toISOString();
    const payloadWithKey: AuctionListing = { ...listing, listingKey };
    const payloadJson = JSON.stringify(payloadWithKey);

    await db
      .prepare(
        `INSERT INTO listings (listing_key, site, title, url, lane, first_seen_at, last_seen_at, last_payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(listing_key) DO UPDATE SET
           site = excluded.site,
           title = excluded.title,
           url = excluded.url,
           lane = excluded.lane,
           last_seen_at = excluded.last_seen_at,
           last_payload_json = excluded.last_payload_json`,
      )
      .bind(listingKey, listing.site, listing.title, listing.url, listing.lane, now, now, payloadJson)
      .run();

    await db
      .prepare("INSERT INTO run_listings (run_id, listing_key, sort_order, payload_json) VALUES (?, ?, ?, ?)")
      .bind(runId, listingKey, index, payloadJson)
      .run();

    for (const sourceUrl of listing.images.slice(0, 5)) {
      const imageKey = await imageKeyFor(listingKey, sourceUrl);
      const r2Key = r2KeyFor(imageKey);
      await db
        .prepare(
          `INSERT INTO images (image_key, listing_key, source_url, r2_key, status)
           VALUES (?, ?, ?, ?, 'pending')
           ON CONFLICT(image_key) DO UPDATE SET
             listing_key = excluded.listing_key,
             source_url = excluded.source_url,
             r2_key = excluded.r2_key,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(imageKey, listingKey, sourceUrl, r2Key)
        .run();
      importedImages.push({ listingKey, imageKey, sourceUrl, r2Key });
    }
  }

  return { runId, listingCount: rawListings.length, imageCount: importedImages.length, images: importedImages };
}

export async function markImageCopied(
  db: D1Database,
  input: { imageKey: string; listingKey: string; sourceUrl: string; r2Key: string; contentType: string | null; byteLength: number | null },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO images (image_key, listing_key, source_url, r2_key, content_type, byte_length, status, copied_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'copied', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(image_key) DO UPDATE SET
         listing_key = excluded.listing_key,
         source_url = excluded.source_url,
         r2_key = excluded.r2_key,
         content_type = excluded.content_type,
         byte_length = excluded.byte_length,
         status = 'copied',
         error = NULL,
         copied_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(input.imageKey, input.listingKey, input.sourceUrl, input.r2Key, input.contentType, input.byteLength)
    .run();
}

export async function markImageFailed(
  db: D1Database,
  input: { imageKey: string; listingKey: string; sourceUrl: string; r2Key: string; error: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO images (image_key, listing_key, source_url, r2_key, status, error, updated_at)
       VALUES (?, ?, ?, ?, 'failed', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(image_key) DO UPDATE SET
         status = 'failed',
         error = excluded.error,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(input.imageKey, input.listingKey, input.sourceUrl, input.r2Key, input.error)
    .run();
}

export async function getImage(db: D1Database, imageKey: string): Promise<ImageRow | null> {
  return db.prepare("SELECT * FROM images WHERE image_key = ?").bind(imageKey).first<ImageRow>();
}

export async function getImageVariant(db: D1Database, imageKey: string, variant: string): Promise<ImageVariantRow | null> {
  return db.prepare("SELECT * FROM image_variants WHERE image_key = ? AND variant = ?").bind(imageKey, variant).first<ImageVariantRow>();
}

export async function markImageVariantCreated(
  db: D1Database,
  input: {
    imageKey: string;
    variant: string;
    r2Key: string;
    width: number | null;
    height: number | null;
    contentType: string | null;
    byteLength: number | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO image_variants (image_key, variant, r2_key, width, height, content_type, byte_length, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'created', CURRENT_TIMESTAMP)
       ON CONFLICT(image_key, variant) DO UPDATE SET
         r2_key = excluded.r2_key,
         width = excluded.width,
         height = excluded.height,
         content_type = excluded.content_type,
         byte_length = excluded.byte_length,
         status = 'created',
         error = NULL,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(input.imageKey, input.variant, input.r2Key, input.width, input.height, input.contentType, input.byteLength)
    .run();
}

export async function markImageVariantFailed(
  db: D1Database,
  input: { imageKey: string; variant: string; r2Key: string; width: number | null; height: number | null; error: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO image_variants (image_key, variant, r2_key, width, height, status, error, updated_at)
       VALUES (?, ?, ?, ?, ?, 'failed', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(image_key, variant) DO UPDATE SET
         r2_key = excluded.r2_key,
         width = excluded.width,
         height = excluded.height,
         status = 'failed',
         error = excluded.error,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(input.imageKey, input.variant, input.r2Key, input.width, input.height, input.error)
    .run();
}

export async function getLatestRun(db: D1Database, scope: UserScope): Promise<RunPayload | null> {
  const runWhere = scope.includeLegacyData ? "(user_id = ? OR user_id IS NULL)" : "user_id = ?";
  const run = await db
    .prepare(`SELECT * FROM runs WHERE ${runWhere} ORDER BY generated_at DESC, created_at DESC LIMIT 1`)
    .bind(scope.userId)
    .first<RunRow>();
  if (!run) return null;
  return runPayloadFromRow(db, scope, run);
}

export async function exportAccount(db: D1Database, scope: UserScope): Promise<AccountExport> {
  const [user, feedback, runs, agentRuns, aiUsageEvents, runnerTasks] = await Promise.all([
    getUserPayload(db, scope.userId),
    exportFeedback(db, scope),
    getRuns(db, scope),
    getAgentRuns(db, scope.userId),
    getAiUsageEvents(db, scope.userId, 500),
    getRunnerTasks(db, scope.userId, 500),
  ]);
  return {
    version: 1,
    kind: "beachcar-account-export",
    generatedAt: new Date().toISOString(),
    user,
    feedback,
    runs,
    agentRuns,
    aiUsageEvents,
    runnerTasks,
  };
}

export async function deleteAccountData(db: D1Database, userId: string): Promise<AccountDeletionResult> {
  const disabledAt = new Date().toISOString();
  const deleted = {
    profiles: await countRows(db, "SELECT COUNT(*) AS count FROM profiles WHERE user_id = ?", userId),
    sourceSettings: await countRows(db, "SELECT COUNT(*) AS count FROM source_settings WHERE user_id = ?", userId),
    aiSettings: await countRows(db, "SELECT COUNT(*) AS count FROM user_ai_settings WHERE user_id = ?", userId),
    aiUsageEvents: await countRows(db, "SELECT COUNT(*) AS count FROM ai_usage_events WHERE user_id = ?", userId),
    runnerTasks: await countRows(db, "SELECT COUNT(*) AS count FROM runner_tasks WHERE user_id = ?", userId),
    feedback: await countRows(db, "SELECT COUNT(*) AS count FROM feedback WHERE user_id = ?", userId),
    preferenceEvents: await countRows(db, "SELECT COUNT(*) AS count FROM preference_events WHERE user_id = ?", userId),
    runs: await countRows(db, "SELECT COUNT(*) AS count FROM runs WHERE user_id = ?", userId),
    agentRuns: await countRows(db, "SELECT COUNT(*) AS count FROM agent_runs WHERE user_id = ?", userId),
  };

  await db.prepare("DELETE FROM run_listings WHERE run_id IN (SELECT id FROM runs WHERE user_id = ?)").bind(userId).run();
  await db.prepare("DELETE FROM runs WHERE user_id = ?").bind(userId).run();
  await db.prepare("DELETE FROM feedback WHERE user_id = ?").bind(userId).run();
  await db.prepare("DELETE FROM preference_events WHERE user_id = ?").bind(userId).run();
  await db.prepare("DELETE FROM ai_usage_events WHERE user_id = ?").bind(userId).run();
  await db.prepare("DELETE FROM runner_tasks WHERE user_id = ?").bind(userId).run();
  await db.prepare("DELETE FROM source_settings WHERE user_id = ?").bind(userId).run();
  await db.prepare("DELETE FROM user_ai_settings WHERE user_id = ?").bind(userId).run();
  await db.prepare("DELETE FROM profiles WHERE user_id = ?").bind(userId).run();
  await db.prepare("DELETE FROM agent_runs WHERE user_id = ?").bind(userId).run();
  await db
    .prepare("UPDATE users SET status = 'disabled', display_name = NULL, last_seen_at = ? WHERE id = ?")
    .bind(disabledAt, userId)
    .run();

  await recordAuditEvent(db, {
    userId,
    actorUserId: userId,
    eventType: "account.deleted",
    metadata: { deleted },
  });

  return { ok: true, userId, disabledAt, deleted };
}

async function getRuns(db: D1Database, scope: UserScope): Promise<RunPayload[]> {
  const runWhere = scope.includeLegacyData ? "(user_id = ? OR user_id IS NULL)" : "user_id = ?";
  const { results } = await db
    .prepare(`SELECT * FROM runs WHERE ${runWhere} ORDER BY generated_at DESC, created_at DESC`)
    .bind(scope.userId)
    .all<RunRow>();
  return Promise.all(results.map((run) => runPayloadFromRow(db, scope, run)));
}

async function runPayloadFromRow(db: D1Database, scope: UserScope, run: RunRow): Promise<RunPayload> {
  const { results: listingRows } = await db
    .prepare("SELECT listing_key, payload_json FROM run_listings WHERE run_id = ? ORDER BY sort_order ASC")
    .bind(run.id)
    .all<RunListingRow>();

  const feedback = await getFeedback(db, scope);
  const feedbackByKey = new Map(feedback.map((entry) => [entry.listingKey, entry]));
  const imagesByListing = await getImagesByListing(db, listingRows.map((row) => row.listing_key));

  const listings = listingRows.map((row) => {
    const listing = JSON.parse(row.payload_json) as AuctionListing;
    const imageRows = imagesByListing.get(row.listing_key) || [];
    return withImageOverlay({ ...listing, listingKey: row.listing_key, feedback: feedbackByKey.get(row.listing_key) || null }, imageRows);
  });

  return {
    id: run.id,
    generatedAt: run.generated_at,
    reportMarkdown: run.report_markdown,
    sourceSummary: run.source_summary_json ? JSON.parse(run.source_summary_json) : null,
    listings,
    feedback,
  };
}

async function getAgentRuns(db: D1Database, userId: string): Promise<AgentRunRecord[]> {
  const { results } = await db
    .prepare("SELECT * FROM agent_runs WHERE user_id = ? ORDER BY created_at DESC")
    .bind(userId)
    .all<AgentRunRow>();
  return results.map(agentRunFromRow);
}

async function countRows(db: D1Database, sql: string, ...values: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...values).first<{ count: number }>();
  return typeof row?.count === "number" ? row.count : 0;
}

export async function createAgentRunRequest(
  db: D1Database,
  input: { userId: string; source: "manual" | "schedule"; reason?: unknown },
): Promise<AgentRunRecord> {
  await assertAiBudgetAvailable(db, input.userId);
  const now = new Date().toISOString();
  const id = `agent-run-${now.replace(/[^0-9a-z]/gi, "-").toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
  const progress = {
    source: input.source,
    reason: typeof input.reason === "string" ? input.reason.trim().slice(0, 240) : null,
    requestedAt: now,
    handoff: "queued_for_cloudflare_agent",
  };
  await db
    .prepare(
      `INSERT INTO agent_runs (id, user_id, status, progress_json, created_at, updated_at)
       VALUES (?, ?, 'queued', ?, ?, ?)`,
    )
    .bind(id, input.userId, JSON.stringify(progress), now, now)
    .run();
  return getAgentRun(db, input.userId, id).then((run) => {
    if (!run) throw new Error("Could not create agent run");
    return run;
  });
}

export async function getLatestAgentRun(db: D1Database, userId: string): Promise<AgentRunRecord | null> {
  const row = await db
    .prepare("SELECT * FROM agent_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(userId)
    .first<AgentRunRow>();
  return row ? agentRunFromRow(row) : null;
}

export async function getNextQueuedAgentRun(db: D1Database): Promise<AgentRunRecord | null> {
  const row = await db
    .prepare("SELECT * FROM agent_runs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1")
    .first<AgentRunRow>();
  return row ? agentRunFromRow(row) : null;
}

export async function getAgentRunById(db: D1Database, id: string): Promise<AgentRunRecord | null> {
  const row = await db.prepare("SELECT * FROM agent_runs WHERE id = ?").bind(id).first<AgentRunRow>();
  return row ? agentRunFromRow(row) : null;
}

export async function claimNextAgentRun(
  db: D1Database,
  input: { runnerId?: unknown } = {},
): Promise<AgentRunRecord | null> {
  const run = await getNextQueuedAgentRun(db);
  if (!run) return null;
  return claimAgentRun(db, run.id, input);
}

export async function claimAgentRun(
  db: D1Database,
  id: string,
  input: { runnerId?: unknown } = {},
): Promise<AgentRunRecord | null> {
  const existing = await getAgentRunById(db, id);
  if (!existing) return null;
  if (existing.status !== "queued") return existing;

  const now = new Date().toISOString();
  const progress = {
    ...existing.progress,
    runnerId: stringOrNull(input.runnerId, null),
    claimedAt: now,
  };
  await db
    .prepare(
      `UPDATE agent_runs
       SET status = 'running',
           progress_json = ?,
           error = NULL,
           started_at = COALESCE(started_at, ?),
           updated_at = ?
       WHERE id = ? AND status = 'queued'`,
    )
    .bind(JSON.stringify(progress), now, now, id)
    .run();

  return getAgentRunById(db, id);
}

export async function markAgentRunPrepared(
  db: D1Database,
  input: { userId: string; runId: string; handoff?: string },
): Promise<AgentRunRecord | null> {
  const existing = await getAgentRun(db, input.userId, input.runId);
  if (!existing) return null;
  const now = new Date().toISOString();
  const progress = {
    ...existing.progress,
    handoff: input.handoff || "ready_for_external_runner",
    preparedAt: now,
  };
  await db
    .prepare(
      `UPDATE agent_runs
       SET progress_json = ?,
           updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'queued'`,
    )
    .bind(JSON.stringify(progress), now, input.runId, input.userId)
    .run();
  return getAgentRun(db, input.userId, input.runId);
}

export async function markAgentRunRunning(
  db: D1Database,
  input: { runId: string; workflowInstanceId?: string | null; runnerId?: string | null },
): Promise<AgentRunRecord> {
  const existing = await getRequiredAgentRun(db, input.runId);
  const now = new Date().toISOString();
  const progress = {
    ...existing.progress,
    handoff: input.workflowInstanceId ? "cloudflare_workflow" : existing.progress.handoff,
    runnerId: input.runnerId || existing.progress.runnerId || null,
    workflowInstanceId: input.workflowInstanceId || existing.workflowInstanceId || null,
    startedAt: existing.startedAt || now,
  };
  await db
    .prepare(
      `UPDATE agent_runs
       SET workflow_instance_id = COALESCE(?, workflow_instance_id),
           status = 'running',
           progress_json = ?,
           error = NULL,
           started_at = COALESCE(started_at, ?),
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(input.workflowInstanceId || null, JSON.stringify(progress), now, now, input.runId)
    .run();
  return getRequiredAgentRun(db, input.runId);
}

export async function markAgentRunPublished(
  db: D1Database,
  input: { runId: string; publishedRunId: string; listingCount: number; imageCount: number },
): Promise<AgentRunRecord> {
  const existing = await getRequiredAgentRun(db, input.runId);
  const now = new Date().toISOString();
  const progress = {
    ...existing.progress,
    publishedRunId: input.publishedRunId,
    listingCount: input.listingCount,
    imageCount: input.imageCount,
    publishedAt: now,
  };
  await db
    .prepare(
      `UPDATE agent_runs
       SET status = 'published',
           progress_json = ?,
           error = NULL,
           finished_at = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(JSON.stringify(progress), now, now, input.runId)
    .run();
  return getRequiredAgentRun(db, input.runId);
}

export async function markAgentRunFailed(db: D1Database, input: { runId: string; error: unknown }): Promise<AgentRunRecord> {
  const existing = await getRequiredAgentRun(db, input.runId);
  const now = new Date().toISOString();
  const message = input.error instanceof Error ? input.error.message : String(input.error || "Agent run failed");
  const progress = {
    ...existing.progress,
    failedAt: now,
  };
  await db
    .prepare(
      `UPDATE agent_runs
       SET status = 'failed',
           progress_json = ?,
           error = ?,
           finished_at = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(JSON.stringify(progress), message.slice(0, 1000), now, now, input.runId)
    .run();
  return getRequiredAgentRun(db, input.runId);
}

async function getRequiredAgentRun(db: D1Database, id: string): Promise<AgentRunRecord> {
  const run = await getAgentRunById(db, id);
  if (!run) throw new Error("Agent run not found");
  return run;
}

async function getAgentRun(db: D1Database, userId: string, id: string): Promise<AgentRunRecord | null> {
  const row = await db.prepare("SELECT * FROM agent_runs WHERE user_id = ? AND id = ?").bind(userId, id).first<AgentRunRow>();
  return row ? agentRunFromRow(row) : null;
}

export async function getFeedback(db: D1Database, scope: UserScope): Promise<FeedbackRecord[]> {
  const feedbackWhere = scope.includeLegacyData ? "(user_id = ? OR user_id IS NULL)" : "user_id = ?";
  const { results } = await db
    .prepare(`SELECT * FROM feedback WHERE ${feedbackWhere} ORDER BY updated_at DESC`)
    .bind(scope.userId)
    .all<FeedbackRow>();
  return results.map(feedbackFromRow);
}

export async function upsertFeedback(
  db: D1Database,
  scope: UserScope,
  listingKey: string,
  input: { action: unknown; note?: unknown; tags?: unknown },
): Promise<FeedbackRecord> {
  const action = normalizeAction(input.action);
  if (!action) throw new Error("Feedback action must be like, star, hide, or avoid");

  const listing = await db
    .prepare("SELECT last_payload_json FROM listings WHERE listing_key = ?")
    .bind(listingKey)
    .first<{ last_payload_json: string }>();
  if (!listing) throw new Error("Unknown listing");

  const parsed = JSON.parse(listing.last_payload_json) as AuctionListing;
  const tags = Array.isArray(input.tags) ? input.tags.filter(Boolean).map(String) : inferTags(parsed);
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : null;
  const updatedAt = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO feedback (user_id, listing_key, action, tags_json, note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, listing_key) DO UPDATE SET
         action = excluded.action,
         tags_json = excluded.tags_json,
         note = excluded.note,
         updated_at = excluded.updated_at`,
    )
    .bind(scope.userId, listingKey, action, JSON.stringify(tags), note, updatedAt)
    .run();

  return { listingKey, action, tags, note, updatedAt };
}

export async function createPreferenceEvent(
  db: D1Database,
  scope: UserScope,
  input: { listingKey?: unknown; eventType?: unknown; note?: unknown; transcript?: unknown; tags?: unknown },
): Promise<PreferenceEvent> {
  const eventType = input.eventType === "voice_note" || input.eventType === "text_note" || input.eventType === "viewed" ? input.eventType : null;
  if (!eventType) throw new Error("Preference event type must be voice_note, text_note, or viewed");

  const listingKey = typeof input.listingKey === "string" && input.listingKey.trim() ? input.listingKey.trim() : null;
  let listing: AuctionListing | null = null;
  if (listingKey) {
    const row = await db
      .prepare("SELECT last_payload_json FROM listings WHERE listing_key = ?")
      .bind(listingKey)
      .first<{ last_payload_json: string }>();
    if (!row) throw new Error("Unknown listing");
    listing = JSON.parse(row.last_payload_json) as AuctionListing;
  }

  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : null;
  const transcript = typeof input.transcript === "string" && input.transcript.trim() ? input.transcript.trim() : null;
  if ((eventType === "voice_note" || eventType === "text_note") && !note && !transcript) {
    throw new Error("Preference note cannot be empty");
  }

  const tags = Array.isArray(input.tags)
    ? input.tags.filter(Boolean).map(String)
    : listing
      ? inferTags(listing)
      : [];
  const createdAt = new Date().toISOString();
  const id = `pref-${createdAt.replace(/[^0-9a-z]/gi, "-").toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;

  await db
    .prepare(
      `INSERT INTO preference_events (id, user_id, listing_key, event_type, note, transcript, tags_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, scope.userId, listingKey, eventType, note, transcript, JSON.stringify([...new Set(tags)]), createdAt)
    .run();

  return { id, listingKey, eventType, note, transcript, tags: [...new Set(tags)], createdAt };
}

export async function deleteFeedback(db: D1Database, scope: UserScope, listingKey: string): Promise<void> {
  await db.prepare("DELETE FROM feedback WHERE user_id = ? AND listing_key = ?").bind(scope.userId, listingKey).run();
}

export async function exportFeedback(db: D1Database, scope: UserScope): Promise<FeedbackExport> {
  const feedback = await getFeedback(db, scope);
  const entries = [];
  for (const entry of feedback) {
    const listingRow = await db
      .prepare("SELECT last_payload_json FROM listings WHERE listing_key = ?")
      .bind(entry.listingKey)
      .first<{ last_payload_json: string }>();
    entries.push({
      ...entry,
      listing: listingRow ? (JSON.parse(listingRow.last_payload_json) as AuctionListing) : null,
    });
  }
  const preferenceEvents = await getPreferenceEventsWithListings(db, scope);

  const counts = {
    like: feedback.filter((entry) => entry.action === "like").length,
    star: feedback.filter((entry) => entry.action === "star").length,
    hide: feedback.filter((entry) => entry.action === "hide").length,
    avoid: feedback.filter((entry) => entry.action === "avoid").length,
    total: feedback.length,
  };

  return {
    version: 1,
    kind: "auction-watch-feedback",
    generatedAt: new Date().toISOString(),
    counts,
    entries,
    preferenceEvents,
    steering: {
      prioritizeSimilarTo: entries
        .filter((entry) => (entry.action === "star" || entry.action === "like") && entry.listing)
        .map((entry) => ({ title: entry.listing!.title, url: entry.listing!.url, tags: entry.tags })),
      suppressExactUrls: entries.filter((entry) => entry.action === "hide" && entry.listing).map((entry) => entry.listing!.url),
      avoidSimilarTo: entries
        .filter((entry) => entry.action === "avoid" && entry.listing)
        .map((entry) => ({ title: entry.listing!.title, url: entry.listing!.url, tags: entry.tags, why: entry.listing!.why })),
      notes: preferenceEvents
        .filter((event) => event.note || event.transcript)
        .map((event) => ({
          title: event.listing?.title,
          url: event.listing?.url,
          note: event.note || event.transcript || "",
          tags: event.tags,
        })),
    },
  };
}

async function getPreferenceEventsWithListings(db: D1Database, scope: UserScope): Promise<Array<PreferenceEvent & { listing?: AuctionListing | null }>> {
  const eventsWhere = scope.includeLegacyData ? "(user_id = ? OR user_id IS NULL)" : "user_id = ?";
  const { results } = await db
    .prepare(`SELECT * FROM preference_events WHERE ${eventsWhere} ORDER BY created_at DESC LIMIT 200`)
    .bind(scope.userId)
    .all<PreferenceEventRow>();
  const events = [];
  for (const row of results) {
    let listing: AuctionListing | null = null;
    if (row.listing_key) {
      const listingRow = await db
        .prepare("SELECT last_payload_json FROM listings WHERE listing_key = ?")
        .bind(row.listing_key)
        .first<{ last_payload_json: string }>();
      listing = listingRow ? (JSON.parse(listingRow.last_payload_json) as AuctionListing) : null;
    }
    events.push({ ...preferenceEventFromRow(row), listing });
  }
  return events;
}

async function getImagesByListing(db: D1Database, listingKeys: string[]): Promise<Map<string, ImageRow[]>> {
  const map = new Map<string, ImageRow[]>();
  if (listingKeys.length === 0) return map;
  const placeholders = listingKeys.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT * FROM images WHERE listing_key IN (${placeholders}) ORDER BY created_at ASC`)
    .bind(...listingKeys)
    .all<ImageRow>();
  for (const row of results) {
    const list = map.get(row.listing_key) || [];
    list.push(row);
    map.set(row.listing_key, list);
  }
  return map;
}

async function getProfile(db: D1Database, userId: string): Promise<UserProfile | null> {
  const row = await db.prepare("SELECT * FROM profiles WHERE user_id = ?").bind(userId).first<ProfileRow>();
  return row ? profileFromRow(row) : null;
}

async function getSourceSettings(db: D1Database, userId: string): Promise<SourceSetting[]> {
  const { results } = await db
    .prepare("SELECT source, enabled, settings_json, updated_at FROM source_settings WHERE user_id = ? ORDER BY source ASC")
    .bind(userId)
    .all<SourceSettingRow>();
  return results.map((row) => ({
    source: row.source,
    enabled: row.enabled === 1,
    settings: parseObject(row.settings_json),
    updatedAt: row.updated_at,
  }));
}

async function getAiSettings(db: D1Database, userId: string): Promise<UserAiSettings | null> {
  const row = await db.prepare("SELECT * FROM user_ai_settings WHERE user_id = ?").bind(userId).first<UserAiSettingsRow>();
  return row ? aiSettingsFromRow(row) : null;
}

async function sumAiUsageMicros(db: D1Database, userId: string, startsAt: string, endsAt: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(cost_micros), 0) AS spend
       FROM ai_usage_events
       WHERE user_id = ? AND occurred_at >= ? AND occurred_at < ?`,
    )
    .bind(userId, startsAt, endsAt)
    .first<UsageSumRow>();
  return typeof row?.spend === "number" ? row.spend : 0;
}

function usageWindow(now: Date, kind: "daily" | "monthly"): { startsAt: string; endsAt: string } {
  if (kind === "monthly") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { startsAt: start.toISOString(), endsAt: end.toISOString() };
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}

function remainingMicros(budgetCents: number | null, spendMicros: number): number | null {
  if (budgetCents === null) return null;
  return Math.max(0, budgetCents * 10_000 - spendMicros);
}

function limitExceeded(budgetCents: number | null, spendMicros: number): boolean {
  if (budgetCents === null) return false;
  return spendMicros >= budgetCents * 10_000;
}

function profileFromRow(row: ProfileRow): UserProfile {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    niche: row.niche,
    budgetMin: row.budget_min,
    budgetMax: row.budget_max,
    stretchBudget: row.stretch_budget,
    homeRegion: row.home_region,
    timezone: row.timezone,
    scheduleCron: row.schedule_cron,
    profile: parseObject(row.profile_json),
    onboardingCompletedAt: row.onboarding_completed_at,
    updatedAt: row.updated_at,
  };
}

function aiSettingsFromRow(row: UserAiSettingsRow): UserAiSettings {
  return {
    mode: row.mode,
    gatewayKeyRef: row.gateway_key_ref,
    monthlyBudgetCents: row.monthly_budget_cents,
    dailyBudgetCents: row.daily_budget_cents,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function aiUsageEventFromRow(row: AiUsageEventRow): AiUsageEventRecord {
  return {
    id: row.id,
    userId: row.user_id,
    agentRunId: row.agent_run_id,
    provider: row.provider,
    model: row.model,
    operation: row.operation,
    mode: row.mode,
    gatewayId: row.gateway_id,
    gatewayKeyRef: row.gateway_key_ref,
    gatewayRequestId: row.gateway_request_id,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    costMicros: row.cost_micros,
    status: row.status,
    metadata: parseObject(row.metadata_json),
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

function runnerTaskFromRow(row: RunnerTaskRow): RunnerTaskRecord {
  return {
    id: row.id,
    userId: row.user_id,
    agentRunId: row.agent_run_id,
    kind: row.kind,
    source: row.source,
    status: row.status,
    priority: row.priority,
    input: parseObject(row.input_json),
    result: row.result_json ? parseObject(row.result_json) : null,
    error: row.error,
    runnerId: row.runner_id,
    claimedAt: row.claimed_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function agentRunFromRow(row: AgentRunRow): AgentRunRecord {
  return {
    id: row.id,
    userId: row.user_id,
    workflowInstanceId: row.workflow_instance_id,
    status: row.status,
    progress: parseObject(row.progress_json),
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeJsonObject(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  return value as Record<string, unknown>;
}

function normalizeSourceSettings(value: unknown): SourceSetting[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const sources: SourceSetting[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const source = stringOrDefault(record.source, "").toLowerCase().replace(/[^0-9a-z-]/g, "");
    if (!source || seen.has(source)) continue;
    seen.add(source);
    sources.push({
      source,
      enabled: record.enabled !== false,
      settings: normalizeJsonObject(record.settings, {}),
      updatedAt: new Date().toISOString(),
    });
  }
  return sources;
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringOrDefault(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function stringOrNull(value: unknown, fallback: string | null): string | null {
  if (value === null) return null;
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || null;
}

function numberOrNull(value: unknown, fallback: number | null): number | null {
  if (value === null) return null;
  if (value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function integerOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
}

function normalizeCostMicros(costMicros: unknown, costCents: unknown): number {
  const micros = integerOrNull(costMicros);
  if (micros !== null) return micros;
  const cents = numberOrNull(costCents, null);
  return cents === null ? 0 : Math.max(0, cents * 10_000);
}

function isoDateOrDefault(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

async function recordAuditEvent(
  db: D1Database,
  input: { userId?: string | null; actorUserId?: string | null; eventType: string; metadata?: Record<string, unknown> },
): Promise<void> {
  const createdAt = new Date().toISOString();
  const id = `audit-${createdAt.replace(/[^0-9a-z]/gi, "-").toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
  await db
    .prepare("INSERT INTO audit_events (id, user_id, actor_user_id, event_type, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, input.userId || null, input.actorUserId || null, input.eventType, JSON.stringify(input.metadata || {}), createdAt)
    .run();
}

async function sha256Hex(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function withImageOverlay(listing: AuctionListing, imageRows: ImageRow[]): AuctionListing {
  const rowsBySource = new Map(imageRows.map((row) => [row.source_url, row]));
  const imageStatus: ImageStatus[] = [];
  const images = listing.images.map((sourceUrl) => {
    const row = rowsBySource.get(sourceUrl);
    if (!row) return sourceUrl;
    const localUrl = `/api/images/${encodeURIComponent(row.image_key)}?variant=deck`;
    imageStatus.push({
      imageKey: row.image_key,
      sourceUrl,
      url: localUrl,
      copied: row.status === "copied",
      status: row.status,
      error: row.error,
    });
    return localUrl;
  });
  return { ...listing, originalImages: listing.images, images, imageStatus };
}

function feedbackFromRow(row: FeedbackRow): FeedbackRecord {
  return {
    listingKey: row.listing_key,
    action: row.action,
    tags: JSON.parse(row.tags_json || "[]") as string[],
    note: row.note,
    updatedAt: row.updated_at,
  };
}

function preferenceEventFromRow(row: PreferenceEventRow): PreferenceEvent {
  return {
    id: row.id,
    listingKey: row.listing_key,
    eventType: row.event_type,
    note: row.note,
    transcript: row.transcript,
    tags: JSON.parse(row.tags_json || "[]") as string[],
    createdAt: row.created_at,
  };
}
