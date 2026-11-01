"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { postAdjustment, dispatchTransfer, receiveTransfer } from "@/lib/adjustments";
import { formError } from "@/lib/forms";

type Result = { id?: string; number?: string; error?: string };

export async function submitAdjustment(payload: unknown): Promise<Result> {
  const user = await requirePermission("stock.adjust");
  try {
    const r = await postAdjustment(user, payload);
    revalidatePath("/adjustments");
    revalidatePath("/products");
    return r;
  } catch (e) {
    return formError(e) ?? {};
  }
}

export async function submitTransfer(payload: unknown): Promise<Result> {
  const user = await requirePermission("stock.transfer");
  try {
    const r = await dispatchTransfer(user, payload);
    revalidatePath("/transfers");
    return r;
  } catch (e) {
    return formError(e) ?? {};
  }
}

export async function submitTransferReceipt(payload: unknown): Promise<Result> {
  const user = await requirePermission("stock.transfer");
  try {
    const r = await receiveTransfer(user, payload);
    revalidatePath("/transfers");
    revalidatePath(`/transfers/${r.id}`);
    return r;
  } catch (e) {
    return formError(e) ?? {};
  }
}
