export const REQUIRED_WORKER_SECRET_NAMES = [
  "PUBLISH_TOKEN",
  "CLERK_SECRET_KEY",
  "CLERK_JWT_ISSUER",
] as const;
export const SOURCE_QUALITY_V1_MIGRATION = "0011_source_cache_listing_fields.sql";
export const PRODUCT_EVENTS_V1_MIGRATION = "0012_product_events.sql";
export const AGENT_CONNECTED_SUBSCRIPTIONS_MIGRATION = "0013_agent_connected_subscriptions.sql";
export const MANAGED_FRIEND_ONBOARDING_MIGRATION = "0014_managed_friend_onboarding.sql";

export const WORKER_SECRET_NAMES = [
  ...REQUIRED_WORKER_SECRET_NAMES,
  "CLERK_WEBHOOK_SIGNING_SECRET",
  "BEACHCAR_AI_GATEWAY_TOKEN",
  "BEACHCAR_AI_GATEWAY_BASE_URL",
  "BEACHCAR_AI_GATEWAY_ID",
  "CLOUDFLARE_ACCOUNT_ID",
  "BEACHCAR_AI_GATEWAY_MODEL",
  "BEACHCAR_AI_ESTIMATED_MICROS_PER_1K_TOKENS",
  "BEACHCAR_MANAGED_PILOT_EMAILS",
  "BEACHCAR_RUNNER_MODE",
  "BEACHCAR_CODEX_MODEL",
  "OPENAI_API_KEY",
  "PRODUCT_TUNING_FORCE_BALANCED",
] as const;

type Environment = Record<string, string | undefined>;

export type CloudflareAccountGate = {
  expectedAccountId: string;
  selectedAccountId: string;
  authenticatedAccountIds: string[];
  expectedConfigured: boolean;
  selectedMatchesExpected: boolean;
  credentialsCanAccessExpected: boolean;
};

export type D1IdentityGate = {
  configuredName: string;
  configuredId: string;
  remoteNameMatchId: string;
  remoteIdMatchName: string;
  exactMatch: boolean;
};

export type DurableObjectRollbackGate = {
  ok: boolean;
  activeVersionId: string;
  activePercentage: number;
  activeVersionCount: number;
  expectedMigrationTag: string;
  remoteMigrationTag: string;
  reason: string;
};

export function evaluateCloudflareAccountGate(options: {
  configAccountId?: string;
  env?: Environment;
  authenticatedAccountIds?: string[];
}): CloudflareAccountGate {
  const env = options.env || {};
  const configAccountId = clean(options.configAccountId);
  const authenticatedAccountIds = uniqueAccountIds(options.authenticatedAccountIds || []);
  const expectedAccountId =
    configAccountId || clean(env.BEACHCAR_EXPECTED_CLOUDFLARE_ACCOUNT_ID) || clean(env.CLOUDFLARE_ACCOUNT_ID);
  const selectedAccountId =
    clean(env.CLOUDFLARE_ACCOUNT_ID) || configAccountId || (authenticatedAccountIds.length === 1 ? authenticatedAccountIds[0] : "");

  return {
    expectedAccountId,
    selectedAccountId,
    authenticatedAccountIds,
    expectedConfigured: isAccountId(expectedAccountId),
    selectedMatchesExpected: Boolean(expectedAccountId && selectedAccountId && expectedAccountId === selectedAccountId),
    credentialsCanAccessExpected: Boolean(expectedAccountId && authenticatedAccountIds.includes(expectedAccountId)),
  };
}

export function accountIdsFromWhoami(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const accounts = (value as { accounts?: unknown }).accounts;
  if (!Array.isArray(accounts)) return [];
  return uniqueAccountIds(
    accounts.map((entry) => (entry && typeof entry === "object" ? clean((entry as { id?: unknown }).id) : "")),
  );
}

export function evaluateD1IdentityGate(options: {
  configuredName?: string;
  configuredId?: string;
  databases?: unknown[];
}): D1IdentityGate {
  const configuredName = clean(options.configuredName);
  const configuredId = clean(options.configuredId);
  const databases = Array.isArray(options.databases) ? options.databases : [];
  const nameMatch = databases.find((entry) => recordString(entry, "name") === configuredName);
  const idMatch = databases.find((entry) => recordString(entry, "uuid") === configuredId);
  const remoteNameMatchId = recordString(nameMatch, "uuid");
  const remoteIdMatchName = recordString(idMatch, "name");

  return {
    configuredName,
    configuredId,
    remoteNameMatchId,
    remoteIdMatchName,
    exactMatch: Boolean(
      configuredName &&
        configuredId &&
        remoteNameMatchId === configuredId &&
        remoteIdMatchName === configuredName,
    ),
  };
}

