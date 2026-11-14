"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formError, str, num, type FormState } from "@/lib/forms";

export async function addMaster(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("products.manage");
  const kind = str(f, "kind");
  const name = str(f, "name");
  const id = str(f, "id");
  if (!name) return { error: "Name is required." };
  try {
    if (kind === "brand") {
      const b = id ? await db.brand.update({ where: { id }, data: { name } }) : await db.brand.create({ data: { name } });
      await db.auditEvent.create({ data: { actorId: user.personId, action: id ? "BRAND_UPDATED" : "BRAND_CREATED", subjectType: "Brand", subjectId: b.id, detail: { name } } });
    } else if (kind === "unit") await db.unit.create({ data: { name, shortName: str(f, "shortName") ?? name, allowDecimal: f.get("allowDecimal") === "on" } });
    else if (kind === "warranty") {
      const days = num(f, "durationDays");
      if (!days || days < 1) return { error: "Warranty duration must be at least one day." };
      await db.warranty.create({ data: { name, durationDays: days, description: str(f, "description") } });
    } else return { error: "Unknown master type." };
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/products/masters");
  return { ok: id ? `${name} saved.` : `${name} added.` };
}

// Deactivating hides a brand from product pickers and filters; products already on it keep it.
export async function setBrandActive(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("products.manage");
  const id = str(f, "id");
  const active = str(f, "active") === "1";
  if (!id) return { error: "Brand not found." };
  try {
    await db.$transaction([
      db.brand.update({ where: { id }, data: { active } }),
      db.auditEvent.create({ data: { actorId: user.personId, action: active ? "BRAND_REACTIVATED" : "BRAND_DEACTIVATED", subjectType: "Brand", subjectId: id } }),
    ]);
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/products/masters");
  return { ok: active ? "Reactivated." : "Deactivated." };
}

// Hard delete only for a brand nothing points at; a brand that has been used should be deactivated instead.
export async function deleteBrand(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("products.manage");
  const id = str(f, "id");
  if (!id) return { error: "Brand not found." };
  try {
    const [b, rules] = await Promise.all([
      db.brand.findUniqueOrThrow({ where: { id }, include: { _count: { select: { products: true } } } }),
      db.discountRule.count({ where: { scope: "BRAND", targetIds: { has: id } } }),
    ]);
    const why = [
      b._count.products && `${b._count.products} product${b._count.products === 1 ? "" : "s"}`,
      rules && "discount rules",
    ].filter(Boolean);
    if (why.length) return { error: `Used by ${why.join(", ")} — deactivate it instead.` };
    await db.$transaction([
      db.brand.delete({ where: { id } }),
      db.auditEvent.create({ data: { actorId: user.personId, action: "BRAND_DELETED", subjectType: "Brand", subjectId: id, detail: { name: b.name } } }),
    ]);
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/products/masters");
  return { ok: "Deleted." };
}
