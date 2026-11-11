"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { createOrder } from "@/lib/purchases";
import { formError, type FormState } from "@/lib/forms";

// One purchase order for one supplier from the ticked suggestions. Nothing enters stock until goods are received.
export async function orderSuggested(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("purchases.post");
  const supplierId = String(f.get("supplierId") ?? "");
  const lines = f.getAll("pick").map(String).map((productId) => ({ productId, qty: Number(f.get(`qty:${productId}`)), unitCost: Number(f.get(`cost:${productId}`) ?? 0) })).filter((l) => l.qty > 0);
  if (!supplierId) return { error: "Choose the supplier for this order." };
  if (!lines.length) return { error: "Tick at least one item with a quantity above 0." };
  let id: string;
  try {
    id = (await createOrder(user, { idempotencyKey: String(f.get("key") ?? randomUUID()), supplierId, notes: "From reorder suggestions", lines })).id;
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/purchases/orders");
  redirect(`/purchases/orders/${id}`);
}
