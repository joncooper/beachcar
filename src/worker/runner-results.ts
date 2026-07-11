import { normalizeDossier, normalizeListing } from "../shared/normalize";
import type {
  AuctionListing,
  RunRunnerTaskSummary,
  RunSourceCacheDiagnostic,
  RunSourceCheck,
  RunSourceDetailAttempts,
  RunSourceStatus,
  RunSourceSummary,
} from "../shared/types";

export type RunnerResultStatus = "ok" | "empty" | "blocked" | "failed";

export interface RunnerCandidateRejection {
  index: number;
  reason: string;
  title?: string;
  url?: string;
}

export interface NormalizedRunnerCandidates {
  listings: AuctionListing[];
  rejections: RunnerCandidateRejection[];
}

export interface RunnerResultAnalysis extends NormalizedRunnerCandidates {
  candidateCount: number;
  resultStatus: RunnerResultStatus;
}

export function analyzeRunnerResult(value: unknown): RunnerResultAnalysis {
  const result = isRecord(value) ? value : {};
  const candidates = Array.isArray(result.normalizedCandidates) ? result.normalizedCandidates : [];
  const normalized = normalizeRunnerCandidates(candidates);
  return {
    ...normalized,
    candidateCount: candidates.length,
    resultStatus: normalizeRunnerResultStatus(result.status, candidates.length),
  };
}

export function normalizeRunnerCandidates(value: unknown): NormalizedRunnerCandidates {
  const candidates = Array.isArray(value) ? value : [];
  const listings: AuctionListing[] = [];
  const rejections: RunnerCandidateRejection[] = [];

  candidates.forEach((candidate, index) => {
    if (!isRecord(candidate)) {
      rejections.push({ index, reason: "candidate_not_object" });
      return;
    }
    const title = stringField(candidate.title);
    const url = stringField(candidate.url);
    const site = stringField(candidate.site);
    if (!title) {
      rejections.push({ index, reason: "missing_title", url });
      return;
    }
    if (!url || !isHttpUrl(url)) {
      rejections.push({ index, reason: "missing_or_invalid_url", title, url });
      return;
    }
    if (!site) {
      rejections.push({ index, reason: "missing_site", title, url });
      return;
    }
    listings.push(listingFromRecord(candidate, { title, url, site }));
  });

  return { listings, rejections };
}

export function auctionListingFromUnknown(value: unknown): AuctionListing | null {
  if (!isRecord(value)) return null;
  const title = stringField(value.title);
  const url = stringField(value.url);
  const site = stringField(value.site);
  if (!title || !url || !site || !isHttpUrl(url)) return null;
  return listingFromRecord(value, { title, url, site });
}

/**
 * Validates a source summary that originated in request JSON or D1 JSON. Known
 * fields are normalized to their declared types; JSON-safe producer metadata is
 * retained for backwards-compatible provenance.
 */
export function normalizeRunSourceSummary(value: unknown): RunSourceSummary | null {
  if (!isRecord(value)) return null;
  const summary: RunSourceSummary = {};

  for (const [key, raw] of Object.entries(value)) {
    if (RUN_SOURCE_SUMMARY_KEYS.has(key)) continue;
    const safe = jsonSafeValue(raw);
    if (safe !== undefined) summary[key] = safe;
  }

  const publisher = stringField(value.publisher);
  if (publisher) summary.publisher = publisher;
  const agentRunId = stringField(value.agentRunId);
  if (agentRunId) summary.agentRunId = agentRunId;
  const workflowInstanceId = stringField(value.workflowInstanceId);
  if (workflowInstanceId) summary.workflowInstanceId = workflowInstanceId;
  const source = stringField(value.source);
  if (source) summary.source = source;
  const reason = nullableString(value.reason);
  if (reason !== undefined) summary.reason = reason;
  const userId = stringField(value.userId);
  if (userId) summary.userId = userId;
  const previousRunId = nullableString(value.previousRunId);
  if (previousRunId !== undefined) summary.previousRunId = previousRunId;
  const automationTokenLabel = stringField(value.automationTokenLabel);
  if (automationTokenLabel) summary.automationTokenLabel = automationTokenLabel;
  const automationTokenId = nullableString(value.automationTokenId);
  if (automationTokenId !== undefined) summary.automationTokenId = automationTokenId;
  const oauthAccessTokenId = nullableString(value.oauthAccessTokenId);
  if (oauthAccessTokenId !== undefined) summary.oauthAccessTokenId = oauthAccessTokenId;
  const oauthClientId = nullableString(value.oauthClientId);
  if (oauthClientId !== undefined) summary.oauthClientId = oauthClientId;
  const publishedAt = stringField(value.publishedAt);
  if (publishedAt) summary.publishedAt = publishedAt;

  const enabledSources = stringArray(value.enabledSources);
  if (enabledSources) summary.enabledSources = enabledSources;
  const sourceSettings = normalizeSourceSettings(value.sourceSettings);
  if (sourceSettings) summary.sourceSettings = sourceSettings;
  const profile = scalarRecord(value.profile);
  if (profile) summary.profile = profile;
  const checkedSources = sourceChecks(value.checkedSources);
  if (checkedSources) summary.checkedSources = checkedSources;
  const blockedSources = sourceChecks(value.blockedSources);
  if (blockedSources) summary.blockedSources = blockedSources;
  const runnerTasks = runnerTaskSummaries(value.runnerTasks);
  if (runnerTasks) summary.runnerTasks = runnerTasks;

  const rawCandidateCount = nonnegativeNumber(value.rawCandidateCount);
  if (rawCandidateCount !== undefined) summary.rawCandidateCount = rawCandidateCount;
  const feedbackCount = nonnegativeNumber(value.feedbackCount);
  if (feedbackCount !== undefined) summary.feedbackCount = feedbackCount;
  if (typeof value.fallbackUsed === "boolean") summary.fallbackUsed = value.fallbackUsed;

  const aiScoring = normalizeAiScoring(value.aiScoring);
  if (aiScoring !== undefined) summary.aiScoring = aiScoring;
  const sourceCacheUpdates = normalizeSourceCacheUpdates(value.sourceCacheUpdates);
  if (sourceCacheUpdates) summary.sourceCacheUpdates = sourceCacheUpdates;

  return summary;
}

