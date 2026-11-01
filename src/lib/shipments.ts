import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db, posting } from "./db";
import { D } from "./money";
import { receiveSalePayment } from "./payments";
import type { CurrentUser } from "./auth";

export class ShipmentError extends Error {}
export const SHIP_FLOW: Record<string, string[]> = {
  PENDING: ["PACKED", "DISPATCHED", "CANCELLED"], PACKED: ["DISPATCHED", "CANCELLED"], DISPATCHED: ["DELIVERED", "RETURNED"],
  DELIVERED: [], RETURNED: [], CANCELLED: [],
};

export const shipmentInput = z.object({
  saleId: z.string(),
  address: z.string().min(3, "Delivery address is required.").max(400),
  contactName: z.string().max(80).nullable().default(null),
  contactPhone: z.string().max(30).nullable().default(null),
  carrier: z.string().max(60).nullable().default(null),
  trackingRef: z.string().max(80).nullable().default(null),
  charge: z.coerce.number().min(0).default(0),
  codAmount: z.coerce.number().min(0).default(0),
  notes: z.string().max(300).nullable().default(null),
});

export async function createShipment(user: CurrentUser, raw: unknown) {
  const input = shipmentInput.parse(raw);
  const sale = await db.sale.findUniqueOrThrow({ where: { id: input.saleId } });
  const due = D(sale.total).minus(sale.paid).minus(sale.credited);
  if (D(input.codAmount).gt(due)) throw new ShipmentError(`Cash on delivery cannot be more than the Rs. ${due.toFixed(2)} still due on the sale.`);
  return db.shipment.create({ data: { ...input, history: [{ status: "PENDING", at: new Date().toISOString(), by: user.name }] } });
}

// Shipping a parcel never marks it paid; COD money is recorded only when the courier remits it (§8.4).
export async function setShipmentStatus(user: CurrentUser, id: string, status: string, note: string | null, deliveredTo: string | null) {
  await posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Shipment" WHERE id = ${id} FOR UPDATE`;
    const s = await tx.shipment.findUniqueOrThrow({ where: { id } });
    if (!SHIP_FLOW[s.status]?.includes(status)) throw new ShipmentError(`Cannot go from ${s.status.toLowerCase()} to ${status.toLowerCase()}.`);
    const history = [...(s.history as object[]), { status, at: new Date().toISOString(), by: user.name, note }];
    await tx.shipment.update({ where: { id }, data: { status, history: history as Prisma.InputJsonValue, ...(deliveredTo ? { deliveredTo } : {}) } });
  });
}

export async function remitCod(user: CurrentUser, id: string, raw: { amount: number; method: string; accountId: string | null; reference: string | null }) {
  const s = await db.shipment.findUniqueOrThrow({ where: { id } });
  const left = D(s.codAmount).minus(s.codRemitted);
  if (!(raw.amount > 0) || D(raw.amount).gt(left)) throw new ShipmentError(`Remit between 0.01 and ${left.toFixed(2)}.`);
  await receiveSalePayment(user, s.saleId, { ...raw, reference: raw.reference ?? `COD ${s.trackingRef ?? s.id.slice(-6)}` });
  await db.shipment.update({ where: { id }, data: { codRemitted: { increment: D(raw.amount) } } });
}
