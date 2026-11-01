"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { postReceipt } from "@/lib/purchases";
import { formError } from "@/lib/forms";

export async function submitReceipt(payload: unknown): Promise<{ id?: string; number?: string; error?: string }> {
  const user = await requirePermission("purchases.post");
  try {
    const r = await postReceipt(user, payload);
    revalidatePath("/purchases");
    revalidatePath("/products");
    return r;
  } catch (e) {
    return formError(e) ?? {};
  }
}
