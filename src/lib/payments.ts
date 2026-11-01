import "server-only";
import { z } from "zod";
import { posting, type Tx } from "./db";
import { D } from "./money";
import { nextNumber } from "./numbering";
import type { CurrentUser } from "./auth";

export class PaymentError extends Error {}

export const chequeSchema = z.object({
  number: z.string().trim().min(1, "Cheque number is required.").max(30),
  bank: z.string().trim().max(60).nullable().default(null),
  realizeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Cheque date is required."),
});

export const payInput = z.object({
  amount: z.coerce.number().positive("Enter an amount."),
  method: z.enum(["CASH", "CARD", "BANK_TRANSFER", "CHEQUE", "OTHER"]),
  accountId: z.string().nullable().default(null),
  reference: z.string().max(80).nullable().default(null),
  cheque: chequeSchema.nullable().default(null),
});

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

// Every cheque payment gets a register entry so it can be cleared or bounced later (§16).
export async function attachCheque(tx: Tx, paymentId: string, direction: "RECEIVED" | "ISSUED", c: z.infer<typeof chequeSchema> | null, fallbackNumber: string | null) {
  await tx.cheque.create({
    data: {
      paymentId, direction, number: c?.number ?? fallbackNumber ?? "not recorded", bank: c?.bank ?? null,
      realizeDate: new Date(`${c?.realizeDate ?? today()}T00:00:00.000Z`),
    },
  });
}

async function resolveAccount(tx: Tx, user: CurrentUser, method: string, accountId: string | null, locationId: string) {
  let registerId: string | null = null;
  if (method === "CASH") {
    const reg = await tx.registerSession.findFirst({ where: { locationId, userId: user.personId, closedAt: null } });
    if (!reg) throw new PaymentError("Open your cash register to take or pay cash.");
    registerId = reg.id;
  }
  if (!accountId) {
    const type = method === "CASH" ? "CASH" : method === "CARD" ? "CARD" : "BANK";
    accountId = (await tx.account.findFirst({ where: { active: true, type, OR: [{ locationId }, { locationId: null }] }, orderBy: { createdAt: "asc" } }))?.id ?? null;
  }
  return { accountId, registerId };
}

// Customer pays (part of) a sale left on credit.
export async function receiveSalePayment(user: CurrentUser, saleId: string, raw: unknown) {
  const input = payInput.parse(raw);
  if (input.method === "CHEQUE" && !input.cheque) throw new PaymentError("Enter the cheque number and date.");
  return posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Sale" WHERE id = ${saleId} FOR UPDATE`;
    const sale = await tx.sale.findUniqueOrThrow({ where: { id: saleId } });
    const due = D(sale.total).minus(sale.paid).minus(sale.credited);
    const amount = D(input.amount).toDecimalPlaces(2);
    if (amount.gt(due)) throw new PaymentError(`Only Rs. ${due.toFixed(2)} is due on ${sale.number}.`);
    const { accountId, registerId } = await resolveAccount(tx, user, input.method, input.accountId, sale.locationId);
    const p = await tx.payment.create({
      data: {
        number: await nextNumber(tx, "PAYMENT_IN"), direction: "IN", method: input.method, amount, accountId, registerId,
        contactId: sale.customerId, saleId, reference: input.reference ?? input.cheque?.number ?? null, createdById: user.personId,
      },
    });
    if (input.method === "CHEQUE") await attachCheque(tx, p.id, "RECEIVED", input.cheque, null);
    const paid = D(sale.paid).plus(amount);
    const left = D(sale.total).minus(paid).minus(sale.credited);
    await tx.sale.update({ where: { id: saleId }, data: { paid, paymentState: left.lte(0) ? "PAID" : "PARTIAL" } });
    return p;
  });
}

