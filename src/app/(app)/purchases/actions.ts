"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { postReceipt, autoLotCode } from "@/lib/purchases";
import { formError } from "@/lib/forms";
import { completeReceipt } from "@/lib/quick-receive";

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

// What the GRN lot will be if staff leave it on auto (shown, editable, on the receive form).
export async function previewLot(supplierId: string): Promise<string | null> {
  await requirePermission("purchases.post");
  if (!supplierId) return null;
  return autoLotCode(db, supplierId, new Date()).catch(() => null);
}

export type CostHistoryRow = { at: string; number: string; supplier: string; qty: string; unitCost: string; newSellPrice: string | null };

// Last few posted GRN lines for a product, newest first, so staff can compare this delivery's cost (and decide on a
// new selling price) against what was paid before. Reversed receipts and ones still waiting for cost are left out.
// Needs cost visibility.
export async function productCostHistory(productId: string): Promise<CostHistoryRow[]> {
  const user = await requirePermission("purchases.post");
  if (!can(user, "cost.view")) return [];
  const rows = await db.receiptLine.findMany({
    where: { productId, receipt: { status: "POSTED" } },
    orderBy: { receipt: { receivedAt: "desc" } },
    take: 5,
    select: { qtyAccepted: true, unitCost: true, newSellPrice: true, receipt: { select: { number: true, receivedAt: true, supplier: { select: { name: true } } } } },
  });
  return rows.map((r) => ({
    at: r.receipt.receivedAt.toISOString(), number: r.receipt.number, supplier: r.receipt.supplier?.name ?? "",
    qty: r.qtyAccepted.toString(), unitCost: r.unitCost.toString(), newSellPrice: r.newSellPrice?.toString() ?? null,
  }));
}

// Owner / manager adds the cost to a quick-received GRN (needs to see costs as well as post GRNs).
export async function submitCompleteReceipt(payload: unknown): Promise<{ id?: string; number?: string; error?: string }> {
  const user = await requirePermission("purchases.post");
  if (!can(user, "cost.view")) return { error: "You need permission to see costs to complete this GRN." };
  try {
    const r = await completeReceipt(user, payload);
    revalidatePath("/purchases");
    revalidatePath(`/purchases/${r.id}`);
    revalidatePath("/products");
    return r;
  } catch (e) {
    return formError(e) ?? {};
  }
}
