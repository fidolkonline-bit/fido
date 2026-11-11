"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { cancelCount, openCount, postCount, saveCounted, scanInto } from "@/lib/stockcount";
import { formError, str, type FormState } from "@/lib/forms";

export async function startCount(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("stock.count");
  let id: string;
  try {
    id = (await openCount(user, { categoryId: str(f, "categoryId"), notes: str(f, "notes"), includeZero: f.get("includeZero") === "on" })).id;
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/stock-counts");
  redirect(`/stock-counts/${id}`);
}

export async function saveCountLines(countId: string, entries: { lineId: string; counted: number | null }[]): Promise<{ ok?: string; error?: string }> {
  const user = await requirePermission("stock.count");
  try {
    await saveCounted(user, countId, entries);
    revalidatePath(`/stock-counts/${countId}`);
    return { ok: "Saved." };
  } catch (e) {
    return formError(e) ?? {};
  }
}

export async function scanCount(countId: string, code: string): Promise<{ ok?: string; error?: string }> {
  const user = await requirePermission("stock.count");
  try {
    const r = await scanInto(user, countId, code);
    revalidatePath(`/stock-counts/${countId}`);
    return r;
  } catch (e) {
    return formError(e) ?? {};
  }
}

export async function finishCount(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("stock.count");
  const id = String(f.get("countId"));
  try {
    if (f.get("confirm") !== "on") return { error: "Tick the box to confirm the differences are real before posting." };
    await postCount(user, id);
  } catch (e) {
    return formError(e);
  }
  revalidatePath(`/stock-counts/${id}`);
  return { ok: "Posted. Stock now matches the count." };
}

export async function abandonCount(f: FormData) {
  const user = await requirePermission("stock.count");
  const id = String(f.get("countId"));
  await cancelCount(user, id);
  revalidatePath(`/stock-counts/${id}`);
}
