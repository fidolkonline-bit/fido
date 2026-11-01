"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, can } from "@/lib/auth";
import { formError, str, num, type FormState } from "@/lib/forms";

const productSchema = z.object({
  sku: z.string().min(1, "SKU is required.").max(40),
  name: z.string().min(1, "Product name is required.").max(160),
  barcode: z.string().max(60).nullable(),
  categoryId: z.string().nullable(),
  brandId: z.string().nullable(),
  unitId: z.string().nullable(),
  warrantyId: z.string().nullable(),
  sellPrice: z.number().min(0, "Selling price cannot be negative."),
  minSellPrice: z.number().min(0).nullable(),
  defaultCost: z.number().min(0),
  alertQty: z.number().min(0),
  stockManaged: z.boolean(),
  trackDevices: z.boolean(),
  notForSale: z.boolean(),
  description: z.string().max(2000).nullable(),
});

function parse(f: FormData) {
  return productSchema.parse({
    sku: str(f, "sku") ?? "",
    name: str(f, "name") ?? "",
    barcode: str(f, "barcode"),
    categoryId: str(f, "categoryId"),
    brandId: str(f, "brandId"),
    unitId: str(f, "unitId"),
    warrantyId: str(f, "warrantyId"),
    sellPrice: num(f, "sellPrice") ?? 0,
    minSellPrice: num(f, "minSellPrice"),
    defaultCost: num(f, "defaultCost") ?? 0,
    alertQty: num(f, "alertQty") ?? 0,
    stockManaged: f.get("stockManaged") === "on",
    trackDevices: f.get("trackDevices") === "on",
    notForSale: f.get("notForSale") === "on",
    description: str(f, "description"),
  });
}

export async function saveProduct(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("products.manage");
  const id = str(f, "id");
  let savedId: string;
  try {
    const data = parse(f);
    const p = id ? await db.product.update({ where: { id }, data }) : await db.product.create({ data });
    savedId = p.id;
    if (can(user, "pricing.manage")) await saveTierPrices(p.id, f);
    await db.auditEvent.create({ data: { actorId: user.personId, action: id ? "PRODUCT_UPDATED" : "PRODUCT_CREATED", subjectType: "Product", subjectId: p.id } });
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/products");
  redirect(`/products/${savedId}`);
}

// Tier price matrix: empty = not set (default price applies); 0 is stored but only treated as free once confirmed.
async function saveTierPrices(productId: string, f: FormData) {
  const tiers = await db.priceGroup.findMany({ select: { id: true } });
  for (const t of tiers) {
    if (!f.has(`tier_${t.id}`)) continue;
    const v = num(f, `tier_${t.id}`);
    if (v === null) { await db.productPrice.deleteMany({ where: { productId, priceGroupId: t.id } }); continue; }
    if (!(v >= 0)) throw new Error("Tier prices cannot be negative.");
    const zeroConfirmed = v === 0 && f.get(`tierfree_${t.id}`) === "on";
    await db.productPrice.upsert({ where: { productId_priceGroupId: { productId, priceGroupId: t.id } }, create: { productId, priceGroupId: t.id, price: v, zeroConfirmed }, update: { price: v, zeroConfirmed } });
  }
}

export async function setProductActive(f: FormData) {
  await requirePermission("products.manage");
  await db.product.update({ where: { id: String(f.get("id")) }, data: { active: f.get("active") === "true" } });
  revalidatePath("/products");
}
