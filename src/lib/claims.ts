import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { posting } from "./db";
import { D, ZERO } from "./money";
import { nextNumber } from "./numbering";
import { allocateDevices, deriveLayer, takeFromLayer, type Pick } from "./stock";
import type { CurrentUser } from "./auth";

export class ClaimError extends Error {}

export const claimInput = z.object({
  idempotencyKey: z.string().min(8).max(80),
  supplierId: z.string().min(1, "Choose the supplier."),
  reason: z.string().max(300).nullable().default(null),
  notes: z.string().max(500).nullable().default(null),
  lines: z
    .array(z.object({ productId: z.string(), costLayerId: z.string().nullable().default(null), qty: z.coerce.number().positive(), deviceIds: z.array(z.string()).default([]) }))
    .min(1, "Add at least one item."),
});

// Dispatch to supplier: the goods leave stock now, at their original lot cost (spec S07).
export async function sendClaim(user: CurrentUser, raw: unknown) {
  const input = claimInput.parse(raw);
  const location = user.location;
  if (!location) throw new ClaimError("No business location is assigned to your login.");
  return posting(async (tx) => {
    const existing = await tx.supplierClaim.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, number: true } });
    if (existing) return existing;
    const number = await nextNumber(tx, "SUPPLIER_CLAIM");
    const claim = await tx.supplierClaim.create({
      data: { number, supplierId: input.supplierId, locationId: location.id, reason: input.reason, notes: input.notes, claimValue: 0, idempotencyKey: input.idempotencyKey, createdById: user.personId },
    });
    let value = ZERO;
    for (const l of input.lines) {
      const product = await tx.product.findUniqueOrThrow({ where: { id: l.productId } });
      const qty = D(l.qty);
      let picks: Pick[];
      if (product.trackDevices) {
        if (!qty.eq(l.deviceIds.length)) throw new ClaimError(`Select the ${qty.toString()} device(s) of ${product.name} being sent.`);
        picks = await allocateDevices(tx, product.id, location.id, l.deviceIds, ["SALEABLE", "HELD"]);
      } else {
        if (!l.costLayerId) throw new ClaimError(`Choose which lot of ${product.name} is going back.`);
        const layer = await takeFromLayer(tx, l.costLayerId, qty, ["SALEABLE", "INSPECTION", "SUPPLIER_HOLD"]);
        if (layer.productId !== product.id || layer.locationId !== location.id) throw new ClaimError("That lot is not this product at this location.");
        picks = [{ layerId: layer.id, qty, unitCost: layer.unitCost }];
      }
      for (const p of picks) {
        const layer = await tx.costLayer.findUniqueOrThrow({ where: { id: p.layerId } });
        value = value.plus(p.qty.mul(p.unitCost));
        await tx.supplierClaimLine.create({
          data: { claimId: claim.id, productId: product.id, costLayerId: layer.id, deviceId: p.deviceId ?? null, lotCode: layer.lotCode, qty: p.qty, unitCost: p.unitCost, fromBucket: layer.bucket },
        });
        await tx.stockMovement.create({
          data: { productId: product.id, locationId: location.id, costLayerId: layer.id, qty: p.qty.neg(), unitCost: p.unitCost, kind: "SUPPLIER_RETURN", sourceType: "SupplierClaim", sourceId: claim.id, reference: number, actorId: user.personId },
        });
        if (p.deviceId) await tx.deviceIdentity.update({ where: { id: p.deviceId }, data: { state: "WITH_SUPPLIER" } });
      }
    }
    await tx.supplierClaim.update({ where: { id: claim.id }, data: { claimValue: value.toDecimalPlaces(2) } });
    await tx.auditEvent.create({ data: { actorId: user.personId, action: "SUPPLIER_CLAIM_SENT", subjectType: "SupplierClaim", subjectId: claim.id, detail: { number, value: value.toString() } } });
    return { id: claim.id, number };
  });
}

export const settleInput = z.object({
  claimId: z.string(),
  creditAmount: z.coerce.number().min(0).default(0),
  refund: z.object({ amount: z.coerce.number().positive(), method: z.enum(["CASH", "BANK_TRANSFER", "CHEQUE", "OTHER"]), accountId: z.string().nullable().default(null), reference: z.string().max(80).nullable().default(null) }).nullable().default(null),
  lines: z.array(z.object({ lineId: z.string(), qtyReplaced: z.coerce.number().min(0).default(0), qtyRejected: z.coerce.number().min(0).default(0), rejectedTo: z.enum(["SUPPLIER_HOLD", "WRITTEN_OFF"]).default("SUPPLIER_HOLD") })),
});

