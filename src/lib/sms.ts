import "server-only";
import { after } from "next/server";
import { db } from "./db";

// SMS outbox with a Text.lk adapter (spec §18). Intents are created only after the business event has committed,
// keyed so a retried request never queues the same message twice; sending never rolls back the sale/repair.

export const SMS_EVENTS = {
  SALE_RECEIPT: { label: "Sale receipt", vars: ["shop", "invoice", "total", "paid", "due"], body: "{shop}: Thank you! Invoice {invoice} Rs.{total}. Paid Rs.{paid}{due}." },
  REPAIR_RECEIVED: { label: "Repair received", vars: ["shop", "job", "device", "promised"], body: "{shop}: We received your {device} for repair. Job {job}. Expected: {promised}. Keep this SMS to collect." },
  REPAIR_ESTIMATE: { label: "Repair estimate", vars: ["shop", "job", "device", "estimate"], body: "{shop}: Repair estimate for {device} (job {job}) is Rs.{estimate}. Please call us to approve." },
  REPAIR_READY: { label: "Repair ready", vars: ["shop", "job", "device", "due"], body: "{shop}: Your {device} (job {job}) is ready to collect.{due}" },
  RELOAD_DONE: { label: "Reload completed", vars: ["shop", "mobile", "amount", "ref"], body: "{shop}: Reload Rs.{amount} to {mobile} successful. Ref {ref}." },
  TASK_ESCALATION: { label: "Staff task overdue (to staff)", vars: ["shop", "task"], body: "{shop} URGENT: {task} has not been acknowledged. Please open the Fido app now." },
} as const;
export type SmsEvent = keyof typeof SMS_EVENTS;

export const smsConfigured = () => !!process.env.TEXTLK_API_TOKEN && !!process.env.TEXTLK_SENDER_ID;

// Sri Lankan mobiles: 07XXXXXXXX / +947XXXXXXXX / 947XXXXXXXX → 947XXXXXXXX. Anything else is rejected.
export function normalizeMobile(raw: string | null | undefined) {
  const d = (raw ?? "").replace(/[^\d]/g, "");
  if (/^07\d{8}$/.test(d)) return "94" + d.slice(1);
  if (/^947\d{8}$/.test(d)) return d;
  if (/^7\d{8}$/.test(d)) return "94" + d;
  return null;
}

const render = (body: string, vars: Record<string, string>) => body.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

export async function templateBody(event: SmsEvent) {
  const t = await db.notificationTemplate.findUnique({ where: { event } });
  return { body: t?.body ?? SMS_EVENTS[event].body, active: t?.active ?? true };
}

// Queue one SMS for a committed event. Returns false when skipped (no valid mobile, template off, duplicate).
export async function enqueueSms(event: SmsEvent, opts: { to: string | null | undefined; vars: Record<string, string>; sourceType: string; sourceId: string; key?: string }) {
  const recipient = normalizeMobile(opts.to);
  if (!recipient) return false;
  const { body, active } = await templateBody(event);
  if (!active) return false;
  const shop = (await db.business.findFirst({ select: { name: true } }))?.name ?? "Shop";
  const text = render(body, { shop, ...opts.vars }).slice(0, 480);
  const uniqueKey = `${event}:${opts.sourceId}:${recipient}${opts.key ? `:${opts.key}` : ""}`;
  if (await db.notificationIntent.findUnique({ where: { uniqueKey }, select: { id: true } })) return false;
  try {
    await db.notificationIntent.create({ data: { uniqueKey, event, recipient, body: text, sourceType: opts.sourceType, sourceId: opts.sourceId } });
    return true;
  } catch {
    return false; // lost a race with an identical request: already queued
  }
}

// Send queued messages. Rows are claimed atomically, so two workers never send the same SMS.
export async function dispatchSms(limit = 20) {
  if (!smsConfigured()) {
    await db.notificationIntent.updateMany({ where: { status: "QUEUED" }, data: { status: "NOT_CONFIGURED", lastError: "Text.lk token / sender ID not set" } });
    return { sent: 0, failed: 0, configured: false };
  }
  const claimed = await db.$queryRaw<{ id: string; recipient: string; body: string }[]>`
    UPDATE "NotificationIntent" SET status = 'SENDING', attempts = attempts + 1
    WHERE id IN (SELECT id FROM "NotificationIntent" WHERE status = 'QUEUED' ORDER BY "createdAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING id, recipient, body`;
  let sent = 0, failed = 0;
  for (const m of claimed) {
    try {
      const res = await fetch("https://app.text.lk/api/v3/sms/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.TEXTLK_API_TOKEN}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ recipient: m.recipient, sender_id: process.env.TEXTLK_SENDER_ID, type: "plain", message: m.body }),
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await res.json().catch(() => null)) as { status?: unknown; message?: string; data?: { uid?: string; sms_id?: string } } | null;
      const ok = res.ok && (json?.status === "success" || json?.status === true);
      if (ok) {
        sent++;
        await db.notificationIntent.update({ where: { id: m.id }, data: { status: "SUBMITTED", sentAt: new Date(), providerId: json?.data?.uid ?? json?.data?.sms_id ?? null, lastError: null } });
      } else {
        failed++;
        await db.notificationIntent.update({ where: { id: m.id }, data: { status: "FAILED", lastError: (json?.message ?? `HTTP ${res.status}`).slice(0, 300) } });
      }
    } catch (e) {
      // Timeout / network: the provider may or may not have sent it. Never auto-resend (spec §18).
      await db.notificationIntent.update({ where: { id: m.id }, data: { status: "UNKNOWN", lastError: (e as Error).message.slice(0, 300) } });
    }
  }
  return { sent, failed, configured: true };
}

// Send after the response is returned (kept alive on serverless); errors are recorded on the intent, never shown as a failed sale.
export function kickSms() {
  after(() => dispatchSms().then(() => undefined, () => undefined));
}
