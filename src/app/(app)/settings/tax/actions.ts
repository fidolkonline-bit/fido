"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formError, num, str, type FormState } from "@/lib/forms";

export async function saveTaxSettings(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("settings.manage");
  const enabled = f.get("taxEnabled") === "on";
  const taxNumber = str(f, "taxNumber");
  if (enabled && !(await db.taxRate.count({ where: { active: true, isDefault: true } }))) return { error: "Add a tax rate and make it the default before switching tax on." };
  const b = await db.business.findFirstOrThrow();
  await db.business.update({ where: { id: b.id }, data: { taxEnabled: enabled, taxNumber } });
  await db.auditEvent.create({ data: { actorId: user.personId, action: "TAX_SETTINGS_CHANGED", subjectType: "Business", subjectId: b.id, detail: { enabled, taxNumber } } });
  revalidatePath("/settings/tax");
  return { ok: enabled ? "Tax is on. New sales show the tax inside the total." : "Tax is off. New sales carry no tax." };
}

export async function addTaxRate(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("settings.manage");
  const name = str(f, "name");
  const rate = num(f, "ratePct");
  if (!name || rate == null || !(rate >= 0 && rate <= 100)) return { error: "Enter a name and a rate between 0 and 100." };
  try {
    const first = !(await db.taxRate.count({ where: { isDefault: true } }));
    const r = await db.taxRate.create({ data: { name, ratePct: rate, isDefault: first } });
    await db.auditEvent.create({ data: { actorId: user.personId, action: "TAX_RATE_ADDED", subjectType: "TaxRate", subjectId: r.id, detail: { name, rate } } });
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/settings/tax");
  return { ok: "Rate added." };
}

// Rates are never edited or deleted once used: past sales keep the rate they were sold at. Retire a rate and add a new one.
export async function setTaxRate(f: FormData) {
  const user = await requirePermission("settings.manage");
  const id = String(f.get("id"));
  const op = String(f.get("op"));
  if (op === "default") {
    await db.$transaction([db.taxRate.updateMany({ data: { isDefault: false } }), db.taxRate.update({ where: { id }, data: { isDefault: true, active: true } })]);
  } else {
    const r = await db.taxRate.findUniqueOrThrow({ where: { id } });
    const b = await db.business.findFirstOrThrow();
    if (r.isDefault && r.active && b.taxEnabled) throw new Error("This is the default rate while tax is on. Make another rate the default first.");
    await db.taxRate.update({ where: { id }, data: { active: !r.active } });
  }
  await db.auditEvent.create({ data: { actorId: user.personId, action: "TAX_RATE_CHANGED", subjectType: "TaxRate", subjectId: id, detail: { op } } });
  revalidatePath("/settings/tax");
}

export async function setProductTax(_: FormState, f: FormData): Promise<FormState> {
  await requirePermission("settings.manage");
  const categoryId = str(f, "categoryId");
  const taxRateId = str(f, "taxRateId");
  if (!categoryId) return { error: "Choose a category." };
  const r = await db.product.updateMany({ where: { categoryId }, data: { taxRateId } });
  revalidatePath("/settings/tax");
  return { ok: `${r.count} product${r.count === 1 ? "" : "s"} updated.` };
}
