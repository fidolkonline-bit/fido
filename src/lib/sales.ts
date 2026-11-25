import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { posting } from "./db";
import { D, ZERO, roundTo } from "./money";
import { nextNumber } from "./numbering";
import { allocateChosenLots, allocateDevices, storeCreditBalance, type Pick } from "./stock";
import { can } from "./permissions";
import type { CurrentUser } from "./auth";
import { attachCheque } from "./payments";
import { activeRules, ruleFor, perUnitDiscount } from "./discounts";
import { priceInfo, salePolicy } from "./pricing";
import { resolvePrice } from "./price-rules";
import { debtOf } from "./debt";
import { checkDiscountLimits } from "./discount-limits";
import { getLoyalty, pointsFor } from "./loyalty";
import { requireDrawer } from "./register";
import { SALE_CHANNELS } from "./sale-channels";
import { syncCreditCommission } from "./credit-commission";

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
        // Lots chosen at the POS for non-device stock; a split across lots is explicit, one entry per lot.
        lots: z.array(z.object({ layerId: z.string(), qty: z.coerce.number().positive() })).max(20).default([]),
        discountRuleId: z.string().nullable().default(null),
      }),
    )
    .min(1, "Add at least one item."),
  invoiceDiscount: z.coerce.number().min(0).default(0),
  // Price tier override for this sale: absent = the customer's policy, null = default price, id = that tier.
  tierOverride: z.string().nullable().optional(),
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
  channel: z.enum(SALE_CHANNELS).default("IN_STORE"),
  channelRef: z.string().trim().max(80).nullable().default(null),
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

    if (input.channel !== "IN_STORE" && !input.customerId) throw new SaleError(`Select the customer for a ${input.channel === "FINTREX" ? "Fintrex" : "COD"} sale.`);

    const register = { id: await requireDrawer(tx, location.id, "Open the cash register before selling.") };

    const business = await tx.business.findFirstOrThrow();
    const products = await tx.product.findMany({
      where: { id: { in: input.lines.map((l) => l.productId) }, active: true },
      include: { category: true, warranty: true, taxRate: true },
    });
    // Tax is off until the business switches it on. Prices include tax: it is worked out of each line, never added on top.
    const defaultTax = business.taxEnabled ? await tx.taxRate.findFirst({ where: { isDefault: true, active: true } }) : null;
    const soldAt = new Date();
    const rules = await activeRules(location.id);
    const byId = new Map(products.map((p) => [p.id, p]));
    // Prices come from the server's own resolution of the tier/customer policy, never from the client.
    const { policy, basis } = await salePolicy(tx, user, input.customerId, input.tierOverride);
    const prices = await priceInfo(tx, products);

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
      const resolved = resolvePrice(prices.get(p.id)!, policy);
      const listPrice = D(resolved.price).toDecimalPlaces(2);
      const discount = D(l.discount).toDecimalPlaces(2);
      const gross = price.mul(q).toDecimalPlaces(2);
      if (discount.gt(gross)) throw new SaleError(`Discount on ${p.name} is more than the line value.`);
      // A running offer (discount rule) is allowed on top of the cashier's own limit, but only the rule's amount (S08).
      const rule = l.discountRuleId ? ruleFor(rules, p) : null;
      if (l.discountRuleId && rule?.id !== l.discountRuleId) throw new SaleError(`The offer on ${p.name} is no longer running. Remove it and add the item again.`);
      const ruleAmount = rule ? perUnitDiscount(rule, p.sellPrice).mul(q) : ZERO;
      return { product: p, qty: q, price, discount, lineTotal: gross.minus(discount), deviceIds: l.deviceIds, lots: l.lots, ruleId: rule?.id ?? null, listPrice, resolved, ruleAmount, hasRule: !!rule };
    });

    const subtotal = lines.reduce((a, l) => a.plus(l.lineTotal), ZERO);
    const invoiceDiscount = D(input.invoiceDiscount).toDecimalPlaces(2);
    if (invoiceDiscount.gt(subtotal)) throw new SaleError("Invoice discount is more than the subtotal.");
    // One allowance for the whole sale: line cuts, line discounts and the invoice discount cannot be stacked,
    // and the minimum price is tested on the net unit price after every discount.
    if (!override) {
      const problem = checkDiscountLimits(
        lines.map((l) => ({ name: l.product.name, qty: l.qty, price: l.price, listPrice: l.listPrice, discount: l.discount, ruleAmount: l.ruleAmount, hasRule: l.hasRule, minSellPrice: l.product.minSellPrice })),
        invoiceDiscount, user.maxDiscountPct,
      );
      if (problem) throw new SaleError(problem);
    }

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
        const current = (await debtOf(tx, [customer.id])).get(customer.id) ?? ZERO;
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
        channel: input.channel,
        channelRef: input.channel === "IN_STORE" ? null : input.channelRef || null,
        idempotencyKey: input.idempotencyKey,
        priceGroupId: policy.tier?.id ?? null,
        priceGroupName: policy.tier?.name ?? null,
        pricingBasis: basis,
        soldAt,
      },
    });
    let taxTotal = ZERO;

    for (const l of lines) {
      const p = l.product;
      // Invoice discount is allocated to lines pro rata for commission basis (spec §17.1 net sales).
      const share = subtotal.gt(0) ? l.lineTotal.div(subtotal) : ZERO;
      const basis = l.lineTotal.minus(invoiceDiscount.mul(share)).toDecimalPlaces(2);
      const taxRate = business.taxEnabled ? (p.taxRate?.active ? p.taxRate : defaultTax) : null;
      const taxAmount = taxRate ? basis.mul(taxRate.ratePct).div(D(100).plus(taxRate.ratePct)).toDecimalPlaces(2) : ZERO;
      taxTotal = taxTotal.plus(taxAmount);
      const warrantyUntil = p.warranty && p.warranty.durationDays > 0 ? new Date(soldAt.getTime() + p.warranty.durationDays * 86_400_000) : null;

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
          listPrice: l.listPrice,
          priceRule: l.price.eq(l.listPrice) ? l.resolved.rule : `Manual price (rule: ${l.resolved.rule} ${l.listPrice.toFixed(2)})`,
          priceGroupId: l.resolved.fallback ? null : l.resolved.tierId,
          priceGroupName: l.resolved.fallback ? null : l.resolved.tierName,
          warrantyName: p.warranty?.name ?? null, warrantyDays: p.warranty?.durationDays ?? null, warrantyUntil,
          taxName: taxRate?.name ?? null, taxRatePct: taxRate?.ratePct ?? 0, taxAmount,
        },
      });

      let costTotal = ZERO;
      if (p.stockManaged) {
        // Overselling is disabled (observed setting), so every unit must come from a cost layer.
        // Phones take the exact selected devices; everything else takes the lots the salesperson chose.
        const picks: Pick[] = p.trackDevices
          ? await allocateDevices(tx, p.id, location.id, l.deviceIds)
          : await allocateChosenLots(tx, p.id, location.id, l.qty, l.lots, p.name);
        for (const pick of picks) {
          costTotal = costTotal.plus(pick.qty.mul(pick.unitCost));
          await tx.costAllocation.create({ data: { saleLineId: line.id, costLayerId: pick.layerId, qty: pick.qty, unitCost: pick.unitCost } });
          if (pick.deviceId) {
            const d = await tx.deviceIdentity.update({ where: { id: pick.deviceId }, data: { state: "SOLD", saleLineId: line.id, soldAt, warrantyUntil } });
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

    if (taxTotal.gt(0)) await tx.sale.update({ where: { id: sale.id }, data: { tax: taxTotal } });
    // Phones sold through Fintrex earn the salesperson the credit commission on top of the category commission.
    if (input.channel === "FINTREX") await syncCreditCommission(tx, sale.id);

    // Loyalty points for a named customer, on the invoice total.
    if (input.customerId) {
      const loyalty = await getLoyalty(tx);
      const points = pointsFor(total.toString(), loyalty);
      if (points > 0) {
        await tx.loyaltyEntry.create({ data: { contactId: input.customerId, points, sourceType: "Sale", sourceId: sale.id, reference: number } });
        await tx.sale.update({ where: { id: sale.id }, data: { loyaltyEarned: points } });
      }
    }

    await tx.auditEvent.create({
      data: { actorId: user.personId, action: "SALE_FINALIZED", subjectType: "Sale", subjectId: sale.id, detail: { number, total: total.toString() } },
    });

    return { id: sale.id, number, change: change.toFixed(2) };
  });
}

