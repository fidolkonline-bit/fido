import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db, posting, type Tx } from "./db";
import { D, ZERO } from "./money";
import { nextNumber } from "./numbering";
import { lotDate, nextLot } from "./lots";
import { autoLotCode, ReceiptError } from "./purchases";
import { notifyPeople } from "./notify";
import type { CurrentUser } from "./auth";

// Quick receive: shop staff put a delivery into stock when the owner is away, with only product and quantity.
// The GRN waits as PENDING_COST: its stock is sellable at once (cost 0 for now) and the owner is alerted to add
// cost, supplier and payment. Adding the cost later back-fills every sale and return that already used that stock.

export const quickInput = z.object({
  idempotencyKey: z.string().min(8).max(80),
  supplierId: z.string().min(1).nullable().default(null),
  notes: z.string().trim().max(500).nullable().default(null),
  lines: z
    .array(
      z.object({
        // An existing product, or the name of a new one (with the price to sell it at).
        productId: z.string().min(1).nullable().default(null),
        newName: z.string().trim().max(160).nullable().default(null),
        qty: z.coerce.number().positive("Quantity must be more than 0."),
        sellPrice: z.coerce.number().min(0).nullable().default(null),
      }),
    )
    .min(1, "Add at least one item.")
    .max(50),
});

export async function quickReceive(user: CurrentUser, raw: unknown) {
  const input = quickInput.parse(raw);
  const location = user.location;
  if (!location) throw new ReceiptError("No business location is assigned to your login.");

  const result = await posting(async (tx) => {
    const existing = await tx.goodsReceipt.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, number: true } });
    if (existing) return { ...existing, fresh: false, summary: "" };

    // Same product twice on one receipt becomes one line.
    const merged = new Map<string, { productId: string | null; newName: string | null; qty: Prisma.Decimal; sellPrice: number | null }>();
    for (const l of input.lines) {
      if (!l.productId && !l.newName) throw new ReceiptError("Each item needs a product or a new product name.");
      const k = l.productId ?? `new:${l.newName!.toLowerCase()}`;
      const prev = merged.get(k);
      merged.set(k, { productId: l.productId, newName: l.productId ? null : l.newName, qty: (prev?.qty ?? ZERO).plus(D(l.qty)), sellPrice: l.sellPrice ?? prev?.sellPrice ?? null });
    }

    const ids = [...merged.values()].flatMap((l) => (l.productId ? [l.productId] : []));
    const found = new Map((await tx.product.findMany({ where: { id: { in: ids } } })).map((p) => [p.id, p]));
    const lines: { product: { id: string; name: string; trackDevices: boolean; stockManaged: boolean }; qty: Prisma.Decimal; isNew: boolean }[] = [];
    for (const l of merged.values()) {
      if (l.productId) {
        const p = found.get(l.productId);
        if (!p || !p.active) throw new ReceiptError("A product on this receipt was not found.");
        if (p.trackDevices) throw new ReceiptError(`${p.name} is tracked by IMEI / serial. Phones go on a normal GRN.`);
        if (!p.stockManaged) throw new ReceiptError(`${p.name} does not keep stock.`);
        if (!l.qty.isInteger()) throw new ReceiptError(`Enter a whole quantity for ${p.name}.`);
        lines.push({ product: p, qty: l.qty, isNew: false });
        continue;
      }
      const name = l.newName!.replace(/\s+/g, " ");
      if (name.length < 2) throw new ReceiptError("Type the new product's name.");
      if (!l.sellPrice || l.sellPrice <= 0) throw new ReceiptError(`Enter the selling price for ${name}.`);
      if (!l.qty.isInteger()) throw new ReceiptError(`Enter a whole quantity for ${name}.`);
      const clash = await tx.product.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { name: true, sku: true } });
      if (clash) throw new ReceiptError(`${clash.name} (${clash.sku}) already exists. Pick it from the search instead of adding it again.`);
      const p = await tx.product.create({ data: { sku: await freeSku(tx), name, sellPrice: D(l.sellPrice).toDecimalPlaces(2), defaultCost: 0, stockManaged: true } });
      lines.push({ product: p, qty: l.qty, isNew: true });
    }

    if (input.supplierId) {
      const s = await tx.contact.findFirst({ where: { id: input.supplierId, isSupplier: true }, select: { id: true } });
      if (!s) throw new ReceiptError("That supplier was not found.");
    }
    // Lot as on a normal GRN (supplier code + date); with no supplier yet, NEW-261126. It stays the same when the
    // cost is added, so labels printed today still match.
    const now = new Date();
    const lotCode = input.supplierId ? await autoLotCode(tx, input.supplierId, now, true) : await pendingLot(tx, now);

    const number = await nextNumber(tx, "GRN");
    const receipt = await tx.goodsReceipt.create({
      data: {
        number, supplierId: input.supplierId, locationId: location.id, notes: input.notes, status: "PENDING_COST", receivedAt: now,
        total: 0, paid: 0, idempotencyKey: input.idempotencyKey, createdById: user.personId,
      },
    });
    for (const l of lines) {
      const line = await tx.receiptLine.create({
        data: { receiptId: receipt.id, productId: l.product.id, lotCode, qtyReceived: l.qty, qtyAccepted: l.qty, qtyRejected: 0, unitCost: 0, newProduct: l.isNew },
      });
      const layer = await tx.costLayer.create({
        data: { productId: l.product.id, locationId: location.id, receiptLineId: line.id, lotCode, qtyIn: l.qty, qtyRemaining: l.qty, unitCost: 0, receivedAt: now, costPending: true },
      });
      await tx.stockMovement.create({
        data: { productId: l.product.id, locationId: location.id, costLayerId: layer.id, qty: l.qty, unitCost: 0, kind: "RECEIPT", sourceType: "GoodsReceipt", sourceId: receipt.id, reference: number, actorId: user.personId },
      });
    }
    await tx.auditEvent.create({
      data: { actorId: user.personId, action: "RECEIPT_QUICK_RECEIVED", subjectType: "GoodsReceipt", subjectId: receipt.id, detail: { number, lines: lines.length, newProducts: lines.filter((l) => l.isNew).length } },
    });
    const summary = lines.map((l) => `${l.qty.toString()} × ${l.product.name}`).join(", ");
    return { id: receipt.id, number, fresh: true, summary };
  });

  if (result.fresh) {
    await notifyPeople("purchases.post", {
      kind: "GRN_COST_PENDING", title: `Add cost · ${result.number}`,
      body: `${user.name} received ${clip(result.summary)} at ${location.name}. Add the cost.`,
      url: `/purchases/${result.id}`, tag: `grn-${result.id}`, exceptPersonId: user.personId,
    });
  }
  return { id: result.id, number: result.number };
}

