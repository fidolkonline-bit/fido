import "server-only";
import { after } from "next/server";
import { Prisma } from "@prisma/client";
import { db, type Tx } from "./db";
import { enqueueSms, kickSms } from "./sms";
import { fireReminders } from "./essentials";
import { liveSubscriptions, pushConfigured, pushError, PushNotReady, pushPaused, sendPush, type PushPayload } from "./push";
import type { CurrentUser } from "./auth";

// Shared durable task foundation for bus parcels and reloads (spec §13). The server acknowledgement is authoritative.
export const ESCALATE_AFTER_MIN = 5;

export async function createTask(tx: Tx, data: { kind: string; title: string; details?: string | null; locationId: string; assignedToId: string | null; priority?: string; dueAt?: Date | null; reloadRequestId?: string; parcelId?: string; createdById: string }) {
  const task = await tx.staffTask.create({ data: { priority: "NORMAL", ...data } });
  await tx.taskEvent.create({ data: { taskId: task.id, kind: "CREATED", actorId: data.createdById } });
  kickTaskPush(); // runs after the response, so after this transaction has committed (or found nothing if it rolled back)
  return task;
}

export async function acknowledgeTask(user: CurrentUser, taskId: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "StaffTask" WHERE id = ${taskId} FOR UPDATE`;
    const t = await tx.staffTask.findUniqueOrThrow({ where: { id: taskId } });
    if (t.status !== "PENDING") return t; // a second tap or a second device: no duplicate effect
    const updated = await tx.staffTask.update({ where: { id: taskId }, data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), assignedToId: t.assignedToId ?? user.personId } });
    await tx.taskEvent.create({ data: { taskId, kind: "ACKNOWLEDGED", actorId: user.personId } });
    if (t.reloadRequestId) await tx.reloadRequest.updateMany({ where: { id: t.reloadRequestId, status: "REQUESTED" }, data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date() } });
    if (t.parcelId) await tx.busParcel.updateMany({ where: { id: t.parcelId, status: "DISPATCHED" }, data: { status: "ACKNOWLEDGED" } });
    return updated;
  });
}

export async function completeTask(tx: Tx, taskId: string, actorId: string, note?: string) {
  const t = await tx.staffTask.findUniqueOrThrow({ where: { id: taskId } });
  if (t.status === "DONE" || t.status === "CANCELLED") return;
  await tx.staffTask.update({ where: { id: taskId }, data: { status: "DONE", completedAt: new Date(), acknowledgedAt: t.acknowledgedAt ?? new Date() } });
  await tx.taskEvent.create({ data: { taskId, kind: "COMPLETED", actorId, note } });
}

// Escalate tasks nobody acknowledged in time: mark once, tell managers in-app, and send an SMS fallback to the assignee.
export async function escalateOverdue() {
  const cutoff = new Date(Date.now() - ESCALATE_AFTER_MIN * 60_000);
  const overdue = await db.staffTask.findMany({
    where: { status: "PENDING", escalatedAt: null, OR: [{ createdAt: { lt: cutoff }, dueAt: null }, { dueAt: { lt: new Date() } }] },
    include: { assignedTo: true },
    take: 50,
  });
  let sms = false;
  for (const t of overdue) {
    const claimed = await db.staffTask.updateMany({ where: { id: t.id, escalatedAt: null }, data: { escalatedAt: new Date() } });
    if (!claimed.count) continue;
    await db.taskEvent.create({ data: { taskId: t.id, kind: "ESCALATED", note: `Not acknowledged after ${ESCALATE_AFTER_MIN} min` } });
    if (await enqueueSms("TASK_ESCALATION", { to: t.assignedTo?.phone, vars: { task: t.title }, sourceType: "StaffTask", sourceId: t.id })) {
      await db.taskEvent.create({ data: { taskId: t.id, kind: "SMS_FALLBACK", note: "SMS queued to assignee" } });
      sms = true;
    }
  }
  if (sms) kickSms();
  if (overdue.length) kickTaskPush();
  return overdue.length;
}

export type Alert = { id: string; kind: string; title: string; details: string | null; priority: string; status: string; createdAt: string; dueAt: string | null; escalated: boolean; href: string; reason: "NEW" | "DUE_SOON" | "ESCALATED" };

const hrefOf = (t: { id: string; reloadRequestId: string | null; parcelId: string | null }) =>
  t.reloadRequestId ? `/reloads/${t.reloadRequestId}` : t.parcelId ? `/tasks/parcels/${t.parcelId}` : `/tasks`;

// What should ring on this user's device right now.
export async function alertsFor(user: CurrentUser): Promise<Alert[]> {
  // Devices poll every 15 s, so reminders, escalations and phone pushes also run when the server cron is unavailable.
  await fireReminders();
  await escalateOverdue();
  kickTaskPush({ throttle: true });
  const soon = new Date(Date.now() + 15 * 60_000);
  const locationIds = user.locations.map((l) => l.id);
  const mine = { OR: [{ assignedToId: user.personId }, { assignedToId: null, locationId: { in: locationIds } }] };
  const [fresh, dueSoon, escalated] = await Promise.all([
    db.staffTask.findMany({ where: { status: "PENDING", ...mine }, orderBy: { createdAt: "asc" }, take: 20 }),
    db.staffTask.findMany({ where: { status: "ACKNOWLEDGED", dueAt: { lte: soon }, ...mine }, take: 20 }),
    user.permissions.has("tasks.manage")
      ? db.staffTask.findMany({ where: { status: "PENDING", escalatedAt: { not: null }, locationId: { in: locationIds }, NOT: { assignedToId: user.personId } }, include: { assignedTo: true }, take: 20 })
      : Promise.resolve([]),
  ]);
  const shape = (t: (typeof fresh)[number], reason: Alert["reason"], extra = ""): Alert => ({
    id: t.id, kind: t.kind, title: t.title + extra, details: t.details, priority: t.priority, status: t.status,
    createdAt: t.createdAt.toISOString(), dueAt: t.dueAt?.toISOString() ?? null, escalated: !!t.escalatedAt, href: hrefOf(t), reason,
  });
  return [
    ...fresh.map((t) => shape(t, "NEW")),
    ...dueSoon.map((t) => shape(t, "DUE_SOON")),
    ...escalated.map((t) => shape(t, "ESCALATED", ` — not acknowledged by ${t.assignedTo?.fullName ?? "anyone"}`)),
  ];
}

// ───── Phone push (Web Push) ─────
// Each alert is claimed once in TaskPush, then sent to the devices of the same people alertsFor would ring.

const NOUN: Record<string, string> = { BUS_PARCEL: "Bus parcel", RELOAD: "Reload request", GENERAL: "Task" };
const PUSH_WINDOW_MS = 60 * 60_000; // older alerts are left to the in-app list
const anyShop = (locationId: string): Prisma.LoginAccountWhereInput[] => [
  { locations: { some: { locationId } } },
  { role: { permissions: { has: "settings.manage" } } }, // owners see every shop
];
type TaskRow = { id: string; kind: string; title: string; details: string | null; priority: string; dueAt: Date | null; locationId: string; assignedToId: string | null; reloadRequestId: string | null; parcelId: string | null };
const crewOf = (t: TaskRow): Prisma.LoginAccountWhereInput => (t.assignedToId ? { personId: t.assignedToId } : { OR: anyShop(t.locationId) });
const managersOf = (t: TaskRow): Prisma.LoginAccountWhereInput => ({
  role: { permissions: { has: "tasks.manage" } }, OR: anyShop(t.locationId), ...(t.assignedToId ? { NOT: { personId: t.assignedToId } } : {}),
});
const clock = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit" });

type Send = { to: Prisma.LoginAccountWhereInput; payload: PushPayload };

export async function dispatchTaskPushes() {
  if (!pushConfigured() || pushPaused()) return 0;
  const now = Date.now();
  const since = new Date(now - PUSH_WINDOW_MS);
  let delivered = 0;
  try {
    const [fresh, overdue, dueSoon] = await Promise.all([
      db.staffTask.findMany({ where: { status: "PENDING", createdAt: { gt: since }, pushes: { none: { reason: "NEW" } } }, orderBy: { createdAt: "asc" }, take: 25 }),
      db.staffTask.findMany({ where: { status: "PENDING", escalatedAt: { gt: since }, pushes: { none: { reason: "ESCALATED" } } }, include: { assignedTo: true }, take: 25 }),
      db.staffTask.findMany({ where: { status: "ACKNOWLEDGED", dueAt: { gt: new Date(now), lte: new Date(now + 15 * 60_000) }, pushes: { none: { reason: "DUE_SOON" } } }, take: 25 }),
    ]);
    const base = (t: TaskRow) => ({ url: hrefOf(t), tag: t.id });
    const jobs: { t: TaskRow; reason: string; sends: Send[] }[] = [
      ...fresh.map((t) => ({
        t, reason: "NEW",
        sends: [{ to: crewOf(t), payload: { ...base(t), title: `${NOUN[t.kind] ?? "Task"}${t.priority === "URGENT" ? " · urgent" : ""}`, body: [t.title, t.details?.slice(0, 140)].filter(Boolean).join("\n"), urgent: t.priority === "URGENT" } }],
      })),
      ...overdue.map((t) => ({
        t, reason: "ESCALATED",
        sends: t.assignedToId
          ? [
              { to: crewOf(t), payload: { ...base(t), title: "Overdue · please acknowledge", body: t.title, urgent: true } },
              { to: managersOf(t), payload: { ...base(t), title: "Task not acknowledged", body: `${t.title}\n${t.assignedTo?.fullName ?? "The assignee"} has not acknowledged it.`, urgent: true } },
            ]
          : [{ to: crewOf(t), payload: { ...base(t), title: "Overdue · nobody acknowledged", body: t.title, urgent: true } }],
      })),
      ...dueSoon.map((t) => ({
        t, reason: "DUE_SOON",
        sends: [{ to: crewOf(t), payload: { ...base(t), title: `Due ${clock(t.dueAt!)}`, body: t.title } }],
      })),
    ];
    for (const job of jobs) {
      // The unique (taskId, reason) row is the claim: a second server or a retried sweep skips it.
      const claim = await db.taskPush.create({ data: { taskId: job.t.id, reason: job.reason } }).catch((e: unknown) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
        throw e;
      });
      if (!claim) continue;
      let devices = 0, ok = 0;
      for (const s of job.sends) {
        const r = await sendPush(await liveSubscriptions(s.to), s.payload);
        devices += r.devices;
        ok += r.delivered;
      }
      await db.taskPush.update({ where: { id: claim.id }, data: { devices, delivered: ok } });
      delivered += ok;
    }
  } catch (e) {
    if (!(pushError(e) instanceof PushNotReady)) console.error("Task push sweep failed", e);
  }
  return delivered;
}

// Fire-and-forget after the response. Polls pass throttle so 20 open devices do not sweep every few seconds.
let lastSweep = 0;
export function kickTaskPush(opts: { throttle?: boolean } = {}) {
  if (!pushConfigured() || pushPaused()) return;
  if (opts.throttle && Date.now() - lastSweep < 30_000) return;
  lastSweep = Date.now();
  const run = () => dispatchTaskPushes().then(() => undefined, () => undefined);
  try {
    after(run);
  } catch {
    void run(); // outside a request (scripts): send now
  }
}
