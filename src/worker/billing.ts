import { createClerkClient } from "@clerk/backend";
import { verifyWebhook } from "@clerk/backend/webhooks";
import {
  findUserIdByAuthSubject,
  managedResearchFeature,
  upsertBillingEntitlement,
} from "./db";
import { errorResponse, jsonResponse } from "./http";

const billingEventPrefix = /^(subscription|subscriptionItem|paymentAttempt)\./;

export async function handleClerkBillingWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);
  const signingSecret = env.CLERK_WEBHOOK_SIGNING_SECRET?.trim();
  if (!signingSecret) return errorResponse("Clerk billing webhook is not configured", 503);

  let event: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    event = await verifyWebhook(request, { signingSecret });
  } catch {
    return errorResponse("Webhook verification failed", 400);
  }

  if (!billingEventPrefix.test(event.type)) return jsonResponse({ ok: true, ignored: true, type: event.type });
  const clerkUserId = clerkBillingUserId(event.data);
  if (!clerkUserId) return jsonResponse({ ok: true, ignored: true, type: event.type, reason: "not_user_billing" });

  const userId = await findUserIdByAuthSubject(env.DB, "clerk", clerkUserId);
  if (!userId) return jsonResponse({ ok: true, ignored: true, type: event.type, reason: "user_not_initialized" });
  if (!env.CLERK_SECRET_KEY) return errorResponse("Clerk secret key is not configured", 503);

  try {
    const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
    const subscription = await clerk.billing.getUserBillingSubscription(clerkUserId);
    const item = subscription.subscriptionItems.find(
      (candidate) =>
        candidate.status === "active" &&
        candidate.plan?.features.some((feature) => feature.slug === managedResearchFeature),
    );
    const entitlement = await upsertBillingEntitlement(env.DB, userId, {
      feature: managedResearchFeature,
      active: Boolean(item),
      source: "clerk_webhook",
      planSlug: item?.plan?.slug || null,
      expiresAt: item?.periodEnd ? new Date(item.periodEnd).toISOString() : null,
    });
    return jsonResponse({ ok: true, type: event.type, userId, entitlement });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        message: error instanceof Error ? error.message : String(error),
        operation: "clerk.billing_entitlement_sync",
        clerkUserId,
        userId,
        eventType: event.type,
      }),
    );
    return errorResponse("Could not synchronize Clerk billing entitlement", 502);
  }
}

function clerkBillingUserId(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const payer = record.payer && typeof record.payer === "object" && !Array.isArray(record.payer)
    ? (record.payer as Record<string, unknown>)
    : {};
  for (const value of [payer.user_id, payer.userId, record.user_id, record.userId, record.payer_id, record.payerId]) {
    if (typeof value === "string" && value.startsWith("user_")) return value;
  }
  return null;
}
