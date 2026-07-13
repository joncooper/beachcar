import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUserIdByAuthSubject: vi.fn(),
  getUserBillingSubscription: vi.fn(),
  upsertBillingEntitlement: vi.fn(),
  verifyWebhook: vi.fn(),
}));

vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({
    billing: { getUserBillingSubscription: mocks.getUserBillingSubscription },
  }),
}));

vi.mock("@clerk/backend/webhooks", () => ({ verifyWebhook: mocks.verifyWebhook }));

vi.mock("../src/worker/db", () => ({
  findUserIdByAuthSubject: mocks.findUserIdByAuthSubject,
  managedResearchFeature: "managed_research",
  upsertBillingEntitlement: mocks.upsertBillingEntitlement,
}));

import { handleClerkBillingWebhook } from "../src/worker/billing";

describe("Clerk billing webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUserIdByAuthSubject.mockResolvedValue("email:friend@example.com");
    mocks.upsertBillingEntitlement.mockImplementation(async (_db, userId, input) => ({ userId, ...input }));
  });

  it("rejects requests that fail Clerk signature verification", async () => {
    mocks.verifyWebhook.mockRejectedValue(new Error("bad signature"));

    const response = await handleClerkBillingWebhook(webhookRequest(), webhookEnv());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Webhook verification failed" });
    expect(mocks.findUserIdByAuthSubject).not.toHaveBeenCalled();
  });

  it("ignores non-billing Clerk events after verification", async () => {
    mocks.verifyWebhook.mockResolvedValue({ type: "user.updated", data: { id: "user_friend" } });

    const response = await handleClerkBillingWebhook(webhookRequest(), webhookEnv());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, ignored: true, type: "user.updated" });
    expect(mocks.getUserBillingSubscription).not.toHaveBeenCalled();
  });

  it("activates managed research only when an active Clerk plan carries the feature", async () => {
    mocks.verifyWebhook.mockResolvedValue(billingEvent("subscription.active"));
    mocks.getUserBillingSubscription.mockResolvedValue({
      subscriptionItems: [
        {
          status: "active",
          periodEnd: Date.parse("2026-08-13T12:00:00.000Z"),
          plan: { slug: "managed-research", features: [{ slug: "managed_research" }] },
        },
      ],
    });

    const response = await handleClerkBillingWebhook(webhookRequest(), webhookEnv());

    expect(response.status).toBe(200);
    expect(mocks.findUserIdByAuthSubject).toHaveBeenCalledWith(expect.anything(), "clerk", "user_friend");
    expect(mocks.upsertBillingEntitlement).toHaveBeenCalledWith(expect.anything(), "email:friend@example.com", {
      feature: "managed_research",
      active: true,
      source: "clerk_webhook",
      planSlug: "managed-research",
      expiresAt: "2026-08-13T12:00:00.000Z",
    });
  });

  it("revokes the entitlement when no active item carries the managed feature", async () => {
    mocks.verifyWebhook.mockResolvedValue(billingEvent("subscriptionItem.canceled"));
    mocks.getUserBillingSubscription.mockResolvedValue({
      subscriptionItems: [
        {
          status: "canceled",
          periodEnd: Date.parse("2026-08-13T12:00:00.000Z"),
          plan: { slug: "managed-research", features: [{ slug: "managed_research" }] },
        },
      ],
    });

    const response = await handleClerkBillingWebhook(webhookRequest(), webhookEnv());

    expect(response.status).toBe(200);
    expect(mocks.upsertBillingEntitlement).toHaveBeenCalledWith(expect.anything(), "email:friend@example.com", {
      feature: "managed_research",
      active: false,
      source: "clerk_webhook",
      planSlug: null,
      expiresAt: null,
    });
  });
});

function webhookRequest(): Request {
  return new Request("https://beachcar.example/api/webhooks/clerk", { method: "POST", body: "{}" });
}

function webhookEnv(): Env {
  return {
    DB: {} as D1Database,
    CLERK_SECRET_KEY: "sk_test_example",
    CLERK_WEBHOOK_SIGNING_SECRET: "whsec_example",
  } as Env;
}

function billingEvent(type: string): Record<string, unknown> {
  return {
    type,
    data: {
      payer: { user_id: "user_friend" },
    },
  };
}
