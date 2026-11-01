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