const clip = (s: string) => (s.length > 120 ? `${s.slice(0, 117)}…` : s);

// QP0001, QP0002… for products added on a quick receive (no year or slash: the code goes on barcode labels).
async function freeSku(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('sku:QP'))`;
  const [row] = await tx.$queryRaw<{ max: number | null }[]>`SELECT MAX(CAST(SUBSTRING(sku FROM 3) AS INTEGER)) AS max FROM "Product" WHERE sku ~ '^QP[0-9]{1,9}$'`;
  return `QP${String((row?.max ?? 0) + 1).padStart(4, "0")}`;
}

async function pendingLot(tx: Tx, at: Date) {
  const base = `NEW-${lotDate(at)}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"lot:" + base}))`;
  const used = await tx.receiptLine.findMany({ where: { lotCode: { startsWith: base } }, select: { lotCode: true }, distinct: ["lotCode"] });
  return nextLot(base, used.map((u) => u.lotCode));
}

// ───────────── Owner: add the cost ─────────────

// Every lot carrying this receipt line's stock: the GRN lot itself plus lots made from it (a return held for
// inspection, a return at another shop). All are still waiting for the cost.
async function pendingLayerIds(tx: Tx, rootLayerId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE t AS (
      SELECT id FROM "CostLayer" WHERE id = ${rootLayerId}
      UNION
      SELECT c.id FROM "CostLayer" c JOIN t ON c."originLayerId" = t.id WHERE c."costPending"
    ) SELECT id FROM t`;
  return rows.map((r) => r.id);
}

export type PendingLineImpact = { lineId: string; sold: string; inStock: string; elsewhere: string };