// Fix a sale's type after the fact (cashier picked the wrong one). Payments are untouched; the change is logged.
export async function setSaleChannel(user: CurrentUser, saleId: string, raw: { channel: unknown; channelRef: unknown }) {
  const { channel, channelRef } = z.object({ channel: z.enum(SALE_CHANNELS), channelRef: z.string().trim().max(80).nullable() }).parse(raw);
  return posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Sale" WHERE id = ${saleId} FOR UPDATE`;
    const sale = await tx.sale.findUnique({ where: { id: saleId }, select: { stage: true, customerId: true, channel: true, channelRef: true, locationId: true } });
    if (!sale || sale.stage !== "FINAL") throw new SaleError("Sale not found.");
    if (!user.locations.some((l) => l.id === sale.locationId)) throw new SaleError("This sale belongs to another location.");
    if (channel !== "IN_STORE" && !sale.customerId) throw new SaleError("A Fintrex or COD sale needs a customer on it.");
    const ref = channel === "IN_STORE" ? null : channelRef || null;
    if (sale.channel === channel && sale.channelRef === ref) return;
    await tx.sale.update({ where: { id: saleId }, data: { channel, channelRef: ref } });
    // Into or out of Fintrex: the credit commission follows (added, moved to the instalment rate, or taken back).
    if (sale.channel === "FINTREX" || channel === "FINTREX") await syncCreditCommission(tx, saleId);
    await tx.auditEvent.create({ data: { actorId: user.personId, action: "SALE_TYPE_CHANGED", subjectType: "Sale", subjectId: saleId, detail: { from: sale.channel, fromRef: sale.channelRef, to: channel, toRef: ref } } });
  });
}
