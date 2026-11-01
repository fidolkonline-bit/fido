import { Prisma } from "@prisma/client";
import { db, type Tx } from "./db";
import { D, ZERO } from "./money";

// Saleable available quantity per product at one location (spec §6.2: available = saleable − reservations).
export async function availability(locationId: string, productIds?: string[]) {
  const rows = await db.costLayer.groupBy({
    by: ["productId"],
    where: { locationId, bucket: "SALEABLE", qtyRemaining: { gt: 0 }, ...(productIds ? { productId: { in: productIds } } : {}) },
    _sum: { qtyRemaining: true },
  });
  return new Map(rows.map((r) => [r.productId, D(r._sum.qtyRemaining)]));
}

export class StockError extends Error {}

type Layer = { id: string; qtyRemaining: Prisma.Decimal; unitCost: Prisma.Decimal };

// FIFO across eligible accepted cost layers. Rows are locked so two tills cannot consume the same unit (AC-08).
export async function allocateFifo(tx: Tx, productId: string, locationId: string, quantity: Prisma.Decimal, label: string) {
  const layers = await tx.$queryRaw<Layer[]>`
    SELECT id, "qtyRemaining", "unitCost" FROM "CostLayer"
    WHERE "productId" = ${productId} AND "locationId" = ${locationId}
      AND bucket = 'SALEABLE' AND "qtyRemaining" > 0
    ORDER BY "receivedAt", "createdAt"
    FOR UPDATE`;

  let needed = quantity;
  const picks: { layerId: string; qty: Prisma.Decimal; unitCost: Prisma.Decimal }[] = [];
  for (const l of layers) {
    if (needed.lte(0)) break;
    const take = Prisma.Decimal.min(D(l.qtyRemaining), needed);
    picks.push({ layerId: l.id, qty: take, unitCost: D(l.unitCost) });
    needed = needed.minus(take);
  }
  if (needed.gt(0)) {
    const have = quantity.minus(needed);
    throw new StockError(`Not enough stock for ${label}: ${have.toString()} available, ${quantity.toString()} requested.`);
  }
  for (const p of picks) {
    await tx.costLayer.update({ where: { id: p.layerId }, data: { qtyRemaining: { decrement: p.qty } } });
  }
  return picks;
}

export type Pick = { layerId: string; qty: Prisma.Decimal; unitCost: Prisma.Decimal; deviceId?: string };

// POS: take exactly the lots the salesperson chose (split across lots only when they said so). Each lot is locked and
// rechecked; a short lot is an error, never quietly topped up from another lot. With no choice sent, only a product
// with a single eligible lot may proceed. Cost stays each lot's own original cost.
export async function allocateChosenLots(tx: Tx, productId: string, locationId: string, quantity: Prisma.Decimal, chosen: { layerId: string; qty: number }[], label: string): Promise<Pick[]> {
  let lots = chosen.map((c) => ({ layerId: c.layerId, qty: D(c.qty) }));
  if (!lots.length) {
    const eligible = await tx.costLayer.findMany({ where: { productId, locationId, bucket: "SALEABLE", qtyRemaining: { gt: 0 } }, select: { id: true }, take: 2 });
    if (!eligible.length) throw new StockError(`No stock of ${label} at this location.`);
    if (eligible.length > 1) throw new StockError(`Choose which lot of ${label} is being sold.`);
    lots = [{ layerId: eligible[0].id, qty: quantity }];
  }
  if (new Set(lots.map((l) => l.layerId)).size !== lots.length) throw new StockError(`The same lot of ${label} was chosen twice.`);
  const sum = lots.reduce((a, l) => a.plus(l.qty), ZERO);
  if (!sum.eq(quantity)) throw new StockError(`Lots chosen for ${label} add up to ${sum.toString()}, not ${quantity.toString()}.`);
  const picks: Pick[] = [];
  for (const l of lots) {
    if (l.qty.lte(0)) throw new StockError(`Each lot of ${label} needs a quantity above 0.`);
    const layer = await takeFromLayer(tx, l.layerId, l.qty, ["SALEABLE"], { productId, locationId });
    picks.push({ layerId: layer.id, qty: l.qty, unitCost: layer.unitCost });
  }
  return picks;
}

