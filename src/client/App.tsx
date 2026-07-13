import {
  BadgeDollarSign,
  Bot,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  Gavel,
  ImageOff,
  KeyRound,
  List,
  MapPin,
  MessageCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  acceptInvite,
  clearFeedback,
  createAutomationToken,
  createAdminInvite,
  deleteAccount as deleteAccountRequest,
  exportAccount,
  getAutomationBundle,
  getAutomationStatus,
  getAdminSourceCacheStatus,
  getAdminOpsSummary,
  getAdminProductEventSummary,
  getLatestAgentRun,
  getLatestRun,
  getMe,
  ingestAdminSourceCache,
  listAdminUsers,
  putFeedback,
  putProfile,
  putResearchSettings,
  putSourceSettings,
  requestAgentRun,
  revokeAutomationToken,
  revokeOAuthConnection,
  setAuthTokenGetter,
} from "./api";
import { signInWithGoogle, useClerkBrowser } from "./clerk-browser";
import type { BrowserClerk } from "./clerk-browser";
import type {
  AdminUserSummary,
  AdminOpsSummary,
  AiUsageSummary,
  AutomationStatus,
  AutomationTokenCreateResult,
  AutomationTokenRecord,
  AgentRunRecord,
  AuctionListing,
  FeedbackAction,
  FeedbackRecord,
  InvitePayload,
  Lane,
  OAuthAccessTokenRecord,
  ProductEventSummary,
  RunPayload,
  ResearchMode,
  SourceCacheAdminStatus,
  SourceSetting,
  UserPayload,
} from "../shared/types";

type ViewFilter = "all" | Lane | "starred" | "ending";
type ViewMode = "deck" | "list";
const managedResearchPrice = 29;
const managedResearchCheckoutEnabled = import.meta.env.VITE_MANAGED_RESEARCH_CHECKOUT_ENABLED === "true";
type SourceSettingsInput = Array<{ source: string; enabled: boolean; settings?: Record<string, unknown> }>;
type NotificationChannel = "email" | "none";
type NotificationSettingsState = {
  channel: NotificationChannel;
  runDigest: boolean;
  strongFitAlerts: boolean;
  digestTime: string;
};
type SourcePreferenceState = {
  source: string;
  enabled: boolean;
  maxDistanceMiles: string;
  maxBudget: string;
  noReserveOnly: boolean;
  browserRunner: boolean;
  searchNotes: string;
};
type CalibrationOption = {
  id: string;
  label: string;
  note: string;
};
type SourceCheckView = {
  source: string;
  site: string;
  status: string;
  label?: string;
  url?: string;
  candidateCount: number;
  message?: string;
  selectorHits?: Record<string, number>;
  detailAttempts?: {
    attempted: number;
    enriched: number;
    blocked: number;
    failed: number;
    empty: number;
    blockedUrls?: string[];
    failedUrls?: string[];
  };
  blockedUrls?: string[];
  cache?: {
    status?: string;
    usableCount?: number;
    searchedTerms?: string[];
    latestIngestionAt?: string | null;
    refreshError?: string | null;
  };
};
type RunnerTaskSummaryView = {
  id: string;
  source: string;
  kind: string;
  status: string;
  mergeStatus?: string;
  normalizedCandidateCount?: number;
  importedCount?: number;
  rejectedCount?: number;
  rejectionReasons?: Array<{ reason: string; count: number }>;
};
type AiScoringView = {
  status: string;
  provider: string;
  model?: string;
  gatewayId?: string;
  totalTokens?: number | null;
  costMicros?: number;
  message?: string;
};
type SourceSummaryView = {
  publisher?: string;
  agentRunId?: string;
  workflowInstanceId?: string;
  source?: string;
  reason?: string | null;
  enabledSources: string[];
  checkedSources: SourceCheckView[];
  blockedSources: SourceCheckView[];
  runnerTasks: RunnerTaskSummaryView[];
  rawCandidateCount: number;
  feedbackCount: number;
  fallbackUsed: boolean;
  aiScoring?: AiScoringView | null;
};
type TimelineItemView = {
  label: string;
  detail: string;
  status: "done" | "running" | "waiting" | "failed";
};

const laneLabels: Record<Lane, string> = {
  family: "Family",
  solo: "Solo",
  curiosity: "Curiosity",
};

const actionLabels: Record<FeedbackAction, string> = {
  like: "Liked",
  star: "Starred",
  hide: "Hidden",
  avoid: "Avoid similar",
};

const actionClasses: Record<FeedbackAction, string> = {
  like: "is-liked",
  star: "is-starred",
  hide: "is-hidden",
  avoid: "is-avoid",
};

const sourceOptions = [
  {
    source: "bringatrailer",
    label: "Bring a Trailer",
    enabledByDefault: true,
    defaultMaxDistanceMiles: "750",
    defaultMaxBudget: "",
    supportsNoReserve: true,
    supportsBrowserRunner: false,
    defaultBrowserRunner: false,
    searchPlaceholder: "VW Thing, Samurai, Tracker, Moke...",
  },
  {
    source: "carsandbids",
    label: "Cars & Bids",
    enabledByDefault: true,
    defaultMaxDistanceMiles: "750",
    defaultMaxBudget: "",
    supportsNoReserve: false,
    supportsBrowserRunner: true,
    defaultBrowserRunner: true,
    searchPlaceholder: "Small 4x4, convertible, beach-town oddballs...",
  },
  {
    source: "hemmings",
    label: "Hemmings",
    enabledByDefault: false,
    defaultMaxDistanceMiles: "750",
    defaultMaxBudget: "",
    supportsNoReserve: false,
    supportsBrowserRunner: true,
    defaultBrowserRunner: true,
    searchPlaceholder: "Thing, Type 2, Samurai, CJ, Moke...",
  },
  {
    source: "marketplace",
    label: "Marketplace",
    enabledByDefault: false,
    defaultMaxDistanceMiles: "150",
    defaultMaxBudget: "",
    supportsNoReserve: false,
    supportsBrowserRunner: true,
    defaultBrowserRunner: true,
    searchPlaceholder: "Local scooters, runabouts, golf carts, projects to avoid...",
  },
];

function sourceDisplayLabel(source: string): string {
  const normalized = source.trim().toLowerCase();
  if (normalized === "bringatrailer-detail") return "Bring a Trailer detail";
  return sourceOptions.find((option) => option.source === normalized)?.label || source;
}

const tasteCalibrationOptions: CalibrationOption[] = [
  { id: "open-air", label: "Open-air", note: "convertibles, door-off 4x4s, targas, and sunroof cars" },
  { id: "simple", label: "Simple", note: "mechanically simple cars with easy parts and light electronics" },
  { id: "kid-plausible", label: "Kid-plausible", note: "usable rear seats, seat belts, and relaxed family errand potential" },
  { id: "small-4x4", label: "Small 4x4", note: "Samurai, Tracker, Sidekick, Thing, and similar compact runabouts" },
  { id: "no-reserve", label: "No reserve", note: "no-reserve or low-drama auctions worth watching early" },
  { id: "quirky-clean", label: "Quirky clean", note: "unusual but tidy cars with charm over perfection" },
];

const avoidCalibrationOptions: CalibrationOption[] = [
  { id: "rust", label: "Rust", note: "structural rust, coastal corrosion, and vague underside photos" },
  { id: "salvage", label: "Salvage", note: "salvage, rebuilt, bonded, or title-story cars" },
  { id: "heavy-project", label: "Heavy project", note: "non-running projects, unknown mechanicals, or missing major parts" },
  { id: "overbuilt", label: "Overbuilt", note: "huge lifts, extreme off-road builds, and hard-to-reverse modifications" },
  { id: "fragile", label: "Fragile", note: "fussy imports, scarce parts, and cars that need specialist ownership" },
  { id: "price-chasing", label: "Price chase", note: "cars already bid past the friend budget or likely to run away" },
];

const defaultTasteCalibration = ["open-air", "simple", "kid-plausible"];
const defaultAvoidCalibration = ["rust", "salvage", "heavy-project"];

const appName = import.meta.env.VITE_APP_NAME || "Beach Car Watch";

function listingKey(listing: AuctionListing): string {
  return listing.listingKey || listing.url || listing.title;
}

function imageVariantUrl(url: string, variant: "thumb" | "deck" | "full"): string {
  if (!url.startsWith("/api/images/")) return url;
  const parsed = new URL(url, window.location.origin);
  parsed.searchParams.set("variant", variant);
  return `${parsed.pathname}${parsed.search}`;
}

function isHiddenAction(action?: FeedbackAction | null): boolean {
  return action === "hide" || action === "avoid";
}

function normalizeCount(value: unknown): string {
  if (value === undefined || value === null || value === "") return "check";
  return String(value);
}

function hasKnownCount(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "" && !/^check\b/i.test(String(value));
}

function isGenericCurrentTake(value: string | undefined): boolean {
  return /^(source-discovery candidate|c&b candidate|manual source-check fallback)/i.test(value || "");
}

function listingPrimerText(listing: AuctionListing): string {
  if (!isGenericCurrentTake(listing.currentTake)) return shortText(listing.currentTake);
  return shortText(listing.dossier?.summary || listing.why);
}

function listingScanMeta(listing: AuctionListing): string {
  return isGenericCurrentTake(listing.currentTake) ? listing.section : shortText(listing.currentTake, listing.section);
}

function estimatedFeeTotal(listing: AuctionListing): number | null {
  const match = (listing.total || listing.bid || "").match(/\$([\d,]+)/);
  if (!match) return null;
  const total = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(total) ? total : null;
}

function budgetPressure(listing: AuctionListing): { label: string; className: string } | null {
  const total = estimatedFeeTotal(listing);
  if (!total) return null;
  if (total > 32000) return { label: "over cap", className: "is-over" };
  if (total >= 30000) return { label: "stretch", className: "is-stretch" };
  if (total >= 28000) return { label: "near cap", className: "is-near" };
  return null;
}

function isEndingSoon(listing: AuctionListing): boolean {
  if (listing.endsAt) {
    const hours = (new Date(listing.endsAt).getTime() - Date.now()) / 36e5;
    return Number.isFinite(hours) && hours <= 30;
  }
  return /today|hour|m$|h\b/i.test(listing.timeLeft || "");
}

function searchBlob(listing: AuctionListing): string {
  return [
    listing.title,
    listing.site,
    listing.section,
    listing.lane,
    listing.bid,
    listing.total,
    listing.fair,
    listing.ceiling,
    listing.why,
    listing.concerns,
    listing.currentTake,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function mergedFeedback(run: RunPayload | null): Map<string, FeedbackRecord> {
  const map = new Map<string, FeedbackRecord>();
  for (const feedback of run?.feedback || []) map.set(feedback.listingKey, feedback);
  for (const listing of run?.listings || []) {
    if (listing.feedback) map.set(listingKey(listing), listing.feedback);
  }
  return map;
}

function generatedTime(run: RunPayload | null): string {
  if (!run?.generatedAt) return "No run";
  return new Date(run.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function agentRunLabel(run: AgentRunRecord | null): string {
  if (!run) return "Run";
  if (run.status === "queued") return "Queued";
  if (run.status === "running") return "Running";
  if (run.status === "failed") return "Failed";
  return "Run";
}

function runButtonTitle(user: UserPayload, run: AgentRunRecord | null, canQueueRun: boolean): string {
  if (!canQueueRun) {
    if (user.researchSettings?.mode === "external_agent") return "Your connected agent publishes new shortlists through Beachcar MCP.";
    if (!user.managedResearchEntitlement?.active) return "Managed Research is available with a subscription.";
    if (user.aiUsage?.budgetExceeded) return "AI budget reached. Raise the cap in Preferences before running again.";
    return "Finish setup before running.";
  }
  return run ? `Latest agent run: ${run.status}` : "Queue a fresh run";
}

function runActionLabel(user: UserPayload, run: AgentRunRecord | null, canQueueRun: boolean): string {
  if (canQueueRun) return agentRunLabel(run);
  if (user.researchSettings?.mode === "external_agent") return "Your agent";
  if (!user.managedResearchEntitlement?.active) return "Upgrade";
  if (user.aiUsage?.budgetExceeded) return "Budget";
  return "Setup";
}

function sourceSummaryView(value: unknown): SourceSummaryView {
  const record = normalizeRecord(value);
  return {
    publisher: stringValue(record.publisher),
    agentRunId: stringValue(record.agentRunId),
    workflowInstanceId: stringValue(record.workflowInstanceId),
    source: stringValue(record.source),
    reason: nullableStringValue(record.reason),
    enabledSources: stringArrayValue(record.enabledSources),
    checkedSources: sourceCheckViews(record.checkedSources),
    blockedSources: sourceCheckViews(record.blockedSources),
    runnerTasks: runnerTaskSummaryViews(record.runnerTasks),
    rawCandidateCount: numberValue(record.rawCandidateCount, 0),
    feedbackCount: numberValue(record.feedbackCount, 0),
    fallbackUsed: record.fallbackUsed === true,
    aiScoring: aiScoringView(record.aiScoring),
  };
}

function sourceCheckViews(value: unknown): SourceCheckView[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = normalizeRecord(item);
    return {
      source: stringValue(record.source) || "source",
      site: stringValue(record.site) || stringValue(record.source) || "Source",
      status: stringValue(record.status) || "unknown",
      label: stringValue(record.label),
      url: stringValue(record.url),
      candidateCount: numberValue(record.candidateCount, 0),
      message: stringValue(record.message),
      selectorHits: recordObjectNumberMap(record.selectorHits),
      detailAttempts: sourceDetailAttemptsView(record.detailAttempts),
      blockedUrls: stringArrayValue(record.blockedUrls),
      cache: sourceCacheDiagnosticView(record.cache),
    };
  });
}

function runnerTaskSummaryViews(value: unknown): RunnerTaskSummaryView[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = normalizeRecord(item);
    return {
      id: stringValue(record.id) || "runner-task",
      source: stringValue(record.source) || "source",
      kind: stringValue(record.kind) || "source_discovery",
      status: stringValue(record.status) || "queued",
      mergeStatus: stringValue(record.mergeStatus),
      normalizedCandidateCount: optionalNumberValue(record.normalizedCandidateCount),
      importedCount: optionalNumberValue(record.importedCount),
      rejectedCount: optionalNumberValue(record.rejectedCount),
      rejectionReasons: rejectionReasonViews(record.rejectionReasons),
    };
  });
}

function sourceDetailAttemptsView(value: unknown): SourceCheckView["detailAttempts"] {
  const record = normalizeRecord(value);
  const attempted = optionalNumberValue(record.attempted);
  if (attempted === undefined) return undefined;
  return {
    attempted,
    enriched: numberValue(record.enriched, 0),
    blocked: numberValue(record.blocked, 0),
    failed: numberValue(record.failed, 0),
    empty: numberValue(record.empty, 0),
    blockedUrls: stringArrayValue(record.blockedUrls),
    failedUrls: stringArrayValue(record.failedUrls),
  };
}

function sourceCacheDiagnosticView(value: unknown): SourceCheckView["cache"] {
  const record = normalizeRecord(value);
  const status = stringValue(record.status);
  if (!status) return undefined;
  return {
    status,
    usableCount: optionalNumberValue(record.usableCount),
    searchedTerms: stringArrayValue(record.searchedTerms),
    latestIngestionAt: nullableStringValue(record.latestIngestionAt),
    refreshError: nullableStringValue(record.refreshError),
  };
}

function rejectionReasonViews(value: unknown): Array<{ reason: string; count: number }> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = normalizeRecord(item);
    return { reason: stringValue(record.reason) || "unknown", count: numberValue(record.count, 0) };
  });
}

function aiScoringView(value: unknown): AiScoringView | null {
  const record = normalizeRecord(value);
  const status = stringValue(record.status);
  if (!status) return null;
  return {
    status,
    provider: stringValue(record.provider) || "ai-gateway",
    model: stringValue(record.model),
    gatewayId: stringValue(record.gatewayId),
    totalTokens: nullableNumberValue(record.totalTokens),
    costMicros: numberValue(record.costMicros, 0),
    message: stringValue(record.message),
  };
}

function timelineItems(run: RunPayload | null, agentRun: AgentRunRecord | null, summary: SourceSummaryView): TimelineItemView[] {
  const progress = normalizeRecord(agentRun?.progress);
  const items: TimelineItemView[] = [
    {
      label: "Queued",
      detail: stringValue(progress.requestedAt) ? `Requested ${formatDateTime(stringValue(progress.requestedAt))}` : "Waiting for a run request",
      status: agentRun ? "done" : "waiting",
    },
    {
      label: "Workflow",
      detail: agentRun?.workflowInstanceId ? `Workflow ${shortId(agentRun.workflowInstanceId)}` : stringValue(progress.handoff) || "Cloudflare Agent handoff",
      status: agentRun?.status === "running" ? "running" : agentRun ? "done" : "waiting",
    },
    {
      label: "Source discovery",
      detail: summary.checkedSources.length
        ? `${summary.rawCandidateCount} raw candidates from ${summary.checkedSources.length} checks`
        : "Source checks pending",
      status: summary.checkedSources.length ? "done" : agentRun?.status === "running" ? "running" : "waiting",
    },
    {
      label: "Runner handoff",
      detail: summary.runnerTasks.length
        ? `${summary.runnerTasks.length} browser/container task${summary.runnerTasks.length === 1 ? "" : "s"} queued`
        : summary.blockedSources.length
          ? `${summary.blockedSources.length} blocked source${summary.blockedSources.length === 1 ? "" : "s"}`
          : "No browser-heavy follow-up",
      status: summary.runnerTasks.length || summary.blockedSources.length ? "done" : summary.checkedSources.length ? "done" : "waiting",
    },
    {
      label: "Published",
      detail: run?.id ? `${run.listings.length} picks in ${shortId(run.id)}` : "No published run yet",
      status: run?.id ? "done" : agentRun?.status === "failed" ? "failed" : "waiting",
    },
  ];
  if (agentRun?.status === "failed") {
    items.push({
      label: "Failure",
      detail: agentRun.error || "Agent run failed",
      status: "failed",
    });
  }
  return items;
}

