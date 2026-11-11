"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { createTradeIn } from "@/lib/tradeins";
import { formError } from "@/lib/forms";

export async function submitTradeIn(payload: unknown): Promise<{ id?: string; error?: string }> {
  const user = await requirePermission("tradein.create");
  try {
    const r = await createTradeIn(user, payload);
    revalidatePath("/trade-ins");
    return r;
  } catch (e) {
    return formError(e) ?? {};
  }
}