/** Incoming publication metadata wins, except terminal runner diagnostics. */
export function mergeRunSourceSummaries(
  existing: RunSourceSummary | null,
  incoming: RunSourceSummary | null,
): RunSourceSummary | null {
  if (!existing) return incoming;
  if (!incoming) return existing;

  const runnerTasks = mergeRunnerTaskSummaries(existing.runnerTasks || [], incoming.runnerTasks || []);
  return {
    ...existing,
    ...incoming,
    ...(runnerTasks.length ? { runnerTasks } : {}),
  };
}

export function summarizeRunnerRejections(rejections: RunnerCandidateRejection[]): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const rejection of rejections) counts.set(rejection.reason, (counts.get(rejection.reason) || 0) + 1);
  return [...counts.entries()].map(([reason, count]) => ({ reason, count }));
}

function listingFromRecord(
  record: Record<string, unknown>,
  required: { title: string; url: string; site: string },
): AuctionListing {
  const input: Partial<AuctionListing> = {
    title: required.title,
    url: required.url,
    site: required.site,
  };

  const listingKey = stringField(record.listingKey);
  const lane = record.lane === "family" || record.lane === "solo" || record.lane === "curiosity" ? record.lane : undefined;
  if (lane) input.lane = lane;
  input.section = stringField(record.section);
  input.bid = stringField(record.bid);
  input.total = stringField(record.total);
  input.location = stringField(record.location);
  input.locationRaw = stringField(record.locationRaw);
  input.locationCity = stringField(record.locationCity);
  input.locationRegion = stringField(record.locationRegion);
  input.locationCountry = stringField(record.locationCountry);
  input.endsAt = stringField(record.endsAt);
  input.ends = stringField(record.ends);
  input.timeLeft = stringField(record.timeLeft);
  input.fair = stringField(record.fair);
  input.ceiling = stringField(record.ceiling);
  input.conf = stringField(record.conf);
  input.why = stringField(record.why);
  input.concerns = stringField(record.concerns);
  input.currentTake = stringField(record.currentTake);
  copyFiniteNumber(record, input, "distanceMiles");
  copyFiniteNumber(record, input, "bidNum");
  copyFiniteNumber(record, input, "bidCents");
  if (record.locationStatus === "ok" || record.locationStatus === "missing") input.locationStatus = record.locationStatus;
  const missingData = stringArray(record.missingData);
  if (missingData) input.missingData = missingData;
  const images = stringArray(record.images);
  if (images) input.images = images;
  const dossier = normalizeDossier(record.dossier);
  if (dossier) input.dossier = dossier;

  for (const key of ["bids", "bidders", "comments"] as const) {
    const field = record[key];
    if (typeof field === "string" || typeof field === "number") input[key] = field;
  }

  const listing = normalizeListing(input);
  return listingKey ? { ...listing, listingKey } : listing;
}

function copyFiniteNumber<K extends "distanceMiles" | "bidNum" | "bidCents">(
  source: Record<string, unknown>,
  target: Partial<AuctionListing>,
  key: K,
): void {
  const value = nonnegativeNumber(source[key]);
  if (value !== undefined) target[key] = value;
}

