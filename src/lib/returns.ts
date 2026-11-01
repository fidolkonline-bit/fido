import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db, posting } from "./db";
import { D, ZERO } from "./money";
import { nextNumber } from "./numbering";
import { deriveLayer } from "./stock";
import type { CurrentUser } from "./auth";

export const DISPOSITIONS = {
  SALEABLE: "Back to saleable stock (original lot)",
  INSPECTION: "Inspection hold",
  SUPPLIER_HOLD: "Supplier recovery hold",
  WRITTEN_OFF: "Wastage / write-off",
} as const;

export const returnInput = z.object({
  idempotencyKey: z.string().min(8).max(80),
  saleId: z.string(),
  reason: z.string().max(300).nullable().default(null),
  lines: z
    .array(
      z.object({
        saleLineId: z.string(),
        qty: z.coerce.number().positive(),
        disposition: z.enum(["SALEABLE", "INSPECTION", "SUPPLIER_HOLD", "WRITTEN_OFF"]),
        condition: z.string().max(120).nullable().default(null),
        deviceIds: z.array(z.string()).default([]),
      }),
    )
    .min(1, "Select at least one item to return."),
  settlement: z.enum(["REFUND", "STORE_CREDIT"]),
  refund: z
    .object({
      method: z.enum(["CASH", "CARD", "BANK_TRANSFER", "OTHER"]),
      accountId: z.string().nullable().default(null),
      reference: z.string().max(80).nullable().default(null),
    })
    .nullable()
    .default(null),
});

export class ReturnError extends Error {}

type SaleForReturn = NonNullable<Awaited<ReturnType<typeof loadSale>>>;

function loadSale(saleId: string, client: Prisma.TransactionClient | typeof db = db) {
  return client.sale.findUnique({
    where: { id: saleId },
    include: {
      customer: true,
      lines: {
        include: {
          product: true,
          allocations: { include: { costLayer: true }, orderBy: { id: "asc" } },
          accruals: true,
          returnLines: true,
          devices: { where: { state: "SOLD" } },
        },
      },
    },
  });
}

// Net value of one unit after the line discount and its pro-rata share of the invoice discount (spec §17.1).
function lineNetValue(sale: SaleForReturn, line: SaleForReturn["lines"][number]) {
  const subtotal = D(sale.subtotal);
  const share = subtotal.gt(0) ? D(line.lineTotal).div(subtotal) : ZERO;
  return D(line.lineTotal).minus(D(sale.discount).mul(share));
}

export function saleDue(s: { total: Prisma.Decimal.Value; paid: Prisma.Decimal.Value; credited: Prisma.Decimal.Value }) {
  return D(s.total).minus(D(s.paid)).minus(D(s.credited));
}

// What can still be returned, and for how much (spec §11: preview before commit).
export async function returnPreview(saleId: string) {
  const sale = await loadSale(saleId);
  if (!sale) return null;
  return {
    sale,
    due: saleDue(sale),
    lines: sale.lines.map((l) => {
      const net = lineNetValue(sale, l);
      const remaining = D(l.qty).minus(l.returnedQty);
      const valueReturned = l.returnLines.reduce((a, r) => a.plus(r.value), ZERO);
      return { line: l, remaining, unitValue: D(l.qty).gt(0) ? net.div(l.qty) : ZERO, remainingValue: net.minus(valueReturned) };
    }),
  };
}

