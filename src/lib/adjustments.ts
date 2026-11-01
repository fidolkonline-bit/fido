import "server-only";
import { z } from "zod";
import { posting } from "./db";
import { D } from "./money";
import { nextNumber } from "./numbering";
import { allocateDevices, allocateFifo, deriveLayer, takeFromLayer, type Pick } from "./stock";
import type { CurrentUser } from "./auth";

export const ADJUST_REASONS = {
  WASTAGE: "Wastage",
  DAMAGE: "Damaged",
  LOSS: "Lost / stolen",
  COUNT_CORRECTION: "Stock count correction",
  FOUND: "Found stock",
  RELEASE_HOLD: "Release held stock",
  OTHER: "Other",
} as const;

export const adjustmentInput = z.object({
  idempotencyKey: z.string().min(8).max(80),
  kind: z.enum(["NORMAL", "ABNORMAL"]).default("NORMAL"),
  reason: z.enum(["WASTAGE", "DAMAGE", "LOSS", "COUNT_CORRECTION", "FOUND", "RELEASE_HOLD", "OTHER"]),
  notes: z.string().max(500).nullable().default(null),
  recoveredAmount: z.coerce.number().min(0).default(0),
  lines: z
    .array(
      z.object({
        productId: z.string(),
        mode: z.enum(["REMOVE", "ADD", "RELEASE"]),
        qty: z.coerce.number().positive(),
        costLayerId: z.string().nullable().default(null), // explicit lot; REMOVE without it uses FIFO
        unitCost: z.coerce.number().min(0).nullable().default(null), // ADD only
        lotCode: z.string().max(60).nullable().default(null), // ADD only
        toBucket: z.enum(["SALEABLE", "SUPPLIER_HOLD", "INSPECTION"]).default("SALEABLE"), // RELEASE only
        deviceIds: z.array(z.string()).default([]),
      }),
    )
    .min(1, "Add at least one line."),
});

export class AdjustmentError extends Error {}

