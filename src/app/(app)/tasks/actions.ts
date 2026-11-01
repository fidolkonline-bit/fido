"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser, requirePermission } from "@/lib/auth";
import { acknowledgeTask, createTask, completeTask } from "@/lib/tasks";
import * as P from "@/lib/parcels";
import { formError, str } from "@/lib/forms";

type Res = { error?: string; ok?: string };

export async function ackTask(taskId: string): Promise<Res> {
  const user = await requireUser();
  try { await acknowledgeTask(user, taskId); } catch (e) { return formError(e) ?? {}; }
  revalidatePath("/tasks");
  return { ok: "Acknowledged" };
}

export async function ackTaskForm(f: FormData) {
  await ackTask(String(f.get("taskId")));
}

export async function finishTask(f: FormData) {
  const user = await requireUser();
  const id = String(f.get("taskId"));
  const t = await db.staffTask.findUniqueOrThrow({ where: { id } });
  if (t.kind !== "GENERAL") throw new Error("Bus parcels and reloads finish from their own page.");
  await db.$transaction((tx) => completeTask(tx, id, user.personId, str(f, "note") ?? undefined));
  revalidatePath("/tasks");
}

export async function newGeneralTask(_: Res | undefined, f: FormData): Promise<Res> {
  const user = await requirePermission("tasks.manage");
  const title = str(f, "title");
  if (!title || !user.location) return { error: "Enter what needs doing." };
  const due = str(f, "dueAt");
  await db.$transaction((tx) => createTask(tx, {
    kind: "GENERAL", title, details: str(f, "details"), locationId: user.location!.id, assignedToId: str(f, "assignedToId"),
    priority: f.get("urgent") === "on" ? "URGENT" : "NORMAL", dueAt: due ? new Date(due) : null, createdById: user.personId,
  }));
  revalidatePath("/tasks");
  return { ok: "Task sent." };
}

export async function submitParcel(payload: unknown): Promise<Res> {
  const user = await requirePermission("tasks.manage");
  let id: string;
  try { id = (await P.createParcel(user, payload)).id; } catch (e) { return formError(e) ?? {}; }
  revalidatePath("/tasks");
  redirect(`/tasks/parcels/${id}`);
}

export async function parcelStep(_: Res | undefined, f: FormData): Promise<Res> {
  const user = await requireUser();
  const id = String(f.get("parcelId"));
  const step = String(f.get("step"));
  try {
    if (step === "ack") {
      const t = await db.staffTask.findFirst({ where: { parcelId: id, status: "PENDING" } });
      if (t) await acknowledgeTask(user, t.id);
    } else if (step === "collected") await P.markCollected(user, id);
    else if (step === "checked") await P.checkContents(user, id, { ok: f.get("ok") === "yes", notes: str(f, "notes") });
    else if (step === "cancel") { if (!user.permissions.has("tasks.manage")) return { error: "Only a manager can cancel." }; await P.cancelParcel(user, id); }
  } catch (e) { return formError(e) ?? {}; }
  revalidatePath(`/tasks/parcels/${id}`);
  revalidatePath("/tasks");
  return { ok: "Saved." };
}
