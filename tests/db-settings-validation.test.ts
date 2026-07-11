import { describe, expect, it } from "vitest";
import { createAgentRunRequest, upsertAiSettings, upsertProfile } from "../src/worker/db";

describe("database settings validation", () => {
  it("rejects new invalid timezone and cron values before writing", async () => {
    const invalidTimezone = new SettingsValidationD1();
    await expect(
      upsertProfile(invalidTimezone as unknown as D1Database, "user-a", {
        timezone: "Not/A_Timezone",
        scheduleCron: "0 8 * * *",
      }),
    ).rejects.toThrow("Invalid profile timezone");
    expect(invalidTimezone.writes).toBe(0);

    const invalidCron = new SettingsValidationD1();
    await expect(
      upsertProfile(invalidCron as unknown as D1Database, "user-a", {
        timezone: "America/New_York",
        scheduleCron: "*/15 * * * *",
      }),
    ).rejects.toThrow("Daily schedule must use");
    expect(invalidCron.writes).toBe(0);
  });

  it("grandfathers an omitted legacy cron but rejects an explicit invalid replacement", async () => {
    const legacy = new SettingsValidationD1(profileRow("0 */6 * * *"));
    const saved = await upsertProfile(legacy as unknown as D1Database, "user-a", { displayName: "Updated" });
    expect(saved.scheduleCron).toBe("0 */6 * * *");
    expect(legacy.writes).toBe(1);

    const replacement = new SettingsValidationD1(profileRow("0 */6 * * *"));
    await expect(
      upsertProfile(replacement as unknown as D1Database, "user-a", { scheduleCron: "every morning" }),
    ).rejects.toThrow("Daily schedule must use");
    expect(replacement.writes).toBe(0);
  });

  it("requires a Gateway key alias when BYOK mode is selected", async () => {
    const db = new SettingsValidationD1();
    await expect(upsertAiSettings(db as unknown as D1Database, "user-a", { mode: "byok", gatewayKeyRef: "  " })).rejects.toThrow(
      "BYOK mode requires an AI Gateway key alias",
    );
    expect(db.writes).toBe(0);
  });

  it("refuses to create agent runs for disabled users", async () => {
    const db = new SettingsValidationD1(null, "disabled");
    await expect(
      createAgentRunRequest(db as unknown as D1Database, { userId: "user-a", source: "schedule" }),
    ).rejects.toThrow("Active user required to create an agent run");
    expect(db.writes).toBe(0);
  });

  it("refuses to run a legacy BYOK configuration without a Gateway alias", async () => {
    const db = new SettingsValidationD1(null, "active", {
      user_id: "user-a",
      mode: "byok",
      gateway_key_ref: null,
      monthly_budget_cents: null,
      daily_budget_cents: null,
      status: "active",
      updated_at: "2026-07-01T12:00:00.000Z",
    });
    await expect(
      createAgentRunRequest(db as unknown as D1Database, { userId: "user-a", source: "schedule" }),
    ).rejects.toThrow("BYOK mode requires an AI Gateway key alias");
    expect(db.writes).toBe(0);
  });

  it("refuses to run before active AI settings are configured", async () => {
    const missing = new SettingsValidationD1();
    await expect(
      createAgentRunRequest(missing as unknown as D1Database, { userId: "user-a", source: "manual" }),
    ).rejects.toThrow("Active managed or BYOK AI settings are required before running");
    expect(missing.writes).toBe(0);

    const disabled = new SettingsValidationD1(null, "active", {
      user_id: "user-a",
      mode: "managed",
      gateway_key_ref: null,
      monthly_budget_cents: 1_000,
      daily_budget_cents: 100,
      status: "disabled",
      updated_at: "2026-07-01T12:00:00.000Z",
    });
    await expect(
      createAgentRunRequest(disabled as unknown as D1Database, { userId: "user-a", source: "manual" }),
    ).rejects.toThrow("Active managed or BYOK AI settings are required before running");
    expect(disabled.writes).toBe(0);
  });
});

function profileRow(scheduleCron: string): ProfileTestRow {
  return {
    user_id: "user-a",
    display_name: "User A",
    niche: "Beach cars and runabouts",
    budget_min: null,
    budget_max: 30000,
    stretch_budget: null,
    home_region: "Northeast",
    timezone: "America/New_York",
    schedule_cron: scheduleCron,
    profile_json: "{}",
    onboarding_completed_at: "2026-07-01T12:00:00.000Z",
    updated_at: "2026-07-01T12:00:00.000Z",
  };
}

interface ProfileTestRow {
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

class SettingsValidationD1 {
  writes = 0;

  constructor(
    public profile: ProfileTestRow | null = null,
    public userStatus = "active",
    public aiSettings: Record<string, unknown> | null = null,
  ) {}

  prepare(sql: string): SettingsValidationStatement {
    return new SettingsValidationStatement(this, sql);
  }
}

class SettingsValidationStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: SettingsValidationD1,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql === "SELECT * FROM profiles WHERE user_id = ?") return this.db.profile as T | null;
    if (this.sql === "SELECT * FROM user_ai_settings WHERE user_id = ?") return this.db.aiSettings as T | null;
    if (this.sql === "SELECT status FROM users WHERE id = ?") return { status: this.db.userStatus } as T;
    throw new Error(`Unexpected first() query: ${this.sql}`);
  }

  async run(): Promise<Record<string, unknown>> {
    if (this.sql.includes("INSERT INTO profiles")) {
      const [userId, displayName, niche, budgetMin, budgetMax, stretchBudget, homeRegion, timezone, scheduleCron, profileJson, onboardingCompletedAt, updatedAt] =
        this.values;
      this.db.profile = {
        user_id: String(userId),
        display_name: displayName === null ? null : String(displayName),
        niche: String(niche),
        budget_min: budgetMin === null ? null : Number(budgetMin),
        budget_max: budgetMax === null ? null : Number(budgetMax),
        stretch_budget: stretchBudget === null ? null : Number(stretchBudget),
        home_region: homeRegion === null ? null : String(homeRegion),
        timezone: String(timezone),
        schedule_cron: String(scheduleCron),
        profile_json: String(profileJson),
        onboarding_completed_at: onboardingCompletedAt === null ? null : String(onboardingCompletedAt),
        updated_at: String(updatedAt),
      };
      this.db.writes += 1;
      return { success: true };
    }
    this.db.writes += 1;
    return { success: true };
  }
}
