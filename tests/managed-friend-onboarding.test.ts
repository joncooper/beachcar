import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  beginNotificationDelivery,
  canConnectExternalAgent,
  createInvite,
  getAiUsageSummary,
  managedEntitlementDecision,
  normalizeManagedOnboarding,
  recordAiUsageEvent,
} from "../src/worker/db";

describe("managed friend onboarding", () => {
  it("normalizes a friend-facing setup and defaults ready email on", () => {
    const result = normalizeManagedOnboarding({
      search: {
        location: "  Portland, ME  ",
        pickupDistanceMiles: 500,
        comfortableCeiling: 30_000,
        stretchRoom: 2_000,
      },
      taste: {
        showMore: ["open-air", "simple"],
        avoid: ["rust"],
        notes: "  Keep it kid-plausible.  ",
      },
      timezone: "America/New_York",
      dailyTime: "08:00",
      readyEmailEnabled: undefined as unknown as boolean,
    });

    expect(result).toMatchObject({
      search: { location: "Portland, ME", pickupDistanceMiles: 500, comfortableCeiling: 30_000, stretchRoom: 2_000 },
      taste: { showMore: ["open-air", "simple"], avoid: ["rust"], notes: "Keep it kid-plausible." },
      timezone: "America/New_York",
      dailyTime: "08:00",
      readyEmailEnabled: true,
    });
  });

  it("rejects incomplete or unsafe setup values before writing", () => {
    const valid = {
      search: { location: "Portland, ME", pickupDistanceMiles: 500, comfortableCeiling: 30_000, stretchRoom: 2_000 },
      taste: { showMore: [], avoid: [], notes: null },
      timezone: "America/New_York",
      dailyTime: "08:00",
      readyEmailEnabled: true,
    };
    expect(() => normalizeManagedOnboarding({ ...valid, search: { ...valid.search, location: " " } })).toThrow("Enter a city");
    expect(() => normalizeManagedOnboarding({ ...valid, search: { ...valid.search, pickupDistanceMiles: 50_000 } })).toThrow("Pickup distance");
    expect(() => normalizeManagedOnboarding({ ...valid, dailyTime: "every morning" })).toThrow();
  });

  it("reuses an unexpired normalized-email invitation", async () => {
    const db = new InviteD1({
      id: "invite-existing",
      email: "friend@example.com",
      accepted_by_user_id: null,
      expires_at: "2099-01-01T00:00:00.000Z",
      created_at: "2026-07-15T12:00:00.000Z",
      accepted_at: null,
      acceptance: "verified_email",
      access_mode: "managed_pilot",
      managed_research: 1,
      display_name: "Friend",
    });
    const invite = await createInvite(db as unknown as D1Database, {
      email: "  FRIEND@Example.com ",
      displayName: "Friend",
      acceptance: "verified_email",
      managedResearch: true,
    });

    expect(db.boundEmail).toBe("friend@example.com");
    expect(db.writes).toBe(0);
    expect(invite).toMatchObject({ id: "invite-existing", alreadyExisted: true, accessMode: "managed_pilot" });
    expect(invite.code).toBeUndefined();
  });

  it("never overwrites an invite-funded entitlement just because a later Clerk session has no paid feature", () => {
    expect(
      managedEntitlementDecision({
        clerkEntitled: false,
        pilotEntitled: false,
        provider: "clerk",
        existingSource: "pilot_allowlist",
        clerkPlanSlug: null,
      }),
    ).toBeNull();
    expect(
      managedEntitlementDecision({
        clerkEntitled: false,
        pilotEntitled: false,
        provider: "clerk",
        existingSource: "clerk_session",
        clerkPlanSlug: null,
      }),
    ).toMatchObject({ active: false, source: "clerk_session" });
  });

  it("keeps local Codex available to every active user, including managed-pilot accounts", () => {
    expect(canConnectExternalAgent("active")).toBe(true);
    expect(canConnectExternalAgent("invited")).toBe(false);
    expect(canConnectExternalAgent("disabled")).toBe(false);
  });

  it("attributes runner usage to the stored run owner, never the submitted user", async () => {
    const db = new UsageD1("email:actual-friend@example.com");
    const event = await recordAiUsageEvent(db as unknown as D1Database, {
      userId: "email:spoofed@example.com",
      agentRunId: "agent-run-friend",
      provider: "openai",
      providerRequestId: "provider-request-123",
      operation: "rank_shortlist",
      inputTokens: 120,
      outputTokens: 30,
      costMicros: 420,
    });

    expect(event).toMatchObject({
      userId: "email:actual-friend@example.com",
      agentRunId: "agent-run-friend",
      providerRequestId: "provider-request-123",
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      costMicros: 420,
    });
  });

  it("rejects managed usage that cannot be attributed to a run and provider request", async () => {
    const db = new UsageD1("email:actual-friend@example.com");
    await expect(
      recordAiUsageEvent(db as unknown as D1Database, {
        userId: "email:spoofed@example.com",
        mode: "managed",
        provider: "openai",
        operation: "rank_shortlist",
        costMicros: 0,
      }),
    ).rejects.toThrow("agent run id");
    await expect(
      recordAiUsageEvent(db as unknown as D1Database, {
        userId: "email:spoofed@example.com",
        agentRunId: "agent-run-friend",
        mode: "managed",
        provider: "openai",
        operation: "rank_shortlist",
        costMicros: 0,
      }),
    ).rejects.toThrow("provider request id");
  });

  it("claims one ready-email delivery per user and published run", async () => {
    const db = new NotificationD1();
    const input = { userId: "email:friend@example.com", agentRunId: "agent-run-one", kind: "shortlist_ready" as const };
    const first = await beginNotificationDelivery(db as unknown as D1Database, input);
    const second = await beginNotificationDelivery(db as unknown as D1Database, input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.delivery.id).toBe(first.delivery.id);
  });

  it("aggregates daily and monthly input, output, total tokens, calls, and cost", async () => {
    const summary = await getAiUsageSummary(new UsageSummaryD1() as unknown as D1Database, "email:friend@example.com", new Date("2026-07-15T16:00:00.000Z"));
    expect(summary.daily).toMatchObject({ inputTokens: 100, outputTokens: 25, totalTokens: 125, eventCount: 2, spendMicros: 300 });
    expect(summary.monthly).toMatchObject({ inputTokens: 900, outputTokens: 225, totalTokens: 1_125, eventCount: 15, spendMicros: 2_700 });
  });

  it("hands new friends to local Codex instead of starting managed research", () => {
    const swift = readFileSync("ios/BeachcarApp/RootView.swift", "utf8");
    const web = readFileSync("src/client/App.tsx", "utf8");
    expect(swift).toContain("Continue on desktop");
    expect(swift).toContain("DesktopCodexHandoffView");
    expect(swift).toContain("completeExternalOnboarding");
    expect(web).toContain("function DesktopCodexCoach");
    expect(web).toContain('bearer_token_env_var = "BEACHCAR_MCP_TOKEN"');
    expect(web).toContain('["setup:read", "setup:write", "sources:read", "runs:publish", "events:read"]');
    expect(web).toContain("Your computer and Codex automation must be awake");
    expect(web).toContain("desktopCodexSetupPending");
  });
});