export async function postAdjustment(user: CurrentUser, raw: unknown) {
  const input = adjustmentInput.parse(raw);
  const location = user.location;
  if (!location) throw new AdjustmentError("No business location is assigned to your login.");

  return posting(async (tx) => {
    const existing = await tx.stockAdjustment.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, number: true } });
    if (existing) return existing;

    const number = await nextNumber(tx, "ADJUSTMENT");
    const adj = await tx.stockAdjustment.create({
      data: {
        number, locationId: location.id, kind: input.kind, reason: input.reason, notes: input.notes,
        recoveredAmount: input.recoveredAmount, idempotencyKey: input.idempotencyKey, createdById: user.personId,
      },
    });
    const move = (productId: string, costLayerId: string, qty: ReturnType<typeof D>, unitCost: ReturnType<typeof D>, kind: string) =>
      tx.stockMovement.create({
        data: { productId, locationId: location.id, costLayerId, qty, unitCost, kind, sourceType: "StockAdjustment", sourceId: adj.id, reference: number, actorId: user.personId },
      });

    for (const l of input.lines) {
      const product = await tx.product.findUniqueOrThrow({ where: { id: l.productId } });
      if (!product.stockManaged) throw new AdjustmentError(`${product.name} is not stock-managed.`);
      const qty = D(l.qty);
      const tracked = product.trackDevices;
      if (tracked && l.mode !== "ADD" && !qty.eq(l.deviceIds.length))
        throw new AdjustmentError(`Select the ${qty.toString()} device(s) of ${product.name} being adjusted.`);

      if (l.mode === "REMOVE") {
        // Write-off keeps the original cost basis of the exact lots removed (§11 wastage).
        let picks: Pick[];
        if (tracked) picks = await allocateDevices(tx, product.id, location.id, l.deviceIds, ["SALEABLE", "HELD"]);
        else if (l.costLayerId) {
          const layer = await takeFromLayer(tx, l.costLayerId, qty, ["SALEABLE", "INSPECTION", "SUPPLIER_HOLD"]);
          if (layer.productId !== product.id || layer.locationId !== location.id) throw new AdjustmentError("That lot is not this product at this location.");
          picks = [{ layerId: layer.id, qty, unitCost: layer.unitCost }];
        } else picks = await allocateFifo(tx, product.id, location.id, qty, product.name);
        for (const p of picks) {
          const layer = await tx.costLayer.findUniqueOrThrow({ where: { id: p.layerId } });
          await tx.stockAdjustmentLine.create({
            data: { adjustmentId: adj.id, productId: product.id, costLayerId: p.layerId, lotCode: layer.lotCode, qty: p.qty.neg(), unitCost: p.unitCost, fromBucket: layer.bucket, toBucket: "WRITTEN_OFF" },
          });
          await move(product.id, p.layerId, p.qty.neg(), p.unitCost, "ADJUSTMENT");
          if (p.deviceId) await tx.deviceIdentity.update({ where: { id: p.deviceId }, data: { state: "WRITTEN_OFF" } });
        }
      } else if (l.mode === "ADD") {
        if (tracked) throw new AdjustmentError(`Add ${product.name} units through Receive goods so each IMEI is recorded.`);
        const unitCost = D(l.unitCost ?? product.defaultCost);
        const layer = await tx.costLayer.create({
          data: {
            productId: product.id, locationId: location.id, lotCode: l.lotCode, qtyIn: qty, qtyRemaining: qty, unitCost,
            receivedAt: new Date(), sourceType: "StockAdjustment", sourceId: adj.id,
          },
        });
        await tx.stockAdjustmentLine.create({ data: { adjustmentId: adj.id, productId: product.id, costLayerId: layer.id, lotCode: l.lotCode, qty, unitCost, toBucket: "SALEABLE" } });
        await move(product.id, layer.id, qty, unitCost, "ADJUSTMENT");
      } else {
        // RELEASE: move held stock (inspection / supplier hold) to another bucket, keeping lot, cost and FIFO date.
        if (!l.costLayerId && !tracked) throw new AdjustmentError("Choose the held lot to release.");
        const picks: Pick[] = tracked
          ? await allocateDevices(tx, product.id, location.id, l.deviceIds, ["HELD"])
          : [await takeFromLayer(tx, l.costLayerId!, qty, ["INSPECTION", "SUPPLIER_HOLD"]).then((x) => ({ layerId: x.id, qty, unitCost: x.unitCost }))];
        for (const p of picks) {
          const from = await tx.costLayer.findUniqueOrThrow({ where: { id: p.layerId } });
          if (from.bucket === l.toBucket) throw new AdjustmentError("The stock is already in that bucket.");
          const to = await deriveLayer(tx, from, { locationId: location.id, qty: p.qty, bucket: l.toBucket, sourceType: "StockAdjustment", sourceId: adj.id });
          await tx.stockAdjustmentLine.create({
            data: { adjustmentId: adj.id, productId: product.id, costLayerId: from.id, lotCode: from.lotCode, qty: p.qty, unitCost: p.unitCost, fromBucket: from.bucket, toBucket: l.toBucket },
          });
          await move(product.id, from.id, p.qty.neg(), p.unitCost, "DISPOSITION");
          await move(product.id, to.id, p.qty, p.unitCost, "DISPOSITION");
          if (p.deviceId) await tx.deviceIdentity.update({ where: { id: p.deviceId }, data: { state: l.toBucket === "SALEABLE" ? "SALEABLE" : "HELD", costLayerId: to.id } });
        }
      }
    }

    await tx.auditEvent.create({ data: { actorId: user.personId, action: "ADJUSTMENT_POSTED", subjectType: "StockAdjustment", subjectId: adj.id, detail: { number, reason: input.reason } } });
    return { id: adj.id, number };
  });
}

// ───────────── Transfers (spec ST01) ─────────────

export const transferInput = z.object({
  idempotencyKey: z.string().min(8).max(80),
  toLocationId: z.string().min(1, "Choose the destination."),
  notes: z.string().max(500).nullable().default(null),
  lines: z.array(z.object({ productId: z.string(), qty: z.coerce.number().positive(), deviceIds: z.array(z.string()).default([]) })).min(1, "Add at least one item."),
});

