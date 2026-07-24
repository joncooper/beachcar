import type { AgentRunRecord } from "../shared/types";
import {
  beginNotificationDelivery,
  finishNotificationDelivery,
  getNotificationPreferences,
  getUserPayload,
  type NotificationDeliveryRecord,
} from "./db";

const readyEmailSender = "finds@dockett.ai";

export async function sendPublishedRunReadyEmail(env: Env, agentRun: AgentRunRecord): Promise<NotificationDeliveryRecord> {
  const preferences = await getNotificationPreferences(env.DB, agentRun.userId);
  if (!preferences.readyEmailEnabled) {
    return (
      await beginNotificationDelivery(env.DB, {
        userId: agentRun.userId,
        agentRunId: agentRun.id,
        kind: "shortlist_ready",
        status: "skipped",
      })
    ).delivery;
  }

  const claimed = await beginNotificationDelivery(env.DB, {
    userId: agentRun.userId,
    agentRunId: agentRun.id,
    kind: "shortlist_ready",
  });
  if (!claimed.created || claimed.delivery.status !== "sending") return claimed.delivery;

  try {
    if (!env.SHORTLIST_EMAIL) throw new Error("Shortlist email binding is not configured");
    const user = await getUserPayload(env.DB, agentRun.userId);
    const appUrl = (env.PUBLIC_APP_URL || "https://beachcar-watch.jon-cooper.workers.dev").replace(/\/+$/, "");
    const findsUrl = `${appUrl}/today?agentRunId=${encodeURIComponent(agentRun.id)}`;
    const preferencesUrl = `${appUrl}/preferences`;
    const greeting = user.displayName?.trim() ? `Hi ${user.displayName.trim()},` : "Hi,";
    const subject = "Your Beachcar shortlist is ready";
    const text = `${greeting}\n\nToday’s Beachcar research is ready.\n\nOpen today’s finds: ${findsUrl}\n\nBeachcar’s private beta research is included for you. No auction details are included in this email.\n\nNotification preferences: ${preferencesUrl}`;
    const html = `<!doctype html>
<html lang="en"><body style="margin:0;background:#0f1518;color:#f5f1e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    <p style="color:#71e3c2;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Beachcar</p>
    <h1 style="font-size:30px;line-height:1.1;margin:12px 0 20px">Your shortlist is ready.</h1>
    <p style="font-size:16px;line-height:1.6">${escapeHtml(greeting)}</p>
    <p style="font-size:16px;line-height:1.6">Today’s research is complete and ranked for your search and taste.</p>
    <p style="margin:28px 0"><a href="${escapeHtml(findsUrl)}" style="display:inline-block;background:#71e3c2;color:#10201d;text-decoration:none;font-weight:700;padding:14px 20px;border-radius:999px">Open today’s finds</a></p>
    <p style="color:#aeb9b4;font-size:13px;line-height:1.6">Research is included during the private beta. This email intentionally contains no auction or dossier details.</p>
    <p style="margin-top:28px"><a href="${escapeHtml(preferencesUrl)}" style="color:#aeb9b4;font-size:12px">Notification preferences</a></p>
  </div>
</body></html>`;
    const result = await env.SHORTLIST_EMAIL.send({
      to: user.email,
      from: { email: readyEmailSender, name: "Beachcar" },
      subject,
      html,
      text,
      headers: {
        "List-Unsubscribe": `<${preferencesUrl}>`,
      },
    });
    return finishNotificationDelivery(env.DB, claimed.delivery.id, {
      status: "sent",
      providerMessageId: result.messageId,
    });
  } catch (error) {
    return finishNotificationDelivery(env.DB, claimed.delivery.id, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}
