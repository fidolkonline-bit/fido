import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { posting } from "./db";
import { D, ZERO, roundTo } from "./money";
import { nextNumber } from "./numbering";
import { allocateFifo, allocateDevices, storeCreditBalance, type Pick } from "./stock";
import { can } from "./permissions";
import type { CurrentUser } from "./auth";
import { attachCheque } from "./payments";
import { activeRules, ruleFor, perUnitDiscount } from "./discounts";

export const saleInput = z.object({
  idempotencyKey: z.string().min(8).max(80),
  customerId: z.string().nullable(),
  lines: z
    .array(
      z.object({
        productId: z.string(),
        qty: z.coerce.number().positive(),
        unitPrice: z.coerce.number().min(0),
        discount: z.coerce.number().min(0).default(0),
        deviceIds: z.array(z.string()).default([]),
        discountRuleId: z.string().nullable().default(null),
      }),
    )
    .min(1, "Add at least one item."),
  invoiceDiscount: z.coerce.number().min(0).default(0),
  commissionMode: z.enum(["NONE", "USER", "AGENT", "DUAL"]).default("NONE"),
  salespersonId: z.string().nullable().default(null),
  agentId: z.string().nullable().default(null),
  payments: z
    .array(
      z.object({
        method: z.enum(["CASH", "CARD", "BANK_TRANSFER", "CHEQUE", "STORE_CREDIT", "OTHER"]),
        amount: z.coerce.number().positive(),
        accountId: z.string().nullable().default(null),
        reference: z.string().max(80).nullable().default(null),
      }),
    )
    .default([]),
  notes: z.string().max(500).nullable().default(null),
});

export type SaleInput = z.infer<typeof saleInput>;

export class SaleError extends Error {}

