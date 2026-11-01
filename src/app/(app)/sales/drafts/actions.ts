"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { saveDraft, closeDraft } from "@/lib/drafts";
import { formError, str } from "@/lib/forms";

export async function saveDraftAction(payload: unknown): Promise<{ id?: string; number?: string; error?: string }> {
  const user = await requirePermission("sales.create");
  try {
    const d = await saveDraft(user, payload);
    revalidatePath("/sales/drafts");
    return { id: d.id, number: d.number };
  } catch (e) { return formError(e) ?? {}; }
}

export async function cancelDraftForm(f: FormData) {
  await requirePermission("sales.create");
  await closeDraft(String(f.get("id")), "CANCELLED");
  revalidatePath("/sales/drafts");
}

export async function saveSubscription(_: { error?: string; ok?: string } | undefined, f: FormData) {
  const user = await requirePermission("sales.create");
  try {
    const lines = JSON.parse(String(f.get("lines") ?? "[]"));
    if (!Array.isArray(lines) || !lines.length) return { error: "Add at least one item." };
    const customerId = str(f, "customerId");
    const start = str(f, "nextDate");
    if (!customerId || !start || !user.location) return { error: "Choose the customer and the first date." };
    await db.subscription.create({
      data: { name: str(f, "name") ?? "Subscription", customerId, locationId: user.location.id, lines, interval: str(f, "interval") ?? "MONTH",
        nextDate: new Date(`${start}T00:00:00.000Z`), endDate: str(f, "endDate") ? new Date(`${str(f, "endDate")}T00:00:00.000Z`) : null },
    });
  } catch (e) { return formError(e); }
  revalidatePath("/sales/subscriptions");
  return { ok: "Subscription saved. A draft invoice will appear on each due date." };
}

export async function stopSubscription(f: FormData) {
  await requirePermission("sales.create");
  await db.subscription.update({ where: { id: String(f.get("id")) }, data: { active: false } });
  revalidatePath("/sales/subscriptions");
}
