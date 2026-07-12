import { randomUUID } from "node:crypto";
import { chmod, open, rename, rm } from "node:fs/promises";

export const SOURCE_QUALITY_PILOT_SOURCES = ["bringatrailer", "carsandbids", "hemmings"] as const;
export const SOURCE_DISCOVERY_PUBLISHER = "cloudflare-workflow-source-discovery";
export const DEFAULT_TRUSTED_LEGACY_TICKET_ORIGIN = "https://beach-car-watch.jon-cooper.workers.dev";

type UnknownRecord = Record<string, unknown>;

type RenameFile = (oldPath: string, newPath: string) => Promise<void>;

export function beachcarUserIdForEmail(email: string): string {
  return `email:${email.trim().toLowerCase()}`;
}

export async function atomicReplacePrivateFile(
  path: string,
  contents: string,
  renameFile: RenameFile = rename,
): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let replaced = false;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(contents, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = null;
    await chmod(temporaryPath, 0o600);
    await renameFile(temporaryPath, path);
    replaced = true;
    await chmod(path, 0o600);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    if (!replaced) await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export type TicketRedemption = {
  storedOrigin: string;
  targetOrigin: string;
  ticket: string;
  redemptionUrl: string;
  rebased: boolean;
};

export function prepareTicketRedemption(input: {
  storedSignInUrl: string;
  targetUrl: string;
  configuredDeployUrl: string;
  trustedLegacyOrigins?: string[];
}): TicketRedemption {
  const stored = strictHttpsUrl(input.storedSignInUrl, "stored Clerk ticket URL", { allowQuery: true });
  const target = strictHttpsUrl(input.targetUrl, "verification target");
  const configured = strictHttpsUrl(input.configuredDeployUrl, "BEACHCAR_DEPLOY_URL");

  if (target.origin !== configured.origin) {
    throw new Error("Verification target must exactly match BEACHCAR_DEPLOY_URL.");
  }

  const trustedOrigins = new Set([
    target.origin,
    ...(input.trustedLegacyOrigins || []).map((value) => strictHttpsUrl(value, "trusted legacy ticket origin").origin),
  ]);
  if (!trustedOrigins.has(stored.origin)) {
    throw new Error("Stored Clerk ticket origin is not in the exact trusted-origin allowlist.");
  }

  const ticketValues = stored.searchParams.getAll("__clerk_ticket").filter(Boolean);
  const queryKeys = [...stored.searchParams.keys()];
  if (ticketValues.length !== 1 || queryKeys.length !== 1 || queryKeys[0] !== "__clerk_ticket" || stored.hash) {
    throw new Error("Stored Clerk ticket URL must contain exactly one __clerk_ticket query parameter and no fragment.");
  }

  const redemption = new URL(target.origin);
  redemption.searchParams.set("__clerk_ticket", ticketValues[0]);
  return {
    storedOrigin: stored.origin,
    targetOrigin: target.origin,
    ticket: ticketValues[0],
    redemptionUrl: redemption.toString(),
    rebased: stored.origin !== target.origin,
  };
}

export function extractClerkPublishableKeys(source: string): string[] {
  return Array.from(new Set(source.match(/\bpk_(?:test|live)_[A-Za-z0-9_-]+\b/g) || [])).sort();
}

export function isClerkPublishableKey(value: unknown): value is string {
  return typeof value === "string" && /^pk_(?:test|live)_[A-Za-z0-9_-]+$/.test(value.trim());
}

export function normalizeSourceNames(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(values.map((value) => (typeof value === "string" ? value.trim().toLowerCase() : "")).filter(Boolean)),
  ).sort();
}

export function enabledSourceNames(settings: unknown): string[] {
  if (!Array.isArray(settings)) return [];
  return normalizeSourceNames(
    settings
      .filter((entry) => isRecord(entry) && entry.enabled === true)
      .map((entry) => (isRecord(entry) ? entry.source : null)),
  );
}