// Dispatch: stock leaves the source now (in transit); lot, cost and FIFO date travel with it (AC-31).
export async function dispatchTransfer(user: CurrentUser, raw: unknown) {
  const input = transferInput.parse(raw);
  const from = user.location;
  if (!from) throw new AdjustmentError("No business location is assigned to your login.");
  if (input.toLocationId === from.id) throw new AdjustmentError("Source and destination are the same location.");

  return posting(async (tx) => {
    const existing = await tx.stockTransfer.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, number: true } });
    if (existing) return existing;
    await tx.location.findFirstOrThrow({ where: { id: input.toLocationId, active: true } });

    const number = await nextNumber(tx, "TRANSFER");
    const t = await tx.stockTransfer.create({
      data: { number, fromLocationId: from.id, toLocationId: input.toLocationId, notes: input.notes, idempotencyKey: input.idempotencyKey, createdById: user.personId },
    });
    for (const l of input.lines) {
      const product = await tx.product.findUniqueOrThrow({ where: { id: l.productId } });
      const qty = D(l.qty);
      if (product.trackDevices && !qty.eq(l.deviceIds.length)) throw new AdjustmentError(`Select the ${qty.toString()} device(s) of ${product.name} to send.`);
      const picks: Pick[] = product.trackDevices
        ? await allocateDevices(tx, product.id, from.id, l.deviceIds)
        : await allocateFifo(tx, product.id, from.id, qty, product.name);
      for (const p of picks) {
        const layer = await tx.costLayer.findUniqueOrThrow({ where: { id: p.layerId } });
        await tx.stockTransferLine.create({
          data: { transferId: t.id, productId: product.id, sourceLayerId: layer.id, deviceId: p.deviceId ?? null, lotCode: layer.lotCode, unitCost: p.unitCost, originReceivedAt: layer.receivedAt, qtySent: p.qty },
        });
        await tx.stockMovement.create({
          data: { productId: product.id, locationId: from.id, costLayerId: layer.id, qty: p.qty.neg(), unitCost: p.unitCost, kind: "TRANSFER_OUT", sourceType: "StockTransfer", sourceId: t.id, reference: number, actorId: user.personId },
        });
        if (p.deviceId) await tx.deviceIdentity.update({ where: { id: p.deviceId }, data: { state: "IN_TRANSIT" } });
      }
    }
    await tx.auditEvent.create({ data: { actorId: user.personId, action: "TRANSFER_DISPATCHED", subjectType: "StockTransfer", subjectId: t.id, detail: { number } } });
    return { id: t.id, number };
  });
}

export const receiveInput = z.object({
  transferId: z.string(),
  lines: z.array(z.object({ lineId: z.string(), qtyReceived: z.coerce.number().min(0) })),
});

// Receive at the destination: received quantity creates layers there; any shortfall stays visible as a discrepancy.
export async function receiveTransfer(user: CurrentUser, raw: unknown) {
  const input = receiveInput.parse(raw);
  return posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "StockTransfer" WHERE id = ${input.transferId} FOR UPDATE`;
    const t = await tx.stockTransfer.findUniqueOrThrow({ where: { id: input.transferId }, include: { lines: { include: { product: true } } } });
    if (t.status !== "IN_TRANSIT") throw new AdjustmentError("This transfer has already been received.");
    if (!user.locations.some((l) => l.id === t.toLocationId)) throw new AdjustmentError("You are not assigned to the destination location.");

    for (const line of t.lines) {
      const got = D(input.lines.find((x) => x.lineId === line.id)?.qtyReceived ?? line.qtySent);
      if (got.gt(line.qtySent)) throw new AdjustmentError(`More ${line.product.name} received than sent.`);
      if (line.product.trackDevices && !got.eq(line.qtySent)) throw new AdjustmentError(`Devices must be received in full; record a missing phone with a stock adjustment after receiving.`);
      await tx.stockTransferLine.update({ where: { id: line.id }, data: { qtyReceived: got } });
      if (got.lte(0)) continue;
      const layer = await deriveLayer(
        tx,
        { id: line.sourceLayerId, productId: line.productId, lotCode: line.lotCode, unitCost: line.unitCost, receivedAt: line.originReceivedAt },
        { locationId: t.toLocationId, qty: got, bucket: "SALEABLE", sourceType: "StockTransfer", sourceId: t.id },
      );
      await tx.stockMovement.create({
        data: { productId: line.productId, locationId: t.toLocationId, costLayerId: layer.id, qty: got, unitCost: line.unitCost, kind: "TRANSFER_IN", sourceType: "StockTransfer", sourceId: t.id, reference: t.number, actorId: user.personId },
      });
      if (line.deviceId) {
        await tx.deviceIdentity.update({ where: { id: line.deviceId }, data: { state: "SALEABLE", locationId: t.toLocationId, costLayerId: layer.id } });
      }
    }
    await tx.stockTransfer.update({ where: { id: t.id }, data: { status: "RECEIVED", receivedAt: new Date(), receivedById: user.personId } });
    await tx.auditEvent.create({ data: { actorId: user.personId, action: "TRANSFER_RECEIVED", subjectType: "StockTransfer", subjectId: t.id, detail: { number: t.number } } });
    return { id: t.id, number: t.number, shortfall: t.lines.some((l) => D(input.lines.find((x) => x.lineId === l.id)?.qtyReceived ?? l.qtySent).lt(l.qtySent)) };
  });
}