// Record what the supplier actually did — once. Expected recovery is never booked as received (§7, §11).
export async function settleClaim(user: CurrentUser, raw: unknown) {
  const input = settleInput.parse(raw);
  return posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "SupplierClaim" WHERE id = ${input.claimId} FOR UPDATE`;
    const claim = await tx.supplierClaim.findUniqueOrThrow({ where: { id: input.claimId }, include: { lines: { include: { product: true } } } });
    if (claim.status !== "SENT") throw new ClaimError("This claim is already settled.");
    if (!user.locations.some((l) => l.id === claim.locationId)) throw new ClaimError("You are not assigned to the location that sent this claim.");

    let replacedValue = ZERO;
    let rejectedBack = ZERO;
    let writtenOff = ZERO;
    const move = (productId: string, layerId: string, qty: Prisma.Decimal, unitCost: Prisma.Decimal, kind: string) =>
      tx.stockMovement.create({ data: { productId, locationId: claim.locationId, costLayerId: layerId, qty, unitCost, kind, sourceType: "SupplierClaim", sourceId: claim.id, reference: claim.number, actorId: user.personId } });

    for (const line of claim.lines) {
      const o = input.lines.find((x) => x.lineId === line.id) ?? { qtyReplaced: 0, qtyRejected: 0, rejectedTo: "SUPPLIER_HOLD" as const };
      const replaced = D(o.qtyReplaced);
      const rejected = D(o.qtyRejected);
      if (replaced.plus(rejected).gt(line.qty)) throw new ClaimError(`${line.product.name}: replaced + rejected is more than was sent.`);
      if (line.deviceId && replaced.gt(0)) throw new ClaimError(`A replacement phone has a new IMEI: receive it through Receive goods, and record credit here instead.`);
      const origin = await tx.costLayer.findUniqueOrThrow({ where: { id: line.costLayerId } });

      if (replaced.gt(0)) {
        // Replacement units are new saleable stock at the original cost; they sell after older stock (FIFO date = today).
        const layer = await deriveLayer(tx, { ...origin, receivedAt: new Date() }, { locationId: claim.locationId, qty: replaced, bucket: "SALEABLE", sourceType: "SupplierClaim", sourceId: claim.id });
        await move(line.productId, layer.id, replaced, D(line.unitCost), "SUPPLIER_REPLACEMENT");
        replacedValue = replacedValue.plus(replaced.mul(line.unitCost));
      }
      if (rejected.gt(0)) {
        if (o.rejectedTo === "SUPPLIER_HOLD") {
          const layer = await deriveLayer(tx, origin, { locationId: claim.locationId, qty: rejected, bucket: "SUPPLIER_HOLD", sourceType: "SupplierClaim", sourceId: claim.id });
          await move(line.productId, layer.id, rejected, D(line.unitCost), "SUPPLIER_REJECTED");
          rejectedBack = rejectedBack.plus(rejected.mul(line.unitCost));
          if (line.deviceId) await tx.deviceIdentity.update({ where: { id: line.deviceId }, data: { state: "HELD", costLayerId: layer.id } });
        } else {
          writtenOff = writtenOff.plus(rejected.mul(line.unitCost));
          if (line.deviceId) await tx.deviceIdentity.update({ where: { id: line.deviceId }, data: { state: "WRITTEN_OFF" } });
        }
      } else if (line.deviceId) {
        await tx.deviceIdentity.update({ where: { id: line.deviceId }, data: { state: "RETURNED_TO_SUPPLIER" } });
      }
      await tx.supplierClaimLine.update({ where: { id: line.id }, data: { qtyReplaced: replaced, qtyRejected: rejected, rejectedTo: rejected.gt(0) ? o.rejectedTo : null } });
    }

    let refundAmount = ZERO;
    if (input.refund) {
      refundAmount = D(input.refund.amount).toDecimalPlaces(2);
      let registerId: string | null = null;
      let accountId = input.refund.accountId;
      if (input.refund.method === "CASH") {
        registerId = (await tx.registerSession.findFirst({ where: { locationId: claim.locationId, userId: user.personId, closedAt: null } }))?.id ?? null;
        accountId ??= (await tx.account.findFirst({ where: { type: "CASH", active: true, locationId: claim.locationId } }))?.id ?? null;
      }
      if (!accountId) throw new ClaimError("Choose the account the refund was paid into.");
      await tx.payment.create({
        data: {
          number: await nextNumber(tx, "PAYMENT_IN"), direction: "IN", method: input.refund.method, amount: refundAmount, accountId, registerId,
          contactId: claim.supplierId, claimId: claim.id, reference: input.refund.reference, createdById: user.personId,
        },
      });
    }

    const creditAmount = D(input.creditAmount).toDecimalPlaces(2);
    const lossValue = D(claim.claimValue).minus(creditAmount).minus(refundAmount).minus(replacedValue).minus(rejectedBack).toDecimalPlaces(2);
    await tx.supplierClaim.update({
      where: { id: claim.id },
      data: {
        status: "SETTLED", settledAt: new Date(), creditAmount, refundAmount,
        replacedValue: replacedValue.toDecimalPlaces(2), rejectedValue: rejectedBack.plus(writtenOff).toDecimalPlaces(2), lossValue,
      },
    });
    await tx.auditEvent.create({ data: { actorId: user.personId, action: "SUPPLIER_CLAIM_SETTLED", subjectType: "SupplierClaim", subjectId: claim.id, detail: { loss: lossValue.toString() } } });
    return { id: claim.id, lossValue: lossValue.toFixed(2) };
  });
}
