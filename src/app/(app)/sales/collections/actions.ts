"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { reverseDebtPayment } from "@/lib/debt";
import { formError, str, type FormState } from "@/lib/forms";

// Corrections are linked reversals: the receipt stays, marked reversed, and its invoices owe again.
export async function reverseCollectionForm(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("debt.reverse");
  const id = String(f.get("id"));
  try { await reverseDebtPayment(user, id, str(f, "reason") ?? ""); } catch (e) { return formError(e); }
  revalidatePath(`/sales/collections/${id}`);
  revalidatePath("/sales/collections");
  return { ok: "Receipt reversed. The debt is back on the invoices it paid." };
}