// We pay (part of) a supplier GRN.
export async function paySupplier(user: CurrentUser, receiptId: string, raw: unknown) {
  const input = payInput.parse(raw);
  if (input.method === "CHEQUE" && !input.cheque) throw new PaymentError("Enter the cheque number and date.");
  return posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "GoodsReceipt" WHERE id = ${receiptId} FOR UPDATE`;
    const r = await tx.goodsReceipt.findUniqueOrThrow({ where: { id: receiptId } });
    const due = D(r.total).minus(r.paid);
    const amount = D(input.amount).toDecimalPlaces(2);
    if (amount.gt(due)) throw new PaymentError(`Only Rs. ${due.toFixed(2)} is due on ${r.number}.`);
    const { accountId, registerId } = await resolveAccount(tx, user, input.method, input.accountId, r.locationId);
    if (!accountId) throw new PaymentError("Choose the account the payment comes from.");
    const p = await tx.payment.create({
      data: {
        number: await nextNumber(tx, "PAYMENT_OUT"), direction: "OUT", method: input.method, amount, accountId, registerId,
        contactId: r.supplierId, receiptId, reference: input.reference ?? input.cheque?.number ?? null, createdById: user.personId,
      },
    });
    if (input.method === "CHEQUE") await attachCheque(tx, p.id, "ISSUED", input.cheque, null);
    await tx.goodsReceipt.update({ where: { id: receiptId }, data: { paid: { increment: amount } } });
    return p;
  });
}

// Deposit → clear, or bounce/cancel. A bounce reverses the payment once and puts the debt back on the source document.
export async function updateCheque(user: CurrentUser, chequeId: string, action: "DEPOSIT" | "CLEAR" | "BOUNCE" | "CANCEL", note: string | null) {
  return posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Cheque" WHERE id = ${chequeId} FOR UPDATE`;
    const c = await tx.cheque.findUniqueOrThrow({ where: { id: chequeId }, include: { payment: true } });
    const allowed: Record<string, string[]> = { DEPOSIT: ["PENDING"], CLEAR: ["PENDING", "DEPOSITED"], BOUNCE: ["PENDING", "DEPOSITED"], CANCEL: ["PENDING"] };
    if (!allowed[action].includes(c.status)) throw new PaymentError(`A ${c.status.toLowerCase()} cheque cannot be ${action.toLowerCase()}ed.`);
    const status = { DEPOSIT: "DEPOSITED", CLEAR: "CLEARED", BOUNCE: "BOUNCED", CANCEL: "CANCELLED" }[action];
    await tx.cheque.update({ where: { id: chequeId }, data: { status, statusAt: new Date(), note } });
    if (action === "BOUNCE" || action === "CANCEL") {
      const p = c.payment;
      const amount = D(p.amount);
      await tx.payment.create({
        data: {
          number: await nextNumber(tx, p.direction === "IN" ? "PAYMENT_OUT" : "PAYMENT_IN"), direction: p.direction === "IN" ? "OUT" : "IN",
          method: "CHEQUE", amount, accountId: p.accountId, contactId: p.contactId, reversesId: p.id,
          reference: `${action === "BOUNCE" ? "Bounced" : "Cancelled"} cheque ${c.number}`, createdById: user.personId,
        },
      });
      // Restore what is owed on whatever the cheque paid.
      if (p.saleId) {
        const s = await tx.sale.update({ where: { id: p.saleId }, data: { paid: { decrement: amount } } });
        await tx.sale.update({ where: { id: s.id }, data: { paymentState: D(s.paid).lte(0) ? "DUE" : "PARTIAL" } });
      }
      if (p.receiptId) await tx.goodsReceipt.update({ where: { id: p.receiptId }, data: { paid: { decrement: amount } } });
      if (p.expenseId) await tx.expense.update({ where: { id: p.expenseId }, data: { paid: { decrement: amount } } });
      if (p.repairJobId) await tx.repairJob.update({ where: { id: p.repairJobId }, data: { paid: { decrement: amount } } });
      if (p.payslipId) {
        const ps = await tx.payslip.update({ where: { id: p.payslipId }, data: { paid: { decrement: amount } } });
        await tx.payrollRun.update({ where: { id: ps.runId }, data: { status: "PART_PAID" } });
      }
    }
    await tx.auditEvent.create({ data: { actorId: user.personId, action: `CHEQUE_${status}`, subjectType: "Cheque", subjectId: chequeId, detail: { number: c.number } } });
  });
}
