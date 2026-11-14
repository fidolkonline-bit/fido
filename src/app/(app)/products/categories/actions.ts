"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formError, str, num, type FormState } from "@/lib/forms";

// Rates are entered as percentages and stored as fractions. Shares apply to the pool (spec §9.1).
const schema = z.object({
  name: z.string().min(1, "Category name is required."),
  parentId: z.string().nullable(),
  poolRate: z.number().min(0).max(100),
  userShare: z.number().min(0).max(100),
  agentShare: z.number().min(0).max(100),
});

export async function saveCategory(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("products.manage");
  try {
    const d = schema.parse({
      name: str(f, "name") ?? "", parentId: str(f, "parentId"),
      poolRate: num(f, "poolRate") ?? 0, userShare: num(f, "userShare") ?? 0, agentShare: num(f, "agentShare") ?? 0,
    });
    if (d.userShare + d.agentShare > 100.0001) return { error: "User share plus agent share cannot exceed 100% of the pool." };
    const data = { name: d.name, parentId: d.parentId, poolRate: d.poolRate / 100, userShare: d.userShare / 100, agentShare: d.agentShare / 100 };
    const id = str(f, "id");
    const c = id ? await db.category.update({ where: { id }, data }) : await db.category.create({ data });
    await db.auditEvent.create({ data: { actorId: user.personId, action: id ? "CATEGORY_UPDATED" : "CATEGORY_CREATED", subjectType: "Category", subjectId: c.id, detail: data } });
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/products/categories");
  return { ok: "Category saved." };
}

// Deactivating hides a category from every picker but keeps its products and history. A parent takes its
// subcategories with it; a subcategory can only come back once its parent is active.
export async function setCategoryActive(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("products.manage");
  const id = str(f, "id");
  const active = str(f, "active") === "1";
  if (!id) return { error: "Category not found." };
  try {
    const c = await db.category.findUniqueOrThrow({ where: { id }, include: { parent: true, children: { where: { active: true }, select: { id: true } } } });
    if (active && c.parent && !c.parent.active) return { error: `Reactivate ${c.parent.name} first.` };
    const ids = active ? [id] : [id, ...c.children.map((x) => x.id)];
    await db.$transaction([
      db.category.updateMany({ where: { id: { in: ids } }, data: { active } }),
      db.auditEvent.create({ data: { actorId: user.personId, action: active ? "CATEGORY_REACTIVATED" : "CATEGORY_DEACTIVATED", subjectType: "Category", subjectId: id, detail: { ids } } }),
    ]);
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/products/categories");
  return { ok: active ? "Reactivated." : "Deactivated." };
}

// Hard delete only for a category nothing points at; anything that has been used should be deactivated instead.
export async function deleteCategory(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("products.manage");
  const id = str(f, "id");
  if (!id) return { error: "Category not found." };
  try {
    const [c, sold, counts, rules] = await Promise.all([
      db.category.findUniqueOrThrow({ where: { id }, include: { _count: { select: { products: true, children: true } } } }),
      db.saleLine.count({ where: { categoryId: id } }),
      db.stockCount.count({ where: { categoryId: id } }),
      db.discountRule.count({ where: { scope: "CATEGORY", targetIds: { has: id } } }),
    ]);
    const why = [
      c._count.products && `${c._count.products} product${c._count.products === 1 ? "" : "s"}`,
      c._count.children && `${c._count.children} subcategor${c._count.children === 1 ? "y" : "ies"}`,
      sold && "past sales",
      counts && "stock counts",
      rules && "discount rules",
    ].filter(Boolean);
    if (why.length) return { error: `Used by ${why.join(", ")} — deactivate it instead.` };
    await db.$transaction([
      db.category.delete({ where: { id } }),
      db.auditEvent.create({ data: { actorId: user.personId, action: "CATEGORY_DELETED", subjectType: "Category", subjectId: id, detail: { name: c.name } } }),
    ]);
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/products/categories");
  return { ok: "Deleted." };
}
