"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";

const printedInput = z.array(z.object({ lineId: z.string().min(1), qty: z.number().int().min(1).max(500) })).min(1).max(200);

// Staff confirm the labels came out of the printer; only then are they counted against the GRN line.
export async function recordGrnLabelsPrinted(raw: unknown): Promise<{ ok?: true; error?: string }> {
  const user = await requirePermission("products.view");
  const parsed = printedInput.safeParse(raw);
  if (!parsed.success) return { error: "Nothing to record." };
  const lines = await db.receiptLine.findMany({ where: { id: { in: parsed.data.map((x) => x.lineId) } }, select: { id: true, receiptId: true } });
  if (lines.length !== new Set(parsed.data.map((x) => x.lineId)).size) return { error: "A GRN line was not found." };
  await db.$transaction([
    ...parsed.data.map((x) => db.receiptLine.update({ where: { id: x.lineId }, data: { labelsPrinted: { increment: x.qty } } })),
    ...[...new Set(lines.map((l) => l.receiptId))].map((receiptId) => db.auditEvent.create({
      data: { actorId: user.personId, action: "GRN_LABELS_PRINTED", subjectType: "GoodsReceipt", subjectId: receiptId, detail: parsed.data.filter((x) => lines.find((l) => l.id === x.lineId)?.receiptId === receiptId) },
    })),
  ]);
  for (const id of new Set(lines.map((l) => l.receiptId))) revalidatePath(`/purchases/${id}`);
  return { ok: true };
}