// What has happened to the stock since it came in: units sold (net of returns) and still in stock. Shown on the
// completion form so the owner knows how many sales the cost will be filled into.
export async function pendingImpact(receiptId: string): Promise<PendingLineImpact[]> {
  const lines = await db.receiptLine.findMany({ where: { receiptId }, select: { id: true, costLayer: { select: { id: true, locationId: true } } } });
  const out: PendingLineImpact[] = [];
  for (const l of lines) {
    if (!l.costLayer) { out.push({ lineId: l.id, sold: "0", inStock: "0", elsewhere: "0" }); continue; }
    const ids = await pendingLayerIds(db, l.costLayer.id);
    const [allocs, layers] = await Promise.all([
      db.costAllocation.findMany({ where: { costLayerId: { in: ids } }, select: { qty: true, returnedQty: true } }),
      db.costLayer.findMany({ where: { id: { in: ids } }, select: { qtyRemaining: true, locationId: true, bucket: true } }),
    ]);
    const sold = allocs.reduce((a, x) => a.plus(x.qty).minus(x.returnedQty), ZERO);
    const here = layers.filter((x) => x.locationId === l.costLayer!.locationId && x.bucket === "SALEABLE").reduce((a, x) => a.plus(x.qtyRemaining), ZERO);
    const all = layers.reduce((a, x) => a.plus(x.qtyRemaining), ZERO);
    out.push({ lineId: l.id, sold: sold.toString(), inStock: here.toString(), elsewhere: all.minus(here).toString() });
  }
  return out;
}

export const completeInput = z.object({
  receiptId: z.string().min(1),
  supplierId: z.string().min(1, "Select a supplier."),
  supplierRef: z.string().trim().max(80).nullable().default(null),
  notes: z.string().trim().max(500).nullable().default(null),
  lines: z.array(z.object({
    lineId: z.string().min(1),
    unitCost: z.coerce.number().min(0),
    newSellPrice: z.coerce.number().min(0).nullable().default(null),
    categoryId: z.string().min(1).nullable().default(null),
  })).min(1),
  payment: z.object({
    amount: z.coerce.number().positive(),
    method: z.enum(["CASH", "BANK_TRANSFER", "CHEQUE", "CARD", "OTHER"]),
    accountId: z.string().nullable().default(null),
    reference: z.string().max(80).nullable().default(null),
  }).nullable().default(null),
});

