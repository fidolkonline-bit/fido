"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formError, str, num, type FormState } from "@/lib/forms";

export async function addMaster(_: FormState, f: FormData): Promise<FormState> {
  await requirePermission("products.manage");
  const kind = str(f, "kind");
  const name = str(f, "name");
  if (!name) return { error: "Name is required." };
  try {
    if (kind === "brand") await db.brand.create({ data: { name } });
    else if (kind === "unit") await db.unit.create({ data: { name, shortName: str(f, "shortName") ?? name, allowDecimal: f.get("allowDecimal") === "on" } });
    else if (kind === "warranty") {
      const days = num(f, "durationDays");
      if (!days || days < 1) return { error: "Warranty duration must be at least one day." };
      await db.warranty.create({ data: { name, durationDays: days, description: str(f, "description") } });
    } else return { error: "Unknown master type." };
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/products/masters");
  return { ok: `${name} added.` };
}