class InviteD1 {
  writes = 0;
  boundEmail = "";

  constructor(private readonly existing: Record<string, unknown> | null) {}

  prepare(sql: string) {
    let values: unknown[] = [];
    return {
      bind: (...bound: unknown[]) => {
        values = bound;
        if (sql.includes("FROM invites")) this.boundEmail = String(values[0]);
        return this.prepareBound(sql, values);
      },
      first: async <T>() => this.existing as T | null,
      run: async () => {
        this.writes += 1;
        return { meta: { changes: 1 } };
      },
    };
  }

  private prepareBound(sql: string, _values: unknown[]) {
    return {
      first: async <T>() => (sql.includes("FROM invites") ? (this.existing as T | null) : null),
      run: async () => {
        this.writes += 1;
        return { meta: { changes: 1 } };
      },
    };
  }
}

class UsageD1 {
  private row: Record<string, unknown> | null = null;

  constructor(private readonly runOwner: string) {}

  prepare(sql: string) {
    let values: unknown[] = [];
    const statement = {
      bind: (...bound: unknown[]) => {
        values = bound;
        return statement;
      },
      first: async <T>() => {
        if (sql.includes("SELECT user_id FROM agent_runs")) return { user_id: this.runOwner } as T;
        if (sql.includes("SELECT * FROM ai_usage_events")) return this.row as T | null;
        return null;
      },
      run: async () => {
        if (sql.includes("INSERT INTO ai_usage_events")) {
          this.row = {
            id: values[0], user_id: values[1], agent_run_id: values[2], provider: values[3], model: values[4],
            operation: values[5], mode: values[6], gateway_id: values[7], gateway_key_ref: values[8], gateway_request_id: values[9],
            provider_request_id: values[10], input_tokens: values[11], output_tokens: values[12], total_tokens: values[13],
            cost_micros: values[14], status: values[15], metadata_json: values[16], occurred_at: values[17], created_at: values[17],
          };
        }
        return { meta: { changes: 1 } };
      },
    };
    return statement;
  }
}

class NotificationD1 {
  private row: Record<string, unknown> | null = null;

  prepare(sql: string) {
    let values: unknown[] = [];
    const statement = {
      bind: (...bound: unknown[]) => {
        values = bound;
        return statement;
      },
      run: async () => {
        if (!sql.includes("INSERT INTO notification_deliveries")) return { meta: { changes: 0 } };
        if (this.row) return { meta: { changes: 0 } };
        this.row = {
          id: values[0], user_id: values[1], agent_run_id: values[2], kind: values[3], status: values[4],
          provider_message_id: null, error: null, attempted_at: values[5], delivered_at: null, created_at: values[6], updated_at: values[7],
        };
        return { meta: { changes: 1 } };
      },
      first: async <T>() => this.row as T | null,
    };
    return statement;
  }
}

class UsageSummaryD1 {
  private aggregateReads = 0;

  prepare(sql: string) {
    const statement = {
      bind: (..._bound: unknown[]) => statement,
      first: async <T>() => {
        if (sql === "SELECT * FROM user_ai_settings WHERE user_id = ?") {
          return {
            user_id: "email:friend@example.com", mode: "managed", gateway_key_ref: null,
            monthly_budget_cents: 500, daily_budget_cents: 50, status: "active", updated_at: "2026-07-15T00:00:00.000Z",
          } as T;
        }
        if (sql.includes("SUM(input_tokens)")) {
          this.aggregateReads += 1;
          return (this.aggregateReads === 1
            ? { spend: 300, input_tokens: 100, output_tokens: 25, total_tokens: 125, event_count: 2 }
            : { spend: 2_700, input_tokens: 900, output_tokens: 225, total_tokens: 1_125, event_count: 15 }) as T;
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    };
    return statement;
  }
}