export function guardedWorkerDeployArgs(options: {
  dryRun?: boolean;
  secretsFile?: string;
  skipContainerRollout?: boolean;
} = {}): string[] {
  const args = ["deploy", "--strict", "--keep-vars"];
  if (options.dryRun) args.push("--dry-run");
  const secretsFile = clean(options.secretsFile);
  if (secretsFile) args.push("--secrets-file", secretsFile);
  if (options.skipContainerRollout) args.push("--containers-rollout", "none");
  return args;
}

export function evaluateDurableObjectRollbackGate(options: {
  deploymentStatus?: unknown;
  expectedMigrationTag?: string;
  remoteMigrationTag?: string;
}): DurableObjectRollbackGate {
  const expectedMigrationTag = clean(options.expectedMigrationTag);
  const remoteMigrationTag = clean(options.remoteMigrationTag);
  const versions = recordArray(options.deploymentStatus, "versions")
    .map((entry) => ({
      versionId: recordString(entry, "version_id") || recordString(entry, "id"),
      percentage: Number(recordValue(entry, "percentage")),
    }))
    .filter((entry) => entry.versionId && Number.isFinite(entry.percentage) && entry.percentage > 0);
  const activeVersion = versions.length === 1 ? versions[0] : null;
  const singleVersionAtFullTraffic = Boolean(activeVersion && activeVersion.percentage === 100);
  const migrationTagMatches = Boolean(expectedMigrationTag && remoteMigrationTag === expectedMigrationTag);
  const ok = singleVersionAtFullTraffic && migrationTagMatches;
  let reason = "The active Worker is a single version at 100% traffic and already has the configured Durable Object migration tag.";
  if (!activeVersion) {
    reason = `Expected exactly one active Worker version, found ${versions.length}.`;
  } else if (activeVersion.percentage !== 100) {
    reason = `Expected the active Worker version at 100% traffic, found ${activeVersion.percentage}%.`;
  } else if (!expectedMigrationTag) {
    reason = "No final Durable Object migration tag is configured locally.";
  } else if (!remoteMigrationTag) {
    reason = "The remote Worker did not report a Durable Object migration tag.";
  } else if (remoteMigrationTag !== expectedMigrationTag) {
    reason = `Remote Durable Object migration tag ${remoteMigrationTag} does not match configured tag ${expectedMigrationTag}.`;
  }

  return {
    ok,
    activeVersionId: activeVersion?.versionId || "",
    activePercentage: activeVersion?.percentage || 0,
    activeVersionCount: versions.length,
    expectedMigrationTag,
    remoteMigrationTag,
    reason,
  };
}

export function workerMigrationTagFromServiceMetadata(value: unknown): string {
  const defaultEnvironment = recordValue(value, "default_environment");
  const script = recordValue(defaultEnvironment, "script");
  return recordString(script, "migration_tag");
}

export function collectWorkerSecrets(env: Environment): Record<string, string> {
  const secrets: Record<string, string> = {};
  for (const name of WORKER_SECRET_NAMES) {
    const value = clean(env[name]);
    if (value && !isPlaceholder(value)) secrets[name] = value;
  }
  return secrets;
}

export function collectRolloutWorkerSecrets(options: {
  deployFileEnv?: Environment;
  ambientEnv?: Environment;
  runnerMode: "deterministic" | "codex";
  deployContainers: boolean;
}): Record<string, string> {
  const deployFileEnv = options.deployFileEnv || {};
  const values: Environment = {
    ...deployFileEnv,
    ...(options.ambientEnv || {}),
    BEACHCAR_RUNNER_MODE: options.runnerMode,
  };
  delete values.OPENAI_API_KEY;
  delete values.BEACHCAR_CODEX_MODEL;
  if (options.runnerMode === "codex" && options.deployContainers) {
    values.OPENAI_API_KEY = deployFileEnv.OPENAI_API_KEY;
    values.BEACHCAR_CODEX_MODEL = deployFileEnv.BEACHCAR_CODEX_MODEL;
  }
  return collectWorkerSecrets(values);
}

export function missingRequiredWorkerSecrets(remoteNames: string[], localNames: string[]): string[] {
  const available = new Set([...remoteNames, ...localNames]);
  return REQUIRED_WORKER_SECRET_NAMES.filter((name) => !available.has(name));
}

export function verificationRequirementArgs(env: Environment): string[] {
  const args: string[] = [];
  if (hasRealValue(env.BEACHCAR_CLERK_TOKEN)) args.push("--require-clerk");
  if (hasRealValue(env.PUBLISH_TOKEN)) args.push("--require-publish");
  if (hasRealValue(env.BEACHCAR_MCP_TOKEN)) args.push("--require-mcp");
  return args;
}

export function missingVerificationGateStatus(required: boolean): "fail" | "skip" {
  return required ? "fail" : "skip";
}