export async function finalizeSale(user: CurrentUser, raw: unknown) {
  const input = saleInput.parse(raw);
  const location = user.location;
  if (!location) throw new SaleError("No business location is assigned to your login.");

  return posting(async (tx) => {
    // Retried submit returns the same result (AC-11).
    const existing = await tx.sale.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, number: true } });
    if (existing) return existing;

    const register = await tx.registerSession.findFirst({
      where: { locationId: location.id, userId: user.personId, closedAt: null },
    });
    if (!register) throw new SaleError("Open your cash register before selling.");

    const business = await tx.business.findFirstOrThrow();
    const products = await tx.product.findMany({
      where: { id: { in: input.lines.map((l) => l.productId) }, active: true },
      include: { category: true },
    });
    const rules = await activeRules(location.id);
    const byId = new Map(products.map((p) => [p.id, p]));

    // Price and discount limits are recalculated on the server, never trusted from the client.
    const override = can(user, "sales.override_price");
    const lines = input.lines.map((l) => {
      const p = byId.get(l.productId);
      if (!p) throw new SaleError("A product in this sale is no longer available.");
      if (p.notForSale) throw new SaleError(`${p.name} is marked not for selling.`);
      const q = D(l.qty);
      if (p.trackDevices && p.stockManaged && !q.eq(l.deviceIds.length))
        throw new SaleError(`Select ${q.toString()} IMEI/serial for ${p.name} (${l.deviceIds.length} selected).`);
      const price = D(l.unitPrice).toDecimalPlaces(2);
      const discount = D(l.discount).toDecimalPlaces(2);
      const gross = price.mul(q).toDecimalPlaces(2);
      if (discount.gt(gross)) throw new SaleError(`Discount on ${p.name} is more than the line value.`);
      // A running offer (discount rule) is allowed on top of the cashier's own limit, but only the rule's amount (S08).
      const rule = l.discountRuleId ? ruleFor(rules, p) : null;
      if (l.discountRuleId && rule?.id !== l.discountRuleId) throw new SaleError(`The offer on ${p.name} is no longer running. Remove it and add the item again.`);
      const ruleAmount = rule ? perUnitDiscount(rule, p.sellPrice).mul(q) : ZERO;
      if (!override) {
        if (p.minSellPrice && price.lt(p.minSellPrice) && !rule) throw new SaleError(`${p.name} cannot be sold below ${p.minSellPrice.toFixed(2)}.`);
        const listGross = D(p.sellPrice).mul(q);
        const effectiveDiscount = listGross.minus(gross).plus(discount).minus(ruleAmount);
        const maxDiscount = listGross.mul(user.maxDiscountPct).div(100);
        if (effectiveDiscount.gt(maxDiscount.plus(0.005)))
          throw new SaleError(`Discount on ${p.name} is above your limit of ${user.maxDiscountPct.toString()}%.`);
      }
      return { product: p, qty: q, price, discount, lineTotal: gross.minus(discount), deviceIds: l.deviceIds, ruleId: rule?.id ?? null };
    });

    const subtotal = lines.reduce((a, l) => a.plus(l.lineTotal), ZERO);
    const invoiceDiscount = D(input.invoiceDiscount).toDecimalPlaces(2);
    if (invoiceDiscount.gt(subtotal)) throw new SaleError("Invoice discount is more than the subtotal.");
    if (!override && subtotal.gt(0) && invoiceDiscount.gt(subtotal.mul(user.maxDiscountPct).div(100).plus(0.005)))
      throw new SaleError(`Invoice discount is above your limit of ${user.maxDiscountPct.toString()}%.`);

    const beforeRounding = subtotal.minus(invoiceDiscount);
    const total = roundTo(beforeRounding, business.saleRounding);
    const rounding = total.minus(beforeRounding);

    // Payments: only cash can be over-tendered; the excess is change, not a receipt.
    const tendered = input.payments.reduce((a, p) => a.plus(D(p.amount)), ZERO);
    const nonCash = input.payments.filter((p) => p.method !== "CASH").reduce((a, p) => a.plus(D(p.amount)), ZERO);
    if (nonCash.gt(total)) throw new SaleError("Card/bank payments are more than the amount due.");
    const change = Prisma.Decimal.max(tendered.minus(total), ZERO);
    const paid = tendered.minus(change);
    const due = total.minus(paid);

    if (due.gt(0)) {
      if (!input.customerId) throw new SaleError("Select a customer to leave a balance due on credit.");
      const customer = await tx.contact.findUniqueOrThrow({ where: { id: input.customerId } });
      if (customer.creditLimit && !can(user, "sales.credit_override")) {
        const agg = await tx.sale.aggregate({ where: { customerId: customer.id, stage: "FINAL" }, _sum: { total: true, paid: true, credited: true } });
        const current = D(customer.openingBalance).plus(D(agg._sum.total)).minus(D(agg._sum.paid)).minus(D(agg._sum.credited));
        if (current.plus(due).gt(customer.creditLimit))
          throw new SaleError(`Credit limit ${customer.creditLimit.toFixed(2)} would be exceeded (current due ${current.toFixed(2)}).`);
      }
    }

    if (input.commissionMode !== "NONE") {
      if ((input.commissionMode === "USER" || input.commissionMode === "DUAL") && !input.salespersonId)
        throw new SaleError("Select the salesperson for user commission.");
      if ((input.commissionMode === "AGENT" || input.commissionMode === "DUAL") && !input.agentId)
        throw new SaleError("Select the referral agent for agent commission.");
    }

    // Store credit (from returns/exchanges) is checked under a row lock so two tills cannot spend it twice.
    const creditUse = input.payments.filter((p) => p.method === "STORE_CREDIT").reduce((a, p) => a.plus(D(p.amount)), ZERO);
    if (creditUse.gt(0)) {
      if (!input.customerId) throw new SaleError("Select the customer whose store credit is being used.");
      await tx.$queryRaw`SELECT id FROM "Contact" WHERE id = ${input.customerId} FOR UPDATE`;
      const balance = await storeCreditBalance(tx, input.customerId);
      if (creditUse.gt(balance)) throw new SaleError(`Store credit available is ${balance.toFixed(2)}.`);
    }

    const number = await nextNumber(tx, "SALE");
    const sale = await tx.sale.create({
      data: {
        number,
        locationId: location.id,
        customerId: input.customerId,
        subtotal,
        discount: invoiceDiscount,
        rounding,
        total,
        paid,
        paymentState: due.lte(0) ? "PAID" : paid.gt(0) ? "PARTIAL" : "DUE",
        commissionMode: input.commissionMode,
        salespersonId: input.commissionMode === "USER" || input.commissionMode === "DUAL" ? input.salespersonId : null,
        agentId: input.commissionMode === "AGENT" || input.commissionMode === "DUAL" ? input.agentId : null,
        createdById: user.personId,
        registerId: register.id,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
      },
    });

    for (const l of lines) {
      const p = l.product;
      // Invoice discount is allocated to lines pro rata for commission basis (spec §17.1 net sales).
      const share = subtotal.gt(0) ? l.lineTotal.div(subtotal) : ZERO;
      const basis = l.lineTotal.minus(invoiceDiscount.mul(share)).toDecimalPlaces(2);

      const line = await tx.saleLine.create({
        data: {
          saleId: sale.id,
          productId: p.id,
          nameSnapshot: p.name,
          qty: l.qty,
          unitPrice: l.price,
          discount: l.discount,
          lineTotal: l.lineTotal,
          categoryId: p.categoryId,
          poolRate: p.category?.poolRate ?? 0,
          userShare: p.category?.userShare ?? 0,
          agentShare: p.category?.agentShare ?? 0,
          discountRuleId: l.ruleId,
        },
      });

      let costTotal = ZERO;
      if (p.stockManaged) {
        // Overselling is disabled (observed setting), so every unit must come from a cost layer.
        // Phones take the exact selected devices; everything else is FIFO.
        const picks: Pick[] = p.trackDevices
          ? await allocateDevices(tx, p.id, location.id, l.deviceIds)
          : await allocateFifo(tx, p.id, location.id, l.qty, p.name);
        for (const pick of picks) {
          costTotal = costTotal.plus(pick.qty.mul(pick.unitCost));
          await tx.costAllocation.create({ data: { saleLineId: line.id, costLayerId: pick.layerId, qty: pick.qty, unitCost: pick.unitCost } });
          if (pick.deviceId) {
            const d = await tx.deviceIdentity.update({ where: { id: pick.deviceId }, data: { state: "SOLD", saleLineId: line.id } });
            await tx.saleLine.update({ where: { id: line.id }, data: { deviceLabels: { push: d.imei1 ?? d.serial ?? d.id } } });
          }
          await tx.stockMovement.create({
            data: {
              productId: p.id, locationId: location.id, costLayerId: pick.layerId, qty: pick.qty.neg(), unitCost: pick.unitCost,
              kind: "SALE", sourceType: "Sale", sourceId: sale.id, reference: number, actorId: user.personId,
            },
          });
        }
        await tx.saleLine.update({ where: { id: line.id }, data: { costTotal } });
      }

      // Category split (§9.1): pool = basis × rate; each recipient gets only its own share.
      const pool = basis.mul(p.category?.poolRate ?? 0);
      const accruals: { role: string; recipientId: string; amount: Prisma.Decimal }[] = [];
      if ((input.commissionMode === "USER" || input.commissionMode === "DUAL") && input.salespersonId)
        accruals.push({ role: "USER", recipientId: input.salespersonId, amount: pool.mul(p.category?.userShare ?? 0) });
      if ((input.commissionMode === "AGENT" || input.commissionMode === "DUAL") && input.agentId)
        accruals.push({ role: "AGENT", recipientId: input.agentId, amount: pool.mul(p.category?.agentShare ?? 0) });
      for (const a of accruals) {
        if (a.amount.gt(0)) await tx.commissionAccrual.create({ data: { saleLineId: line.id, basis, ...a, amount: a.amount.toDecimalPlaces(4) } });
      }
    }

    // Record actual receipts; cash goes to this register's location till.
    let changeLeft = change;
    for (const p of input.payments) {
      let amount = D(p.amount);
      if (p.method === "CASH" && changeLeft.gt(0)) {
        const used = Prisma.Decimal.min(amount, changeLeft);
        amount = amount.minus(used);
        changeLeft = changeLeft.minus(used);
      }
      if (amount.lte(0)) continue;
      let accountId = p.accountId;
      if (p.method === "STORE_CREDIT") {
        accountId = null; // not money received: it consumes credit already issued
      } else if (!accountId) {
        const acct = await tx.account.findFirst({
          where: { active: true, type: p.method === "CASH" ? "CASH" : p.method === "CARD" ? "CARD" : "BANK", OR: [{ locationId: location.id }, { locationId: null }] },
          orderBy: { createdAt: "asc" },
        });
        accountId = acct?.id ?? null;
      }
      const payment = await tx.payment.create({
        data: {
          number: await nextNumber(tx, "PAYMENT_IN"),
          direction: "IN", method: p.method, amount, accountId, contactId: input.customerId, saleId: sale.id,
          registerId: p.method === "CASH" ? register.id : null, reference: p.reference, createdById: user.personId,
        },
      });
      if (p.method === "CHEQUE") await attachCheque(tx, payment.id, "RECEIVED", null, p.reference);
      if (p.method === "STORE_CREDIT")
        await tx.storeCreditEntry.create({ data: { contactId: input.customerId!, amount: amount.neg(), sourceType: "Sale", sourceId: sale.id, reference: number } });
    }

    await tx.auditEvent.create({
      data: { actorId: user.personId, action: "SALE_FINALIZED", subjectType: "Sale", subjectId: sale.id, detail: { number, total: total.toString() } },
    });

    return { id: sale.id, number, change: change.toFixed(2) };
  });
}