// The owner adds cost, supplier (and optionally a payment). The GRN becomes a normal posted one, and the cost is
// filled into its lots, the stock ledger, and every sale and return that already used that stock, so profit for
// those days is corrected. Commission is on the selling price and does not change.
export async function completeReceipt(user: CurrentUser, raw: unknown) {
  const input = completeInput.parse(raw);
  const out = await posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "GoodsReceipt" WHERE id = ${input.receiptId} FOR UPDATE`;
    const r = await tx.goodsReceipt.findUnique({ where: { id: input.receiptId }, include: { lines: { include: { product: true, costLayer: true } } } });
    if (!r) throw new ReceiptError("That GRN was not found.");
    if (r.status !== "PENDING_COST") throw new ReceiptError(`${r.number} already has its cost.`);
    const supplier = await tx.contact.findFirst({ where: { id: input.supplierId, isSupplier: true }, select: { id: true } });
    if (!supplier) throw new ReceiptError("That supplier was not found.");
    if (input.supplierRef) {
      const dup = await tx.goodsReceipt.findFirst({ where: { supplierId: input.supplierId, supplierRef: input.supplierRef, status: "POSTED" } });
      if (dup) throw new ReceiptError(`Supplier reference ${input.supplierRef} is already on ${dup.number}.`);
    }
    const given = new Map(input.lines.map((l) => [l.lineId, l]));
    if (given.size !== r.lines.length || r.lines.some((l) => !given.has(l.id))) throw new ReceiptError("Enter a cost for every item on this GRN.");

    let total = ZERO;
    let soldUnits = ZERO;
    for (const line of r.lines) {
      const g = given.get(line.id)!;
      const cost = D(g.unitCost).toDecimalPlaces(4);
      total = total.plus(D(line.qtyAccepted).mul(cost));
      await tx.receiptLine.update({ where: { id: line.id }, data: { unitCost: cost, newSellPrice: g.newSellPrice != null ? D(g.newSellPrice).toDecimalPlaces(2) : null } });
      await tx.product.update({
        where: { id: line.productId },
        data: {
          defaultCost: cost,
          ...(g.newSellPrice != null ? { sellPrice: D(g.newSellPrice).toDecimalPlaces(2) } : {}),
          ...(line.newProduct && g.categoryId ? { categoryId: g.categoryId } : {}),
        },
      });
      if (!line.costLayer) continue;

      const ids = await pendingLayerIds(tx, line.costLayer.id);
      // Returns that went back into these lots: their cost was recorded as 0 and is filled in below.
      const returnMoves = await tx.stockMovement.findMany({ where: { costLayerId: { in: ids }, kind: "SALE_RETURN" }, select: { sourceId: true, qty: true } });
      await tx.costLayer.updateMany({ where: { id: { in: ids } }, data: { unitCost: cost, costPending: false } });
      await tx.stockMovement.updateMany({ where: { costLayerId: { in: ids } }, data: { unitCost: cost } });

      const allocs = await tx.costAllocation.findMany({ where: { costLayerId: { in: ids } }, select: { id: true, saleLineId: true, qty: true, returnedQty: true } });
      if (allocs.length) {
        await tx.costAllocation.updateMany({ where: { id: { in: allocs.map((a) => a.id) } }, data: { unitCost: cost } });
        soldUnits = soldUnits.plus(allocs.reduce((a, x) => a.plus(x.qty).minus(x.returnedQty), ZERO));
        const saleLineIds = [...new Set(allocs.map((a) => a.saleLineId))];
        for (const saleLineId of saleLineIds) {
          const all = await tx.costAllocation.findMany({ where: { saleLineId }, select: { qty: true, unitCost: true } });
          await tx.saleLine.update({ where: { id: saleLineId }, data: { costTotal: all.reduce((a, x) => a.plus(D(x.qty).mul(x.unitCost)), ZERO) } });
        }
        // Each return of this stock added its units back at cost 0; add qty × cost to that return's line(s) for
        // the sale lines involved.
        const byReturn = new Map<string, Prisma.Decimal>();
        for (const m of returnMoves) byReturn.set(m.sourceId, (byReturn.get(m.sourceId) ?? ZERO).plus(m.qty));
        for (const [returnId, q] of byReturn) {
          let left = q;
          const rls = await tx.saleReturnLine.findMany({ where: { returnId, saleLineId: { in: saleLineIds } }, orderBy: { id: "asc" }, select: { id: true, qty: true } });
          for (const rl of rls) {
            if (left.lte(0)) break;
            const take = Prisma.Decimal.min(left, D(rl.qty));
            await tx.saleReturnLine.update({ where: { id: rl.id }, data: { costValue: { increment: take.mul(cost) } } });
            left = left.minus(take);
          }
        }
      }
    }
    total = total.toDecimalPlaces(2);

    const payAmount = input.payment ? D(input.payment.amount).toDecimalPlaces(2) : ZERO;
    if (payAmount.gt(total)) throw new ReceiptError("Payment is more than the receipt total.");
    const costAddedAt = new Date();
    await tx.goodsReceipt.update({
      where: { id: r.id },
      data: {
        supplierId: input.supplierId, supplierRef: input.supplierRef, notes: input.notes ?? r.notes, status: "POSTED",
        total, paid: payAmount, costAddedAt, costAddedById: user.personId,
      },
    });
    if (input.payment && payAmount.gt(0)) {
      await tx.payment.create({
        data: {
          number: await nextNumber(tx, "PAYMENT_OUT"), direction: "OUT", method: input.payment.method, amount: payAmount,
          accountId: input.payment.accountId, contactId: input.supplierId, receiptId: r.id, reference: input.payment.reference, createdById: user.personId,
        },
      });
    }
    await tx.auditEvent.create({
      data: { actorId: user.personId, action: "RECEIPT_COST_ADDED", subjectType: "GoodsReceipt", subjectId: r.id, detail: { number: r.number, total: total.toString(), soldBeforeCost: soldUnits.toString() } },
    });
    return { id: r.id, number: r.number };
  });
  // The "add cost" alert is done for everyone it went to.
  await db.notification.updateMany({ where: { kind: "GRN_COST_PENDING", url: `/purchases/${out.id}`, readAt: null }, data: { readAt: new Date() } }).catch(() => 0);
  return out;
}

// Morning nudge from the nightly job: GRNs received yesterday or before that still have no cost. Once a day.
export async function remindPendingCost() {
  const before = new Date(Date.now() - 12 * 3_600_000);
  const n = await db.goodsReceipt.count({ where: { status: "PENDING_COST", receivedAt: { lt: before } } });
  if (!n) return 0;
  const recent = await db.notification.findFirst({ where: { kind: "GRN_COST_PENDING", url: "/purchases?status=pending", createdAt: { gt: new Date(Date.now() - 20 * 3_600_000) } }, select: { id: true } });
  if (recent) return 0;
  await notifyPeople("purchases.post", {
    kind: "GRN_COST_PENDING", title: n === 1 ? "1 GRN is waiting for cost" : `${n} GRNs are waiting for cost`,
    body: "Stock was received without cost. Profit for those sales is not right until the cost is added.",
    url: "/purchases?status=pending", tag: "grn-cost-pending",
  });
  return n;
}
