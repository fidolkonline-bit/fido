"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { sendClaim, settleClaim } from "@/lib/claims";
import { formError } from "@/lib/forms";

export async function submitClaim(payload: unknown): Promise<{ id?: string; error?: string }> {
  const user = await requirePermission("purchases.claims");
  try {
    const r = await sendClaim(user, payload);
    revalidatePath("/purchases/returns");
    return r;
  } catch (e) {
    return formError(e) ?? {};
  }
}

export async function submitSettlement(payload: unknown): Promise<{ error?: string }> {
  const user = await requirePermission("purchases.claims");
  try {
    const r = await settleClaim(user, payload);
    revalidatePath(`/purchases/returns/${r.id}`);
    return {};
  } catch (e) {
    return formError(e) ?? {};
  }
}
