export const REQUIRED_WORKER_SECRET_NAMES = ["PUBLISH_TOKEN", "CLERK_SECRET_KEY", "CLERK_JWT_ISSUER"] as const;
export const SOURCE_QUALITY_V1_MIGRATION = "0011_source_cache_listing_fields.sql";

export const WORKER_SECRET_NAMES = [
  ...REQUIRED_WORKER_SECRET_NAMES,
  "BEACHCAR_AI_GATEWAY_TOKEN",
  "BEACHCAR_AI_GATEWAY_BASE_URL",
  "BEACHCAR_AI_GATEWAY_ID",
  "CLOUDFLARE_ACCOUNT_ID",
  "BEACHCAR_AI_GATEWAY_MODEL",
  "BEACHCAR_AI_ESTIMATED_MICROS_PER_1K_TOKENS",
  "BEACHCAR_RUNNER_MODE",
  "BEACHCAR_CODEX_MODEL",
  "OPENAI_API_KEY",
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

export function collectWorkerSecrets(env: Environment): Record<string, string> {
  const secrets: Record<string, string> = {};
  for (const name of WORKER_SECRET_NAMES) {
    const value = clean(env[name]);
    if (value && !isPlaceholder(value)) secrets[name] = value;
  }
  return secrets;
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
  return pending.length === 1 && pending[0] === SOURCE_QUALITY_V1_MIGRATION;
}

export function evaluateSourceQualitySchemaGate(outputs: {
  columns: string;
  indexes: string;
  quickCheck: string;
}): { columnCount: number; indexCount: number; quickCheck: string; ok: boolean } {
  const columnCount = numericResult(outputs.columns, "found_columns");
  const indexCount = numericResult(outputs.indexes, "found_indexes");
  const quickRows = d1RowsFromJson(outputs.quickCheck);
  const quickCheck = clean(quickRows[0]?.quick_check || quickRows[0]?.integrity_check);
  return {
    columnCount,
    indexCount,
    quickCheck,
    ok: columnCount === 12 && indexCount === 3 && quickCheck.toLowerCase() === "ok",
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

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