function runStatusText(run: RunPayload | null, agentRun: AgentRunRecord | null): string {
  if (agentRun?.status === "running") return "Workflow running";
  if (agentRun?.status === "queued") return "Run queued";
  if (agentRun?.status === "failed") return "Run failed";
  if (run?.id) return "Latest run published";
  return "No run yet";
}

function runStatusMeta(run: RunPayload | null, agentRun: AgentRunRecord | null, summary: SourceSummaryView): string {
  if (agentRun?.status === "running") return "Cloudflare Workflow is processing";
  if (agentRun?.status === "queued") return "Waiting for the per-user Agent";
  if (agentRun?.status === "failed") return agentRun.error || "Open details for the failure";
  if (run?.id) {
    const runnerText = summary.runnerTasks.length ? ` · ${summary.runnerTasks.length} runner task${summary.runnerTasks.length === 1 ? "" : "s"}` : "";
    return `${run.listings.length} picks · ${summary.checkedSources.length} source checks${runnerText}`;
  }
  return "Queue the first discovery run";
}

function sourceStatusClass(status: string): string {
  if (status === "ok" || status === "fallback" || status === "completed" || status === "published") return "is-ok";
  if (status === "blocked" || status === "failed") return "is-warn";
  if (status === "running" || status === "queued") return "is-running";
  return "is-muted";
}

