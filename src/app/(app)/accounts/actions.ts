"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formError, num, str, type FormState } from "@/lib/forms";

const TYPES = ["CASH", "BANK", "CARD", "WALLET", "OWNER_COLLECTION"];

export async function addAccount(_: FormState, f: FormData): Promise<FormState> {
  await requirePermission("accounts.manage");
  const name = str(f, "name");
  const type = str(f, "type");
  if (!name) return { error: "Account name is required." };
  if (!type || !TYPES.includes(type)) return { error: "Choose an account type." };
  try {
    await db.account.create({ data: { name, type, locationId: str(f, "locationId"), openingBalance: num(f, "openingBalance") ?? 0 } });
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/accounts");
  return { ok: `${name} added.` };
}
