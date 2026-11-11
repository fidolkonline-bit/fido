import "server-only";
import { db, posting } from "./db";
import { D, ZERO } from "./money";
import { nextNumber } from "./numbering";
import { postAdjustment } from "./adjustments";
import type { CurrentUser } from "./auth";

export class CountError extends Error {}

// Open a count sheet: saleable stock at this location is frozen as "expected". Held stock (inspection, supplier
// hold) is not part of a count. Phones are listed by IMEI and are counted by scanning each one.
export async function openCount(user: CurrentUser, raw: { categoryId: string | null; notes: string | null; includeZero: boolean }) {
  const location = user.location;
  if (!location) throw new CountError("No business location is assigned to your login.");
  return posting(async (tx) => {
    const category = raw.categoryId ? await tx.category.findUnique({ where: { id: raw.categoryId }, include: { children: { select: { id: true } } } }) : null;
    const categoryIds = category ? [category.id, ...category.children.map((c) => c.id)] : null;
    const clash = await tx.stockCount.findFirst({ where: { locationId: location.id, status: "OPEN", categoryId: raw.categoryId } });
    if (clash) throw new CountError(`Count ${clash.number} is already open for this ${category ? "category" : "location"}. Finish or cancel it first.`);
    const products = await tx.product.findMany({
      where: { active: true, stockManaged: true, ...(categoryIds ? { categoryId: { in: categoryIds } } : {}) },
      select: { id: true, trackDevices: true },
    });
    const ids = products.map((p) => p.id);
    const [stock, devices] = await Promise.all([
      tx.costLayer.groupBy({ by: ["productId"], where: { locationId: location.id, bucket: "SALEABLE", qtyRemaining: { gt: 0 }, productId: { in: ids } }, _sum: { qtyRemaining: true } }),
      tx.deviceIdentity.findMany({ where: { locationId: location.id, state: "SALEABLE", productId: { in: ids } }, select: { id: true, productId: true } }),
    ]);
    const qtyOf = new Map(stock.map((s) => [s.productId, D(s._sum.qtyRemaining)]));
    const devOf = new Map<string, string[]>();
    for (const d of devices) devOf.set(d.productId, [...(devOf.get(d.productId) ?? []), d.id]);
    const lines = products
      .map((p) => ({ productId: p.id, expectedQty: qtyOf.get(p.id) ?? ZERO, expectedDeviceIds: p.trackDevices ? devOf.get(p.id) ?? [] : [] }))
      .filter((l) => raw.includeZero || l.expectedQty.gt(0));
    if (!lines.length) throw new CountError("There is no stock to count here.");
    const number = await nextNumber(tx, "STOCK_COUNT");
    const count = await tx.stockCount.create({
      data: { number, locationId: location.id, categoryId: raw.categoryId, scope: category?.name ?? null, notes: raw.notes, createdById: user.personId, lines: { createMany: { data: lines } } },
    });
    await tx.auditEvent.create({ data: { actorId: user.personId, action: "STOCK_COUNT_OPENED", subjectType: "StockCount", subjectId: count.id, detail: { number, lines: lines.length } } });
    return { id: count.id, number };
  });
}

async function openSheet(countId: string, user: CurrentUser) {
  const count = await db.stockCount.findUnique({ where: { id: countId } });
  if (!count) throw new CountError("Count not found.");
  if (count.status !== "OPEN") throw new CountError(`Count ${count.number} is ${count.status.toLowerCase()}.`);
  if (count.locationId !== user.location?.id) throw new CountError("Switch to the location this count belongs to.");
  return count;
}

// Typed quantities for ordinary (non-IMEI) products. An empty box means "not counted yet", never zero.
export async function saveCounted(user: CurrentUser, countId: string, entries: { lineId: string; counted: number | null }[]) {
  await openSheet(countId, user);
  for (const e of entries) {
    if (e.counted != null && !(e.counted >= 0)) throw new CountError("Counted quantities cannot be negative.");
    await db.stockCountLine.updateMany({ where: { id: e.lineId, countId, product: { trackDevices: false } }, data: { countedQty: e.counted } });
  }
}