function timelineStatusClass(status: TimelineItemView["status"]): string {
  if (status === "done") return "is-ok";
  if (status === "running") return "is-running";
  if (status === "failed") return "is-warn";
  return "is-muted";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nullableStringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function numberValue(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function optionalNumberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function recordObjectNumberMap(value: unknown): Record<string, number> | undefined {
  const record = normalizeRecord(value);
  const entries = Object.entries(record)
    .map(([key, raw]) => [key, optionalNumberValue(raw)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function nullableNumberValue(value: unknown): number | null {
  const parsed = numberValue(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function shortId(value: string | null | undefined): string {
  if (!value) return "run";
  return value.length <= 18 ? value : `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function formatDateTime(value: string | undefined): string {
  if (!value) return "check";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function shortText(value?: string, fallback = "check"): string {
  return value?.trim() || fallback;
}

function compactTime(value?: string): string {
  if (!value) return "check";
  return value
    .replace(/^today,\s*/i, "")
    .replace(/\bdays?\b/gi, "d")
    .replace(/\bhours?\b/gi, "h")
    .replace(/\bminutes?\b/gi, "m")
    .replace(/,\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function locationText(listing: AuctionListing): string {
  return listing.location || "Location: check listing";
}

function splitConcernText(value?: string): string[] {
  if (!value) return [];
  return value
    .split(/,\s+|;\s+|\.\s+/)
    .map((item) => item.trim().replace(/\.$/, ""))
    .filter(Boolean)
    .slice(0, 5);
}

export function App(props: { clerkPublishableKey: string }) {
  const searchParams = new URLSearchParams(window.location.search);
  const demoMode = import.meta.env.DEV || isLocalDemoHost() ? searchParams.get("demo") : null;
  if (searchParams.get("admin") === "1") {
    return <AdminConsole demo={false} />;
  }
  if (demoMode === "admin") {
    return <AdminConsole demo />;
  }
  if (demoMode === "settings") {
    return (
      <main className="shell is-deck">
        <SettingsSheet
          automationStatus={demoAutomationStatus()}
          error={null}
          isPending={false}
          onClose={() => undefined}
          onDelete={() => undefined}
          onExport={() => undefined}
          onOpenPricing={() => undefined}
          onSubmit={() => undefined}
          user={demoSettingsUser()}
        />
      </main>
    );
  }
  if (demoMode === "run") {
    return <RunDetailDemo />;
  }
  if (demoMode === "invite") {
    return <InviteGate email="friend@example.com" error={null} isPending={false} onSubmit={() => undefined} />;
  }
  if (demoMode === "onboarding") {
    return (
      <OnboardingGate
        automationStatus={demoAutomationStatus()}
        email="friend@example.com"
        error={null}
        isPending={false}
        managedResearchEntitled={false}
        onOpenPricing={() => undefined}
        onSubmit={() => undefined}
      />
    );
  }
  return <AuthenticatedApp clerkPublishableKey={props.clerkPublishableKey} />;
}

function isLocalDemoHost(): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function demoSettingsUser(): UserPayload {
  return {
    id: "email:friend@example.com",
    email: "friend@example.com",
    displayName: "Friend",
    status: "active",
    profile: {
      userId: "email:friend@example.com",
      displayName: "Friend",
      niche: "Beach cars and runabouts",
      budgetMax: 30000,
      stretchBudget: 2000,
      homeRegion: "Northeast",
      timezone: "America/New_York",
      scheduleCron: "0 8 * * *",
      profile: {
        tasteNotes:
          "Casual beach-town use, charm over perfection, and low-drama ownership. Selected tastes: convertibles, door-off 4x4s, targas, and sunroof cars; mechanically simple cars with easy parts and light electronics; usable rear seats, seat belts, and relaxed family errand potential.",
        avoidNotes:
          "Anything that needs a major rescue before it can be enjoyed. Selected avoids: structural rust, coastal corrosion, and vague underside photos; salvage, rebuilt, bonded, or title-story cars; non-running projects, unknown mechanicals, or missing major parts.",
        tasteNotesFreeform: "Casual beach-town use, charm over perfection, and low-drama ownership.",
        avoidNotesFreeform: "Anything that needs a major rescue before it can be enjoyed.",
        tasteCalibration: defaultTasteCalibration,
        avoidCalibration: defaultAvoidCalibration,
        notifications: {
          channel: "email",
          runDigest: true,
          strongFitAlerts: true,
          digestTime: "08:00",
        },
      },
      onboardingCompletedAt: "2026-06-25T12:00:00.000Z",
      updatedAt: "2026-06-25T12:00:00.000Z",
    },
    sourceSettings: [
      {
        source: "bringatrailer",
        enabled: true,
        settings: { maxDistanceMiles: 750, noReserveOnly: false, searchNotes: "VW Thing, Samurai, Tracker" },
        updatedAt: "2026-06-25T12:00:00.000Z",
      },
      {
        source: "carsandbids",
        enabled: true,
        settings: { maxDistanceMiles: 750, browserRunner: true },
        updatedAt: "2026-06-25T12:00:00.000Z",
      },
      {
        source: "marketplace",
        enabled: false,
        settings: { maxDistanceMiles: 150, browserRunner: true },
        updatedAt: "2026-06-25T12:00:00.000Z",
      },
    ],
    researchSettings: { mode: "external_agent", updatedAt: "2026-06-25T12:00:00.000Z" },
    managedResearchEntitlement: {
      feature: "managed_research",
      active: false,
      source: "clerk_session",
      planSlug: null,
      updatedAt: "2026-06-25T12:00:00.000Z",
    },
    aiSettings: {
      mode: "managed",
      dailyBudgetCents: 250,
      monthlyBudgetCents: 2500,
      gatewayKeyRef: null,
      status: "active",
      updatedAt: "2026-06-25T12:00:00.000Z",
    },
    onboarding: { completed: true, completedAt: "2026-06-25T12:00:00.000Z" },
    capabilities: { canConnectAgent: true, canUseManagedAi: false, canUseByok: false, canRunNow: false },
  };
}

function demoAutomationStatus(): AutomationStatus {
  const now = "2026-06-25T12:00:00.000Z";
  return {
    mcpEndpoint: "https://beachcar-watch.example.workers.dev/mcp",
    bundleEndpoint: "https://beachcar-watch.example.workers.dev/api/automation/bundle",
    protectedResourceMetadataEndpoint: "https://beachcar-watch.example.workers.dev/.well-known/oauth-protected-resource/mcp",
    oauth: {
      status: "authorization_code_ready",
      protectedResourceMetadataEndpoint: "https://beachcar-watch.example.workers.dev/.well-known/oauth-protected-resource/mcp",
      authorizationServerMetadataEndpoint: "https://beachcar-watch.example.workers.dev/.well-known/oauth-authorization-server",
      authorizationEndpoint: "https://beachcar-watch.example.workers.dev/oauth/authorize",
      tokenEndpoint: "https://beachcar-watch.example.workers.dev/oauth/token",
      registrationEndpoint: "https://beachcar-watch.example.workers.dev/oauth/register",
      message: "OAuth protected-resource discovery and authorization-code + PKCE endpoints are available; scoped automation tokens remain available for preview clients.",
    },
    defaultScopes: ["setup:read", "sources:read", "runs:publish", "usage:write", "events:read"],
    oauthAccessTokens: [
      {
        id: "oauth-token-demo",
        userId: "email:friend@example.com",
        clientId: "beachcar-oauth-client-demo",
        clientName: "Codex cloud agent",
        resource: "https://beachcar-watch.example.workers.dev/mcp",
        scopes: ["setup:read", "sources:read", "runs:publish", "usage:write", "events:read"],
        lastUsedAt: now,
        expiresAt: "2027-06-25T13:00:00.000Z",
        createdAt: now,
      },
    ],
    tokens: [
      {
        id: "automation-token-demo",
        userId: "email:friend@example.com",
        label: "Friend cloud agent",
        scopes: ["setup:read", "sources:read", "runs:publish", "usage:write", "events:read"],
        lastUsedAt: now,
        createdAt: now,
      },
    ],
    recentEvents: [
      {
        id: "automation-event-demo",
        userId: "email:friend@example.com",
        tokenId: "automation-token-demo",
        actor: "automation",
        eventType: "tool.search_bat_cache",
        metadata: { source: "bringatrailer", candidateCount: 12 },
        createdAt: now,
      },
    ],
  };
}

function RunDetailDemo() {
  const [open, setOpen] = useState(true);
  const user = demoSettingsUser();
  const run = demoRunPayload();
  const agentRun = demoAgentRunRecord();
  const sourceSummary = sourceSummaryView(run.sourceSummary);

  return (
    <main className="shell is-deck">
      <header className="app-header">
        <div className="brand-line">
          <strong>{appName}</strong>
          <span>{generatedTime(run)}</span>
        </div>
        <div className="header-actions">
          <button className="icon-toggle is-active" type="button">
            <span>Deck</span>
          </button>
          <button className="icon-toggle" type="button">
            <List size={17} aria-hidden="true" />
            <span>List</span>
          </button>
        </div>
      </header>
      <RunStatusStrip
        agentRun={agentRun}
        canQueueRun
        onConfigure={() => undefined}
        onOpen={() => setOpen(true)}
        onQueue={() => undefined}
        onUpgrade={() => undefined}
        pending={false}
        run={run}
        sourceSummary={sourceSummary}
        user={user}
      />
      <section className="empty-state">
        <Clock3 size={34} aria-hidden="true" />
        <h2>Run detail demo</h2>
        <p>{runStatusMeta(run, agentRun, sourceSummary)}</p>
        <button className="source-link" type="button" onClick={() => setOpen(true)}>
          Open run detail
        </button>
      </section>
      {open ? (
        <RunDetailSheet
          agentRun={agentRun}
          canQueueRun
          onClose={() => setOpen(false)}
          onConfigure={() => undefined}
          onQueue={() => undefined}
          onUpgrade={() => undefined}
          pending={false}
          run={run}
          sourceSummary={sourceSummary}
          user={user}
        />
      ) : null}
    </main>
  );
}

function demoRunPayload(): RunPayload {
  return {
    id: "run-from-agent-run-demo",
    generatedAt: "2026-06-25T13:45:00.000Z",
    reportMarkdown: "Demo source discovery report.",
    feedback: [],
    listings: [
      {
        listingKey: "demo-thing",
        section: "Strong fits",
        lane: "family",
        site: "Bring a Trailer",
        title: "1974 Volkswagen Thing",
        url: "https://bringatrailer.com/listing/1974-volkswagen-thing/",
        bid: "$8,295",
        total: "$8,710 incl. buyer fee estimate",
        location: "Northeast",
        timeLeft: "2 days",
        bids: 12,
        comments: 18,
        fair: "$7,500-$9,800 current comp screen",
        ceiling: "Keep total under $32,000 unless unusually clean.",
        conf: "source-score-43",
        why: "Found on Bring a Trailer via Volkswagen Thing; matched VW Thing, no reserve, inside current budget screen.",
        concerns: "Verify title, rust, underside, driving video, seating/restraint practicality, and final buyer-fee total.",
        currentTake: "source-discovery candidate from public source data",
        images: [],
        dossier: {
          summary: "Two-owner Thing wearing a fresh soft top, with recent brakes, tires, and a rebuilt carburetor. Sold on a clean title with service records.",
          specs: {
            odometer: "62,400 mi",
            engine: "1.6L flat-4",
            transmission: "4-speed manual",
            drivetrain: "RWD",
            exterior: "Texas Yellow",
            interior: "Black vinyl",
            title: "Clean · SC",
            seller: "lowcountry_air",
            lot: "BaT #88,412",
          },
          listing: [
            "This 1974 Volkswagen Thing is finished in Texas Yellow over a black interior and is powered by a 1.6-liter flat-four paired with a four-speed manual transaxle.",
            "Work under current ownership includes a new soft top, a front-end refresh, fresh brake hydraulics, and a carburetor rebuild. The doors are removable and the windshield folds.",
            "The car is offered with a clean title, a tool roll, and a binder of receipts. The seller notes minor surface rust on the floor pans and a small tear in the driver's seat.",
          ],
          equipment: ["New convertible soft top", "Removable doors, folding windshield", "15\" steel wheels with new tires", "Aftermarket lap belts, all seats"],
          service: ["2024 — new soft top", "2023 — front-end refresh", "2023 — brake hydraulics renewed", "2022 — carburetor rebuild"],
          bidLog: [
            { bidder: "dune_runner", amount: "$8,295", ago: "2h" },
            { bidder: "aircooled_sc", amount: "$8,000", ago: "6h" },
            { bidder: "Opening bid", amount: "$5,000", ago: "3d" },
          ],
          comments: [
            { user: "thing_fan", body: "Floors look honest in the extra photos. GLWTA.", ago: "3h" },
            { user: "lowcountry_air", body: "Top frame is complete and the new canvas fits well.", ago: "2h", seller: true },
          ],
          beachUse: { body: "Open 2WD", location: "Charleston, SC", people: "Confirm belts", paperwork: "Clean title" },
          valueScore: 0.18,
        },
      },
    ],
    sourceSummary: {
      publisher: "cloudflare-workflow-source-discovery",
      agentRunId: "agent-run-demo",
      workflowInstanceId: "workflow-agent-run-demo",
      source: "manual",
      reason: "demo",
      feedbackCount: 9,
      enabledSources: ["bringatrailer", "carsandbids"],
      checkedSources: [
        {
          source: "bringatrailer",
          site: "Bring a Trailer",
          status: "ok",
          label: "Volkswagen Thing",
          candidateCount: 1,
          message: "Parsed live keyword-page listing cards.",
        },
        {
          source: "bringatrailer",
          site: "Bring a Trailer",
          status: "ok",
          label: "Auctions RSS",
          candidateCount: 34,
          message: "Parsed public RSS items as a broad source sweep.",
        },
        {
          source: "carsandbids",
          site: "Cars & Bids",
          status: "blocked",
          candidateCount: 0,
          message: "Fetch reached a bot/access challenge; use a logged-in browser or container runner for this source.",
        },
      ],
      blockedSources: [
        {
          source: "carsandbids",
          site: "Cars & Bids",
          status: "blocked",
          candidateCount: 0,
          message: "Fetch reached a bot/access challenge; use a logged-in browser or container runner for this source.",
        },
      ],
      fallbackUsed: false,
      rawCandidateCount: 35,
      aiScoring: {
        status: "ok",
        provider: "cloudflare-ai-gateway",
        model: "openai/gpt-4.1-mini",
        totalTokens: 140,
        costMicros: 280,
        message: "AI rerank applied to source candidates.",
      },
      runnerTasks: [{ id: "runner-task-browser-source-carsandbids-demo", source: "carsandbids", kind: "browser_source", status: "queued" }],
    },
  };
}

function demoAgentRunRecord(): AgentRunRecord {
  return {
    id: "agent-run-demo",
    userId: "email:friend@example.com",
    workflowInstanceId: "workflow-agent-run-demo",
    status: "published",
    progress: {
      source: "manual",
      reason: "demo",
      requestedAt: "2026-06-25T13:43:00.000Z",
      handoff: "cloudflare_workflow",
      publishedRunId: "run-from-agent-run-demo",
      listingCount: 1,
      imageCount: 0,
      publishedAt: "2026-06-25T13:45:00.000Z",
    },
    error: null,
    startedAt: "2026-06-25T13:43:05.000Z",
    finishedAt: "2026-06-25T13:45:00.000Z",
    createdAt: "2026-06-25T13:43:00.000Z",
    updatedAt: "2026-06-25T13:45:00.000Z",
  };
}

function AuthenticatedApp(props: { clerkPublishableKey: string }) {
  const auth = useClerkBrowser(props.clerkPublishableKey);
  const [run, setRun] = useState<RunPayload | null>(null);
  const [user, setUser] = useState<UserPayload | null>(null);
  const [agentRun, setAgentRun] = useState<AgentRunRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ViewMode>("deck");
  const [filter, setFilter] = useState<ViewFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [runDetailOpen, setRunDetailOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [imageIndex, setImageIndex] = useState(0);
  const [feedbackByKey, setFeedbackByKey] = useState<Map<string, FeedbackRecord>>(new Map());
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [photoTouchStart, setPhotoTouchStart] = useState<{ x: number; y: number } | null>(null);
  const [accountActionPending, setAccountActionPending] = useState(false);
  const [runRequestPending, setRunRequestPending] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.isLoaded || !auth.isSignedIn || !auth.clerk) return;
    setLoading(true);
    setAuthTokenGetter(() => auth.clerk?.session?.getToken() || Promise.resolve(null));
    let cancelled = false;
    async function load() {
      try {
        const nextUser = await getMe();
        if (cancelled) return;
        setUser(nextUser);
        if (nextUser.status !== "active" || !nextUser.onboarding?.completed) {
          setRun(null);
          setAgentRun(null);
          setFeedbackByKey(new Map());
          setError(null);
          return;
        }
        const [nextRun, nextAgentRun] = await Promise.all([getLatestRun(nextUser.id), getLatestAgentRun().catch(() => null)]);
        if (cancelled) return;
        setRun(nextRun);
        setAgentRun(nextAgentRun);
        setFeedbackByKey(mergedFeedback(nextRun));
        setError(null);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load the latest run");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [auth.clerk, auth.isLoaded, auth.isSignedIn]);

  const loadRunForUser = useCallback(async (userId?: string) => {
    const nextRun = await getLatestRun(userId);
    setRun(nextRun);
    setFeedbackByKey(mergedFeedback(nextRun));
  }, []);

  async function submitInviteCode(code: string) {
    setAccountActionPending(true);
    try {
      const nextUser = await acceptInvite(code);
      setUser(nextUser);
      setError(null);
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "Could not accept invite");
    } finally {
      setAccountActionPending(false);
    }
  }

  async function startGoogleSignIn() {
    setSignInError(null);
    try {
      await signInWithGoogle(auth.clerk);
    } catch (signInFailure) {
      setSignInError(signInFailure instanceof Error ? signInFailure.message : "Could not start Google sign-in");
    }
  }

  async function completeProfile(input: {
    displayName?: string;
    niche: string;
    budgetMax?: number | null;
    stretchBudget?: number | null;
    homeRegion?: string | null;
    timezone: string;
    profile: Record<string, unknown>;
    researchMode: ResearchMode;
    sourceSettings?: SourceSettingsInput;
  }) {
    setAccountActionPending(true);
    try {
      const { researchMode, sourceSettings, ...profileInput } = input;
      let nextUser = await putProfile({ ...profileInput, completeOnboarding: true });
      if (sourceSettings) nextUser = await putSourceSettings({ sources: sourceSettings });
      nextUser = await putResearchSettings(researchMode);
      setUser(nextUser);
      await loadRunForUser(nextUser.id).catch(() => {
        setRun({ id: null, generatedAt: null, listings: [], feedback: [] });
        setFeedbackByKey(new Map());
      });
      setError(null);
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : "Could not save profile");
    } finally {
      setAccountActionPending(false);
    }
  }

  async function saveSettings(input: {
    displayName?: string;
    niche: string;
    budgetMax?: number | null;
    stretchBudget?: number | null;
    homeRegion?: string | null;
    timezone: string;
    profile: Record<string, unknown>;
    researchMode: ResearchMode;
    sourceSettings?: SourceSettingsInput;
  }) {
    setAccountActionPending(true);
    try {
      const { researchMode, sourceSettings, ...profileInput } = input;
      let nextUser = await putProfile({ ...profileInput, completeOnboarding: true });
      if (sourceSettings) nextUser = await putSourceSettings({ sources: sourceSettings });
      nextUser = await putResearchSettings(researchMode);
      setUser(nextUser);
      setSettingsOpen(false);
      setError(null);
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : "Could not save profile");
    } finally {
      setAccountActionPending(false);
    }
  }

  async function exportAccountData() {
    setAccountActionPending(true);
    try {
      const account = await exportAccount();
      downloadJson(account, `beachcar-account-${account.user.email}-${new Date().toISOString().slice(0, 10)}.json`);
      setError(null);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Could not export account");
    } finally {
      setAccountActionPending(false);
    }
  }

  async function deleteAccount(confirmEmail: string) {
    setAccountActionPending(true);
    try {
      await deleteAccountRequest(confirmEmail);
      setUser(
        user
          ? {
              ...user,
              status: "disabled",
              displayName: null,
              profile: null,
              sourceSettings: [],
              researchSettings: { mode: "external_agent", updatedAt: null },
              managedResearchEntitlement: {
                feature: "managed_research",
                active: false,
                source: "none",
                planSlug: null,
                expiresAt: null,
                updatedAt: null,
              },
              aiSettings: null,
              aiUsage: null,
              onboarding: { completed: false, completedAt: null },
              capabilities: { canConnectAgent: false, canUseManagedAi: false, canUseByok: false, canRunNow: false },
            }
          : null,
      );
      setRun(null);
      setAgentRun(null);
      setFeedbackByKey(new Map());
      setSettingsOpen(false);
      setError(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete account");
    } finally {
      setAccountActionPending(false);
    }
  }

  async function queueAgentRun() {
    setRunRequestPending(true);
    try {
      const nextAgentRun = await requestAgentRun("manual_web");
      setAgentRun(nextAgentRun);
      setError(null);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Could not queue run");
    } finally {
      setRunRequestPending(false);
    }
  }

  async function closePricing() {
    setPricingOpen(false);
    try {
      await auth.clerk?.session?.getToken({ skipCache: true });
      setUser(await getMe());
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Could not refresh subscription status");
    }
  }

  const visibleListings = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (run?.listings || []).filter((listing) => {
      const key = listingKey(listing);
      const feedback = feedbackByKey.get(key);
      if (!showHidden && isHiddenAction(feedback?.action)) return false;
      if (filter === "starred" && feedback?.action !== "star") return false;
      if (filter === "ending" && !isEndingSoon(listing)) return false;
      if (filter === "family" || filter === "solo" || filter === "curiosity") {
        if (listing.lane !== filter) return false;
      }
      if (normalizedQuery && !searchBlob(listing).includes(normalizedQuery)) return false;
      return true;
    });
  }, [feedbackByKey, filter, query, run?.listings, showHidden]);

  const selectedListing = visibleListings[selectedIndex] || visibleListings[0] || null;
  const selectedKey = selectedListing ? listingKey(selectedListing) : "";
  const selectedFeedback = selectedListing ? feedbackByKey.get(selectedKey) || null : null;
  const selectedImages = selectedListing?.images?.length ? selectedListing.images : [];
  const currentImage = selectedImages[imageIndex] || selectedImages[0] || "";

  useEffect(() => {
    const urls = new Set<string>();
    for (const url of selectedImages.slice(imageIndex + 1, imageIndex + 3)) {
      if (url) urls.add(url);
    }
    for (const listing of visibleListings.slice(selectedIndex + 1, selectedIndex + 3)) {
      if (listing.images[0]) urls.add(listing.images[0]);
    }
    for (const url of urls) {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
    }
  }, [imageIndex, selectedImages, selectedIndex, visibleListings]);

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(visibleListings.length - 1, 0)));
  }, [visibleListings.length]);

  useEffect(() => {
    setImageIndex(0);
  }, [selectedKey]);

  useEffect(() => {
    setImageIndex((current) => Math.min(current, Math.max(selectedImages.length - 1, 0)));
  }, [selectedImages.length]);

  const moveListing = useCallback(
    (direction: -1 | 1) => {
      if (!visibleListings.length) return;
      setSelectedIndex((current) => (current + direction + visibleListings.length) % visibleListings.length);
      setImageIndex(0);
      setMode("deck");
    },
    [visibleListings.length],
  );

  const moveImage = useCallback(
    (direction: -1 | 1) => {
      if (!selectedImages.length) return;
      setImageIndex((current) => (current + direction + selectedImages.length) % selectedImages.length);
    },
    [selectedImages.length],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "ArrowLeft") moveListing(-1);
      if (event.key === "ArrowRight") moveListing(1);
      if (event.key === "[") moveImage(-1);
      if (event.key === "]") moveImage(1);
      if (event.key.toLowerCase() === "f") setFilterOpen((current) => !current);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moveImage, moveListing]);

  async function mark(action: FeedbackAction) {
    if (!selectedListing) return;
    if (selectedFeedback?.action === action) {
      await clearMark();
      return;
    }

    const key = listingKey(selectedListing);
    setPendingAction(`${key}:${action}`);
    const previous = feedbackByKey.get(key);
    const optimistic: FeedbackRecord = {
      listingKey: key,
      action,
      tags: [selectedListing.lane, selectedListing.currentTake || selectedListing.section].filter(Boolean),
      updatedAt: new Date().toISOString(),
    };
    setFeedbackByKey((current) => new Map(current).set(key, optimistic));
    try {
      const saved = await putFeedback(key, action, { tags: optimistic.tags });
      setFeedbackByKey((current) => new Map(current).set(key, saved));
    } catch (markError) {
      setFeedbackByKey((current) => {
        const next = new Map(current);
        if (previous) next.set(key, previous);
        else next.delete(key);
        return next;
      });
      setError(markError instanceof Error ? markError.message : "Could not save feedback");
    } finally {
      setPendingAction(null);
    }
  }

  async function clearMark() {
    if (!selectedListing) return;
    const key = listingKey(selectedListing);
    const previous = feedbackByKey.get(key);
    setPendingAction(`${key}:clear`);
    setFeedbackByKey((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
    try {
      await clearFeedback(key);
    } catch (clearError) {
      setFeedbackByKey((current) => {
        const next = new Map(current);
        if (previous) next.set(key, previous);
        return next;
      });
      setError(clearError instanceof Error ? clearError.message : "Could not clear feedback");
    } finally {
      setPendingAction(null);
    }
  }

  function onPhotoTouchEnd(clientX: number, clientY: number) {
    if (photoTouchStart === null) return;
    const deltaX = clientX - photoTouchStart.x;
    const deltaY = clientY - photoTouchStart.y;
    setPhotoTouchStart(null);
    if (Math.abs(deltaX) < 42 || Math.abs(deltaX) < Math.abs(deltaY)) return;
    moveImage(deltaX < 0 ? 1 : -1);
  }

  const counts = useMemo(() => {
    const all = run?.listings.length || 0;
    const starred = [...feedbackByKey.values()].filter((feedback) => feedback.action === "star").length;
    const hidden = (run?.listings || []).filter((listing) => isHiddenAction(feedbackByKey.get(listingKey(listing))?.action)).length;
    const ending = (run?.listings || []).filter(isEndingSoon).length;
    return { all, visible: visibleListings.length, starred, hidden, ending };
  }, [feedbackByKey, run?.listings, visibleListings.length]);

  if (!auth.isLoaded || (auth.isSignedIn && loading)) {
    return (
      <main className="shell is-loading">
        <div className="loading-card">
          <Sparkles aria-hidden="true" />
          <p>Loading today&apos;s auction watch...</p>
        </div>
      </main>
    );
  }

  if (!auth.isSignedIn) {
    return (
      <main className="shell is-loading">
        <section className="auth-card">
          <p className="eyebrow">Private Auction Watch</p>
          <h1>{appName}</h1>
          <p>Sign in with Google to review today&apos;s shortlist and save your stars, skips, and avoid signals.</p>
          {auth.error || signInError ? <p className="auth-error">{auth.error || signInError}</p> : null}
          <button className="source-link" type="button" onClick={() => void startGoogleSignIn()}>
            Sign in with Google
          </button>
        </section>
      </main>
    );
  }

  if (user?.status === "disabled") {
    return <DisabledAccountGate email={user.email || auth.email || ""} clerk={auth.clerk} />;
  }

  if (user && user.status !== "active") {
    return (
      <InviteGate
        email={user.email || auth.email || ""}
        error={error}
        isPending={accountActionPending}
        onSubmit={(code) => void submitInviteCode(code)}
      />
    );
  }

  if (user && !user.onboarding?.completed) {
    return (
      <>
        <OnboardingGate
          email={user.email || auth.email || ""}
          error={error}
          isPending={accountActionPending}
          managedResearchEntitled={Boolean(user.managedResearchEntitlement?.active)}
          onOpenPricing={() => setPricingOpen(true)}
          onSubmit={(input) => void completeProfile(input)}
        />
        {pricingOpen ? <ClerkPricingSheet clerk={auth.clerk} onClose={() => void closePricing()} /> : null}
      </>
    );
  }

  if (!user) {
    return (
      <main className="shell is-loading">
        <div className="loading-card">
          <Sparkles aria-hidden="true" />
          <p>Loading today&apos;s auction watch...</p>
        </div>
      </main>
    );
  }

  const activeUser = user;
  const aiBudgetExceeded = Boolean(activeUser.aiUsage?.budgetExceeded);
  const canQueueRun = Boolean(activeUser.capabilities?.canRunNow) && !aiBudgetExceeded;
  const sourceSummary = sourceSummaryView(run?.sourceSummary);

  return (
    <main className={mode === "deck" ? "shell is-deck" : "shell is-list"}>
      <header className="app-header">
        <div className="brand-line">
          <strong>{appName}</strong>
          <span>{generatedTime(run)}</span>
        </div>
        <div className="header-actions">
          <button className={mode === "deck" ? "icon-toggle is-active" : "icon-toggle"} type="button" onClick={() => setMode("deck")}>
            <span>Deck</span>
          </button>
          <button className={mode === "list" ? "icon-toggle is-active" : "icon-toggle"} type="button" onClick={() => setMode("list")}>
            <List size={17} aria-hidden="true" />
            <span>List</span>
          </button>
          <button className="icon-button" type="button" onClick={() => setFilterOpen(true)} aria-label="Filters">
            <SlidersHorizontal size={19} aria-hidden="true" />
          </button>
          <button className="icon-toggle" type="button" onClick={() => setSettingsOpen(true)}>
            <ShieldCheck size={16} aria-hidden="true" />
            <span>Prefs</span>
          </button>
          <div className="private-button" title={activeUser.email || auth.email || "Signed in"}>
            <ShieldCheck size={16} aria-hidden="true" />
            <ClerkUserButton clerk={auth.clerk} />
          </div>
        </div>
      </header>

      <RunStatusStrip
        agentRun={agentRun}
        canQueueRun={canQueueRun}
        onConfigure={() => setSettingsOpen(true)}
        onOpen={() => setRunDetailOpen(true)}
        onQueue={() => void queueAgentRun()}
        onUpgrade={() => setPricingOpen(true)}
        pending={runRequestPending}
        run={run}
        sourceSummary={sourceSummary}
        user={activeUser}
      />

      {filterOpen ? (
        <FilterSheet
          counts={counts}
          filter={filter}
          query={query}
          setFilter={setFilter}
          setFilterOpen={setFilterOpen}
          setQuery={setQuery}
          setShowHidden={setShowHidden}
          showHidden={showHidden}
        />
      ) : null}

      {settingsOpen && user ? (
        <SettingsSheet
          error={error}
          isPending={accountActionPending}
          onClose={() => setSettingsOpen(false)}
          onDelete={(confirmEmail) => void deleteAccount(confirmEmail)}
          onExport={() => void exportAccountData()}
          onOpenPricing={() => setPricingOpen(true)}
          onSubmit={(input) => void saveSettings(input)}
          user={user}
        />
      ) : null}

      {pricingOpen ? <ClerkPricingSheet clerk={auth.clerk} onClose={() => void closePricing()} /> : null}

      {runDetailOpen ? (
        <RunDetailSheet
          agentRun={agentRun}
          canQueueRun={canQueueRun}
          onClose={() => setRunDetailOpen(false)}
          onConfigure={() => {
            setRunDetailOpen(false);
            setSettingsOpen(true);
          }}
          onQueue={() => void queueAgentRun()}
          onUpgrade={() => {
            setRunDetailOpen(false);
            setPricingOpen(true);
          }}
          pending={runRequestPending}
          run={run}
          sourceSummary={sourceSummary}
          user={activeUser}
        />
      ) : null}

      {error ? (
        <div className="notice" role="alert">
          {error}
        </div>
      ) : null}

      {selectedListing ? (
        mode === "deck" ? (
          <section className="deck-view" aria-label="Review listing">
            <article className="review-card">
              <div
                className="photo-stage"
                onTouchStart={(event) => {
                  const touch = event.changedTouches[0];
                  setPhotoTouchStart(touch ? { x: touch.clientX, y: touch.clientY } : null);
                }}
                onTouchEnd={(event) => {
                  const touch = event.changedTouches[0];
                  onPhotoTouchEnd(touch?.clientX ?? 0, touch?.clientY ?? 0);
                }}
              >
                {currentImage ? (
                  <img src={currentImage} alt={selectedListing.title} loading="eager" />
                ) : (
                  <div className="empty-photo">
                    <ImageOff size={30} aria-hidden="true" />
                    <span>No image yet</span>
                  </div>
                )}
                {selectedImages.length > 1 ? (
                  <>
                    <button className="image-button is-left" type="button" onClick={() => moveImage(-1)} aria-label="Previous photo">
                      <ChevronLeft aria-hidden="true" />
                    </button>
                    <button className="image-button is-right" type="button" onClick={() => moveImage(1)} aria-label="Next photo">
                      <ChevronRight aria-hidden="true" />
                    </button>
                  </>
                ) : null}
                <div className="photo-meta">
                  <span>Photo {selectedImages.length ? `${imageIndex + 1}/${selectedImages.length}` : "0/0"}</span>
                  <Dots count={selectedImages.length} active={imageIndex} />
                </div>
              </div>

              <div className="decision-strip">
                <span>{selectedIndex + 1} / {visibleListings.length}</span>
                <span className={`badge lane-${selectedListing.lane}`}>{laneLabels[selectedListing.lane]}</span>
                <span className={isEndingSoon(selectedListing) ? "time-chip is-urgent" : "time-chip"}>
                  {compactTime(selectedListing.timeLeft || selectedListing.ends)}
                </span>
                <strong>{shortText(selectedListing.total)}</strong>
              </div>

              <section className="listing-primer">
                <div className="title-row">
                  <div>
                    <h1>{selectedListing.title}</h1>
                    <p className="location-line">
                      <MapPin size={15} aria-hidden="true" />
                      <span>{locationText(selectedListing)}</span>
                    </p>
                    <p>{listingPrimerText(selectedListing)}</p>
                  </div>
                  {selectedFeedback ? <span className={`feedback-dot ${actionClasses[selectedFeedback.action]}`}>{actionLabels[selectedFeedback.action]}</span> : null}
                </div>

                <div className="valuation-row">
                  <Metric label="Current" value={selectedListing.bid} />
                  <Metric label="Fair" value={selectedListing.fair || "Needs comps"} />
                  <Metric label="Stop" value={selectedListing.ceiling || "Set later"} highlight />
                </div>

                <div className="mini-stats">
                  <span>
                    <Gavel size={15} aria-hidden="true" /> {normalizeCount(selectedListing.bids)} bids
                  </span>
                  <span>
                    <MessageCircle size={15} aria-hidden="true" /> {normalizeCount(selectedListing.comments)} comments
                  </span>
                  <span title={locationText(selectedListing)}>
                    <MapPin size={15} aria-hidden="true" /> {selectedListing.location || selectedListing.site}
                  </span>
                </div>
              </section>

              <section className="sticky-listing-strip">
                {selectedListing.images[0] ? (
                  <img src={imageVariantUrl(selectedListing.images[0], "thumb")} alt="" loading="lazy" />
                ) : (
                  <span className="mini-empty">No img</span>
                )}
                <div>
                  <strong>{selectedListing.title}</strong>
                  <small>
                    {selectedListing.total} · {compactTime(selectedListing.timeLeft || selectedListing.ends)} · {selectedListing.location || selectedListing.site}
                  </small>
                </div>
                <span>{selectedIndex + 1}/{visibleListings.length}</span>
              </section>

              <section className="details-sheet">
                <DiligenceSection title="Why it fits" body={selectedListing.why} tone="good" />
                <DiligenceList title="Concerns" items={splitConcernText(selectedListing.concerns)} tone="warn" />
                <section className="detail-section">
                  <p>Valuation</p>
                  <div className="valuation-row is-flat">
                    <Metric label="Current" value={selectedListing.bid} />
                    <Metric label="Fair" value={selectedListing.fair || "Needs comps"} />
                    <Metric label="Stop" value={selectedListing.ceiling || "Set later"} highlight />
                    <Metric label="Confidence" value={selectedListing.conf || "check"} />
                  </div>
                </section>
                <section className="detail-section">
                  <p>Auction stats</p>
                  <div className="stat-line">
                    <Stat icon={<BadgeDollarSign />} label="Total" value={selectedListing.total} />
                    <Stat icon={<Clock3 />} label="Ends" value={compactTime(selectedListing.timeLeft || selectedListing.ends)} />
                    <Stat icon={<MapPin />} label="Location" value={selectedListing.location || "check listing"} />
                  </div>
                </section>
                <DossierDetail dossier={selectedListing.dossier} />
              </section>
            </article>
          </section>
        ) : (
          <ListView
            counts={counts}
            feedbackByKey={feedbackByKey}
            listings={visibleListings}
            selectedIndex={selectedIndex}
            setFilterOpen={setFilterOpen}
            setMode={setMode}
            setSelectedIndex={setSelectedIndex}
          />
        )
      ) : (
        <section className="empty-state">
          <CircleSlash size={34} aria-hidden="true" />
          <h2>No listings match this view</h2>
          <p>Try clearing search, switching filters, or showing hidden listings.</p>
          <button className="source-link" type="button" onClick={() => setFilterOpen(true)}>
            Adjust filters
          </button>
        </section>
      )}

      {selectedListing ? (
        <ReviewRail
          feedback={selectedFeedback}
          listing={selectedListing}
          moveListing={moveListing}
          onMark={(action) => void mark(action)}
          pending={pendingAction !== null}
        />
      ) : null}
    </main>
  );
}

function RunStatusStrip(props: {
  agentRun: AgentRunRecord | null;
  canQueueRun: boolean;
  onConfigure: () => void;
  onOpen: () => void;
  onQueue: () => void;
  onUpgrade: () => void;
  pending: boolean;
  run: RunPayload | null;
  sourceSummary: SourceSummaryView;
  user: UserPayload;
}) {
  return (
    <section className="run-status-strip" aria-label="Run status">
      <button className="run-status-main" type="button" onClick={props.onOpen}>
        <Clock3 size={18} aria-hidden="true" />
        <span>
          <strong>{runStatusText(props.run, props.agentRun)}</strong>
          <small>{runStatusMeta(props.run, props.agentRun, props.sourceSummary)}</small>
        </span>
      </button>
      <button
        className="run-now-action"
        disabled={props.pending}
        type="button"
        onClick={() => {
          if (props.canQueueRun) props.onQueue();
          else if (props.user.researchSettings?.mode === "external_agent") props.onConfigure();
          else if (!props.user.managedResearchEntitlement?.active) props.onUpgrade();
          else props.onConfigure();
        }}
        title={runButtonTitle(props.user, props.agentRun, props.canQueueRun)}
      >
        <Sparkles size={16} aria-hidden="true" />
        <span>{props.pending ? "Queueing" : runActionLabel(props.user, props.agentRun, props.canQueueRun)}</span>
      </button>
    </section>
  );
}

function RunDetailSheet(props: {
  agentRun: AgentRunRecord | null;
  canQueueRun: boolean;
  onClose: () => void;
  onConfigure: () => void;
  onQueue: () => void;
  onUpgrade: () => void;
  pending: boolean;
  run: RunPayload | null;
  sourceSummary: SourceSummaryView;
  user: UserPayload;
}) {
  const summary = props.sourceSummary;
  const items = timelineItems(props.run, props.agentRun, summary);
  const sourceChecks = summary.checkedSources.length ? summary.checkedSources : summary.blockedSources;

  return (
    <div className="filter-overlay" role="dialog" aria-modal="true" aria-label="Run detail">
      <button className="filter-backdrop" type="button" onClick={props.onClose} aria-label="Close run detail" />
      <section
        className="filter-sheet run-detail-sheet"
        data-agent-run-id={props.agentRun?.id || ""}
        data-published-run-id={props.run?.id || ""}
        data-run-generated-at={props.run?.generatedAt || ""}
        data-workflow-instance-id={props.agentRun?.workflowInstanceId || summary.workflowInstanceId || ""}
      >
        <div className="sheet-grabber" />
        <div className="sheet-title">
          <strong>Run detail</strong>
          <button type="button" onClick={props.onClose}>
            Done
          </button>
        </div>

        <div className="run-detail-hero">
          <div>
            <p className="eyebrow">Latest status</p>
            <h2>{runStatusText(props.run, props.agentRun)}</h2>
            <span>{runStatusMeta(props.run, props.agentRun, summary)}</span>
          </div>
          <button
            className="run-now-action"
            disabled={props.pending}
            type="button"
            onClick={() => {
              if (props.canQueueRun) props.onQueue();
              else if (props.user.researchSettings?.mode === "external_agent") props.onConfigure();
              else if (!props.user.managedResearchEntitlement?.active) props.onUpgrade();
              else props.onConfigure();
            }}
            title={runButtonTitle(props.user, props.agentRun, props.canQueueRun)}
          >
            <Sparkles size={16} aria-hidden="true" />
            <span>{props.pending ? "Queueing" : runActionLabel(props.user, props.agentRun, props.canQueueRun)}</span>
          </button>
        </div>

        <div className="run-metric-grid">
          <Metric label="Listings" value={String(props.run?.listings.length || 0)} />
          <Metric label="Candidates" value={String(summary.rawCandidateCount || 0)} />
          <Metric label="Sources" value={String(summary.checkedSources.length)} />
          <Metric label="Feedback" value={String(summary.feedbackCount || 0)} />
        </div>

        <section className="run-timeline" aria-label="Run timeline">
          {items.map((item) => (
            <article className={`timeline-row ${timelineStatusClass(item.status)}`} key={item.label}>
              <span aria-hidden="true" />
              <div>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </div>
            </article>
          ))}
        </section>

        <section className="run-detail-section">
          <div className="setup-section-title">
            <span>Sources</span>
            <small>{summary.enabledSources.length ? summary.enabledSources.map(sourceDisplayLabel).join(", ") : "default"}</small>
          </div>
          <div className="source-check-list">
            {sourceChecks.slice(0, 12).map((check, index) => (
              <article key={`${check.source}:${check.label || check.url || index}`}>
                <span className={`source-status-dot ${sourceStatusClass(check.status)}`}>{check.status}</span>
                <div>
                  <strong>{check.label ? `${check.site} · ${check.label}` : check.site}</strong>
                  <small>{check.message || `${check.candidateCount} candidate(s)`}</small>
                  {sourceCheckDiagnosticText(check) ? <small className="source-diagnostic-line">{sourceCheckDiagnosticText(check)}</small> : null}
                </div>
                <em>{check.candidateCount}</em>
              </article>
            ))}
            {sourceChecks.length === 0 ? <p className="setup-muted">No source checks have been published for this run yet.</p> : null}
          </div>
        </section>

        <section className="run-detail-section">
          <div className="setup-section-title">
            <span>AI</span>
            <small>{summary.aiScoring?.status || props.user.aiSettings?.mode || "not configured"}</small>
          </div>
          <div className="run-ai-row">
            <span>
              <small>Mode</small>
              <strong>{props.user.aiSettings?.mode || "managed"}</strong>
            </span>
            <span>
              <small>Provider</small>
              <strong>{summary.aiScoring?.provider || "heuristic"}</strong>
            </span>
            <span>
              <small>Tokens</small>
              <strong>{summary.aiScoring?.totalTokens ?? 0}</strong>
            </span>
            <span>
              <small>Cost</small>
              <strong>{formatMicrosAsDollars(summary.aiScoring?.costMicros || 0)}</strong>
            </span>
          </div>
          {summary.aiScoring?.message ? <p className="setup-muted">{summary.aiScoring.message}</p> : null}
        </section>

        <section className="run-detail-section">
          <div className="setup-section-title">
            <span>Runner tasks</span>
            <small>{summary.runnerTasks.length}</small>
          </div>
          <div className="runner-task-list">
            {summary.runnerTasks.map((task) => (
              <article key={task.id}>
                <span className={`source-status-dot ${sourceStatusClass(task.status)}`}>{task.status}</span>
                <div>
                  <strong>{sourceDisplayLabel(task.source)}</strong>
                  <small>{runnerTaskDetailText(task)}</small>
                  {runnerTaskDiagnosticText(task) ? <small className="source-diagnostic-line">{runnerTaskDiagnosticText(task)}</small> : null}
                </div>
              </article>
            ))}
            {summary.runnerTasks.length === 0 ? <p className="setup-muted">No browser or container runner tasks were needed.</p> : null}
          </div>
        </section>

        <section className="run-detail-section">
          <div className="setup-section-title">
            <span>Run ids</span>
            <small>{props.agentRun?.status || "idle"}</small>
          </div>
          <div className="run-id-list">
            <span>
              <small>Agent</small>
              <strong>{shortId(props.agentRun?.id)}</strong>
            </span>
            <span>
              <small>Workflow</small>
              <strong>{shortId(props.agentRun?.workflowInstanceId || summary.workflowInstanceId)}</strong>
            </span>
            <span>
              <small>Published</small>
              <strong>{shortId(props.run?.id)}</strong>
            </span>
          </div>
        </section>
      </section>
    </div>
  );
}

function sourceCheckDiagnosticText(check: SourceCheckView): string {
  const parts: string[] = [];
  if (check.selectorHits) {
    parts.push(`Selectors: ${numberMapText(check.selectorHits, 3)}`);
  }
  if (check.detailAttempts) {
    const detail = check.detailAttempts;
    const tail = [
      detail.blocked ? `${detail.blocked} blocked` : "",
      detail.failed ? `${detail.failed} failed` : "",
      detail.empty ? `${detail.empty} empty` : "",
    ].filter(Boolean);
    parts.push(`Detail: ${detail.enriched}/${detail.attempted} enriched${tail.length ? `, ${tail.join(", ")}` : ""}`);
  }
  if (check.cache) {
    const tail = [
      check.cache.usableCount !== undefined ? `${check.cache.usableCount} usable` : "",
      check.cache.latestIngestionAt ? `latest ${shortDateTime(check.cache.latestIngestionAt)}` : "",
      check.cache.refreshError ? "refresh failed" : "",
    ].filter(Boolean);
    parts.push(`Cache: ${[check.cache.status, ...tail].filter(Boolean).join(", ")}`);
  }
  if (check.blockedUrls?.length) {
    parts.push(`${check.blockedUrls.length} blocked URL${check.blockedUrls.length === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

function runnerTaskDetailText(task: RunnerTaskSummaryView): string {
  const imported = task.importedCount !== undefined ? ` · ${task.importedCount} imported` : "";
  const rejected = task.rejectedCount ? ` · ${task.rejectedCount} rejected` : "";
  const merge = task.mergeStatus ? ` · ${task.mergeStatus}` : "";
  return `${task.kind} · ${shortId(task.id)}${merge}${imported}${rejected}`;
}

function runnerTaskDiagnosticText(task: RunnerTaskSummaryView): string {
  const parts: string[] = [];
  if (task.normalizedCandidateCount !== undefined) parts.push(`${task.normalizedCandidateCount} normalized`);
  if (task.rejectionReasons?.length) {
    parts.push(`Rejects: ${task.rejectionReasons.map((item) => `${item.reason} ${item.count}`).join(", ")}`);
  }
  return parts.join(" · ");
}

function numberMapText(value: Record<string, number>, limit: number): string {
  return Object.entries(value)
    .slice(0, limit)
    .map(([key, count]) => `${key} ${count}`)
    .join(", ");
}

function FilterSheet(props: {
  counts: { all: number; visible: number; starred: number; hidden: number; ending: number };
  filter: ViewFilter;
  query: string;
  showHidden: boolean;
  setFilter: (filter: ViewFilter) => void;
  setFilterOpen: (open: boolean) => void;
  setQuery: (query: string) => void;
  setShowHidden: (show: boolean) => void;
}) {
  return (
    <div className="filter-overlay">
      <button className="filter-backdrop" type="button" onClick={() => props.setFilterOpen(false)} aria-label="Close filters" />
      <section className="filter-sheet" aria-label="Filters">
        <div className="sheet-grabber" />
        <div className="sheet-title">
          <strong>Filters</strong>
          <button type="button" onClick={() => props.setFilterOpen(false)}>
            Done
          </button>
        </div>
        <label className="search-box">
          <Search size={18} aria-hidden="true" />
          <input value={props.query} onChange={(event) => props.setQuery(event.target.value)} placeholder="Thing, Vespa, rust, cheap..." />
        </label>
        <div className="filter-grid">
          <FilterChip active={props.filter === "all"} onClick={() => props.setFilter("all")} label={`All ${props.counts.all}`} />
          <FilterChip active={props.filter === "family"} onClick={() => props.setFilter("family")} label="Family" />
          <FilterChip active={props.filter === "solo"} onClick={() => props.setFilter("solo")} label="Solo" />
          <FilterChip active={props.filter === "curiosity"} onClick={() => props.setFilter("curiosity")} label="Curiosity" />
          <FilterChip active={props.filter === "ending"} onClick={() => props.setFilter("ending")} label={`Ending ${props.counts.ending}`} />
          <FilterChip active={props.filter === "starred"} onClick={() => props.setFilter("starred")} label={`Starred ${props.counts.starred}`} />
        </div>
        <label className="toggle">
          <input checked={props.showHidden} onChange={(event) => props.setShowHidden(event.target.checked)} type="checkbox" />
          <span>Show hidden and avoid-similar</span>
          <small>{props.counts.hidden}</small>
        </label>
      </section>
    </div>
  );
}

function SettingsSheet(props: {
  automationStatus?: AutomationStatus;
  error: string | null;
  isPending: boolean;
  onClose: () => void;
  onDelete: (confirmEmail: string) => void;
  onExport: () => void;
  onOpenPricing: () => void;
  onSubmit: (input: {
    displayName?: string;
    niche: string;
    budgetMax?: number | null;
    stretchBudget?: number | null;
    homeRegion?: string | null;
    timezone: string;
    profile: Record<string, unknown>;
    researchMode: ResearchMode;
    sourceSettings?: SourceSettingsInput;
  }) => void;
  user: UserPayload;
}) {
  const profile = props.user.profile;
  const profileData = profile?.profile || {};
  const [displayName, setDisplayName] = useState(profile?.displayName || props.user.displayName || "");
  const [budgetMax, setBudgetMax] = useState(profile?.budgetMax?.toString() || "30000");
  const [stretchBudget, setStretchBudget] = useState(profile?.stretchBudget?.toString() || "2000");
  const [homeRegion, setHomeRegion] = useState(profile?.homeRegion || "Northeast");
  const [tasteNotes, setTasteNotes] = useState(
    stringProfileValue(profileData, "tasteNotesFreeform", stringProfileValue(profileData, "tasteNotes", "Open-air, charming, beach-town practical.")),
  );
  const [avoidNotes, setAvoidNotes] = useState(
    stringProfileValue(profileData, "avoidNotesFreeform", stringProfileValue(profileData, "avoidNotes", "Major rust, salvage titles, huge lifts, fragile projects.")),
  );
  const [tasteCalibration, setTasteCalibration] = useState(() =>
    initialCalibrationSelection(profileData, "tasteCalibration", [], tasteCalibrationOptions),
  );
  const [avoidCalibration, setAvoidCalibration] = useState(() =>
    initialCalibrationSelection(profileData, "avoidCalibration", [], avoidCalibrationOptions),
  );
  const [researchMode, setResearchMode] = useState<ResearchMode>(props.user.researchSettings?.mode || "external_agent");
  const [localError, setLocalError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState(() => initialNotificationSettings(profileData));
  const [sourcePreferences, setSourcePreferences] = useState(() => initialSourcePreferences(props.user.sourceSettings, profileData));
  const [deleteConfirm, setDeleteConfirm] = useState("");

  return (
    <div className="filter-overlay" role="dialog" aria-modal="true" aria-label="Preferences">
      <button className="filter-backdrop" type="button" onClick={props.onClose} aria-label="Close preferences" />
      <section className="filter-sheet settings-sheet">
        <div className="sheet-grabber" />
        <div className="sheet-title">
          <strong>Preferences</strong>
          <button type="button" onClick={props.onClose}>
            Done
          </button>
        </div>
        <p className="setup-muted">{props.user.email}</p>
        <form
          className="setup-form setup-grid"
          onSubmit={(event) => {
            event.preventDefault();
            if (researchMode === "managed" && !props.user.managedResearchEntitlement?.active) {
              setLocalError("Subscribe to Managed Research before enabling Beachcar-run curation.");
              return;
            }
            setLocalError(null);
            props.onSubmit({
              displayName,
              niche: profile?.niche || "Beach cars and runabouts",
              budgetMax: numberFromInput(budgetMax),
              stretchBudget: numberFromInput(stretchBudget),
              homeRegion,
              timezone: profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
              profile: {
                ...profileData,
                tasteNotes: calibrationNotes(tasteNotes, tasteCalibration, tasteCalibrationOptions, "Selected tastes"),
                avoidNotes: calibrationNotes(avoidNotes, avoidCalibration, avoidCalibrationOptions, "Selected avoids"),
                tasteNotesFreeform: tasteNotes.trim(),
                avoidNotesFreeform: avoidNotes.trim(),
                tasteCalibration: [...tasteCalibration],
                avoidCalibration: [...avoidCalibration],
                lanes: Array.isArray(profileData.lanes) ? profileData.lanes : ["family", "solo", "curiosity"],
                sources: profileSourceList(sourcePreferences),
                sourcePreferences: sourceSettingsInput(sourcePreferences),
                notifications: notificationSettingsInput(notifications),
              },
              researchMode,
              sourceSettings: sourceSettingsInput(sourcePreferences),
            });
          }}
        >
          <label>
            <span>Name</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Optional" />
          </label>
          <label>
            <span>Region</span>
            <input value={homeRegion} onChange={(event) => setHomeRegion(event.target.value)} />
          </label>
          <label>
            <span>Budget ceiling</span>
            <input inputMode="numeric" value={budgetMax} onChange={(event) => setBudgetMax(event.target.value)} />
          </label>
          <label>
            <span>Stretch room</span>
            <input inputMode="numeric" value={stretchBudget} onChange={(event) => setStretchBudget(event.target.value)} />
          </label>
          <TasteCalibrationFields
            selectedAvoid={avoidCalibration}
            selectedTaste={tasteCalibration}
            setSelectedAvoid={setAvoidCalibration}
            setSelectedTaste={setTasteCalibration}
          />
          <label className="setup-span">
            <span>Extra priorities</span>
            <textarea value={tasteNotes} onChange={(event) => setTasteNotes(event.target.value)} />
          </label>
          <label className="setup-span">
            <span>Extra avoids</span>
            <textarea value={avoidNotes} onChange={(event) => setAvoidNotes(event.target.value)} />
          </label>
          <ResearchServiceFields
            managedResearchEntitled={Boolean(props.user.managedResearchEntitlement?.active)}
            mode={researchMode}
            onOpenPricing={props.onOpenPricing}
            setMode={(mode) => {
              setResearchMode(mode);
              if (localError) setLocalError(null);
            }}
          />
          <NotificationSettingsFields value={notifications} onChange={setNotifications} />
          <SourceSettingsFields preferences={sourcePreferences} setPreferences={setSourcePreferences} />
          <AutomationSettingsPanel demoStatus={props.automationStatus} />
          {localError || props.error ? <p className="auth-error setup-span">{localError || props.error}</p> : null}
          <button className="source-link setup-span" disabled={props.isPending} type="submit">
            {props.isPending ? "Saving..." : "Save preferences"}
          </button>
        </form>
        <section className="account-tools" aria-label="Account data">
          <div className="setup-section-title">
            <span>Account</span>
            <small>{props.user.status}</small>
          </div>
          <div className="account-tool-row">
            <button disabled={props.isPending} type="button" onClick={props.onExport}>
              <Download size={16} aria-hidden="true" />
              <span>Export data</span>
            </button>
          </div>
          <label>
            <span>Confirm email</span>
            <input autoComplete="off" value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} />
          </label>
          <button
            className="danger-action"
            disabled={props.isPending || deleteConfirm.trim().toLowerCase() !== props.user.email.toLowerCase()}
            type="button"
            onClick={() => props.onDelete(deleteConfirm)}
          >
            <Trash2 size={16} aria-hidden="true" />
            <span>Delete account</span>
          </button>
        </section>
      </section>
    </div>
  );
}

function AutomationSettingsPanel(props: { demoStatus?: AutomationStatus }) {
  const [status, setStatus] = useState<AutomationStatus | null>(props.demoStatus || null);
  const [created, setCreated] = useState<AutomationTokenCreateResult | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (props.demoStatus) {
      setStatus(props.demoStatus);
      setMessage(null);
      return;
    }
    setPending("refresh");
    try {
      setStatus(await getAutomationStatus());
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load automation status");
    } finally {
      setPending(null);
    }
  }, [props.demoStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function createToken() {
    if (props.demoStatus) {
      const createdAt = new Date().toISOString();
      const record: AutomationTokenRecord = {
        id: `automation-token-demo-${createdAt.replace(/[^0-9a-z]/gi, "-").toLowerCase()}`,
        userId: "email:friend@example.com",
        label: "Friend cloud agent",
        scopes: props.demoStatus.defaultScopes,
        createdAt,
      };
      setCreated({ token: "beachcar_demo_token_shown_once", record });
      setStatus({ ...props.demoStatus, tokens: [record, ...props.demoStatus.tokens] });
      setMessage("Token created. Store it in your cloud agent now; Beachcar will not show it again.");
      return;
    }
    setPending("create");
    try {
      const token = await createAutomationToken("Friend cloud agent");
      setCreated(token);
      setStatus(await getAutomationStatus());
      setMessage("Token created. Store it in your cloud agent now; Beachcar will not show it again.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create automation token");
    } finally {
      setPending(null);
    }
  }

  async function revokeToken(id: string) {
    if (props.demoStatus) {
      const revokedAt = new Date().toISOString();
      setStatus((current) =>
        current
          ? {
              ...current,
              tokens: current.tokens.map((token) => (token.id === id ? { ...token, revokedAt } : token)),
            }
          : current,
      );
      if (created?.record.id === id) setCreated(null);
      setMessage("Automation token revoked.");
      return;
    }
    setPending(id);
    try {
      await revokeAutomationToken(id);
      setStatus(await getAutomationStatus());
      if (created?.record.id === id) setCreated(null);
      setMessage("Automation token revoked.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not revoke automation token");
    } finally {
      setPending(null);
    }
  }

  async function revokeOAuthToken(id: string) {
    if (props.demoStatus) {
      const revokedAt = new Date().toISOString();
      setStatus((current) =>
        current
          ? {
              ...current,
              oauthAccessTokens: current.oauthAccessTokens.map((token) => (token.id === id ? { ...token, revokedAt } : token)),
            }
          : current,
      );
      setMessage("OAuth connection revoked.");
      return;
    }
    setPending(id);
    try {
      await revokeOAuthConnection(id);
      setStatus(await getAutomationStatus());
      setMessage("OAuth connection revoked.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not revoke OAuth connection");
    } finally {
      setPending(null);
    }
  }

  async function copyToken() {
    if (!created?.token) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setMessage("Token copied.");
    } catch {
      setMessage("Copy failed. Select the token text and copy it manually.");
    }
  }

  async function downloadSkill() {
    if (props.demoStatus) {
      setMessage("The hosted Worker provides the downloadable skill after sign-in.");
      return;
    }
    setPending("bundle");
    try {
      const bundle = await getAutomationBundle();
      downloadText(bundle.markdown, bundle.filename, bundle.contentType);
      setMessage("Skill downloaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not download skill");
    } finally {
      setPending(null);
    }
  }

  const activeTokens = (status?.tokens || []).filter((token) => !token.revokedAt);
  const revokedTokens = (status?.tokens || []).filter((token) => token.revokedAt);
  const oauthTokens = status?.oauthAccessTokens || [];
  const activeOAuthTokens = oauthTokens.filter(isOAuthConnectionActive);
  const inactiveOAuthTokens = oauthTokens.filter((token) => !isOAuthConnectionActive(token));
  const activeConnectionCount = activeTokens.length + activeOAuthTokens.length;

  return (
    <section className="automation-settings" aria-label="External agent connection">
      <div className="setup-section-title">
        <span>External agent connection</span>
        <small>{activeConnectionCount ? `${activeConnectionCount} active` : "none active"}</small>
      </div>
      <p className="automation-note">
        For technical users who want their own MCP-capable agent to research and publish runs. This is not needed for Beachcar's managed service.
      </p>
      <div className="automation-endpoint">
        <Bot size={18} aria-hidden="true" />
        <span>{status?.mcpEndpoint || "Loading MCP endpoint..."}</span>
      </div>
      <div className="automation-endpoint">
        <ShieldCheck size={18} aria-hidden="true" />
        <span>{status?.protectedResourceMetadataEndpoint || status?.oauth.protectedResourceMetadataEndpoint || "Loading OAuth resource metadata..."}</span>
      </div>
      {status?.oauth.authorizationServerMetadataEndpoint ? (
        <div className="automation-endpoint">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>{status.oauth.authorizationServerMetadataEndpoint}</span>
        </div>
      ) : null}
      <div className="automation-actions">
        <button disabled={pending !== null} type="button" onClick={createToken}>
          <KeyRound size={16} aria-hidden="true" />
          <span>{pending === "create" ? "Creating..." : "Create token"}</span>
        </button>
        <button disabled={pending !== null} type="button" onClick={downloadSkill}>
          <Download size={16} aria-hidden="true" />
          <span>{pending === "bundle" ? "Preparing..." : "Download skill"}</span>
        </button>
        <button disabled={pending !== null} type="button" onClick={() => void refresh()}>
          <RefreshCw size={16} aria-hidden="true" />
          <span>Refresh</span>
        </button>
      </div>
      {created ? (
        <div className="automation-token-reveal">
          <div>
            <strong>New token</strong>
            <small>Shown once</small>
          </div>
          <textarea readOnly value={created.token} />
          <button type="button" onClick={copyToken}>
            <Copy size={16} aria-hidden="true" />
            <span>Copy token</span>
          </button>
        </div>
      ) : null}
      {status?.oauth ? <p className="automation-note">{status.oauth.message}</p> : null}
      {oauthTokens.length ? (
        <div className="automation-token-list" aria-label="OAuth connections">
          <div className="automation-list-heading">
            <strong>OAuth connections</strong>
            <small>{activeOAuthTokens.length ? `${activeOAuthTokens.length} active` : "none active"}</small>
          </div>
          {[...activeOAuthTokens, ...inactiveOAuthTokens].slice(0, 5).map((token) => (
            <article key={token.id}>
              <span>
                <strong>{oauthConnectionName(token)}</strong>
                <small>{oauthConnectionDetail(token)}</small>
              </span>
              {token.revokedAt ? (
                <em>revoked</em>
              ) : isOAuthConnectionExpired(token) ? (
                <em>expired</em>
              ) : (
                <button disabled={pending !== null} type="button" onClick={() => void revokeOAuthToken(token.id)}>
                  Revoke
                </button>
              )}
            </article>
          ))}
        </div>
      ) : null}
      <div className="automation-token-list">
        <div className="automation-list-heading">
          <strong>Fallback tokens</strong>
          <small>{activeTokens.length ? `${activeTokens.length} active` : "none active"}</small>
        </div>
        {[...activeTokens, ...revokedTokens].slice(0, 5).map((token) => (
          <article key={token.id}>
            <span>
              <strong>{token.label}</strong>
              <small>{token.lastUsedAt ? `Used ${shortDateTime(token.lastUsedAt)}` : `Created ${shortDateTime(token.createdAt)}`}</small>
            </span>
            {token.revokedAt ? (
              <em>revoked</em>
            ) : (
              <button disabled={pending !== null} type="button" onClick={() => void revokeToken(token.id)}>
                Revoke
              </button>
            )}
          </article>
        ))}
      </div>
      {status?.recentEvents.length ? (
        <div className="automation-events">
          {status.recentEvents.slice(0, 4).map((event) => (
            <span key={event.id}>
              <strong>{event.eventType}</strong>
              <small>{shortDateTime(event.createdAt)}</small>
            </span>
          ))}
        </div>
      ) : null}
      {message ? <p className="automation-note">{message}</p> : null}
    </section>
  );
}

function ListView(props: {
  counts: { all: number; visible: number; ending: number; hidden: number };
  feedbackByKey: Map<string, FeedbackRecord>;
  listings: AuctionListing[];
  selectedIndex: number;
  setFilterOpen: (open: boolean) => void;
  setMode: (mode: ViewMode) => void;
  setSelectedIndex: (index: number) => void;
}) {
  return (
    <section className="scan-view" aria-label="Scan listings">
      <div className="scan-toolbar">
        <button type="button" onClick={() => props.setFilterOpen(true)}>
          Today {props.counts.visible} picks
        </button>
        <button type="button" onClick={() => props.setFilterOpen(true)}>
          Ending soon {props.counts.ending}
        </button>
        {props.counts.hidden ? (
          <button type="button" onClick={() => props.setFilterOpen(true)}>
            Hidden {props.counts.hidden}
          </button>
        ) : null}
      </div>
      <div className="listing-list">
        {props.listings.map((listing, index) => {
          const key = listingKey(listing);
          const feedback = props.feedbackByKey.get(key);
          const pressure = budgetPressure(listing);
          return (
            <button
              className={index === props.selectedIndex ? "scan-row is-active" : "scan-row"}
              key={key}
              type="button"
              onClick={() => {
                props.setSelectedIndex(index);
                props.setMode("deck");
              }}
            >
              {listing.images[0] ? <img src={imageVariantUrl(listing.images[0], "thumb")} alt="" loading="lazy" /> : <span className="mini-empty">No img</span>}
              <span className="scan-copy">
                <span>
                  <strong>{listing.title}</strong>
                  <i className={`badge lane-${listing.lane}`}>{laneLabels[listing.lane]}</i>
                </span>
                <small>
                  <MapPin size={13} aria-hidden="true" /> {listing.location || "Location check"}
                </small>
                <small>{listingScanMeta(listing)}</small>
                <em>{listing.fair || "Fair value check"}</em>
              </span>
              <span className="scan-price">
                <strong>{listing.total}</strong>
                <small className={isEndingSoon(listing) ? "is-urgent" : ""}>{compactTime(listing.timeLeft || listing.ends)}</small>
                {hasKnownCount(listing.bids) || hasKnownCount(listing.bidders) || hasKnownCount(listing.comments) ? (
                  <span className="scan-activity" aria-label="Auction activity">
                    {hasKnownCount(listing.bids) ? (
                      <span>
                        <Gavel size={13} aria-hidden="true" /> {normalizeCount(listing.bids)}
                      </span>
                    ) : null}
                    {hasKnownCount(listing.bidders) ? (
                      <span>
                        <Users size={13} aria-hidden="true" /> {normalizeCount(listing.bidders)}
                      </span>
                    ) : null}
                    {hasKnownCount(listing.comments) ? (
                      <span>
                        <MessageCircle size={13} aria-hidden="true" /> {normalizeCount(listing.comments)}
                      </span>
                    ) : null}
                  </span>
                ) : null}
                {pressure ? (
                  <span className={`budget-chip ${pressure.className}`}>
                    <BadgeDollarSign size={13} aria-hidden="true" /> {pressure.label}
                  </span>
                ) : null}
                <Star className={feedback?.action === "star" ? "is-lit" : ""} size={21} aria-hidden="true" />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ReviewRail(props: {
  feedback: FeedbackRecord | null;
  listing: AuctionListing;
  pending: boolean;
  moveListing: (direction: -1 | 1) => void;
  onMark: (action: FeedbackAction) => void;
}) {
  return (
    <nav className="review-rail" aria-label="Review actions">
      <button type="button" onClick={() => props.moveListing(-1)} aria-label="Previous listing">
        <ChevronLeft aria-hidden="true" />
      </button>
      <button
        className={props.feedback?.action === "avoid" ? "rail-action is-selected is-avoid-action" : "rail-action"}
        disabled={props.pending}
        type="button"
        onClick={() => props.onMark("avoid")}
      >
        <CircleSlash size={20} aria-hidden="true" />
        <span>Avoid</span>
      </button>
      <button
        className={props.feedback?.action === "hide" ? "rail-action is-selected" : "rail-action"}
        disabled={props.pending}
        type="button"
        onClick={() => props.onMark("hide")}
      >
        <X size={20} aria-hidden="true" />
        <span>Hide</span>
      </button>
      <button
        className={props.feedback?.action === "star" ? "rail-action is-selected is-star-action" : "rail-action"}
        disabled={props.pending}
        type="button"
        onClick={() => props.onMark("star")}
      >
        <Star size={20} aria-hidden="true" />
        <span>Star</span>
      </button>
      <a className="rail-action open-action" href={props.listing.url} target="_blank" rel="noreferrer">
        <ExternalLink size={20} aria-hidden="true" />
        <span>Open</span>
      </a>
      <button type="button" onClick={() => props.moveListing(1)} aria-label="Next listing">
        <ChevronRight aria-hidden="true" />
      </button>
    </nav>
  );
}

function InviteGate(props: { email: string; error: string | null; isPending: boolean; onSubmit: (code: string) => void }) {
  const [code, setCode] = useState("");
  return (
    <main className="shell is-loading">
      <section className="setup-card">
        <p className="eyebrow">Invite required</p>
        <h1>{appName}</h1>
        <p className="setup-muted">{props.email}</p>
        <form
          className="setup-form"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmit(code);
          }}
        >
          <label>
            <span>Invite code</span>
            <input autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} />
          </label>
          {props.error ? <p className="auth-error">{props.error}</p> : null}
          <button className="source-link" disabled={props.isPending || !code.trim()} type="submit">
            {props.isPending ? "Checking..." : "Accept invite"}
          </button>
        </form>
      </section>
    </main>
  );
}

function DisabledAccountGate(props: { email: string; clerk: BrowserClerk | null }) {
  return (
    <main className="shell is-loading">
      <section className="setup-card">
        <p className="eyebrow">Account disabled</p>
        <h1>{appName}</h1>
        <p className="setup-muted">{props.email}</p>
        <button className="source-link" type="button" onClick={() => void props.clerk?.signOut({ redirectUrl: "/" })}>
          Sign out
        </button>
      </section>
    </main>
  );
}

function OnboardingGate(props: {
  automationStatus?: AutomationStatus;
  email: string;
  error: string | null;
  isPending: boolean;
  managedResearchEntitled: boolean;
  onOpenPricing: () => void;
  onSubmit: (input: {
    displayName?: string;
    niche: string;
    budgetMax?: number | null;
    stretchBudget?: number | null;
    homeRegion?: string | null;
    timezone: string;
    profile: Record<string, unknown>;
    researchMode: ResearchMode;
    sourceSettings?: SourceSettingsInput;
  }) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [budgetMax, setBudgetMax] = useState("30000");
  const [stretchBudget, setStretchBudget] = useState("2000");
  const [homeRegion, setHomeRegion] = useState("Northeast");
  const [tasteNotes, setTasteNotes] = useState("Casual beach-town use, charm over perfection, and low-drama ownership.");
  const [avoidNotes, setAvoidNotes] = useState("Anything that needs a major rescue before it can be enjoyed.");
  const [tasteCalibration, setTasteCalibration] = useState(() => [...defaultTasteCalibration]);
  const [avoidCalibration, setAvoidCalibration] = useState(() => [...defaultAvoidCalibration]);
  const [researchMode, setResearchMode] = useState<ResearchMode>(props.managedResearchEntitled ? "managed" : "external_agent");
  const [localError, setLocalError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState(() => initialNotificationSettings({}));
  const [sourcePreferences, setSourcePreferences] = useState(() => initialSourcePreferences([], {}));

  return (
    <main className="shell is-loading">
      <section className="setup-card is-wide">
        <p className="eyebrow">Bring your own agent</p>
        <h1>Give your agent great taste.</h1>
        <p className="setup-muted">
          Beachcar is the private memory and presentation layer for your car hunt. Connect Codex, Claude, or another agent through MCP; it researches
          the market, learns from your decisions, and publishes a shortlist for {props.email}.
        </p>
        <form
          className="setup-form setup-grid"
          onSubmit={(event) => {
            event.preventDefault();
            if (researchMode === "managed" && !props.managedResearchEntitled) {
              setLocalError("Subscribe to Managed Research before enabling Beachcar-run curation.");
              return;
            }
            setLocalError(null);
            props.onSubmit({
              displayName,
              niche: "Beach cars and runabouts",
              budgetMax: numberFromInput(budgetMax),
              stretchBudget: numberFromInput(stretchBudget),
              homeRegion,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
              profile: {
                tasteNotes: calibrationNotes(tasteNotes, tasteCalibration, tasteCalibrationOptions, "Selected tastes"),
                avoidNotes: calibrationNotes(avoidNotes, avoidCalibration, avoidCalibrationOptions, "Selected avoids"),
                tasteNotesFreeform: tasteNotes.trim(),
                avoidNotesFreeform: avoidNotes.trim(),
                tasteCalibration: [...tasteCalibration],
                avoidCalibration: [...avoidCalibration],
                lanes: ["family", "solo", "curiosity"],
                sources: profileSourceList(sourcePreferences),
                sourcePreferences: sourceSettingsInput(sourcePreferences),
                notifications: notificationSettingsInput(notifications),
              },
              researchMode,
              sourceSettings: sourceSettingsInput(sourcePreferences),
            });
          }}
        >
          <label>
            <span>Name</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Optional" />
          </label>
          <label>
            <span>Region</span>
            <input value={homeRegion} onChange={(event) => setHomeRegion(event.target.value)} />
          </label>
          <label>
            <span>Budget ceiling</span>
            <input inputMode="numeric" value={budgetMax} onChange={(event) => setBudgetMax(event.target.value)} />
          </label>
          <label>
            <span>Stretch room</span>
            <input inputMode="numeric" value={stretchBudget} onChange={(event) => setStretchBudget(event.target.value)} />
          </label>
          <ResearchServiceFields
            managedResearchEntitled={props.managedResearchEntitled}
            mode={researchMode}
            onOpenPricing={props.onOpenPricing}
            setMode={(mode) => {
              setResearchMode(mode);
              if (localError) setLocalError(null);
            }}
          />
          <TasteCalibrationFields
            selectedAvoid={avoidCalibration}
            selectedTaste={tasteCalibration}
            setSelectedAvoid={setAvoidCalibration}
            setSelectedTaste={setTasteCalibration}
          />
          <label className="setup-span">
            <span>Extra priorities</span>
            <textarea value={tasteNotes} onChange={(event) => setTasteNotes(event.target.value)} />
          </label>
          <label className="setup-span">
            <span>Extra avoids</span>
            <textarea value={avoidNotes} onChange={(event) => setAvoidNotes(event.target.value)} />
          </label>
          <NotificationSettingsFields value={notifications} onChange={setNotifications} />
          <SourceSettingsFields preferences={sourcePreferences} setPreferences={setSourcePreferences} />
          {researchMode === "external_agent" ? <AutomationSettingsPanel demoStatus={props.automationStatus} /> : null}
          {localError || props.error ? <p className="auth-error setup-span">{localError || props.error}</p> : null}
          <button className="source-link setup-span" disabled={props.isPending} type="submit">
            {props.isPending ? "Saving..." : "Save preferences"}
          </button>
        </form>
      </section>
    </main>
  );
}

function TasteCalibrationFields(props: {
  selectedTaste: string[];
  selectedAvoid: string[];
  setSelectedTaste: (selected: string[]) => void;
  setSelectedAvoid: (selected: string[]) => void;
}) {
  const selectedCount = props.selectedTaste.length + props.selectedAvoid.length;
  return (
    <section className="taste-calibration setup-span" aria-label="Taste calibration">
      <div className="setup-section-title">
        <span>Taste calibration</span>
        <small>{selectedCount ? `${selectedCount} selected` : "custom only"}</small>
      </div>
      <CalibrationOptionGrid
        title="Show more"
        options={tasteCalibrationOptions}
        selected={props.selectedTaste}
        onChange={props.setSelectedTaste}
      />
      <CalibrationOptionGrid
        title="Avoid"
        options={avoidCalibrationOptions}
        selected={props.selectedAvoid}
        onChange={props.setSelectedAvoid}
      />
    </section>
  );
}

function CalibrationOptionGrid(props: {
  title: string;
  options: CalibrationOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  const selected = new Set(props.selected);
  return (
    <div className="calibration-group">
      <strong>{props.title}</strong>
      <div className="calibration-grid">
        {props.options.map((option) => (
          <label className={selected.has(option.id) ? "calibration-option is-selected" : "calibration-option"} key={option.id}>
            <input
              checked={selected.has(option.id)}
              onChange={() => props.onChange(toggleCalibrationOption(props.selected, option.id))}
              type="checkbox"
            />
            <span>
              <b>{option.label}</b>
              <small>{option.note}</small>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function ResearchServiceFields(props: {
  mode: ResearchMode;
  managedResearchEntitled: boolean;
  onOpenPricing: () => void;
  setMode: (mode: ResearchMode) => void;
}) {
  const isExternal = props.mode === "external_agent";
  const managedAccessLabel = props.managedResearchEntitled
    ? managedResearchCheckoutEnabled
      ? "Your plan"
      : "Pilot access"
    : managedResearchCheckoutEnabled
      ? `$${managedResearchPrice}/month`
      : "Invite-only pilot";
  return (
    <section className="research-service setup-span">
      <div className="setup-section-title">
        <span>Who runs the research?</span>
        <small>{isExternal ? "Your agent · included" : "Beachcar · managed"}</small>
      </div>
      <div className="research-mode-grid" role="radiogroup" aria-label="Research service">
        <button
          aria-checked={isExternal}
          className={isExternal ? "research-mode-card is-selected" : "research-mode-card"}
          onClick={() => props.setMode("external_agent")}
          role="radio"
          type="button"
        >
          <span className="research-mode-icon" aria-hidden="true">
            <Bot size={20} />
          </span>
          <span>
            <span className="research-mode-heading">
              <strong>Connect your own agent</strong>
              <em>Default</em>
            </span>
            <small>Use Codex, Claude, or any MCP client. Your agent searches, reasons, and publishes; Beachcar remembers your taste and presents the results.</small>
          </span>
          <span className="research-mode-price">Included</span>
        </button>
        <button
          aria-checked={!isExternal}
          className={!isExternal ? "research-mode-card is-selected is-managed" : "research-mode-card is-managed"}
          onClick={() => {
            if (props.managedResearchEntitled) props.setMode("managed");
            else props.onOpenPricing();
          }}
          role="radio"
          type="button"
        >
          <span className="research-mode-icon" aria-hidden="true">
            <Sparkles size={20} />
          </span>
          <span>
            <span className="research-mode-heading">
              <strong>Beachcar Managed Research</strong>
              {props.managedResearchEntitled ? <em>Active</em> : null}
            </span>
            <small>Beachcar runs the daily research workflow for you with hosted AI, source monitoring, cost controls, and automatic publishing.</small>
          </span>
          <span className="research-mode-price">{managedAccessLabel}</span>
        </button>
      </div>
      <p className="managed-service-note">
        {isExternal
          ? "Beachcar never charges for agent-connected curation. Create an OAuth connection or one-time token below, then point your agent at the MCP endpoint."
          : managedResearchCheckoutEnabled
            ? "Managed Research uses Beachcar's AI Gateway budget. Cancel any time while keeping your profile, feedback, and saved finds."
            : "Managed Research is free during the private pilot. Access is limited so we can learn from real usage and keep a close eye on quality and cost."}
      </p>
    </section>
  );
}

function NotificationSettingsFields(props: {
  value: NotificationSettingsState;
  onChange: (value: NotificationSettingsState) => void;
}) {
  function update(patch: Partial<NotificationSettingsState>) {
    props.onChange({ ...props.value, ...patch });
  }

  return (
    <section className="notification-settings setup-span">
      <div className="setup-section-title">
        <span>Notifications</span>
        <small>{props.value.channel === "email" ? "Email" : "Muted"}</small>
      </div>
      <div className="segmented-control" aria-label="Notification channel">
        <button
          aria-pressed={props.value.channel === "email"}
          className={props.value.channel === "email" ? "is-active" : ""}
          type="button"
          onClick={() => update({ channel: "email" })}
        >
          Email
        </button>
        <button
          aria-pressed={props.value.channel === "none"}
          className={props.value.channel === "none" ? "is-active" : ""}
          type="button"
          onClick={() => update({ channel: "none" })}
        >
          None
        </button>
      </div>
      <div className="source-toggle-list is-compact">
        <label>
          <input checked={props.value.runDigest} onChange={(event) => update({ runDigest: event.target.checked })} type="checkbox" />
          <span>Daily run digest</span>
        </label>
        <label>
          <input checked={props.value.strongFitAlerts} onChange={(event) => update({ strongFitAlerts: event.target.checked })} type="checkbox" />
          <span>Strong-fit alerts</span>
        </label>
      </div>
      {props.value.channel === "email" ? (
        <label>
          <span>Digest time</span>
          <input type="time" value={props.value.digestTime} onChange={(event) => update({ digestTime: event.target.value })} />
        </label>
      ) : null}
    </section>
  );
}

function SourceSettingsFields(props: {
  preferences: SourcePreferenceState[];
  setPreferences: (preferences: SourcePreferenceState[]) => void;
}) {
  function update(source: string, patch: Partial<SourcePreferenceState>) {
    props.setPreferences(
      sourceOptions.map((option) => {
        const current = props.preferences.find((preference) => preference.source === option.source) || defaultSourcePreference(option);
        return current.source === source ? { ...current, ...patch } : current;
      }),
    );
  }

  const activeCount = props.preferences.filter((preference) => preference.enabled).length;

  return (
    <section className="source-settings setup-span">
      <div className="setup-section-title">
        <span>Sources</span>
        <small>{activeCount} active</small>
      </div>
      <div className="source-config-list">
        {sourceOptions.map((option) => {
          const preference = props.preferences.find((item) => item.source === option.source) || defaultSourcePreference(option);
          return (
            <article className={preference.enabled ? "source-config-card is-enabled" : "source-config-card"} key={option.source}>
              <label className="source-config-toggle">
                <input checked={preference.enabled} onChange={(event) => update(option.source, { enabled: event.target.checked })} type="checkbox" />
                <span>{option.label}</span>
              </label>
              {preference.enabled ? (
                <div className="source-detail-grid">
                  <label>
                    <span>Max miles</span>
                    <input
                      inputMode="numeric"
                      value={preference.maxDistanceMiles}
                      onChange={(event) => update(option.source, { maxDistanceMiles: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Source cap</span>
                    <input
                      inputMode="decimal"
                      placeholder="optional"
                      value={preference.maxBudget}
                      onChange={(event) => update(option.source, { maxBudget: event.target.value })}
                    />
                  </label>
                  {option.supportsNoReserve ? (
                    <label className="source-check">
                      <input checked={preference.noReserveOnly} onChange={(event) => update(option.source, { noReserveOnly: event.target.checked })} type="checkbox" />
                      <span>No-reserve only</span>
                    </label>
                  ) : null}
                  {option.supportsBrowserRunner ? (
                    <label className="source-check">
                      <input checked={preference.browserRunner} onChange={(event) => update(option.source, { browserRunner: event.target.checked })} type="checkbox" />
                      <span>Browser runner</span>
                    </label>
                  ) : null}
                  <label className="source-notes">
                    <span>Search notes</span>
                    <textarea
                      placeholder={option.searchPlaceholder}
                      value={preference.searchNotes}
                      onChange={(event) => update(option.source, { searchNotes: event.target.value })}
                    />
                  </label>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function AdminConsole(props: { demo: boolean }) {
  const [publishToken, setPublishToken] = useState("");
  const [email, setEmail] = useState("friend@example.com");
  const [users, setUsers] = useState<AdminUserSummary[]>(
    props.demo
      ? [
          {
            id: "email:owner@example.com",
            email: "owner@example.com",
            status: "active",
            onboardingCompletedAt: "2026-06-25T12:00:00.000Z",
            latestRunAt: "2026-06-25T13:00:00.000Z",
            aiUsage: demoAiUsage(184000, 482000),
            createdAt: "2026-06-24T12:00:00.000Z",
            lastSeenAt: "2026-06-25T13:10:00.000Z",
          },
          {
            id: "email:friend@example.com",
            email: "friend@example.com",
            status: "invited",
            onboardingCompletedAt: null,
            latestRunAt: null,
            aiUsage: demoAiUsage(0, 0),
            createdAt: "2026-06-25T13:20:00.000Z",
            lastSeenAt: "2026-06-25T13:20:00.000Z",
          },
        ]
      : [],
  );
  const [invite, setInvite] = useState<InvitePayload | null>(
    props.demo
      ? {
          id: "invite-demo",
          email: "friend@example.com",
          code: "demo-invite-code",
          createdAt: "2026-06-25T13:20:00.000Z",
          expiresAt: null,
        }
      : null,
  );
  const [sourceCache, setSourceCache] = useState<SourceCacheAdminStatus | null>(props.demo ? demoSourceCacheStatus() : null);
  const [opsSummary, setOpsSummary] = useState<AdminOpsSummary | null>(props.demo ? demoAdminOpsSummary() : null);
  const [productSummary, setProductSummary] = useState<ProductEventSummary | null>(props.demo ? demoProductEventSummary() : null);
  const [status, setStatus] = useState<string | null>(props.demo ? "Demo data shown. Use /?admin=1 locally for live admin calls." : null);
  const [pending, setPending] = useState(false);

  async function refreshUsers(token = publishToken) {
    if (props.demo) return;
    if (!token.trim()) {
      setStatus("Enter the publish token first.");
      return;
    }
    setPending(true);
    try {
      const [nextUsers, nextOps, nextProductSummary] = await Promise.all([
        listAdminUsers(token.trim()),
        getAdminOpsSummary(token.trim()),
        getAdminProductEventSummary(token.trim()),
      ]);
      setUsers(nextUsers);
      setOpsSummary(nextOps);
      setProductSummary(nextProductSummary);
      setStatus("Users refreshed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load users");
    } finally {
      setPending(false);
    }
  }

  async function refreshOpsSummary(token = publishToken) {
    if (props.demo) return;
    if (!token.trim()) {
      setStatus("Enter the publish token first.");
      return;
    }
    setPending(true);
    try {
      setOpsSummary(await getAdminOpsSummary(token.trim()));
      setStatus("Ops summary refreshed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load ops summary");
    } finally {
      setPending(false);
    }
  }

  async function refreshProductSummary(token = publishToken) {
    if (props.demo) return;
    if (!token.trim()) {
      setStatus("Enter the publish token first.");
      return;
    }
    setPending(true);
    try {
      setProductSummary(await getAdminProductEventSummary(token.trim()));
      setStatus("Beta interaction summary refreshed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load beta interaction summary");
    } finally {
      setPending(false);
    }
  }

  async function createInvite() {
    if (props.demo) return;
    if (!publishToken.trim() || !email.trim()) {
      setStatus("Enter a publish token and email.");
      return;
    }
    setPending(true);
    try {
      const nextInvite = await createAdminInvite(publishToken.trim(), email.trim());
      setInvite(nextInvite);
      setStatus("Invite created. Share the code with the friend.");
      await refreshUsers(publishToken.trim());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not create invite");
    } finally {
      setPending(false);
    }
  }

  async function refreshSourceCache(token = publishToken) {
    if (props.demo) return;
    if (!token.trim()) {
      setStatus("Enter the publish token first.");
      return;
    }
    setPending(true);
    try {
      setSourceCache(await getAdminSourceCacheStatus(token.trim()));
      setStatus("Source cache refreshed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load source cache");
    } finally {
      setPending(false);
    }
  }

  async function ingestSourceCache() {
    if (props.demo) return;
    if (!publishToken.trim()) {
      setStatus("Enter the publish token first.");
      return;
    }
    setPending(true);
    try {
      const result = await ingestAdminSourceCache(publishToken.trim());
      setStatus(`BaT cache refreshed: ${result.ingestion.itemCount} items, ${result.ingestion.newItemCount} new.`);
      await refreshSourceCache(publishToken.trim());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not refresh source cache");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="shell admin-shell">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Friend access</h1>
        </div>
        <span>{users.length} users</span>
      </header>

      <section className="admin-panel">
        <div className="admin-grid">
          <label>
            <span>Publish token</span>
            <input
              disabled={props.demo}
              type="password"
              value={publishToken}
              onChange={(event) => setPublishToken(event.target.value)}
              placeholder={props.demo ? "Not needed in demo" : "Stored only in this browser tab"}
            />
          </label>
          <label>
            <span>Friend email</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
        </div>
        <div className="admin-actions">
          <button disabled={pending || props.demo} type="button" onClick={() => void createInvite()}>
            Create invite
          </button>
          <button disabled={pending || props.demo} type="button" onClick={() => void refreshUsers()}>
            Refresh users
          </button>
        </div>
        {status ? <p className="admin-status">{status}</p> : null}
        {invite ? (
          <div className="invite-result">
            <span>Invite code</span>
            <strong>{invite.code}</strong>
            <small>{invite.email}</small>
          </div>
        ) : null}
      </section>

      <section className="admin-panel beta-calibration-panel">
        <div className="setup-section-title">
          <span>Beta interaction calibration</span>
          <small>{productSummary ? `${productSummary.windowDays} days · updated ${shortDateTime(productSummary.generatedAt)}` : "not loaded"}</small>
        </div>
        <p className="admin-status">
          Aggregated product diagnostics only. Auction titles, URLs, photos, preference notes, coordinates, and touch paths are never collected.
        </p>
        <div className="source-cache-metrics">
          <Metric label="Events" value={productSummary ? String(productSummary.total) : "not loaded"} />
          <Metric label="Testers" value={productSummary ? String(productSummary.users) : "not loaded"} />
          <Metric label="Sessions" value={productSummary ? String(productSummary.sessions) : "not loaded"} />
          <Metric label="Cohorts" value={productSummary ? String(new Set(productSummary.aggregates.map((entry) => entry.tuningPreset)).size) : "not loaded"} />
        </div>
        <div className="beta-cohort-table" aria-label="Gesture outcomes by tuning preset">
          {productSummary?.reviewOutcomes.map((review) => {
            const gallery = productSummary.galleryOutcomes.find((entry) => entry.tuningPreset === review.tuningPreset);
            const commitRate = review.total > 0 ? Math.round((review.committed / review.total) * 100) : 0;
            const firstAttemptRate = gallery && gallery.gesture > 0 ? Math.round((gallery.firstAttemptGesture / gallery.gesture) * 100) : null;
            return (
              <article key={review.tuningPreset}>
                <div>
                  <strong>{review.tuningPreset}</strong>
                  <small>{review.total} review drags</small>
                </div>
                <Metric label="Committed" value={`${commitRate}%`} />
                <Metric label="Cancelled" value={String(review.cancelled)} />
                <Metric label="Gallery first try" value={firstAttemptRate === null ? "no data" : `${firstAttemptRate}%`} />
                <Metric label="Gallery exits" value={gallery ? `${gallery.gesture} gesture / ${gallery.control} control` : "no data"} />
              </article>
            );
          })}
          {productSummary && productSummary.reviewOutcomes.length === 0 ? <p className="setup-muted">No consented review sessions yet.</p> : null}
          {!productSummary ? <p className="setup-muted">Load the summary to compare Balanced, Quick, and Deliberate cohorts.</p> : null}
        </div>
        <div className="admin-actions">
          <button disabled={pending || props.demo} type="button" onClick={() => void refreshProductSummary()}>
            <RefreshCw size={16} aria-hidden="true" />
            <span>Refresh calibration</span>
          </button>
        </div>
      </section>

      <section className="admin-panel">
        <div className="setup-section-title">
          <span>Ops summary</span>
          <small>{opsSummary ? `updated ${shortDateTime(opsSummary.generatedAt)}` : "not loaded"}</small>
        </div>
        <div className="admin-ops-grid">
          <Metric label="Users" value={opsSummary ? `${opsSummary.users.active}/${opsSummary.users.total} active` : "not loaded"} />
          <Metric label="Onboarded" value={opsSummary ? `${opsSummary.users.onboarded}` : "not loaded"} />
          <Metric label="Runs" value={opsSummary ? `${opsSummary.runs.total}` : "not loaded"} />
          <Metric label="Latest run" value={opsSummary?.runs.latestGeneratedAt ? shortDateTime(opsSummary.runs.latestGeneratedAt) : "none"} />
          <Metric label="Agent runs" value={opsSummary ? `${opsSummary.agentRuns.running} running` : "not loaded"} />
          <Metric label="Runner backlog" value={opsSummary ? `${opsSummary.runnerTasks.queued} queued` : "not loaded"} />
          <Metric
            label="Images"
            value={opsSummary ? `${opsSummary.images.originals.total} originals / ${opsSummary.images.variants.total} variants` : "not loaded"}
          />
          <Metric
            label="Image bytes"
            value={opsSummary ? formatBytes(opsSummary.images.originals.bytes + opsSummary.images.variants.bytes) : "not loaded"}
          />
          <Metric label="AI today" value={opsSummary ? formatMicrosAsDollars(opsSummary.aiUsage.dailySpendMicros) : "not loaded"} />
          <Metric label="AI month" value={opsSummary ? formatMicrosAsDollars(opsSummary.aiUsage.monthlySpendMicros) : "not loaded"} />
          <Metric label="BaT cached" value={opsSummary ? String(opsSummary.sourceCache.sources.bringatrailer.itemCount) : "not loaded"} />
          <Metric label="BaT status" value={opsSummary?.sourceCache.sources.bringatrailer.latestIngestion?.status || "not loaded"} />
        </div>
        <div className="admin-actions">
          <button disabled={pending || props.demo} type="button" onClick={() => void refreshOpsSummary()}>
            <RefreshCw size={16} aria-hidden="true" />
            <span>Refresh ops</span>
          </button>
        </div>
      </section>

      <section className="admin-panel">
        <div className="setup-section-title">
          <span>Source cache</span>
          <small>{sourceCacheFreshness(sourceCache)}</small>
        </div>
        <div className="source-cache-grid">
          <article className="source-cache-card">
            <div>
              <strong>Bring a Trailer RSS</strong>
              <small>{sourceCache?.sources.bringatrailer.latestIngestion?.sourceUrl || "https://bringatrailer.com/auctions/feed/"}</small>
            </div>
            <span className={`admin-status-pill is-${sourceCache?.sources.bringatrailer.latestIngestion?.status || "invited"}`}>
              {sourceCache?.sources.bringatrailer.latestIngestion?.status || "not loaded"}
            </span>
          </article>
          <div className="source-cache-metrics">
            <Metric label="Cached" value={String(sourceCache?.sources.bringatrailer.itemCount ?? 0)} />
            <Metric label="Last items" value={String(sourceCache?.sources.bringatrailer.latestIngestion?.itemCount ?? 0)} />
            <Metric label="New" value={String(sourceCache?.sources.bringatrailer.latestIngestion?.newItemCount ?? 0)} />
            <Metric label="Last run" value={shortSourceCacheTime(sourceCache?.sources.bringatrailer.latestIngestion?.finishedAt)} />
          </div>
          {sourceCache?.sources.bringatrailer.latestIngestion?.error ? (
            <p className="admin-status is-error">{sourceCache.sources.bringatrailer.latestIngestion.error}</p>
          ) : null}
        </div>
        <div className="admin-actions">
          <button disabled={pending || props.demo} type="button" onClick={() => void refreshSourceCache()}>
            <RefreshCw size={16} aria-hidden="true" />
            <span>Refresh status</span>
          </button>
          <button disabled={pending || props.demo} type="button" onClick={() => void ingestSourceCache()}>
            <Search size={16} aria-hidden="true" />
            <span>Ingest BaT RSS</span>
          </button>
        </div>
      </section>

      <section className="admin-panel">
        <div className="admin-table">
          {users.map((user) => (
            <article key={user.id}>
              <div>
                <strong>{user.email}</strong>
                <small>{user.id}</small>
              </div>
              <span className={`admin-status-pill is-${user.status}`}>{user.status}</span>
              <span>{user.onboardingCompletedAt ? "Onboarded" : "Needs setup"}</span>
              <span>
                {formatMicrosAsDollars(user.aiUsage?.daily.spendMicros || 0)} / {formatMicrosAsDollars(user.aiUsage?.monthly.spendMicros || 0)}
              </span>
              <span>{user.latestRunAt ? new Date(user.latestRunAt).toLocaleString() : "No run"}</span>
            </article>
          ))}
          {users.length === 0 ? <p className="setup-muted">No users loaded yet.</p> : null}
        </div>
      </section>
    </main>
  );
}

function demoSourceCacheStatus(): SourceCacheAdminStatus {
  return {
    sources: {
      bringatrailer: {
        source: "bringatrailer",
        itemCount: 20,
        latestIngestion: {
          id: "source-ingestion-demo",
          source: "bringatrailer",
          sourceUrl: "https://bringatrailer.com/auctions/feed/",
          status: "ok",
          itemCount: 20,
          newItemCount: 3,
          error: null,
          startedAt: "2026-06-25T12:00:00.000Z",
          finishedAt: "2026-06-25T12:00:01.000Z",
        },
      },
    },
  };
}

function demoAdminOpsSummary(): AdminOpsSummary {
  return {
    generatedAt: "2026-06-25T13:30:00.000Z",
    users: { total: 2, active: 1, invited: 1, disabled: 0, onboarded: 1 },
    runs: { total: 4, latestGeneratedAt: "2026-06-25T13:00:00.000Z" },
    agentRuns: { total: 5, queued: 0, running: 0, published: 4, failed: 1, cancelled: 0 },
    runnerTasks: {
      total: 2,
      queued: 1,
      running: 0,
      completed: 1,
      failed: 0,
      cancelled: 0,
      oldestQueuedAt: "2026-06-25T13:05:00.000Z",
      latestFinishedAt: "2026-06-25T12:45:00.000Z",
    },
    images: {
      originals: { total: 24, pending: 0, copied: 22, failed: 2, bytes: 8_700_000 },
      variants: { total: 36, pending: 0, created: 34, failed: 2, bytes: 5_100_000 },
    },
    aiUsage: { dailySpendMicros: 184000, monthlySpendMicros: 482000, dailyEvents: 7, monthlyEvents: 19 },
    sourceCache: demoSourceCacheStatus(),
  };
}

function demoProductEventSummary(): ProductEventSummary {
  return {
    generatedAt: "2026-07-13T11:00:00.000Z",
    windowDays: 30,
    total: 186,
    users: 5,
    sessions: 17,
    aggregates: [
      { eventName: "review_drag_ended", tuningPreset: "balanced", count: 62 },
      { eventName: "review_drag_ended", tuningPreset: "quick", count: 48 },
      { eventName: "gallery_dismissed", tuningPreset: "balanced", count: 14 },
      { eventName: "gallery_dismissed", tuningPreset: "quick", count: 11 },
    ],
    reviewOutcomes: [
      { tuningPreset: "balanced", total: 62, committed: 49, cancelled: 13 },
      { tuningPreset: "quick", total: 48, committed: 42, cancelled: 6 },
    ],
    galleryOutcomes: [
      { tuningPreset: "balanced", total: 14, gesture: 11, control: 3, firstAttemptGesture: 8 },
      { tuningPreset: "quick", total: 11, gesture: 10, control: 1, firstAttemptGesture: 9 },
    ],
  };
}

function sourceCacheFreshness(status: SourceCacheAdminStatus | null): string {
  const finishedAt = status?.sources.bringatrailer.latestIngestion?.finishedAt;
  if (!finishedAt) return "not loaded";
  return `updated ${shortDateTime(finishedAt)}`;
}

function shortSourceCacheTime(value: string | undefined): string {
  return value ? shortDateTime(value) : "not loaded";
}

function numberFromInput(value: string): number | null {
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalNumberFromInput(value: string): number | null {
  return value.trim() ? numberFromInput(value) : null;
}

function centsFromDollarInput(value: string): number | null {
  const dollars = numberFromInput(value);
  return dollars === null ? null : Math.max(0, Math.round(dollars * 100));
}

function optionalCentsFromDollarInput(value: string): number | null {
  return value.trim() ? centsFromDollarInput(value) : null;
}

function dollarsFromCents(value: number | null | undefined, fallback: string): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value / 100) : fallback;
}

function formatMicrosAsDollars(micros: number): string {
  return `$${(Math.max(0, micros) / 1_000_000).toFixed(2)}`;
}

function formatBytes(bytes: number): string {
  const safeBytes = Math.max(0, bytes);
  if (safeBytes < 1024) return `${safeBytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = safeBytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatAiBudget(cents: number | null | undefined): string {
  return typeof cents === "number" && Number.isFinite(cents) ? `of $${(cents / 100).toFixed(2)}` : "no cap";
}

function demoAiUsage(dailySpendMicros: number, monthlySpendMicros: number): AiUsageSummary {
  return {
    generatedAt: "2026-06-25T13:00:00.000Z",
    daily: {
      spendMicros: dailySpendMicros,
      budgetCents: 250,
      remainingMicros: Math.max(0, 250 * 10_000 - dailySpendMicros),
      limitExceeded: dailySpendMicros >= 250 * 10_000,
      startsAt: "2026-06-25T00:00:00.000Z",
      endsAt: "2026-06-26T00:00:00.000Z",
    },
    monthly: {
      spendMicros: monthlySpendMicros,
      budgetCents: 2500,
      remainingMicros: Math.max(0, 2500 * 10_000 - monthlySpendMicros),
      limitExceeded: monthlySpendMicros >= 2500 * 10_000,
      startsAt: "2026-06-01T00:00:00.000Z",
      endsAt: "2026-07-01T00:00:00.000Z",
    },
    budgetExceeded: false,
  };
}

function stringProfileValue(profile: Record<string, unknown>, key: string, fallback: string): string {
  const value = profile[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function initialCalibrationSelection(
  profile: Record<string, unknown>,
  key: string,
  fallback: string[],
  options: CalibrationOption[],
): string[] {
  const allowed = new Set(options.map((option) => option.id));
  const value = profile[key];
  if (!Array.isArray(value)) return [...fallback];
  return value.filter((item): item is string => typeof item === "string" && allowed.has(item));
}

function toggleCalibrationOption(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
}

function calibrationNotes(baseNotes: string, selected: string[], options: CalibrationOption[], label: string): string {
  const byId = new Map(options.map((option) => [option.id, option.note]));
  const selectedNotes = selected.map((id) => byId.get(id)).filter((note): note is string => Boolean(note));
  const parts = [baseNotes.trim()];
  if (selectedNotes.length) parts.push(`${label}: ${selectedNotes.join("; ")}.`);
  return parts.filter(Boolean).join(" ");
}

function initialNotificationSettings(profile: Record<string, unknown>): NotificationSettingsState {
  const settings = normalizeRecord(profile.notifications);
  const channel = settings.channel === "none" ? "none" : "email";
  return {
    channel,
    runDigest: settings.runDigest !== false,
    strongFitAlerts: settings.strongFitAlerts !== false,
    digestTime: typeof settings.digestTime === "string" && settings.digestTime ? settings.digestTime : "08:00",
  };
}

function notificationSettingsInput(settings: NotificationSettingsState): Record<string, unknown> {
  return {
    channel: settings.channel,
    runDigest: settings.runDigest,
    strongFitAlerts: settings.strongFitAlerts,
    digestTime: settings.digestTime || "08:00",
  };
}

function initialSourcePreferences(settings: SourceSetting[] | undefined, profile: Record<string, unknown>): SourcePreferenceState[] {
  const settingsBySource = new Map((settings || []).map((setting) => [setting.source, setting]));
  const profilePreferences = new Map(
    Array.isArray(profile.sourcePreferences)
      ? profile.sourcePreferences
          .filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
          .map((item) => [typeof item.source === "string" ? item.source : "", item])
      : [],
  );
  const profileSources = new Set(Array.isArray(profile.sources) ? profile.sources.filter((source): source is string => typeof source === "string") : []);

  return sourceOptions.map((option) => {
    const stored = settingsBySource.get(option.source);
    const profiled = profilePreferences.get(option.source);
    const rawSettings = normalizeRecord(stored?.settings || normalizeRecord(profiled?.settings));
    const hasProfileSources = profileSources.size > 0;
    const enabled =
      stored?.enabled ??
      (typeof profiled?.enabled === "boolean" ? profiled.enabled : hasProfileSources ? profileSources.has(option.source) : option.enabledByDefault);
    return defaultSourcePreference(option, {
      enabled,
      maxDistanceMiles: numberSettingText(rawSettings, "maxDistanceMiles", option.defaultMaxDistanceMiles),
      maxBudget: dollarsFromCents(numberSetting(rawSettings, "maxBudgetCents"), option.defaultMaxBudget),
      noReserveOnly: booleanSetting(rawSettings, "noReserveOnly", false),
      browserRunner: booleanSetting(rawSettings, "browserRunner", option.defaultBrowserRunner),
      searchNotes: stringSetting(rawSettings, "searchNotes", ""),
    });
  });
}

function defaultSourcePreference(
  option: (typeof sourceOptions)[number],
  overrides: Partial<SourcePreferenceState> = {},
): SourcePreferenceState {
  return {
    source: option.source,
    enabled: option.enabledByDefault,
    maxDistanceMiles: option.defaultMaxDistanceMiles,
    maxBudget: option.defaultMaxBudget,
    noReserveOnly: false,
    browserRunner: option.defaultBrowserRunner,
    searchNotes: "",
    ...overrides,
  };
}

function profileSourceList(preferences: SourcePreferenceState[]): string[] {
  const enabled = new Set(preferences.filter((preference) => preference.enabled).map((preference) => preference.source));
  return sourceOptions.filter((option) => enabled.has(option.source)).map((option) => option.source);
}

function sourceSettingsInput(preferences: SourcePreferenceState[]): SourceSettingsInput {
  const bySource = new Map(preferences.map((preference) => [preference.source, preference]));
  return sourceOptions.map((option) => {
    const preference = bySource.get(option.source) || defaultSourcePreference(option);
    return {
      source: option.source,
      enabled: preference.enabled,
      settings: sourceSettingsRecord(preference),
    };
  });
}

function sourceSettingsRecord(preference: SourcePreferenceState): Record<string, unknown> {
  const settings: Record<string, unknown> = {
    noReserveOnly: preference.noReserveOnly,
    browserRunner: preference.browserRunner,
  };
  const maxDistanceMiles = optionalNumberFromInput(preference.maxDistanceMiles);
  const maxBudgetCents = optionalCentsFromDollarInput(preference.maxBudget);
  if (maxDistanceMiles !== null) settings.maxDistanceMiles = maxDistanceMiles;
  if (maxBudgetCents !== null) settings.maxBudgetCents = maxBudgetCents;
  if (preference.searchNotes.trim()) settings.searchNotes = preference.searchNotes.trim();
  return settings;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function numberSetting(settings: Record<string, unknown>, key: string): number | null {
  const value = settings[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function numberSettingText(settings: Record<string, unknown>, key: string, fallback: string): string {
  const value = numberSetting(settings, key);
  return value === null ? fallback : String(value);
}

function booleanSetting(settings: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = settings[key];
  return typeof value === "boolean" ? value : fallback;
}

function stringSetting(settings: Record<string, unknown>, key: string, fallback: string): string {
  const value = settings[key];
  return typeof value === "string" ? value : fallback;
}

function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  downloadBlob(blob, filename);
}

function downloadText(value: string, filename: string, contentType: string): void {
  const blob = new Blob([value], { type: contentType });
  downloadBlob(blob, filename);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.replace(/[^0-9a-z@._-]/gi, "-");
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function shortDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function isOAuthConnectionExpired(token: OAuthAccessTokenRecord): boolean {
  const expiresAt = Date.parse(token.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function isOAuthConnectionActive(token: OAuthAccessTokenRecord): boolean {
  return !token.revokedAt && !isOAuthConnectionExpired(token);
}

function oauthConnectionName(token: OAuthAccessTokenRecord): string {
  return token.clientName || token.clientId.replace(/^beachcar-oauth-client-/, "OAuth client ");
}

function oauthConnectionDetail(token: OAuthAccessTokenRecord): string {
  if (token.revokedAt) return `Revoked ${shortDateTime(token.revokedAt)}`;
  if (isOAuthConnectionExpired(token)) return `Expired ${shortDateTime(token.expiresAt)}`;
  if (token.lastUsedAt) return `Used ${shortDateTime(token.lastUsedAt)}`;
  return `Expires ${shortDateTime(token.expiresAt)}`;
}

function FilterChip(props: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={props.active ? "chip is-active" : "chip"} type="button" onClick={props.onClick}>
      {props.label}
    </button>
  );
}

function Dots(props: { count: number; active: number }) {
  if (props.count <= 1) return null;
  return (
    <span className="photo-dots" aria-hidden="true">
      {Array.from({ length: Math.min(props.count, 5) }, (_, index) => (
        <i className={index === props.active ? "is-active" : ""} key={index} />
      ))}
    </span>
  );
}

function Metric(props: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={props.highlight ? "metric is-highlight" : "metric"}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function DiligenceSection(props: { title: string; body?: string; tone?: "good" | "warn" }) {
  if (!props.body) return null;
  return (
    <section className={`detail-section ${props.tone ? `is-${props.tone}` : ""}`}>
      <p>{props.title}</p>
      <div>{props.body}</div>
    </section>
  );
}

function DiligenceList(props: { title: string; items: string[]; tone?: "good" | "warn" }) {
  if (!props.items.length) return null;
  return (
    <section className={`detail-section ${props.tone ? `is-${props.tone}` : ""}`}>
      <p>{props.title}</p>
      <ul>
        {props.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function DossierDetail(props: { dossier?: AuctionListing["dossier"] }) {
  const d = props.dossier;
  if (!d) return null;

  const specRows: Array<[string, string]> = [];
  const metaRows: Array<[string, string]> = [];
  if (d.specs) {
    const s = d.specs;
    const add = (rows: Array<[string, string]>, label: string, value?: string) => {
      if (value) rows.push([label, value]);
    };
    add(specRows, "Odometer", s.odometer);
    add(specRows, "Engine", s.engine);
    add(specRows, "Transmission", s.transmission);
    add(specRows, "Drivetrain", s.drivetrain);
    add(specRows, "Exterior", s.exterior);
    add(specRows, "Interior", s.interior);
    add(metaRows, "Title", s.title);
    add(metaRows, "Seller", s.seller);
    add(metaRows, "Listing", s.lot);
  }

  const fitRows: Array<[string, string]> = [];
  if (d.beachUse) {
    const b = d.beachUse;
    if (b.body) fitRows.push(["Body", b.body]);
    if (b.location) fitRows.push(["Where", b.location]);
    if (b.people) fitRows.push(["People", b.people]);
    if (b.paperwork) fitRows.push(["Paperwork", b.paperwork]);
  }

  const hasVehicle = Boolean(d.summary) || specRows.length > 0 || metaRows.length > 0;
  const valuePercent = typeof d.valueScore === "number" ? Math.round(Math.max(0, Math.min(1, d.valueScore)) * 100) : null;

  return (
    <>
      {hasVehicle ? (
        <section className="detail-section">
          <p>Vehicle</p>
          {d.summary ? <div>{d.summary}</div> : null}
          {specRows.length ? (
            <div className="spec-grid">
              {specRows.map(([label, value]) => (
                <div className="spec-cell" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          ) : null}
          {metaRows.length ? (
            <div className="spec-meta">
              {metaRows.map(([label, value]) => (
                <div className="spec-cell" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {valuePercent !== null ? (
        <section className="detail-section">
          <p>Value read</p>
          <div className="value-meter">
            <div className="value-scale">
              <span>Cheap</span>
              <span>Fair</span>
              <span>Rich</span>
            </div>
            <div className="value-bar">
              <span className="value-thumb" style={{ left: `${valuePercent}%` }} />
            </div>
          </div>
        </section>
      ) : null}

      {d.listing && d.listing.length ? (
        <section className="detail-section">
          <p>From the listing</p>
          <div className="listing-prose">
            {d.listing.map((para, index) => (
              <p key={index}>{para}</p>
            ))}
          </div>
        </section>
      ) : null}

      {d.equipment && d.equipment.length ? (
        <section className="detail-section is-good">
          <p>Equipment &amp; highlights</p>
          <ul>
            {d.equipment.map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {d.service && d.service.length ? (
        <section className="detail-section is-good">
          <p>Recent service</p>
          <ul>
            {d.service.map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {fitRows.length ? (
        <section className="detail-section">
          <p>Beach-use fit</p>
          <div className="fit-grid">
            {fitRows.map(([label, value]) => (
              <div className="fit-cell" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {d.bidLog && d.bidLog.length ? (
        <section className="detail-section">
          <p>Bidding</p>
          <div className="bid-log">
            {d.bidLog.map((bid, index) => (
              <div className={index === 0 ? "bid-row is-top" : "bid-row"} key={index}>
                <span className="bid-bidder">{bid.bidder}</span>
                <strong>{bid.amount}</strong>
                <span className="bid-ago">{bid.ago ?? ""}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {d.comments && d.comments.length ? (
        <section className="detail-section">
          <p>Comments</p>
          <div className="comment-thread">
            {d.comments.map((comment, index) => (
              <div className="comment" key={index}>
                <span className={comment.seller ? "comment-avatar is-seller" : "comment-avatar"}>
                  {comment.user.slice(0, 1).toUpperCase()}
                </span>
                <div className="comment-body">
                  <div className="comment-head">
                    <strong>{comment.user}</strong>
                    {comment.seller ? <span className="seller-badge">Seller</span> : null}
                    <span className="comment-ago">{comment.ago ?? ""}</span>
                  </div>
                  <p>{comment.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function ClerkPricingSheet(props: { clerk: BrowserClerk | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const canMount = managedResearchCheckoutEnabled && Boolean(props.clerk?.mountPricingTable);

  useEffect(() => {
    if (!managedResearchCheckoutEnabled || !props.clerk?.mountPricingTable || !ref.current) return;
    const node = ref.current;
    props.clerk.mountPricingTable(node, {
      appearance: {
        elements: {
          card: "beachcar-clerk-pricing-card",
          rootBox: "beachcar-clerk-pricing-root",
        },
      },
    });
    return () => props.clerk?.unmountPricingTable?.(node);
  }, [props.clerk]);

  return (
    <div className="filter-overlay pricing-overlay" role="dialog" aria-modal="true" aria-label="Managed Research plans">
      <button className="filter-backdrop" type="button" onClick={props.onClose} aria-label="Close pricing" />
      <section className="filter-sheet pricing-sheet">
        <div className="sheet-grabber" />
        <div className="sheet-title">
          <div>
            <p className="eyebrow">{managedResearchCheckoutEnabled ? "Optional managed service" : "Private pilot"}</p>
            <strong>{managedResearchCheckoutEnabled ? "Let Beachcar run the research." : "Help shape Managed Research."}</strong>
          </div>
          <button type="button" onClick={props.onClose}>
            Done
          </button>
        </div>
        <p className="setup-muted">
          {managedResearchCheckoutEnabled
            ? `Managed Research is $${managedResearchPrice}/month. Beachcar runs the hosted agent workflow, monitors sources, applies your feedback, and publishes a fresh private shortlist. Your own agent remains free.`
            : "Managed Research is currently a small, free pilot. Beachcar runs the hosted agent workflow, monitors sources, applies your feedback, and publishes a fresh private shortlist while we refine the experience with real users."}
        </p>
        {canMount ? (
          <div className="clerk-pricing-table" ref={ref} />
        ) : (
          <div className="pricing-unavailable">
            <Sparkles size={22} aria-hidden="true" />
            <strong>{managedResearchCheckoutEnabled ? "Checkout is not available in this environment yet." : "Pilot access is granted by invitation."}</strong>
            <small>
              {managedResearchCheckoutEnabled
                ? "The free agent-connected path is fully available. Billing appears here once Clerk Billing is enabled."
                : "There is no checkout and no payment information is collected. Your own agent remains available to everyone."}
            </small>
          </div>
        )}
        <p className="pricing-footnote">
          {managedResearchCheckoutEnabled
            ? "Cancel any time. Your taste profile, feedback, and saved listings stay with you."
            : "Pilot members will get clear notice before any future paid offering; access will never turn into a charge automatically."}
        </p>
      </section>
    </div>
  );
}

function ClerkUserButton(props: { clerk: BrowserClerk | null }) {
  return (
    <button className="mini-signout" type="button" onClick={() => void props.clerk?.signOut({ redirectUrl: "/" })}>
      Sign out
    </button>
  );
}

function Stat(props: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="stat">
      {props.icon}
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}
