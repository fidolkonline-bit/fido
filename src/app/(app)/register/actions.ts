"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { DENOMINATIONS, openRegister as openDrawerSession, recordMovement, closeRegister as closeDrawer } from "@/lib/register";
import { money } from "@/lib/money";
import { formError, num, str, type FormState } from "@/lib/forms";

export async function openRegister(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("register.operate");
  try {
    await openDrawerSession(user, { openingCash: num(f, "openingCash") ?? Number.NaN, note: str(f, "openingNote") });
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/", "layout");
  return { ok: "Cash register opened." };
}

export async function moveCash(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("register.operate");
  try {
    const m = await recordMovement(user, { reason: str(f, "reason") ?? "", amount: num(f, "amount") ?? Number.NaN, note: str(f, "note") });
    revalidatePath("/", "layout");
    return { ok: `Recorded: Rs. ${money(m.amount)} ${m.direction === "IN" ? "put into" : "taken out of"} the drawer.` };
  } catch (e) {
    return formError(e);
  }
}

export async function closeRegister(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("register.operate");
  const id = str(f, "registerId");
  if (!id) return { error: "Register not found." };
  const counts: Record<string, number> = {};
  for (const d of DENOMINATIONS) counts[d] = num(f, `d${d}`) ?? 0;
  try {
    await closeDrawer(user, {
      registerId: id, counts, varianceReason: str(f, "varianceReason"), notes: str(f, "notes"),
      cashLeft: num(f, "cashLeft"), handoverReason: str(f, "handoverReason"),
    });
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/", "layout");
  redirect(`/register/${id}?closed=1`);
}
