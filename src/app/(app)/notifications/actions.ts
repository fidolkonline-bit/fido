"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { dispatchSms, smsConfigured, SMS_EVENTS, type SmsEvent } from "@/lib/sms";
import { str, type FormState } from "@/lib/forms";

export async function sendQueued(): Promise<FormState> {
  await requirePermission("notifications.manage");
  if (!smsConfigured()) return { error: "Text.lk is not set up yet: add TEXTLK_API_TOKEN and TEXTLK_SENDER_ID to the server settings." };
  // Messages that waited while SMS was not configured go out now.
  await db.notificationIntent.updateMany({ where: { status: "NOT_CONFIGURED" }, data: { status: "QUEUED" } });
  const r = await dispatchSms(100);
  revalidatePath("/notifications");
  return { ok: `${r.sent} sent, ${r.failed} failed.` };
}

// Controlled resend: FAILED may be retried; UNKNOWN only after someone confirms it did not arrive (spec §18).
export async function resend(f: FormData) {
  const user = await requirePermission("notifications.manage");
  const id = String(f.get("id"));
  const m = await db.notificationIntent.findUniqueOrThrow({ where: { id } });
  if (!["FAILED", "UNKNOWN", "NOT_CONFIGURED"].includes(m.status)) return;
  if (m.status === "UNKNOWN" && f.get("confirm") !== "yes") return;
  await db.notificationIntent.update({ where: { id }, data: { status: "QUEUED", lastError: null } });
  await db.auditEvent.create({ data: { actorId: user.personId, action: "SMS_RESEND", subjectType: "NotificationIntent", subjectId: id, detail: { previous: m.status } } });
  await dispatchSms(5);
  revalidatePath("/notifications");
}

export async function cancelSms(f: FormData) {
  await requirePermission("notifications.manage");
  await db.notificationIntent.updateMany({ where: { id: String(f.get("id")), status: { in: ["QUEUED", "NOT_CONFIGURED", "FAILED", "UNKNOWN"] } }, data: { status: "CANCELLED" } });
  revalidatePath("/notifications");
}

export async function saveTemplate(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("notifications.manage");
  const event = str(f, "event") as SmsEvent | null;
  const body = str(f, "body");
  if (!event || !(event in SMS_EVENTS)) return { error: "Unknown message type." };
  if (!body || body.length > 480) return { error: "Message must be 1–480 characters." };
  if (/pin|pattern|password/i.test(body) && /\{/.test(body) && event.startsWith("REPAIR")) return { error: "Repair messages must never include unlock codes." };
  await db.notificationTemplate.upsert({ where: { event }, create: { event, body, active: f.get("active") === "on" }, update: { body, active: f.get("active") === "on" } });
  await db.auditEvent.create({ data: { actorId: user.personId, action: "SMS_TEMPLATE_SAVED", subjectType: "NotificationTemplate", subjectId: event } });
  revalidatePath("/notifications");
  return { ok: "Saved." };
}