export function sameStringSet(left: string[], right: string[]): boolean {
  const a = Array.from(new Set(left)).sort();
  const b = Array.from(new Set(right)).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export type SourceProof = {
  enabledSourcesMatch: boolean;
  requiredSourcesEnabled: boolean;
  diagnostics: Record<string, boolean>;
  runnerHandoffs: Record<string, boolean>;
  runnerMerges: Record<string, boolean>;
};

export function evaluateSourceProof(input: {
  userSourceSettings: unknown;
  summaryEnabledSources: unknown;
  checkedSources: unknown;
  runnerTasks: unknown;
  requiredSources?: readonly string[];
}): SourceProof {
  const required = normalizeSourceNames([...(input.requiredSources || SOURCE_QUALITY_PILOT_SOURCES)]);
  const userEnabled = enabledSourceNames(input.userSourceSettings);
  const summaryEnabled = normalizeSourceNames(input.summaryEnabledSources);
  const checks = Array.isArray(input.checkedSources) ? input.checkedSources.filter(isRecord) : [];
  const tasks = Array.isArray(input.runnerTasks) ? input.runnerTasks.filter(isRecord) : [];
  const diagnostics: Record<string, boolean> = {};
  const runnerHandoffs: Record<string, boolean> = {};
  const runnerMerges: Record<string, boolean> = {};

  for (const source of required) {
    diagnostics[source] = checks.some((entry) => normalizedField(entry, "source") === source);
    const sourceTasks = tasks.filter((entry) => normalizedField(entry, "source") === source);
    runnerHandoffs[source] = sourceTasks.some((entry) => ["queued", "running", "completed"].includes(normalizedField(entry, "status")));
    runnerMerges[source] = sourceTasks.some((entry) => {
      const mergedCount = ["importedCount", "patchedCount", "insertedCount"].reduce(
        (total, key) => total + nonNegativeNumber(entry[key]),
        0,
      );
      const mergedWithCandidates =
        normalizedField(entry, "status") === "completed" &&
        normalizedField(entry, "mergeStatus") === "merged" &&
        normalizedField(entry, "resultStatus") === "ok" &&
        mergedCount > 0;
      if (source !== "hemmings") return mergedWithCandidates;
      const honestEmptyOrBlocked =
        normalizedField(entry, "status") === "completed" &&
        normalizedField(entry, "mergeStatus") === "empty" &&
        ["empty", "blocked"].includes(normalizedField(entry, "resultStatus"));
      return mergedWithCandidates || honestEmptyOrBlocked;
    });
  }

  return {
    enabledSourcesMatch: sameStringSet(userEnabled, summaryEnabled),
    requiredSourcesEnabled: required.every((source) => userEnabled.includes(source) && summaryEnabled.includes(source)),
    diagnostics,
    runnerHandoffs,
    runnerMerges,
  };
}

export type ProvenanceProof = {
  publisher: boolean;
  agentRunId: boolean;
  userId: boolean;
  workflowInstanceId: boolean;
  source: boolean;
  reason: boolean;
  directDiscovery: boolean;
};

export function evaluateRunProvenance(
  summary: unknown,
  expected: { agentRunId: string; userId: string; workflowInstanceId: string; reason: string },
): ProvenanceProof {
  const value = isRecord(summary) ? summary : {};
  return {
    publisher: value.publisher === SOURCE_DISCOVERY_PUBLISHER,
    agentRunId: value.agentRunId === expected.agentRunId,
    userId: value.userId === expected.userId,
    workflowInstanceId: Boolean(expected.workflowInstanceId && value.workflowInstanceId === expected.workflowInstanceId),
    source: value.source === "manual",
    reason: value.reason === expected.reason,
    directDiscovery: value.fallbackUsed === false,
  };
}

export type ManagedAiProof = {
  settings: boolean;
  scoring: boolean;
  budgetHealthy: boolean;
  usageEvent: boolean;
  mode: "ai-gateway" | "heuristic";
};

export function evaluateManagedAiProof(input: {
  user: unknown;
  sourceSummary: unknown;
  usage: unknown;
  agentRunId: string;
  requireAiGateway?: boolean;
}): ManagedAiProof {
  const user = isRecord(input.user) ? input.user : {};
  const settings = isRecord(user.aiSettings) ? user.aiSettings : {};
  const sourceSummary = isRecord(input.sourceSummary) ? input.sourceSummary : {};
  const scoring = isRecord(sourceSummary.aiScoring) ? sourceSummary.aiScoring : {};
  const usage = isRecord(input.usage) ? input.usage : {};
  const budget = isRecord(usage.summary) ? usage.summary : {};
  const events = Array.isArray(usage.events) ? usage.events.filter(isRecord) : [];
  const runScoringEvents = events.filter(
    (event) => event.agentRunId === input.agentRunId && event.operation === "candidate_scoring",
  );
  const gatewayEvent = runScoringEvents.some(
    (event) =>
      event.mode === "managed" &&
      event.provider === "cloudflare-ai-gateway" &&
      event.status === "ok",
  );
  const requireAiGateway = input.requireAiGateway === true;
  return {
    settings: settings.mode === "managed" && settings.status === "active",
    scoring: requireAiGateway
      ? scoring.status === "ok" && scoring.provider === "cloudflare-ai-gateway"
      : scoring.status === "skipped" && scoring.provider === "heuristic",
    budgetHealthy: budget.budgetExceeded === false,
    usageEvent: requireAiGateway ? gatewayEvent : runScoringEvents.length === 0,
    mode: requireAiGateway ? "ai-gateway" : "heuristic",
  };
}

export function sameOriginDeckImageUrl(listings: unknown, baseUrl: string): string {
  if (!Array.isArray(listings)) return "";
  const origin = new URL(baseUrl).origin;
  for (const listing of listings) {
    if (!isRecord(listing) || !Array.isArray(listing.images)) continue;
    for (const value of listing.images) {
      if (typeof value !== "string") continue;
      try {
        const url = new URL(value, origin);
        if (url.origin === origin && /^\/api\/images\/[^/]+$/.test(url.pathname)) return url.toString();
      } catch {
        // Ignore malformed listing image URLs.
      }
    }
  }
  return "";
}

export function listingsHaveExplicitLocationStatus(listings: unknown): boolean {
  if (!Array.isArray(listings) || listings.length === 0) return false;
  return listings.every((listing) => {
    if (!isRecord(listing)) return false;
    if (listing.locationStatus === "ok") {
      return typeof listing.location === "string" && Boolean(listing.location.trim());
    }
    if (listing.locationStatus !== "missing" || !Array.isArray(listing.missingData)) return false;
    return listing.missingData.some((value) => typeof value === "string" && value.trim().toLowerCase() === "location");
  });
}

export function validManagedScheduleStatus(input: {
  status: unknown;
  user: unknown;
  expectedNextRunAt: string;
  now?: Date;
  toleranceMs?: number;
}): boolean {
  const status = isRecord(input.status) ? input.status : {};
  const user = isRecord(input.user) ? input.user : {};
  const profile = isRecord(user.profile) ? user.profile : {};
  const schedules = Array.isArray(status.schedules) ? status.schedules.filter(isRecord) : [];
  const queueSchedules = schedules.filter((schedule) => schedule.callback === "queueScheduledRun");
  const schedule = queueSchedules[0];
  const nextRunAt = typeof status.nextRunAt === "string" ? Date.parse(status.nextRunAt) : Number.NaN;
  const expectedNextRunAt = Date.parse(input.expectedNextRunAt);
  const toleranceMs = input.toleranceMs ?? 1_000;
  const now = input.now?.getTime() ?? Date.now();
  return Boolean(
    status.userId === user.id &&
      status.scheduleCron === profile.scheduleCron &&
      status.scheduleTimezone === profile.timezone &&
      status.phase === "scheduled" &&
      typeof status.scheduleId === "string" &&
      status.scheduleId.length > 0 &&
      Number.isFinite(nextRunAt) &&
      Number.isFinite(expectedNextRunAt) &&
      nextRunAt > now &&
      Math.abs(nextRunAt - expectedNextRunAt) <= toleranceMs &&
      queueSchedules.length === 1 &&
      schedule?.id === status.scheduleId &&
      schedule?.type === "scheduled" &&
      schedule?.nextRunAt === status.nextRunAt &&
      !("payload" in (schedule || {})),
  );
}

export function jwtSubject(token: string): string {
  try {
    const payload = token.split(".")[1];
    if (!payload) return "";
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown };
    return typeof parsed.sub === "string" ? parsed.sub : "";
  } catch {
    return "";
  }
}

export function redactSensitive(error: unknown, secrets: Iterable<string> = []): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of Array.from(secrets).filter(Boolean).sort((a, b) => b.length - a.length)) {
    message = message.split(secret).join("<redacted-secret>");
  }
  return message
    .replace(/([?&](?:__clerk_ticket|ticket|token)=)[^&\s]+/gi, "$1<redacted>")
    .replace(/\beyJ[A-Za-z0-9._-]{20,}\b/g, "<redacted-jwt>")
    .replace(/\b(?:sk|pk)_(?:test|live)_[A-Za-z0-9_-]+\b/g, "<redacted-key>");
}

function strictHttpsUrl(value: string, label: string, options: { allowQuery?: boolean } = {}): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`${label} must use credential-free HTTPS.`);
  }
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error(`${label} must not be local.`);
  }
  if (url.pathname !== "/" || (!options.allowQuery && (url.search || url.hash))) {
    throw new Error(`${label} must be an origin URL with no path, query, or fragment.`);
  }
  return url;
}

function normalizedField(record: UnknownRecord, key: string): string {
  return typeof record[key] === "string" ? record[key].trim().toLowerCase() : "";
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
