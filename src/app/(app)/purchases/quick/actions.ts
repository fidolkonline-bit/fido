"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { quickReceive } from "@/lib/quick-receive";
import { formError } from "@/lib/forms";

export async function submitQuickReceive(payload: unknown): Promise<{ id?: string; number?: string; error?: string }> {
  const user = await requirePermission("purchases.quick_receive");
  try {
    const r = await quickReceive(user, payload);
    revalidatePath("/purchases");
    revalidatePath("/purchases/quick");
    revalidatePath("/products");
    return r;
  } catch (e) {
    return formError(e) ?? {};
  }
}