// One scan: an IMEI / serial marks that phone as seen; a product barcode or SKU adds 1 to that product.
export async function scanInto(user: CurrentUser, countId: string, rawCode: string): Promise<{ ok: string } | { error: string }> {
  await openSheet(countId, user);
  const code = rawCode.trim();
  if (!code) return { error: "Nothing was read." };
  const device = await db.deviceIdentity.findFirst({ where: { OR: [{ imei1: code }, { imei2: code }, { serial: code }] }, orderBy: { createdAt: "desc" }, include: { product: true } });
  if (device) {
    const line = await db.stockCountLine.findUnique({ where: { countId_productId: { countId, productId: device.productId } } });
    if (!line) return { error: `${device.product.name} is not on this count sheet.` };
    if (line.countedDeviceIds.includes(device.id)) return { ok: `Already counted: ${device.product.name} ${code}` };
    const counted = [...line.countedDeviceIds, device.id];
    await db.stockCountLine.update({ where: { id: line.id }, data: { countedDeviceIds: counted, countedQty: counted.length } });
    const expected = line.expectedDeviceIds.includes(device.id);
    return expected ? { ok: `${device.product.name} ${code} ✓ (${counted.length}/${line.expectedDeviceIds.length})` } : { error: `${device.product.name} ${code} is on the shelf but the system has it as ${device.state.toLowerCase().replace("_", " ")}. Noted for review.` };
  }
  const product = await db.product.findFirst({ where: { OR: [{ barcode: code }, { sku: { equals: code, mode: "insensitive" } }] } });
  if (!product) {
    // Unknown code: keep it on the sheet so someone checks what that item is.
    const first = await db.stockCountLine.findFirst({ where: { countId }, orderBy: { id: "asc" } });
    if (first && !first.unknownCodes.includes(code)) await db.stockCountLine.update({ where: { id: first.id }, data: { unknownCodes: { push: code } } });
    return { error: `${code} is not a known barcode, SKU or IMEI. Noted for review.` };
  }
  if (product.trackDevices) return { error: `${product.name} is counted by IMEI. Scan the IMEI label on each phone.` };
  const line = await db.stockCountLine.findUnique({ where: { countId_productId: { countId, productId: product.id } } });
  if (!line) return { error: `${product.name} is not on this count sheet.` };
  const next = D(line.countedQty ?? 0).plus(1);
  await db.stockCountLine.update({ where: { id: line.id }, data: { countedQty: next } });
  return { ok: `${product.name}: ${next.toString()} counted (expected ${D(line.expectedQty).toString()})` };
}

// Post: every counted line's difference becomes a line on ONE stock adjustment (reason: stock count correction).
// Lines never counted are left alone. Shortage is written off at the lots' own cost (oldest first; missing phones
// by IMEI); surplus is added as found stock at the product's current cost. Sales made after the sheet was opened are
// respected: the difference (counted − expected at opening) is applied to today's stock, not overwritten.
export async function postCount(user: CurrentUser, countId: string) {
  const sheet = await openSheet(countId, user);
  const lines = await db.stockCountLine.findMany({ where: { countId, countedQty: { not: null } }, include: { product: true } });
  if (!lines.length) throw new CountError("Nothing has been counted yet.");
  const adj: Record<string, unknown>[] = [];
  const notes: string[] = [];
  for (const l of lines) {
    if (l.product.trackDevices) {
      const missing = l.expectedDeviceIds.filter((id) => !l.countedDeviceIds.includes(id));
      // Only phones the system still has on sale here can be written off (one sold since opening is not missing).
      const still = await db.deviceIdentity.findMany({ where: { id: { in: missing }, state: "SALEABLE", locationId: sheet.locationId }, select: { id: true } });
      if (still.length) adj.push({ productId: l.productId, qty: still.length, mode: "REMOVE", deviceIds: still.map((d) => d.id) });
      const extra = l.countedDeviceIds.filter((id) => !l.expectedDeviceIds.includes(id)).length;
      if (extra) notes.push(`${l.product.name}: ${extra} phone(s) found that the system does not have on sale here — check each one.`);
    } else {
      const delta = D(l.countedQty!).minus(l.expectedQty);
      if (delta.lt(0)) {
        const have = await db.costLayer.aggregate({ where: { productId: l.productId, locationId: sheet.locationId, bucket: "SALEABLE" }, _sum: { qtyRemaining: true } });
        const take = D(have._sum.qtyRemaining).lt(delta.abs()) ? D(have._sum.qtyRemaining) : delta.abs();
        if (take.gt(0)) adj.push({ productId: l.productId, qty: take.toNumber(), mode: "REMOVE" });
        if (take.lt(delta.abs())) notes.push(`${l.product.name}: short by ${delta.abs().toString()} but only ${take.toString()} left in stock now.`);
      } else if (delta.gt(0)) {
        adj.push({ productId: l.productId, qty: delta.toNumber(), mode: "ADD", lotCode: `COUNT-${sheet.number}`, unitCost: Number(l.product.defaultCost) });
      }
    }
  }
  const unknown = (await db.stockCountLine.findMany({ where: { countId }, select: { unknownCodes: true } })).flatMap((x) => x.unknownCodes);
  if (unknown.length) notes.push(`Unknown codes scanned: ${unknown.join(", ")}`);
  // Retried posts reuse the same adjustment (idempotency key), so stock is never corrected twice.
  const result = adj.length
    ? await postAdjustment(user, { idempotencyKey: `stock-count-${sheet.id}`, kind: "NORMAL", reason: "COUNT_CORRECTION", notes: `Stock count ${sheet.number}${sheet.scope ? ` (${sheet.scope})` : ""}`, recoveredAmount: 0, lines: adj })
    : null;
  await db.stockCount.update({ where: { id: countId }, data: { status: "POSTED", postedAt: new Date(), adjustmentId: result?.id ?? null, notes: [sheet.notes, ...notes].filter(Boolean).join("\n") || null } });
  await db.auditEvent.create({ data: { actorId: user.personId, action: "STOCK_COUNT_POSTED", subjectType: "StockCount", subjectId: countId, detail: { number: sheet.number, adjustment: result?.number ?? null, lines: adj.length } } });
  return { adjustmentId: result?.id ?? null, differences: adj.length };
}

export async function cancelCount(user: CurrentUser, countId: string) {
  await openSheet(countId, user);
  await db.stockCount.update({ where: { id: countId }, data: { status: "CANCELLED" } });
  await db.auditEvent.create({ data: { actorId: user.personId, action: "STOCK_COUNT_CANCELLED", subjectType: "StockCount", subjectId: countId } });
}
