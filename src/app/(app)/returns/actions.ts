"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { postReturn } from "@/lib/returns";
import { formError } from "@/lib/forms";

export async function submitReturn(payload: unknown): Promise<{ id?: string; number?: string; error?: string }> {
  const user = await requirePermission("returns.create");
  try {
    const r = await postReturn(user, payload);
    revalidatePath("/sales");
    revalidatePath("/returns");
    return r;
  } catch (e) {
    return formError(e) ?? {};
  }
}