// Explicit lot choice: take from one named layer, locked, in any bucket the caller permits.
export async function takeFromLayer(tx: Tx, layerId: string, quantity: Prisma.Decimal, buckets: string[] = ["SALEABLE"], expect?: { productId: string; locationId: string }) {
  const [layer] = await tx.$queryRaw<(Layer & { bucket: string; productId: string; locationId: string; lotCode: string | null })[]>`
    SELECT id, "qtyRemaining", "unitCost", bucket, "productId", "locationId", "lotCode" FROM "CostLayer" WHERE id = ${layerId} FOR UPDATE`;
  if (!layer) throw new StockError("That lot no longer exists.");
  if (expect && (layer.productId !== expect.productId || layer.locationId !== expect.locationId))
    throw new StockError(`Lot ${layer.lotCode ?? "(no lot)"} is not stock of this product at this location.`);
  if (!buckets.includes(layer.bucket)) throw new StockError(`Lot ${layer.lotCode ?? ""} is in ${layer.bucket.toLowerCase().replace("_", " ")}, not available here.`);
  if (D(layer.qtyRemaining).lt(quantity)) throw new StockError(`Lot ${layer.lotCode ?? "(no lot)"} has only ${D(layer.qtyRemaining).toString()} left.`);
  await tx.costLayer.update({ where: { id: layerId }, data: { qtyRemaining: { decrement: quantity } } });
  return { ...layer, unitCost: D(layer.unitCost) };
}

// Phones are sold, moved and written off by exact device: each IMEI takes one unit from its own cost layer.
export async function allocateDevices(tx: Tx, productId: string, locationId: string, deviceIds: string[], states = ["SALEABLE"]): Promise<Pick[]> {
  if (new Set(deviceIds).size !== deviceIds.length) throw new StockError("The same device was selected twice.");
  const devices = await tx.$queryRaw<{ id: string; productId: string; locationId: string | null; state: string; costLayerId: string | null; imei1: string | null; serial: string | null }[]>`
    SELECT id, "productId", "locationId", state, "costLayerId", imei1, serial FROM "DeviceIdentity" WHERE id = ANY(${deviceIds}) FOR UPDATE`;
  const picks: Pick[] = [];
  for (const id of deviceIds) {
    const d = devices.find((x) => x.id === id);
    const label = d?.imei1 ?? d?.serial ?? "device";
    if (!d || d.productId !== productId) throw new StockError(`Device ${label} does not belong to this product.`);
    if (d.locationId !== locationId || !states.includes(d.state)) throw new StockError(`Device ${label} is not available here (${d.state.toLowerCase()}).`);
    if (!d.costLayerId) throw new StockError(`Device ${label} has no cost record.`);
    const layer = await takeFromLayer(tx, d.costLayerId, D(1), ["SALEABLE", "INSPECTION", "SUPPLIER_HOLD"]);
    picks.push({ layerId: layer.id, qty: D(1), unitCost: layer.unitCost, deviceId: d.id });
  }
  return picks;
}

// A new layer derived from an existing one (return, transfer, hold release) keeps lot, cost and FIFO date.
export async function deriveLayer(
  tx: Tx,
  origin: { id: string; productId: string; lotCode: string | null; unitCost: Prisma.Decimal.Value; receivedAt: Date },
  data: { locationId: string; qty: Prisma.Decimal; bucket: string; sourceType: string; sourceId: string },
) {
  return tx.costLayer.create({
    data: {
      productId: origin.productId, locationId: data.locationId, lotCode: origin.lotCode, unitCost: origin.unitCost,
      receivedAt: origin.receivedAt, qtyIn: data.qty, qtyRemaining: data.qty, bucket: data.bucket,
      sourceType: data.sourceType, sourceId: data.sourceId, originLayerId: origin.id,
    },
  });
}

export async function storeCreditBalance(tx: Tx, contactId: string) {
  const agg = await tx.storeCreditEntry.aggregate({ where: { contactId }, _sum: { amount: true } });
  return D(agg._sum.amount);
}
