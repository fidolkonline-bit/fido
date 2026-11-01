"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { createExpense, payExpense } from "@/lib/expenses";
import { formError, str, type FormState } from "@/lib/forms";

export async function submitExpense(payload: unknown): Promise<{ id?: string; error?: string }> {
  const user = await requirePermission("expenses.manage");
  try {
    const r = await createExpense(user, payload);
    revalidatePath("/expenses");
    return r;
  } catch (e) {
    return formError(e) ?? {};
  }
}

export async function submitExpensePayment(expenseId: string, payload: unknown): Promise<{ error?: string }> {
  const user = await requirePermission("expenses.manage");
  try {
    await payExpense(user, expenseId, payload);
    revalidatePath(`/expenses/${expenseId}`);
    return {};
  } catch (e) {
    return formError(e) ?? {};
  }
}

export async function addExpenseCategory(_: FormState, f: FormData): Promise<FormState> {
  await requirePermission("expenses.manage");
  const name = str(f, "name");
  if (!name) return { error: "Category name is required." };
  try {
    await db.expenseCategory.create({ data: { name } });
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/expenses/new");
  return { ok: `${name} added.` };
}
