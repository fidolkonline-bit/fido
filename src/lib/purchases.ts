import "server-only";
import { z } from "zod";
import { posting } from "./db";
import { D, ZERO } from "./money";
import { nextNumber } from "./numbering";
import type { CurrentUser } from "./auth";

export const receiptInput = z.object({
  idempotencyKey: z.string().min(8).max(80),
  supplierId: z.string().min(1, "Select a supplier."),
  supplierRef: z.string().max(80).nullable().default(null),
  purchaseOrderId: z.string().nullable().default(null),
  parcelId: z.string().nullable().default(null),
  notes: z.string().max(500).nullable().default(null),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        poLineId: z.string().nullable().default(null),
        lotCode: z.string().max(60).nullable().default(null),
        qtyReceived: z.coerce.number().positive(),
        qtyRejected: z.coerce.number().min(0).default(0),
        unitCost: z.coerce.number().min(0),
        newSellPrice: z.coerce.number().min(0).nullable().default(null),
        condition: z.enum(["NEW", "USED"]).default("NEW"),
        // One entry per accepted unit for IMEI/serial-tracked products. Kept as text: never strip leading zeros.
        devices: z
          .array(
            z.object({
              imei1: z.string().trim().regex(/^\d{14,17}$/, "IMEI must be 14–17 digits.").nullable().default(null),
              imei2: z.string().trim().regex(/^\d{14,17}$/, "IMEI 2 must be 14–17 digits.").nullable().default(null),
              serial: z.string().trim().max(60).nullable().default(null),
            }),
          )
          .default([]),
      }),
    )
    .min(1, "Add at least one received item."),
  payment: z
    .object({
      amount: z.coerce.number().positive(),
      method: z.enum(["CASH", "BANK_TRANSFER", "CHEQUE", "CARD", "OTHER"]),
      accountId: z.string().nullable().default(null),
      reference: z.string().max(80).nullable().default(null),
    })
    .nullable()
    .default(null),
});

export class ReceiptError extends Error {}

