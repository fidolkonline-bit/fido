"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { createOrder, closeOrder } from "@/lib/purchases";
import { formError } from "@/lib/forms";

export async function submitOrder(payload: unknown): Promise<{ id?: string; error?: string }> {
  const user = await requirePermission("purchases.post");
  try {
    const r = await createOrder(user, payload);
    revalidatePath("/purchases/orders");
    return r;
  } catch (e) {
    return formError(e) ?? {};
  }
}

export async function finishOrder(f: FormData) {
  const user = await requirePermission("purchases.post");
  const id = String(f.get("orderId"));
  await closeOrder(user, id);
  revalidatePath(`/purchases/orders/${id}`);
}