function normalizeRunnerResultStatus(value: unknown, candidateCount: number): RunnerResultStatus {
  if (value === "ok" || value === "empty" || value === "blocked" || value === "failed") return value;
  if (typeof value === "string" && value.trim()) return "failed";
  return candidateCount > 0 ? "ok" : "empty";
}

function sourceChecks(value: unknown): RunSourceCheck[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const checks = value.map(sourceCheck).filter((check): check is RunSourceCheck => check !== null);
  return checks;
}

function sourceCheck(value: unknown): RunSourceCheck | null {
  if (!isRecord(value)) return null;
  const source = stringField(value.source);
  const site = stringField(value.site);
  const status = runSourceStatus(value.status);
  if (!source || !site || !status) return null;
  const check: RunSourceCheck = {
    source,
    site,
    status,
    candidateCount: nonnegativeNumber(value.candidateCount) || 0,
  };
  for (const key of ["label", "url", "checkedAt", "message"] as const) {
    const field = stringField(value[key]);
    if (field) check[key] = field;
  }
  const selectorHits = numericRecord(value.selectorHits);
  if (selectorHits) check.selectorHits = selectorHits;
  const detailAttempts = normalizeDetailAttempts(value.detailAttempts);
  if (detailAttempts) check.detailAttempts = detailAttempts;
  const blockedUrls = stringArray(value.blockedUrls);
  if (blockedUrls) check.blockedUrls = blockedUrls;
  const cache = normalizeCacheDiagnostic(value.cache);
  if (cache) check.cache = cache;
  return check;
}

function normalizeDetailAttempts(value: unknown): RunSourceDetailAttempts | undefined {
  if (!isRecord(value)) return undefined;
  const attempts: RunSourceDetailAttempts = {
    attempted: nonnegativeNumber(value.attempted) || 0,
    enriched: nonnegativeNumber(value.enriched) || 0,
    blocked: nonnegativeNumber(value.blocked) || 0,
    failed: nonnegativeNumber(value.failed) || 0,
    empty: nonnegativeNumber(value.empty) || 0,
  };
  const blockedUrls = stringArray(value.blockedUrls);
  if (blockedUrls) attempts.blockedUrls = blockedUrls;
  const failedUrls = stringArray(value.failedUrls);
  if (failedUrls) attempts.failedUrls = failedUrls;
  return attempts;
}

function normalizeCacheDiagnostic(value: unknown): RunSourceCacheDiagnostic | undefined {
  if (!isRecord(value)) return undefined;
  const cache: RunSourceCacheDiagnostic = {};
  const status = stringField(value.status);
  if (status) cache.status = status;
  const latestIngestionAt = nullableString(value.latestIngestionAt);
  if (latestIngestionAt !== undefined) cache.latestIngestionAt = latestIngestionAt;
  const refreshError = nullableString(value.refreshError);
  if (refreshError !== undefined) cache.refreshError = refreshError;
  const usableCount = nonnegativeNumber(value.usableCount);
  if (usableCount !== undefined) cache.usableCount = usableCount;
  const searchedTerms = stringArray(value.searchedTerms);
  if (searchedTerms) cache.searchedTerms = searchedTerms;
  return Object.keys(cache).length ? cache : undefined;
}

function runnerTaskSummaries(value: unknown): RunRunnerTaskSummary[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(runnerTaskSummary).filter((task): task is RunRunnerTaskSummary => task !== null);
}

function runnerTaskSummary(value: unknown): RunRunnerTaskSummary | null {
  if (!isRecord(value)) return null;
  const id = stringField(value.id);
  const source = stringField(value.source);
  const kind = stringField(value.kind);
  const status = stringField(value.status);
  if (!id || !source || !kind || !status) return null;
  const task: RunRunnerTaskSummary = { id, source, kind, status };
  if (value.mergeStatus === "empty" || value.mergeStatus === "pending_run" || value.mergeStatus === "merged") task.mergeStatus = value.mergeStatus;
  if (value.resultStatus === "ok" || value.resultStatus === "empty" || value.resultStatus === "blocked" || value.resultStatus === "failed") {
    task.resultStatus = value.resultStatus;
  }
  for (const key of ["normalizedCandidateCount", "importedCount", "patchedCount", "insertedCount", "rejectedCount"] as const) {
    const count = nonnegativeNumber(value[key]);
    if (count !== undefined) task[key] = count;
  }
  if (Array.isArray(value.rejectionReasons)) {
    task.rejectionReasons = value.rejectionReasons.flatMap((reason) => {
      if (!isRecord(reason)) return [];
      const name = stringField(reason.reason);
      const count = nonnegativeNumber(reason.count);
      return name && count !== undefined ? [{ reason: name, count }] : [];
    });
  }
  return task;
}

