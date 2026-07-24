import type {
  AccountDeletionResult,
  AccountExport,
  AdminUserSummary,
  AdminOpsSummary,
  AiUsageEventRecord,
  AiUsageSummary,
  AutomationBundle,
  AutomationStatus,
  AutomationTokenCreateResult,
  AutomationTokenRecord,
  AgentRunRecord,
  AgentRunRequest,
  FeedbackAction,
  FeedbackRecord,
  InvitePayload,
  ManagedOnboardingInput,
  ManagedOnboardingResult,
  PreferenceEvent,
  ProductEventSummary,
  RunPayload,
  SourceCacheAdminStatus,
  SourceCacheIngestResult,
  UserAiSettings,
  ResearchMode,
  UserPayload,
  OAuthAccessTokenRecord,
  AutomationScope,
} from "../shared/types";

const latestRunCachePrefix = "beachcar-watch:last-run";
let tokenGetter: (() => Promise<string | null>) | null = null;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export async function getMe(): Promise<UserPayload> {
  return requestJson<UserPayload>("/api/me");
}

export async function acceptInvite(code: string): Promise<UserPayload> {
  return requestJson<UserPayload>("/api/invites/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
}

export async function completeManagedOnboarding(input: ManagedOnboardingInput): Promise<ManagedOnboardingResult> {
  return requestJson<ManagedOnboardingResult>("/api/onboarding/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function putProfile(input: {
  displayName?: string;
  niche?: string;
  budgetMin?: number | null;
  budgetMax?: number | null;
  stretchBudget?: number | null;
  homeRegion?: string | null;
  timezone?: string;
  scheduleCron?: string;
  profile?: Record<string, unknown>;
  completeOnboarding?: boolean;
}): Promise<UserPayload> {
  return requestJson<UserPayload>("/api/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function putAiSettings(input: {
  mode: UserAiSettings["mode"];
  gatewayKeyRef?: string | null;
  monthlyBudgetCents?: number | null;
  dailyBudgetCents?: number | null;
}): Promise<UserPayload> {
  return requestJson<UserPayload>("/api/ai-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function putResearchSettings(mode: ResearchMode): Promise<UserPayload> {
  return requestJson<UserPayload>("/api/research-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
}

export async function putNotificationPreferences(readyEmailEnabled: boolean): Promise<UserPayload> {
  return requestJson<UserPayload>("/api/notification-preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ readyEmailEnabled }),
  });
}

export async function putSourceSettings(input: {
  sources: Array<{ source: string; enabled: boolean; settings?: Record<string, unknown> }>;
}): Promise<UserPayload> {
  return requestJson<UserPayload>("/api/source-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function getAiUsage(): Promise<{ summary: AiUsageSummary; events: AiUsageEventRecord[] }> {
  return requestJson<{ summary: AiUsageSummary; events: AiUsageEventRecord[] }>("/api/ai-usage");
}

export async function getAutomationStatus(): Promise<AutomationStatus> {
  return requestJson<AutomationStatus>("/api/automation/status");
}

export async function createAutomationToken(label: string, scopes?: AutomationScope[]): Promise<AutomationTokenCreateResult> {
  return requestJson<AutomationTokenCreateResult>("/api/automation/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, ...(scopes ? { scopes } : {}) }),
  });
}

export async function revokeAutomationToken(id: string): Promise<AutomationTokenRecord> {
  return requestJson<AutomationTokenRecord>(`/api/automation/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function revokeOAuthConnection(id: string): Promise<OAuthAccessTokenRecord> {
  return requestJson<OAuthAccessTokenRecord>(`/api/automation/oauth-tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function getAutomationBundle(): Promise<AutomationBundle> {
  return requestJson<AutomationBundle>("/api/automation/bundle");
}

export async function exportAccount(): Promise<AccountExport> {
  return requestJson<AccountExport>("/api/account/export");
}

export async function deleteAccount(confirmEmail: string): Promise<AccountDeletionResult> {
  return requestJson<AccountDeletionResult>("/api/account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmEmail }),
  });
}

export function setAuthTokenGetter(getter: () => Promise<string | null>): void {
  tokenGetter = getter;
}

export async function getLatestRun(userId?: string): Promise<RunPayload> {
  const cacheKey = userId ? `${latestRunCachePrefix}:${userId}` : latestRunCachePrefix;
  try {
    const run = await requestJson<RunPayload>("/api/runs/latest");
    localStorage.setItem(cacheKey, JSON.stringify(run));
    return run;
  } catch (error) {
    const cached = localStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached) as RunPayload;
    throw error;
  }
}

export async function getLatestAgentRun(): Promise<AgentRunRecord | null> {
  return requestJson<AgentRunRecord | null>("/api/agent-runs/latest");
}

export async function getAgentRun(id: string): Promise<AgentRunRecord> {
  return requestJson<AgentRunRecord>(`/api/agent-runs/${encodeURIComponent(id)}`);
}

export async function requestAgentRun(reason?: string, requestId = globalThis.crypto.randomUUID()): Promise<AgentRunRecord> {
  const input: AgentRunRequest = { requestId, ...(reason ? { reason } : {}) };
  return requestJson<AgentRunRecord>("/api/agent-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function putFeedback(
  listingKey: string,
  action: FeedbackAction,
  input: { note?: string; tags?: string[] } = {},
): Promise<FeedbackRecord> {
  return requestJson<FeedbackRecord>(`/api/feedback/${encodeURIComponent(listingKey)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...input }),
  });
}

export async function clearFeedback(listingKey: string): Promise<void> {
  await requestJson<{ ok: true }>(`/api/feedback/${encodeURIComponent(listingKey)}`, { method: "DELETE" });
}

export async function postPreferenceEvent(input: {
  listingKey?: string | null;
  eventType: "voice_note" | "text_note" | "viewed";
  note?: string;
  transcript?: string;
  tags?: string[];
}): Promise<PreferenceEvent> {
  return requestJson<PreferenceEvent>("/api/preference-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function createAdminInvite(publishToken: string, email: string, displayName?: string): Promise<InvitePayload> {
  return requestJson<InvitePayload>("/api/admin/invites", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Publish-Token": publishToken,
    },
    body: JSON.stringify({ email, displayName, acceptance: "verified_email", managedResearch: true }),
    skipUserToken: true,
  });
}

export async function listAdminUsers(publishToken: string): Promise<AdminUserSummary[]> {
  return requestJson<AdminUserSummary[]>("/api/admin/users", {
    headers: { "X-Publish-Token": publishToken },
    skipUserToken: true,
  });
}

export async function getAdminOpsSummary(publishToken: string): Promise<AdminOpsSummary> {
  return requestJson<AdminOpsSummary>("/api/admin/ops-summary", {
    headers: { "X-Publish-Token": publishToken },
    skipUserToken: true,
  });
}

export async function getAdminProductEventSummary(publishToken: string, days = 30): Promise<ProductEventSummary> {
  return requestJson<ProductEventSummary>(`/api/admin/product-events/summary?days=${encodeURIComponent(days)}`, {
    headers: { "X-Publish-Token": publishToken },
    skipUserToken: true,
  });
}

export async function getAdminSourceCacheStatus(publishToken: string): Promise<SourceCacheAdminStatus> {
  return requestJson<SourceCacheAdminStatus>("/api/admin/source-cache/status", {
    headers: { "X-Publish-Token": publishToken },
    skipUserToken: true,
  });
}

export async function ingestAdminSourceCache(publishToken: string): Promise<SourceCacheIngestResult> {
  return requestJson<SourceCacheIngestResult>("/api/admin/source-cache/ingest", {
    method: "POST",
    headers: { "X-Publish-Token": publishToken },
    skipUserToken: true,
  });
}

async function requestJson<T>(path: string, init: RequestInit & { skipUserToken?: boolean } = {}): Promise<T> {
  const { skipUserToken, ...requestInit } = init;
  const token = !skipUserToken && tokenGetter ? await tokenGetter() : null;
  const response = await fetch(path, {
    credentials: "same-origin",
    ...requestInit,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...requestInit.headers,
    },
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the HTTP status message when the response is not JSON.
    }
    throw new ApiError(message, response.status);
  }

  return response.json() as Promise<T>;
}
