import "server-only";
import { z } from "zod";
import { posting } from "./db";
import { D, ZERO } from "./money";
import { nextNumber } from "./numbering";
import type { CurrentUser } from "./auth";
import type { Tx } from "./db";
import { attachCheque } from "./payments";

const paymentSchema = z.object({
  amount: z.coerce.number().positive(),
  method: z.enum(["CASH", "BANK_TRANSFER", "CHEQUE", "CARD", "OTHER"]),
  accountId: z.string().nullable().default(null),
  reference: z.string().max(80).nullable().default(null),
});

export const expenseInput = z.object({
  idempotencyKey: z.string().min(8).max(80),
  categoryId: z.string().min(1, "Choose a category."),
  expenseDate: z.coerce.date(),
  amount: z.coerce.number().positive("Amount must be more than zero."),
  tax: z.coerce.number().min(0).default(0),
  contactId: z.string().nullable().default(null),
  description: z.string().max(500).nullable().default(null),
  payment: paymentSchema.nullable().default(null),
});

export class ExpenseError extends Error {}

// Settlement of an expense is a payment, never a second expense (§16).
async function payOut(tx: Tx, user: CurrentUser, expense: { id: string; contactId: string | null; locationId: string }, raw: z.infer<typeof paymentSchema>) {
  const amount = D(raw.amount).toDecimalPlaces(2);
  let registerId: string | null = null;
  let accountId = raw.accountId;
  if (raw.method === "CASH") {
    // Cash paid from the drawer reduces the register's expected cash.
    const reg = await tx.registerSession.findFirst({ where: { locationId: expense.locationId, userId: user.personId, closedAt: null } });
    registerId = reg?.id ?? null;
    if (!accountId) accountId = (await tx.account.findFirst({ where: { type: "CASH", active: true, locationId: expense.locationId } }))?.id ?? null;
  }
  if (!accountId) throw new ExpenseError("Choose the account the money is paid from.");
  const payment = await tx.payment.create({
    data: {
      number: await nextNumber(tx, "PAYMENT_OUT"), direction: "OUT", method: raw.method, amount, accountId, contactId: expense.contactId,
      expenseId: expense.id, registerId, reference: raw.reference, createdById: user.personId,
    },
  });
  if (raw.method === "CHEQUE") await attachCheque(tx, payment.id, "ISSUED", null, raw.reference);
  return amount;
}

export async function createExpense(user: CurrentUser, raw: unknown) {
  const input = expenseInput.parse(raw);
  const location = user.location;
  if (!location) throw new ExpenseError("No business location is assigned to your login.");
  return posting(async (tx) => {
    const existing = await tx.expense.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, number: true } });
    if (existing) return existing;
    const total = D(input.amount).plus(D(input.tax)).toDecimalPlaces(2);
    if (input.payment && D(input.payment.amount).gt(total)) throw new ExpenseError("Payment is more than the expense total.");
    const number = await nextNumber(tx, "EXPENSE");
    const e = await tx.expense.create({
      data: {
        number, categoryId: input.categoryId, locationId: location.id, contactId: input.contactId, expenseDate: input.expenseDate,
        amount: D(input.amount), tax: D(input.tax), description: input.description, idempotencyKey: input.idempotencyKey, createdById: user.personId,
      },
    });
    const paid = input.payment ? await payOut(tx, user, e, input.payment) : ZERO;
    if (paid.gt(0)) await tx.expense.update({ where: { id: e.id }, data: { paid } });
    await tx.auditEvent.create({ data: { actorId: user.personId, action: "EXPENSE_CREATED", subjectType: "Expense", subjectId: e.id, detail: { number, total: total.toString() } } });
    return { id: e.id, number };
  });
}

export async function payExpense(user: CurrentUser, expenseId: string, raw: unknown) {
  const payment = paymentSchema.parse(raw);
  return posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Expense" WHERE id = ${expenseId} FOR UPDATE`;
    const e = await tx.expense.findUniqueOrThrow({ where: { id: expenseId } });
    const due = D(e.amount).plus(e.tax).minus(e.paid);
    if (D(payment.amount).gt(due)) throw new ExpenseError(`Only ${due.toFixed(2)} is still due on this expense.`);
    const paid = await payOut(tx, user, e, payment);
    await tx.expense.update({ where: { id: e.id }, data: { paid: { increment: paid } } });
    return { id: e.id };
  });
}