function mergeRunnerTaskSummaries(
  existing: RunRunnerTaskSummary[],
  incoming: RunRunnerTaskSummary[],
): RunRunnerTaskSummary[] {
  const merged = new Map(existing.map((task) => [task.id, task]));
  for (const task of incoming) {
    const current = merged.get(task.id);
    if (!current) {
      merged.set(task.id, task);
      continue;
    }
    const currentIsTerminal = current.mergeStatus === "merged" || current.mergeStatus === "empty";
    merged.set(task.id, currentIsTerminal ? { ...task, ...current } : { ...current, ...task });
  }
  return [...merged.values()];
}

function normalizeSourceSettings(value: unknown): RunSourceSummary["sourceSettings"] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((setting) => {
    if (!isRecord(setting)) return [];
    const source = stringField(setting.source);
    const settings = scalarRecord(setting.settings);
    if (!source || typeof setting.enabled !== "boolean") return [];
    return [{ source, enabled: setting.enabled, settings: settings || {} }];
  });
}

function normalizeAiScoring(value: unknown): RunSourceSummary["aiScoring"] | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const status = stringField(value.status);
  if (!status) return undefined;
  const scoring: NonNullable<RunSourceSummary["aiScoring"]> = { status };
  const provider = nullableString(value.provider);
  if (provider !== undefined) scoring.provider = provider;
  const model = nullableString(value.model);
  if (model !== undefined) scoring.model = model;
  const message = stringField(value.message);
  if (message) scoring.message = message;
  const totalTokens = nonnegativeNumber(value.totalTokens);
  if (totalTokens !== undefined) scoring.totalTokens = totalTokens;
  else if (value.totalTokens === null) scoring.totalTokens = null;
  const costMicros = nonnegativeNumber(value.costMicros);
  if (costMicros !== undefined) scoring.costMicros = costMicros;
  return scoring;
}

function normalizeSourceCacheUpdates(value: unknown): RunSourceSummary["sourceCacheUpdates"] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const source = stringField(entry.source);
    const status = stringField(entry.status);
    if (!source || !status) return [];
    const update: NonNullable<RunSourceSummary["sourceCacheUpdates"]>[number] = {
      source,
      status,
      candidateCount: nonnegativeNumber(entry.candidateCount) || 0,
    };
    const newItemCount = nonnegativeNumber(entry.newItemCount);
    if (newItemCount !== undefined) update.newItemCount = newItemCount;
    const error = stringField(entry.error);
    if (error) update.error = error;
    return [update];
  });
}

function runSourceStatus(value: unknown): RunSourceStatus | undefined {
  return value === "ok" || value === "blocked" || value === "failed" || value === "skipped" || value === "fallback" ? value : undefined;
}

function scalarRecord(value: unknown): Record<string, string | number | boolean | null> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, field] of Object.entries(value)) {
    if (typeof field === "string" || typeof field === "boolean" || field === null || (typeof field === "number" && Number.isFinite(field))) {
      result[key] = field;
    }
  }
  return result;
}

function numericRecord(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, number> = {};
  for (const [key, field] of Object.entries(value)) {
    const number = nonnegativeNumber(field);
    if (number !== undefined) result[key] = number;
  }
  return Object.keys(result).length ? result : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((entry) => {
    const string = stringField(entry);
    return string ? [string] : [];
  });
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonnegativeNumber(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number >= 0 ? number : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nullableString(value: unknown): string | null | undefined {
  return value === null ? null : stringField(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

type JsonSafe = string | number | boolean | null | JsonSafe[] | { [key: string]: JsonSafe };

function jsonSafeValue(value: unknown, seen = new WeakSet<object>()): JsonSafe | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    const array: JsonSafe[] = [];
    for (const item of value) {
      const safe = jsonSafeValue(item, seen);
      if (safe !== undefined) array.push(safe);
    }
    seen.delete(value);
    return array;
  }
  const object: { [key: string]: JsonSafe } = {};
  for (const [key, item] of Object.entries(value)) {
    const safe = jsonSafeValue(item, seen);
    if (safe !== undefined) object[key] = safe;
  }
  seen.delete(value);
  return object;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const RUN_SOURCE_SUMMARY_KEYS = new Set([
  "publisher",
  "agentRunId",
  "workflowInstanceId",
  "source",
  "reason",
  "userId",
  "enabledSources",
  "sourceSettings",
  "previousRunId",
  "profile",
  "checkedSources",
  "blockedSources",
  "runnerTasks",
  "rawCandidateCount",
  "feedbackCount",
  "fallbackUsed",
  "automationTokenId",
  "oauthAccessTokenId",
  "oauthClientId",
  "automationTokenLabel",
  "publishedAt",
  "aiScoring",
  "sourceCacheUpdates",
]);