export async function postReturn(user: CurrentUser, raw: unknown) {
  const input = returnInput.parse(raw);
  const location = user.location;
  if (!location) throw new ReturnError("No business location is assigned to your login.");

  return posting(async (tx) => {
    const existing = await tx.saleReturn.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, number: true } });
    if (existing) return existing;

    // Serialise returns on the same sale so concurrent submissions cannot exceed the sold quantity (AC-24).
    await tx.$queryRaw`SELECT id FROM "Sale" WHERE id = ${input.saleId} FOR UPDATE`;
    const sale = await loadSale(input.saleId, tx);
    if (!sale || sale.stage !== "FINAL") throw new ReturnError("Original sale not found.");
    if (input.settlement === "STORE_CREDIT" && !sale.customerId)
      throw new ReturnError("Store credit needs a customer on the original sale. Refund a walk-in sale instead.");

    const number = await nextNumber(tx, "CREDIT_NOTE");
    const ret = await tx.saleReturn.create({
      data: {
        number, saleId: sale.id, locationId: location.id, customerId: sale.customerId, reason: input.reason,
        totalValue: 0, settlement: input.settlement, idempotencyKey: input.idempotencyKey, createdById: user.personId,
      },
    });

    let totalValue = ZERO;
    const seen = new Set<string>();
    for (const r of input.lines) {
      if (seen.has(r.saleLineId)) throw new ReturnError("The same sale line appears twice.");
      seen.add(r.saleLineId);
      const line = sale.lines.find((l) => l.id === r.saleLineId);
      if (!line) throw new ReturnError("A returned item is not on this sale.");
      const qty = D(r.qty);
      const remaining = D(line.qty).minus(line.returnedQty);
      if (qty.gt(remaining)) throw new ReturnError(`Only ${remaining.toString()} of ${line.nameSnapshot} can still be returned.`);

      // Value: proportional net value; the last units take whatever value is left so rounding never over-refunds.
      const net = lineNetValue(sale, line);
      const valueReturned = line.returnLines.reduce((a, x) => a.plus(x.value), ZERO);
      const value = qty.eq(remaining) ? net.minus(valueReturned).toDecimalPlaces(2) : net.div(line.qty).mul(qty).toDecimalPlaces(2);
      totalValue = totalValue.plus(value);

      const retLine = await tx.saleReturnLine.create({
        data: { returnId: ret.id, saleLineId: line.id, qty, value, costValue: 0, disposition: r.disposition, condition: r.condition },
      });

      // Cost: reverse the original allocations (devices: exactly the returned devices' layers).
      let costValue = ZERO;
      const picks: { alloc: (typeof line.allocations)[number]; qty: Prisma.Decimal; deviceId?: string }[] = [];
      if (line.product.trackDevices && line.allocations.length) {
        if (!qty.eq(r.deviceIds.length)) throw new ReturnError(`Select which ${qty.toString()} device(s) of ${line.nameSnapshot} came back.`);
        for (const deviceId of r.deviceIds) {
          const dev = line.devices.find((d) => d.id === deviceId);
          if (!dev) throw new ReturnError(`That device was not sold on this line or is already returned.`);
          const alloc = line.allocations.find((a) => a.costLayerId === dev.costLayerId && D(a.qty).minus(a.returnedQty).gt(0));
          if (!alloc) throw new ReturnError("Device cost record not found.");
          picks.push({ alloc, qty: D(1), deviceId });
        }
      } else {
        let need = qty;
        for (const alloc of [...line.allocations].reverse()) {
          if (need.lte(0)) break;
          const open = D(alloc.qty).minus(alloc.returnedQty);
          if (open.lte(0)) continue;
          const take = Prisma.Decimal.min(open, need);
          picks.push({ alloc, qty: take });
          need = need.minus(take);
        }
      }

      for (const pick of picks) {
        const layer = pick.alloc.costLayer;
        costValue = costValue.plus(pick.qty.mul(pick.alloc.unitCost));
        await tx.costAllocation.update({ where: { id: pick.alloc.id }, data: { returnedQty: { increment: pick.qty } } });
        // Saleable returns at the selling location go back into the original lot; anything else gets its own held layer.
        let target = layer.id;
        if (r.disposition === "SALEABLE" && layer.locationId === location.id && layer.bucket === "SALEABLE") {
          await tx.costLayer.update({ where: { id: layer.id }, data: { qtyRemaining: { increment: pick.qty } } });
        } else {
          const held = await deriveLayer(tx, layer, { locationId: location.id, qty: pick.qty, bucket: r.disposition, sourceType: "SaleReturn", sourceId: ret.id });
          target = held.id;
        }
        await tx.stockMovement.create({
          data: {
            productId: line.productId, locationId: location.id, costLayerId: target, qty: pick.qty, unitCost: pick.alloc.unitCost,
            kind: "SALE_RETURN", sourceType: "SaleReturn", sourceId: ret.id, reference: number, actorId: user.personId,
          },
        });
        if (pick.deviceId) {
          await tx.deviceIdentity.update({
            where: { id: pick.deviceId },
            data: { state: r.disposition === "SALEABLE" ? "SALEABLE" : r.disposition === "WRITTEN_OFF" ? "WRITTEN_OFF" : "HELD", saleLineId: null, costLayerId: target, locationId: location.id },
          });
        }
      }
      await tx.saleReturnLine.update({ where: { id: retLine.id }, data: { costValue } });
      await tx.saleLine.update({ where: { id: line.id }, data: { returnedQty: { increment: qty } } });

      // Commission: reverse the returned share of each original accrual (§9.2); paid commission is adjusted later, not edited.
      for (const acc of line.accruals.filter((a) => D(a.amount).gt(0))) {
        await tx.commissionAccrual.create({
          data: {
            saleLineId: line.id, recipientId: acc.recipientId, role: acc.role, basis: D(acc.basis).div(line.qty).mul(qty).neg().toDecimalPlaces(2),
            amount: D(acc.amount).div(line.qty).mul(qty).neg().toDecimalPlaces(4), state: "REVERSAL", returnLineId: retLine.id,
          },
        });
      }
    }

    // Settlement: unpaid debt on the sale is offset first; only the excess is refunded or credited (§11).
    const due = Prisma.Decimal.max(saleDue(sale), ZERO);
    const debtOffset = Prisma.Decimal.min(due, totalValue);
    const excess = totalValue.minus(debtOffset);
    let refunded = ZERO;
    let storeCredit = ZERO;

    if (excess.gt(0)) {
      if (input.settlement === "REFUND") {
        const method = input.refund?.method ?? "CASH";
        let registerId: string | null = null;
        if (method === "CASH") {
          const reg = await tx.registerSession.findFirst({ where: { locationId: location.id, userId: user.personId, closedAt: null } });
          if (!reg) throw new ReturnError("Open your cash register to give a cash refund.");
          registerId = reg.id;
        }
        let accountId = input.refund?.accountId ?? null;
        if (!accountId) {
          const acct = await tx.account.findFirst({
            where: { active: true, type: method === "CASH" ? "CASH" : method === "CARD" ? "CARD" : "BANK", OR: [{ locationId: location.id }, { locationId: null }] },
            orderBy: { createdAt: "asc" },
          });
          accountId = acct?.id ?? null;
        }
        await tx.payment.create({
          data: {
            number: await nextNumber(tx, "PAYMENT_OUT"), direction: "OUT", method, amount: excess, accountId, contactId: sale.customerId,
            saleId: sale.id, returnId: ret.id, registerId, reference: input.refund?.reference ?? null, createdById: user.personId,
          },
        });
        refunded = excess;
      } else {
        await tx.storeCreditEntry.create({ data: { contactId: sale.customerId!, amount: excess, sourceType: "SaleReturn", sourceId: ret.id, reference: number } });
        storeCredit = excess;
      }
    }

    // Money that left this sale (refund or moved to credit) reduces what was retained against it.
    const paid = D(sale.paid).minus(excess);
    const credited = D(sale.credited).plus(totalValue);
    const dueAfter = D(sale.total).minus(paid).minus(credited);
    await tx.sale.update({
      where: { id: sale.id },
      data: { paid, credited, paymentState: dueAfter.lte(0) ? "PAID" : paid.gt(0) ? "PARTIAL" : "DUE" },
    });
    await tx.saleReturn.update({ where: { id: ret.id }, data: { totalValue, debtOffset, refunded, storeCredit, settlement: excess.gt(0) ? input.settlement : "DEBT_ONLY" } });
    await tx.auditEvent.create({
      data: { actorId: user.personId, action: "RETURN_COMPLETED", subjectType: "SaleReturn", subjectId: ret.id, detail: { number, sale: sale.number, value: totalValue.toString() } },
    });
    return { id: ret.id, number, refunded: refunded.toFixed(2), storeCredit: storeCredit.toFixed(2), debtOffset: debtOffset.toFixed(2) };
  });
}
