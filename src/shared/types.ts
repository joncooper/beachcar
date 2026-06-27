export type Lane = "family" | "solo" | "curiosity";
export type FeedbackAction = "like" | "star" | "hide" | "avoid";

/**
 * Rich per-car detail for the native dossier view. Every field is optional and
 * forward-compatible: runs that omit it (or omit sub-fields) degrade gracefully
 * in the clients. The shape mirrors the iOS `ShadeDossierData` decoder exactly —
 * keep them in sync. Any AI-vending mode (admin import, remote MCP, the per-user
 * workflow, AI Gateway, the container runner) may populate this.
 */
export interface ShadeDossierData {
  /** One-paragraph vehicle summary (VEHICLE section). */
  summary?: string;
  /** Two-column spec grid; all sub-fields optional. */
  specs?: {
    odometer?: string;
    engine?: string;
    transmission?: string;
    drivetrain?: string;
    exterior?: string;
    interior?: string;
    title?: string;
    seller?: string;
    lot?: string;
  };
  /** FROM THE LISTING — the full multi-paragraph writeup. */
  listing?: string[];
  /** EQUIPMENT & HIGHLIGHTS bullets. */
  equipment?: string[];
  /** RECENT SERVICE bullets. */
  service?: string[];
  /** BIDDING history, most-recent first. */
  bidLog?: Array<{ bidder: string; amount: string; ago?: string }>;
  /** COMMENTS thread; `seller` highlights the seller's posts. */
  comments?: Array<{ user: string; body: string; ago?: string; seller?: boolean }>;
  /** BEACH-USE FIT 2x2 grid. */
  beachUse?: { body?: string; location?: string; people?: string; paperwork?: string };
  /** 0..1 position on the CHEAP..RICH value meter. */
  valueScore?: number;
}

export interface AuctionListing {
  listingKey?: string;
  section: string;
  lane: Lane;
  site: string;
  title: string;
  url: string;
  bid: string;
  total: string;
  location?: string;
  bidNum?: number;
  endsAt?: string;
  ends?: string;
  timeLeft?: string;
  bids?: string | number;
  bidders?: string | number;
  comments?: string | number;
  fair?: string;
  ceiling?: string;
  conf?: string;
  why: string;
  concerns: string;
  currentTake?: string;
  images: string[];
  originalImages?: string[];
  feedback?: FeedbackRecord | null;
  imageStatus?: ImageStatus[];
  /** Optional rich detail for the dossier view (see ShadeDossierData). */
  dossier?: ShadeDossierData | null;
}

export interface ImageStatus {
  imageKey: string;
  sourceUrl: string;
  url: string;
  copied: boolean;
  status: "pending" | "copied" | "failed";
  error?: string | null;
}

export interface FeedbackRecord {
  listingKey: string;
  action: FeedbackAction;
  tags: string[];
  note?: string | null;
  updatedAt: string;
}

export interface PreferenceEvent {
  id: string;
  listingKey?: string | null;
  eventType: "voice_note" | "text_note" | "viewed";
  note?: string | null;
  transcript?: string | null;
  tags: string[];
  createdAt: string;
}

export interface RunPayload {
  id: string | null;
  generatedAt: string | null;
  reportMarkdown?: string | null;
  sourceSummary?: unknown;
  listings: AuctionListing[];
  feedback: FeedbackRecord[];
}