export function pendingD1MigrationFiles(output: string): string[] {
  return Array.from(new Set(output.match(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/g) || [])).sort();
}

export function isSafeSourceQualityMigrationSet(output: string): boolean {
  const pending = pendingD1MigrationFiles(output);
  if (pending.length === 0) return /No migrations to apply!/i.test(output);
  const allowed = new Set([
    SOURCE_QUALITY_V1_MIGRATION,
    PRODUCT_EVENTS_V1_MIGRATION,
    AGENT_CONNECTED_SUBSCRIPTIONS_MIGRATION,
    MANAGED_FRIEND_ONBOARDING_MIGRATION,
  ]);
  return pending.every((migration) => allowed.has(migration));
}

export function evaluateSourceQualitySchemaGate(outputs: {
  columns: string;
  indexes: string;
  productColumns: string;
  productIndexes: string;
  researchColumns: string;
  billingColumns: string;
  billingIndexes: string;
  friendColumns: string;
  friendTables: string;
  friendIndexes: string;
  quickCheck: string;
}): {
  columnCount: number;
  indexCount: number;
  productColumnCount: number;
  productIndexCount: number;
  researchColumnCount: number;
  billingColumnCount: number;
  billingIndexCount: number;
  friendColumnCount: number;
  friendTableCount: number;
  friendIndexCount: number;
  quickCheck: string;
  ok: boolean;
} {
  const columnCount = numericResult(outputs.columns, "found_columns");
  const indexCount = numericResult(outputs.indexes, "found_indexes");
  const productColumnCount = numericResult(outputs.productColumns, "found_product_columns");
  const productIndexCount = numericResult(outputs.productIndexes, "found_product_indexes");
  const researchColumnCount = numericResult(outputs.researchColumns, "found_research_columns");
  const billingColumnCount = numericResult(outputs.billingColumns, "found_billing_columns");
  const billingIndexCount = numericResult(outputs.billingIndexes, "found_billing_indexes");
  const friendColumnCount = numericResult(outputs.friendColumns, "found_friend_columns");
  const friendTableCount = numericResult(outputs.friendTables, "found_friend_tables");
  const friendIndexCount = numericResult(outputs.friendIndexes, "found_friend_indexes");
  const quickRows = d1RowsFromJson(outputs.quickCheck);
  const quickCheck = clean(quickRows[0]?.quick_check || quickRows[0]?.integrity_check);
  return {
    columnCount,
    indexCount,
    productColumnCount,
    productIndexCount,
    researchColumnCount,
    billingColumnCount,
    billingIndexCount,
    friendColumnCount,
    friendTableCount,
    friendIndexCount,
    quickCheck,
    ok:
      columnCount === 12 &&
      indexCount === 3 &&
      productColumnCount === 9 &&
      productIndexCount === 3 &&
      researchColumnCount === 4 &&
      billingColumnCount === 7 &&
      billingIndexCount === 1 &&
      friendColumnCount === 6 &&
      friendTableCount === 2 &&
      friendIndexCount === 4 &&
      quickCheck.toLowerCase() === "ok",
  };
}

export function d1RowsFromJson(output: string): Array<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return [];
  }
  const envelopes = Array.isArray(value) ? value : [value];
  const rows: Array<Record<string, unknown>> = [];
  for (const envelope of envelopes) {
    if (!envelope || typeof envelope !== "object") continue;
    const results = (envelope as { results?: unknown }).results;
    if (!Array.isArray(results)) continue;
    for (const row of results) {
      if (row && typeof row === "object" && !Array.isArray(row)) rows.push(row as Record<string, unknown>);
    }
  }
  return rows;
}

export function hasRealValue(value: unknown): boolean {
  const text = clean(value);
  return Boolean(text && !isPlaceholder(text));
}

export function isPlaceholder(value: unknown): boolean {
  return /\.\.\.|<[^>]+>|your-|example|reuse-dev-token|generate-a-long-random-token|REPLACE|TODO|CHANGEME|placeholder/i.test(clean(value));
}

function uniqueAccountIds(values: string[]): string[] {
  return Array.from(new Set(values.map(clean).filter(isAccountId))).sort();
}

function numericResult(output: string, key: string): number {
  const value = d1RowsFromJson(output)[0]?.[key];
  return typeof value === "number" ? value : Number(value);
}

function isAccountId(value: string): boolean {
  return /^[a-f0-9]{32}$/i.test(value);
}

function recordValue(value: unknown, key: string): unknown {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function recordString(value: unknown, key: string): string {
  return clean(recordValue(value, key));
}

function recordArray(value: unknown, key: string): unknown[] {
  const current = recordValue(value, key);
  return Array.isArray(current) ? current : [];
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
