"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { loyaltySchema, redeemPoints } from "@/lib/loyalty";
import { saveSetting } from "@/lib/settings";
import { formError, num, type FormState } from "@/lib/forms";

export async function saveLoyalty(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("settings.manage");
  try {
    const v = loyaltySchema.parse({ enabled: f.get("enabled") === "on", earnPer: num(f, "earnPer") ?? 100, pointValue: num(f, "pointValue") ?? 1, minRedeem: num(f, "minRedeem") ?? 100 });
    await saveSetting("loyalty", v, user.personId);
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/settings/loyalty");
  return { ok: "Loyalty settings saved. They apply to new sales." };
}

export async function redeemPointsForm(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("sales.create");
  const contactId = String(f.get("contactId") ?? "");
  try {
    const r = await redeemPoints(user, contactId, Number(f.get("points")));
    revalidatePath(`/contacts/${contactId}`);
    return { ok: `Rs. ${r.credit} added as store credit. ${r.left} points left. Use Store credit as the payment method at the POS.` };
  } catch (e) {
    return formError(e);
  }
}
