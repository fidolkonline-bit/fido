import "server-only";
import { db, type Tx } from "./db";
import { enqueueSms, kickSms } from "./sms";
import type { CurrentUser } from "./auth";

// Shared durable task foundation for bus parcels and reloads (spec §13). The server acknowledgement is authoritative.
export const ESCALATE_AFTER_MIN = 5;

export async function createTask(tx: Tx, data: { kind: string; title: string; details?: string | null; locationId: string; assignedToId: string | null; priority?: string; dueAt?: Date | null; reloadRequestId?: string; parcelId?: string; createdById: string }) {
  const task = await tx.staffTask.create({ data: { priority: "NORMAL", ...data } });
  await tx.taskEvent.create({ data: { taskId: task.id, kind: "CREATED", actorId: data.createdById } });
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
  return overdue.length;
}

export type Alert = { id: string; kind: string; title: string; details: string | null; priority: string; status: string; createdAt: string; dueAt: string | null; escalated: boolean; href: string; reason: "NEW" | "DUE_SOON" | "ESCALATED" };

const hrefOf = (t: { id: string; reloadRequestId: string | null; parcelId: string | null }) =>
  t.reloadRequestId ? `/reloads/${t.reloadRequestId}` : t.parcelId ? `/tasks/parcels/${t.parcelId}` : `/tasks`;

// What should ring on this user's device right now.
export async function alertsFor(user: CurrentUser): Promise<Alert[]> {
  await escalateOverdue();
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