// Posting a GRN: accepted quantity becomes one cost layer per line; payment is a separate record (spec §7).
export async function postReceipt(user: CurrentUser, raw: unknown) {
  const input = receiptInput.parse(raw);
  const location = user.location;
  if (!location) throw new ReceiptError("No business location is assigned to your login.");

  return posting(async (tx) => {
    const existing = await tx.goodsReceipt.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, number: true } });
    if (existing) return existing;

    if (input.supplierRef) {
      const dup = await tx.goodsReceipt.findFirst({ where: { supplierId: input.supplierId, supplierRef: input.supplierRef, status: "POSTED" } });
      if (dup) throw new ReceiptError(`Supplier reference ${input.supplierRef} is already on ${dup.number}.`);
    }

    // Receiving against an order: lock it, check supplier/lines, and block over-receipt (spec §7).
    const order = input.purchaseOrderId
      ? await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${input.purchaseOrderId} FOR UPDATE`.then(() =>
          tx.purchaseOrder.findUniqueOrThrow({ where: { id: input.purchaseOrderId! }, include: { lines: true } }))
      : null;
    if (order) {
      if (order.supplierId !== input.supplierId) throw new ReceiptError("This purchase order is for a different supplier.");
      if (!["ORDERED", "PART_RECEIVED"].includes(order.status)) throw new ReceiptError(`Purchase order ${order.number} is ${order.status.toLowerCase().replace("_", " ")}.`);
    }

    const products = await tx.product.findMany({ where: { id: { in: input.lines.map((l) => l.productId) } } });
    const byId = new Map(products.map((p) => [p.id, p]));

    let total = ZERO;
    const lines = input.lines.map((l) => {
      const p = byId.get(l.productId);
      if (!p) throw new ReceiptError("A product on this receipt was not found.");
      const received = D(l.qtyReceived);
      const rejected = D(l.qtyRejected);
      if (rejected.gt(received)) throw new ReceiptError(`Rejected quantity for ${p.name} is more than received.`);
      const accepted = received.minus(rejected);
      const unitCost = D(l.unitCost).toDecimalPlaces(4);
      if (p.trackDevices && p.stockManaged) {
        if (!accepted.isInteger()) throw new ReceiptError(`${p.name} is tracked by device: quantities must be whole units.`);
        if (!accepted.eq(l.devices.length)) throw new ReceiptError(`Enter ${accepted.toString()} IMEI/serial for ${p.name} (${l.devices.length} entered).`);
        if (l.devices.some((d) => !d.imei1 && !d.serial)) throw new ReceiptError(`Every ${p.name} unit needs an IMEI or a serial number.`);
      }
      total = total.plus(accepted.mul(unitCost));
      if (l.poLineId) {
        const pol = order?.lines.find((x) => x.id === l.poLineId);
        if (!pol || pol.productId !== p.id) throw new ReceiptError(`${p.name} is not on the selected purchase order.`);
        const open = D(pol.qtyOrdered).minus(pol.qtyReceived);
        if (accepted.gt(open)) throw new ReceiptError(`Only ${open.toString()} of ${p.name} is still due on the order (over-receipt is blocked).`);
      }
      return { ...l, product: p, received, rejected, accepted, unitCost };
    });
    total = total.toDecimalPlaces(2);

    const payAmount = input.payment ? D(input.payment.amount).toDecimalPlaces(2) : ZERO;
    if (payAmount.gt(total)) throw new ReceiptError("Payment is more than the receipt total.");

    // The same physical device cannot be in stock twice.
    const imeis = lines.flatMap((l) => l.devices.map((d) => d.imei1).filter((x): x is string => !!x));
    if (new Set(imeis).size !== imeis.length) throw new ReceiptError("The same IMEI is entered twice on this receipt.");
    if (imeis.length) {
      const clash = await tx.deviceIdentity.findFirst({ where: { imei1: { in: imeis }, state: { notIn: ["SOLD", "WRITTEN_OFF"] } } });
      if (clash) throw new ReceiptError(`IMEI ${clash.imei1} is already in stock.`);
    }

    const number = await nextNumber(tx, "GRN");
    const receivedAt = new Date();
    const receipt = await tx.goodsReceipt.create({
      data: {
        number, supplierId: input.supplierId, locationId: location.id, supplierRef: input.supplierRef, notes: input.notes,
        status: "POSTED", receivedAt, total, paid: payAmount, idempotencyKey: input.idempotencyKey, createdById: user.personId,
        purchaseOrderId: order?.id ?? null,
      },
    });

    for (const l of lines) {
      const line = await tx.receiptLine.create({
        data: {
          receiptId: receipt.id, productId: l.product.id, poLineId: l.poLineId, lotCode: l.lotCode || null, qtyReceived: l.received,
          qtyAccepted: l.accepted, qtyRejected: l.rejected, unitCost: l.unitCost, newSellPrice: l.newSellPrice,
        },
      });
      if (l.accepted.gt(0) && l.product.stockManaged) {
        const layer = await tx.costLayer.create({
          data: {
            productId: l.product.id, locationId: location.id, receiptLineId: line.id, lotCode: l.lotCode || null,
            qtyIn: l.accepted, qtyRemaining: l.accepted, unitCost: l.unitCost, receivedAt,
          },
        });
        await tx.stockMovement.create({
          data: {
            productId: l.product.id, locationId: location.id, costLayerId: layer.id, qty: l.accepted, unitCost: l.unitCost,
            kind: "RECEIPT", sourceType: "GoodsReceipt", sourceId: receipt.id, reference: number, actorId: user.personId,
          },
        });
        if (l.product.trackDevices) {
          await tx.deviceIdentity.createMany({
            data: l.devices.map((d) => ({
              productId: l.product.id, receiptLineId: line.id, costLayerId: layer.id, locationId: location.id,
              imei1: d.imei1, imei2: d.imei2, serial: d.serial, condition: l.condition,
            })),
          });
        }
      }
      // New default cost/price affects future sales only; posted history keeps its own costs.
      await tx.product.update({
        where: { id: l.product.id },
        data: { defaultCost: l.unitCost, ...(l.newSellPrice != null ? { sellPrice: D(l.newSellPrice) } : {}) },
      });
    }

    if (order) {
      for (const l of lines.filter((x) => x.poLineId)) {
        await tx.purchaseOrderLine.update({ where: { id: l.poLineId! }, data: { qtyReceived: { increment: l.accepted } } });
      }
      const after = await tx.purchaseOrderLine.findMany({ where: { orderId: order.id } });
      const complete = after.every((x) => D(x.qtyReceived).gte(x.qtyOrdered));
      await tx.purchaseOrder.update({ where: { id: order.id }, data: { status: complete ? "RECEIVED" : "PART_RECEIVED" } });
    }

    if (input.parcelId) {
      // Checked bus parcel contents are now received: link and close the parcel (collection alone never added stock).
      const parcel = await tx.busParcel.findUnique({ where: { id: input.parcelId } });
      if (!parcel || !["CHECKED", "EXCEPTION"].includes(parcel.status) || parcel.receiptId) throw new ReceiptError("That bus parcel is not checked or is already received.");
      await tx.busParcel.update({ where: { id: parcel.id }, data: { receiptId: receipt.id, status: "CLOSED" } });
    }

    if (input.payment && payAmount.gt(0)) {
      await tx.payment.create({
        data: {
          number: await nextNumber(tx, "PAYMENT_OUT"), direction: "OUT", method: input.payment.method, amount: payAmount,
          accountId: input.payment.accountId, contactId: input.supplierId, receiptId: receipt.id, reference: input.payment.reference,
          createdById: user.personId,
        },
      });
    }

    await tx.auditEvent.create({
      data: { actorId: user.personId, action: "RECEIPT_POSTED", subjectType: "GoodsReceipt", subjectId: receipt.id, detail: { number, total: total.toString() } },
    });
    return { id: receipt.id, number };
  });
}

// ───────────── Purchase orders ─────────────

export const orderInput = z.object({
  idempotencyKey: z.string().min(8).max(80),
  supplierId: z.string().min(1, "Select a supplier."),
  expectedAt: z.coerce.date().nullable().default(null),
  notes: z.string().max(500).nullable().default(null),
  lines: z.array(z.object({ productId: z.string(), qty: z.coerce.number().positive(), unitCost: z.coerce.number().min(0) })).min(1, "Add at least one item."),
});

export async function createOrder(user: CurrentUser, raw: unknown) {
  const input = orderInput.parse(raw);
  const location = user.location;
  if (!location) throw new ReceiptError("No business location is assigned to your login.");
  return posting(async (tx) => {
    const existing = await tx.purchaseOrder.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, number: true } });
    if (existing) return existing;
    const total = input.lines.reduce((a, l) => a.plus(D(l.qty).mul(l.unitCost)), ZERO).toDecimalPlaces(2);
    const number = await nextNumber(tx, "PURCHASE_ORDER");
    const po = await tx.purchaseOrder.create({
      data: {
        number, supplierId: input.supplierId, locationId: location.id, expectedAt: input.expectedAt, notes: input.notes, total,
        idempotencyKey: input.idempotencyKey, createdById: user.personId,
        lines: { create: input.lines.map((l) => ({ productId: l.productId, qtyOrdered: D(l.qty), unitCost: D(l.unitCost) })) },
      },
    });
    await tx.auditEvent.create({ data: { actorId: user.personId, action: "PO_CREATED", subjectType: "PurchaseOrder", subjectId: po.id, detail: { number } } });
    return { id: po.id, number };
  });
}

// Close a part-received order (remaining quantity will not come) or cancel an unreceived one.
export async function closeOrder(user: CurrentUser, orderId: string) {
  return posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${orderId} FOR UPDATE`;
    const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } });
    if (!["ORDERED", "PART_RECEIVED"].includes(po.status)) throw new ReceiptError("This order is already finished.");
    const status = po.status === "ORDERED" ? "CANCELLED" : "CLOSED";
    await tx.purchaseOrder.update({ where: { id: orderId }, data: { status } });
    await tx.auditEvent.create({ data: { actorId: user.personId, action: `PO_${status}`, subjectType: "PurchaseOrder", subjectId: orderId } });
    return { status };
  });
}
