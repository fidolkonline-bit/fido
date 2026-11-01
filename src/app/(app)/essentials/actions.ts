"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser, requirePermission } from "@/lib/auth";
import { formError, str } from "@/lib/forms";

type Res = { error?: string; ok?: string } | undefined;
const roles = (f: FormData) => f.getAll("audience").map(String).filter(Boolean);

export async function memoForm(_: Res, f: FormData): Promise<Res> {
  const user = await requirePermission("essentials.manage");
  const title = str(f, "title"), body = str(f, "body");
  if (!title || !body) return { error: "Title and message are required." };
  await db.memo.create({ data: { title, body, audience: roles(f), pinned: f.get("pinned") === "on", createdById: user.personId } });
  revalidatePath("/essentials");
  return { ok: "Posted." };
}

export async function removeMemo(f: FormData) {
  await requirePermission("essentials.manage");
  await db.memo.delete({ where: { id: String(f.get("id")) } });
  revalidatePath("/essentials");
}

export async function reminderForm(_: Res, f: FormData): Promise<Res> {
  const user = await requireUser();
  const title = str(f, "title"), at = str(f, "at");
  if (!title || !at || !user.location) return { error: "What and when are required." };
  const assignee = str(f, "assignedToId");
  // Staff set reminders for themselves; reminding others needs the Essentials permission.
  if (assignee !== user.personId && !user.permissions.has("essentials.manage")) return { error: "You can only set reminders for yourself." };
  await db.reminder.create({
    data: { title, details: str(f, "details"), nextAt: new Date(`${at}:00+05:30`), repeat: str(f, "repeat") ?? "NONE", assignedToId: assignee, locationId: user.location.id, createdById: user.personId },
  });
  revalidatePath("/essentials/reminders");
  return { ok: "Reminder set. It will ring as a task at that time." };
}

export async function stopReminder(f: FormData) {
  const user = await requireUser();
  const r = await db.reminder.findUniqueOrThrow({ where: { id: String(f.get("id")) } });
  if (r.createdById !== user.personId && !user.permissions.has("essentials.manage")) throw new Error("Not allowed.");
  await db.reminder.update({ where: { id: r.id }, data: { active: false } });
  revalidatePath("/essentials/reminders");
}

export async function newThread(_: Res, f: FormData): Promise<Res> {
  const user = await requireUser();
  const subject = str(f, "subject"), body = str(f, "body");
  const members = [...new Set([user.personId, ...f.getAll("members").map(String)])];
  if (!subject || !body || members.length < 2) return { error: "Choose who to message, a subject and the message." };
  const t = await db.messageThread.create({
    data: { subject, members: { create: members.map((personId) => ({ personId, lastReadAt: personId === user.personId ? new Date() : null })) }, messages: { create: { senderId: user.personId, body } } },
  });
  redirect(`/essentials/messages/${t.id}`);
}

export async function reply(_: Res, f: FormData): Promise<Res> {
  const user = await requireUser();
  const threadId = String(f.get("threadId"));
  const body = str(f, "body");
  // Only members of a conversation can read or write in it (§19).
  const member = await db.threadMember.findUnique({ where: { threadId_personId: { threadId, personId: user.personId } } });
  if (!member) return { error: "You are not in this conversation." };
  if (!body) return { error: "Write a message." };
  await db.$transaction([
    db.staffMessage.create({ data: { threadId, senderId: user.personId, body } }),
    db.messageThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } }),
    db.threadMember.update({ where: { threadId_personId: { threadId, personId: user.personId } }, data: { lastReadAt: new Date() } }),
  ]);
  revalidatePath(`/essentials/messages/${threadId}`);
  return { ok: undefined };
}

export async function articleForm(_: Res, f: FormData): Promise<Res> {
  const user = await requirePermission("essentials.manage");
  const id = str(f, "id"), title = str(f, "title"), body = str(f, "body");
  if (!title || !body) return { error: "Title and content are required." };
  let savedId = id;
  try {
    if (id) {
      const a = await db.knowledgeArticle.findUniqueOrThrow({ where: { id } });
      // Every edit keeps the previous version (revision history, §19).
      const history = [...(a.history as object[]), { revision: a.revision, title: a.title, body: a.body, at: a.updatedAt.toISOString(), by: user.name }];
      await db.knowledgeArticle.update({ where: { id }, data: { title, body, category: str(f, "category") ?? a.category, audience: roles(f), revision: a.revision + 1, history } });
    } else {
      savedId = (await db.knowledgeArticle.create({ data: { title, body, category: str(f, "category") ?? "General", audience: roles(f), createdById: user.personId } })).id;
    }
  } catch (e) { return formError(e); }
  redirect(`/essentials/knowledge/${savedId}`);
}

const MAX_BYTES = 4 * 1024 * 1024;
export async function uploadDocument(_: Res, f: FormData): Promise<Res> {
  const user = await requirePermission("essentials.manage");
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file." };
  if (file.size > MAX_BYTES) return { error: "Files must be 4 MB or smaller." };
  await db.documentFile.create({
    data: { name: str(f, "name") ?? file.name, description: str(f, "description"), mimeType: file.type || "application/octet-stream", size: file.size,
      data: Buffer.from(await file.arrayBuffer()), audience: roles(f), createdById: user.personId },
  });
  revalidatePath("/essentials/documents");
  return { ok: "Uploaded." };
}

export async function removeDocument(f: FormData) {
  await requirePermission("essentials.manage");
  await db.documentFile.delete({ where: { id: String(f.get("id")) } });
  revalidatePath("/essentials/documents");
}

