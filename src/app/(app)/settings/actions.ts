"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formError, num, str, type FormState } from "@/lib/forms";

export async function saveBusiness(_: FormState, f: FormData): Promise<FormState> {
  await requirePermission("settings.manage");
  const name = str(f, "name");
  const rounding = num(f, "saleRounding");
  if (!name) return { error: "Business name is required." };
  if (rounding == null || ![0, 0.5, 1, 5, 10].includes(rounding)) return { error: "Choose a supported rounding step." };
  try {
    const b = await db.business.findFirstOrThrow();
    await db.business.update({ where: { id: b.id }, data: { name, saleRounding: rounding } });
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/settings");
  return { ok: "Business settings saved." };
}

export async function addLocation(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("settings.manage");
  const name = str(f, "name");
  const code = str(f, "code")?.toUpperCase();
  if (!name || !code) return { error: "Location name and code are required." };
  try {
    const b = await db.business.findFirstOrThrow();
    const loc = await db.location.create({ data: { businessId: b.id, name, code, address: str(f, "address"), phone: str(f, "phone") } });
    await db.account.create({ data: { name: `${name} till`, type: "CASH", locationId: loc.id } });
    await db.auditEvent.create({ data: { actorId: user.personId, action: "LOCATION_CREATED", subjectType: "Location", subjectId: loc.id } });
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/settings");
  return { ok: `${name} added with its own cash till account.` };
}
