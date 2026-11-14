"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { postReceipt } from "@/lib/purchases";
import { formError } from "@/lib/forms";

export async function submitReceipt(payload: unknown): Promise<{ id?: string; number?: string; error?: string }> {
  const user = await requirePermission("purchases.post");
  try {
    const r = await postReceipt(user, payload);
    revalidatePath("/purchases");
    revalidatePath("/products");
    return r;
  } catch (e) {
    return formError(e) ?? {};
  }
}

export type CostHistoryRow = { at: string; number: string; supplier: string; qty: string; unitCost: string; newSellPrice: string | null };

// Last few posted GRN lines for a product, newest first, so staff can compare this delivery's cost (and decide on a
// new selling price) against what was paid before. Reversed receipts are left out. Needs cost visibility.
export async function productCostHistory(productId: string): Promise<CostHistoryRow[]> {
  const user = await requirePermission("purchases.post");
  if (!can(user, "cost.view")) return [];
  const rows = await db.receiptLine.findMany({
    where: { productId, receipt: { status: { not: "REVERSED" } } },
    orderBy: { receipt: { receivedAt: "desc" } },
    take: 5,
    select: { qtyAccepted: true, unitCost: true, newSellPrice: true, receipt: { select: { number: true, receivedAt: true, supplier: { select: { name: true } } } } },
  });
  return rows.map((r) => ({
    at: r.receipt.receivedAt.toISOString(), number: r.receipt.number, supplier: r.receipt.supplier.name,
    qty: r.qtyAccepted.toString(), unitCost: r.unitCost.toString(), newSellPrice: r.newSellPrice?.toString() ?? null,
  }));
}
