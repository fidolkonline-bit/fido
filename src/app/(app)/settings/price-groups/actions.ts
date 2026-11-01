"use server";

import { revalidatePath } from "next/cache";
import { db, posting } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formError, str, num, type FormState } from "@/lib/forms";

const done = (ok: string): FormState => { revalidatePath("/settings/price-groups"); revalidatePath("/pos"); return { ok }; };

export async function createPriceGroup(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("pricing.manage");
  const name = str(f, "name");
  if (!name) return { error: "Name is required." };
  try {
    const max = await db.priceGroup.aggregate({ _max: { sortOrder: true } });
    const g = await db.priceGroup.create({ data: { name, description: str(f, "description"), sortOrder: (max._max.sortOrder ?? 0) + 1 } });
    await db.auditEvent.create({ data: { actorId: user.personId, action: "PRICE_GROUP_CREATED", subjectType: "PriceGroup", subjectId: g.id, detail: { name } } });
  } catch (e) { return formError(e); }
  return done(`${name} added.`);
}

// Renaming keeps every price, customer group and role link: they point at the id, not the name.
export async function updatePriceGroup(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("pricing.manage");
  const id = String(f.get("id"));
  const name = str(f, "name");
  if (!name) return { error: "Name is required." };
  try {
    const before = await db.priceGroup.findUniqueOrThrow({ where: { id } });
    const roleIds = f.getAll("roleIds").map(String);
    await posting(async (tx) => {
      await tx.priceGroup.update({ where: { id }, data: { name, description: str(f, "description"), sortOrder: num(f, "sortOrder") ?? before.sortOrder, active: f.get("active") === "on" } });
      await tx.priceGroupAccess.deleteMany({ where: { priceGroupId: id } });
      if (roleIds.length) await tx.priceGroupAccess.createMany({ data: roleIds.map((roleId) => ({ priceGroupId: id, roleId })) });
      await tx.auditEvent.create({ data: { actorId: user.personId, action: "PRICE_GROUP_UPDATED", subjectType: "PriceGroup", subjectId: id, detail: { from: before.name, to: name, active: f.get("active") === "on", roles: roleIds.length } } });
    });
  } catch (e) { return formError(e); }
  return done(`${name} saved.`);
}

// Only a group no sale has ever used can be deleted; otherwise it is deactivated so old invoices stay explained.
export async function deletePriceGroup(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("pricing.manage");
  const id = String(f.get("id"));
  try {
    const used = (await db.sale.count({ where: { priceGroupId: id } })) + (await db.saleLine.count({ where: { priceGroupId: id } }));
    const g = await db.priceGroup.findUniqueOrThrow({ where: { id } });
    if (used) {
      await db.priceGroup.update({ where: { id }, data: { active: false } });
      return done(`${g.name} is used by past sales, so it was deactivated instead of deleted.`);
    }
    await posting(async (tx) => {
      await tx.customerGroup.updateMany({ where: { priceGroupId: id }, data: { priceGroupId: null } });
      await tx.priceGroup.delete({ where: { id } });
      await tx.auditEvent.create({ data: { actorId: user.personId, action: "PRICE_GROUP_DELETED", subjectType: "PriceGroup", subjectId: id, detail: { name: g.name } } });
    });
    return done(`${g.name} deleted with its product prices.`);
  } catch (e) { return formError(e); }
}

export async function setCustomerGroupPricing(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("pricing.manage");
  const id = String(f.get("id"));
  const priceGroupId = str(f, "priceGroupId");
  const pct = num(f, "adjustmentPct");
  if (pct !== null && (pct <= -100 || pct > 500)) return { error: "Adjustment must be above −100% and at most 500%." };
  try {
    const g = await db.customerGroup.update({ where: { id }, data: { priceGroupId, adjustmentPct: priceGroupId ? null : pct } });
    await db.auditEvent.create({ data: { actorId: user.personId, action: "CUSTOMER_GROUP_PRICING", subjectType: "CustomerGroup", subjectId: id, detail: { priceGroupId, adjustmentPct: pct } } });
    revalidatePath("/contacts/groups");
    return { ok: `${g.name} pricing saved.` };
  } catch (e) { return formError(e); }
}