export interface AgentRunRecord {
  id: string;
  userId: string;
  workflowInstanceId?: string | null;
  status: "queued" | "running" | "published" | "failed" | "cancelled";
  progress: Record<string, unknown>;
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportPayload {
  runId?: string;
  userId?: string;
  generatedAt?: string;
  reportMarkdown?: string;
  sourceSummary?: unknown;
  listings?: AuctionListing[];
  items?: AuctionListing[];
}

export interface FeedbackExport {
  version: 1;
  kind: "auction-watch-feedback";
  generatedAt: string;
  counts: Record<FeedbackAction, number> & { total: number };
  entries: Array<FeedbackRecord & { listing?: AuctionListing | null }>;
  preferenceEvents?: Array<PreferenceEvent & { listing?: AuctionListing | null }>;
  steering: {
    prioritizeSimilarTo: Array<{ title: string; url: string; tags: string[] }>;
    suppressExactUrls: string[];
    avoidSimilarTo: Array<{ title: string; url: string; tags: string[]; why?: string }>;
    notes: Array<{ title?: string; url?: string; note: string; tags: string[] }>;
  };
}

export interface UserRecord {
  id: string;
  email: string;
  displayName?: string | null;
  status: "invited" | "active" | "disabled";
}

export interface UserProfile {
  userId: string;
  displayName?: string | null;
  niche: string;
  budgetMin?: number | null;
  budgetMax?: number | null;
  stretchBudget?: number | null;
  homeRegion?: string | null;
  timezone: string;
  scheduleCron: string;
  profile: Record<string, unknown>;
  onboardingCompletedAt?: string | null;
  updatedAt: string;
}

export interface SourceSetting {
  source: string;
  enabled: boolean;
  settings: Record<string, unknown>;
  updatedAt: string;
}

export interface UserAiSettings {
  mode: "managed" | "byok";
  gatewayKeyRef?: string | null;
  monthlyBudgetCents?: number | null;
  dailyBudgetCents?: number | null;
  status: "not_configured" | "active" | "disabled" | "error";
  updatedAt: string;
}

export interface AiUsageWindow {
  spendMicros: number;
  budgetCents?: number | null;
  remainingMicros?: number | null;
  limitExceeded: boolean;
  startsAt: string;
  endsAt: string;
}

export interface AiUsageSummary {
  generatedAt: string;
  daily: AiUsageWindow;
  monthly: AiUsageWindow;
  budgetExceeded: boolean;
}

export interface AiUsageEventRecord {
  id: string;
  userId: string;
  agentRunId?: string | null;
  provider: string;
  model?: string | null;
  operation: string;
  mode?: UserAiSettings["mode"] | null;
  gatewayId?: string | null;
  gatewayKeyRef?: string | null;
  gatewayRequestId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  costMicros: number;
  status: "ok" | "error" | "cached";
  metadata: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}

export type AutomationScope = "setup:read" | "sources:read" | "runs:publish" | "usage:write" | "events:read";

export interface AutomationTokenRecord {
  id: string;
  userId: string;
  label: string;
  scopes: AutomationScope[];
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
}

export interface OAuthAccessTokenRecord {
  id: string;
  userId: string;
  clientId: string;
  clientName?: string | null;
  resource: string;
  scopes: AutomationScope[];
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface AutomationTokenCreateResult {
  token: string;
  record: AutomationTokenRecord;
}

export interface AutomationEventRecord {
  id: string;
  userId: string;
  tokenId?: string | null;
  actor: string;
  eventType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AutomationStatus {
  mcpEndpoint: string;
  bundleEndpoint: string;
  protectedResourceMetadataEndpoint: string;
  oauth: {
    status: "planned" | "metadata_ready" | "authorization_code_ready";
    protectedResourceMetadataEndpoint?: string;
    authorizationServerMetadataEndpoint?: string;
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    registrationEndpoint?: string;
    message: string;
  };
  defaultScopes: AutomationScope[];
  tokens: AutomationTokenRecord[];
  oauthAccessTokens: OAuthAccessTokenRecord[];
  recentEvents: AutomationEventRecord[];
}

export interface AutomationBundle {
  filename: string;
  contentType: "text/markdown";
  mcpEndpoint: string;
  markdown: string;
}

export interface RunnerTaskRecord {
  id: string;
  userId: string;
  agentRunId?: string | null;
  kind: "source_discovery" | "codex_research" | "browser_source";
  source: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  priority: number;
  input: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: string | null;
  runnerId?: string | null;
  claimedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserPayload extends UserRecord {
  profile?: UserProfile | null;
  sourceSettings?: SourceSetting[];
  aiSettings?: UserAiSettings | null;
  aiUsage?: AiUsageSummary | null;
  onboarding?: {
    completed: boolean;
    completedAt?: string | null;
  };
  capabilities?: {
    canUseManagedAi: boolean;
    canUseByok: boolean;
    canRunNow: boolean;
  };
}

export interface AdminUserSummary extends UserRecord {
  onboardingCompletedAt?: string | null;
  latestRunAt?: string | null;
  aiUsage?: AiUsageSummary | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface AdminOpsSummary {
  generatedAt: string;
  users: {
    total: number;
    active: number;
    invited: number;
    disabled: number;
    onboarded: number;
  };
  runs: {
    total: number;
    latestGeneratedAt?: string | null;
  };
  agentRuns: {
    total: number;
    queued: number;
    running: number;
    published: number;
    failed: number;
    cancelled: number;
  };
  runnerTasks: {
    total: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    oldestQueuedAt?: string | null;
    latestFinishedAt?: string | null;
  };
  images: {
    originals: {
      total: number;
      pending: number;
      copied: number;
      failed: number;
      bytes: number;
    };
    variants: {
      total: number;
      pending: number;
      created: number;
      failed: number;
      bytes: number;
    };
  };
  aiUsage: {
    dailySpendMicros: number;
    monthlySpendMicros: number;
    dailyEvents: number;
    monthlyEvents: number;
  };
  sourceCache: SourceCacheAdminStatus;
}

export interface SourceIngestionRun {
  id: string;
  source: string;
  sourceUrl: string;
  status: "ok" | "failed";
  itemCount: number;
  newItemCount: number;
  error?: string | null;
  startedAt: string;
  finishedAt: string;
}

export interface SourceCacheStatus {
  source: string;
  itemCount: number;
  latestIngestion: SourceIngestionRun | null;
}

export interface SourceCacheAdminStatus {
  sources: {
    bringatrailer: SourceCacheStatus;
  };
}

export interface SourceCacheUpsertResult {
  source: string;
  sourceUrl: string;
  itemCount: number;
  newItemCount: number;
  startedAt: string;
  finishedAt: string;
}

export interface SourceCacheIngestResult {
  source: "bringatrailer";
  ingestion: SourceCacheUpsertResult;
}

export interface AccountExport {
  version: 1;
  kind: "beachcar-account-export";
  generatedAt: string;
  user: UserPayload;
  feedback: FeedbackExport;
  runs: RunPayload[];
  agentRuns: AgentRunRecord[];
  aiUsageEvents: AiUsageEventRecord[];
  runnerTasks: RunnerTaskRecord[];
  automationTokens: AutomationTokenRecord[];
  oauthAccessTokens: OAuthAccessTokenRecord[];
  automationEvents: AutomationEventRecord[];
}

export interface AccountDeletionResult {
  ok: true;
  userId: string;
  disabledAt: string;
  deleted: {
    profiles: number;
    sourceSettings: number;
    aiSettings: number;
    aiUsageEvents: number;
    runnerTasks: number;
    feedback: number;
    preferenceEvents: number;
    runs: number;
    agentRuns: number;
    automationTokens: number;
    oauthAuthorizationCodes: number;
    oauthAccessTokens: number;
    automationEvents: number;
  };
}

export interface InvitePayload {
  id: string;
  email: string;
  code: string;
  createdAt: string;
  expiresAt?: string | null;
}
