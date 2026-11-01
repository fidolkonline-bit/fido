import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db, posting, type Tx } from "./db";
import { D, ZERO, colomboDayStart } from "./money";
import { nextNumber } from "./numbering";
import { can } from "./permissions";
import type { CurrentUser } from "./auth";
import { attachCheque, chequeSchema } from "./payments";
import { storeCreditBalance } from "./stock";
import { ACCOUNT_TYPES, DEFAULT_TYPE, OPENING, checkAllocation, defaultAccount, orderObligations, suggestAllocation, type Allocation, type Obligation } from "./debt-rules";

// Customer debt and repayment at the POS (CR-03). The ledger is read from posted records only: FINAL invoices and the
// opening balance, less linked payments and return credits. Drafts, quotes and carts are never debt.

export class DebtError extends Error {
  constructor(message: string, public code: "STALE" | "INVALID" = "INVALID") { super(message); }
}

type Client = Tx | typeof db;

// Debt of many customers in one pass (lists, reports, credit limit). Opening due + Σ invoice due; overpaid invoices count 0.
export async function debtOf(client: Client, customerIds: string[]) {
  if (!customerIds.length) return new Map<string, Prisma.Decimal>();
  const [contacts, sales] = await Promise.all([
    client.contact.findMany({ where: { id: { in: customerIds } }, select: { id: true, openingBalance: true, openingPaid: true, isCustomer: true } }),
    client.$queryRaw<{ customerId: string; due: Prisma.Decimal }[]>`
      SELECT "customerId", COALESCE(SUM(GREATEST(total - paid - credited, 0)), 0) AS due FROM "Sale"
      WHERE "customerId" = ANY(${customerIds}) AND stage = 'FINAL' GROUP BY "customerId"`,
  ]);
  const out = new Map<string, Prisma.Decimal>();
  for (const c of contacts) out.set(c.id, c.isCustomer ? Prisma.Decimal.max(D(c.openingBalance).minus(c.openingPaid), ZERO) : ZERO);
  for (const s of sales) out.set(s.customerId, (out.get(s.customerId) ?? ZERO).plus(D(s.due)));
  return out;
}

export const openingDue = (c: { openingBalance: Prisma.Decimal.Value; openingPaid: Prisma.Decimal.Value }) => Prisma.Decimal.max(D(c.openingBalance).minus(D(c.openingPaid)), ZERO);

const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

export type Ledger = Awaited<ReturnType<typeof loadLedger>>;

// The authoritative balance for one customer. Inside a posting transaction pass lock=true: the customer row and their
// open invoices are locked so a competing payment or return waits, then sees the new figures.
export async function loadLedger(client: Client, customerId: string, user: CurrentUser | null, lock = false) {
  if (lock) {
    await client.$queryRaw`SELECT id FROM "Contact" WHERE id = ${customerId} FOR UPDATE`;
    await client.$queryRaw`SELECT id FROM "Sale" WHERE "customerId" = ${customerId} AND stage = 'FINAL' AND total - paid - credited > 0 ORDER BY id FOR UPDATE`;
  }
  const c = await client.contact.findUnique({ where: { id: customerId }, select: { id: true, name: true, code: true, phone: true, isCustomer: true, openingBalance: true, openingPaid: true, payTermDays: true, creditLimit: true, createdAt: true } });
  if (!c || !c.isCustomer) throw new DebtError("Customer not found.");
  const sales = await client.sale.findMany({
    where: { customerId, stage: "FINAL" },
    select: { id: true, number: true, soldAt: true, total: true, paid: true, credited: true, locationId: true, location: { select: { name: true } } },
    orderBy: { soldAt: "asc" },
  });
  const today = colomboDayStart();
  // Users see documents of their own locations only; another branch's invoice shows as an amount, not a document.
  const visible = new Set(user?.locations.map((l) => l.id) ?? []);
  const terms = c.payTermDays ?? null;
  const obligations: Obligation[] = [];
  const opening = openingDue(c);
  if (opening.gt(0)) {
    const due = terms !== null ? addDays(c.createdAt, terms) : null;
    obligations.push({ key: OPENING, kind: "OPENING", ref: "Opening balance", docDate: c.createdAt.toISOString(), dueDate: due?.toISOString() ?? null, due: opening.toFixed(2), overdue: !!due && due < today, location: null, restricted: false });
  }
  for (const s of sales) {
    const due = D(s.total).minus(s.paid).minus(s.credited);
    if (due.lte(0)) continue;
    const dueDate = terms !== null ? addDays(s.soldAt, terms) : null;
    const restricted = !!user && !visible.has(s.locationId);
    obligations.push({
      key: s.id, kind: "INVOICE", ref: restricted ? "Invoice at another branch" : s.number, docDate: s.soldAt.toISOString(), dueDate: dueDate?.toISOString() ?? null,
      due: due.toFixed(2), overdue: !!dueDate && dueDate < today, location: s.location.name, restricted,
    });
  }
  const ordered = orderObligations(obligations);
  const debt = ordered.reduce((a, o) => a.plus(o.due), ZERO);
  const overdue = ordered.filter((o) => o.overdue).reduce((a, o) => a.plus(o.due), ZERO);
  const otherBranches = ordered.filter((o) => o.restricted).reduce((a, o) => a.plus(o.due), ZERO);
  const [credit, pending] = await Promise.all([
    storeCreditBalance(client as Tx, customerId),
    // Cheques already counted against the debt but not cleared yet: shown so nobody mistakes them for settled money.
    client.payment.aggregate({ where: { contactId: customerId, direction: "IN", reversedBy: { is: null }, cheque: { status: { in: ["PENDING", "DEPOSITED"] } } }, _sum: { amount: true } }),
  ]);
  return {
    customer: { id: c.id, name: c.name, code: c.code, phone: c.phone, creditLimit: c.creditLimit, payTermDays: terms },
    obligations: ordered, debt, overdue, otherBranches, storeCredit: credit, pendingCheques: D(pending._sum.amount), asOf: new Date(),
  };
}

// Plain JSON for the POS (Decimals → strings).
export function ledgerView(l: Ledger) {
  return {
    customer: { ...l.customer, creditLimit: l.customer.creditLimit?.toFixed(2) ?? null },
    obligations: l.obligations, debt: l.debt.toFixed(2), overdue: l.overdue.toFixed(2), otherBranches: l.otherBranches.toFixed(2),
    storeCredit: l.storeCredit.toFixed(2), pendingCheques: l.pendingCheques.toFixed(2), asOf: l.asOf.toISOString(),
  };
}
export type LedgerView = ReturnType<typeof ledgerView>;

export const debtPayInput = z.object({
  idempotencyKey: z.string().min(8).max(80),
  customerId: z.string().min(1),
  amount: z.coerce.number().positive("Enter the amount received."),
  method: z.enum(["CASH", "CARD", "BANK_TRANSFER", "CHEQUE", "STORE_CREDIT", "OTHER"]),
  accountId: z.string().nullable().default(null),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null), // business date; null or today = now
  reference: z.string().trim().max(80).nullable().default(null),
  note: z.string().trim().max(500).nullable().default(null),
  cheque: chequeSchema.nullable().default(null),
  expectedDebt: z.string(), // the debt the cashier was shown; anything else means the balance moved meanwhile
  allocation: z.array(z.object({ key: z.string(), amount: z.string() })).max(200).nullable().default(null),
  excess: z.enum(["NONE", "ADVANCE", "CHANGE"]).default("NONE"),
});


// The account money lands in: cash at the till goes to this location's cash account and this register; a chosen
// owner-collection or bank account takes it instead (permission debt.account).
async function receivingAccount(tx: Tx, user: CurrentUser, method: string, accountId: string | null, locationId: string) {
  if (method === "STORE_CREDIT") return { accountId: null, registerId: null, accountName: "Store credit" };
  if (accountId) {
    if (!can(user, "debt.account")) throw new DebtError("You are not allowed to choose the receiving account.");
    const a = await tx.account.findFirst({ where: { id: accountId, active: true } });
    if (!a) throw new DebtError("That account is no longer active.");
    if (!ACCOUNT_TYPES[method].includes(a.type)) throw new DebtError(`${a.name} cannot receive ${method.toLowerCase().replace("_", " ")} payments.`);
    if (a.locationId && a.locationId !== locationId) throw new DebtError(`${a.name} belongs to another location.`);
    // Cash into the till's own cash account belongs to that register; cash into an owner account does not.
    const registerId = method === "CASH" && a.type === "CASH" ? (await openRegister(tx, user, locationId)) : null;
    return { accountId: a.id, registerId, accountName: a.name };
  }
  const registerId = method === "CASH" ? await openRegister(tx, user, locationId) : null;
  const a = defaultAccount(await tx.account.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } }), method, locationId);
  if (!a) throw new DebtError(`No active ${DEFAULT_TYPE[method].toLowerCase()} account is set up to receive this payment. Ask a manager to add one under Accounts.`);
  return { accountId: a.id, registerId, accountName: a.name };
}

async function openRegister(tx: Tx, user: CurrentUser, locationId: string) {
  const reg = await tx.registerSession.findFirst({ where: { locationId, userId: user.personId, closedAt: null } });
  if (!reg) throw new DebtError("Open your cash register to take cash.");
  return reg.id;
}

// Paid-on: today means now; an earlier business date needs debt.backdate; the future is never allowed.
function paidAtFor(user: CurrentUser, paidOn: string | null) {
  const todayStr = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  if (!paidOn || paidOn === todayStr) return new Date();
  if (paidOn > todayStr) throw new DebtError("The paid-on date cannot be in the future.");
  if (!can(user, "debt.backdate")) throw new DebtError("You are not allowed to record a payment on an earlier date.");
  return new Date(`${paidOn}T12:00:00+05:30`);
}

const collectionInclude = { allocations: { include: { sale: { select: { number: true, locationId: true } } } }, customer: { select: { name: true, phone: true } }, account: { select: { name: true } }, payments: { include: { cheque: true } } } as const;
type Loaded = Prisma.DebtCollectionGetPayload<{ include: typeof collectionInclude }>;

// What the cashier sees after posting (and what a retried submit gets back unchanged).
export function receiptView(c: Loaded, user: CurrentUser | null, replay = false) {
  const visible = new Set(user?.locations.map((l) => l.id) ?? []);
  const cheque = c.payments.find((p) => p.direction === "IN" && p.cheque)?.cheque ?? null;
  return {
    id: c.id, number: c.number, replay, state: c.state, method: c.method, paidAt: c.paidAt.toISOString(),
    customer: c.customer.name, phone: c.customer.phone, account: c.account?.name ?? (c.method === "STORE_CREDIT" ? "Store credit" : null),
    tendered: c.tendered.toFixed(2), change: c.change.toFixed(2), received: c.received.toFixed(2), allocated: c.allocated.toFixed(2), advance: c.advance.toFixed(2),
    debtBefore: c.debtBefore.toFixed(2), debtAfter: c.debtAfter.toFixed(2),
    chequeStatus: cheque?.status ?? null,
    allocations: c.allocations.map((a) => ({
      ref: !a.sale ? "Opening balance" : user && !visible.has(a.sale.locationId) ? "Invoice at another branch" : a.sale.number,
      amount: a.amount.toFixed(2), dueAfter: a.dueAfter.toFixed(2),
    })),
  };
}
export type ReceiptView = ReturnType<typeof receiptView>;

// Receive money against a customer's previous debt. One receipt, one money movement, allocations committed together.
// No sale, no stock movement, no revenue and no commission: those were recognised when the invoices were posted.
export async function receiveDebtPayment(user: CurrentUser, raw: unknown) {
  const input = debtPayInput.parse(raw);
  const location = user.location;
  if (!location) throw new DebtError("No business location is assigned to your login.");
  if (input.method === "CHEQUE" && !input.cheque) throw new DebtError("Enter the cheque number and date.");

  return posting(async (tx) => {
    // Lock first, then look for a retry: two submits of one receipt are serialised on the customer row.
    const ledger = await loadLedger(tx, input.customerId, user, true);
    const existing = await tx.debtCollection.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: collectionInclude });
    if (existing) {
      if (existing.customerId !== input.customerId) throw new DebtError("This payment was already recorded for another customer.");
      return receiptView(existing, user, true);
    }
    if (!D(input.expectedDebt).eq(ledger.debt))
      throw new DebtError(`The balance changed to Rs. ${ledger.debt.toFixed(2)} while you were entering this payment (another payment or a return). Check the updated allocation and record again.`, "STALE");

    const amount = D(input.amount).toDecimalPlaces(2);
    const applied = Prisma.Decimal.min(amount, ledger.debt);
    const excess = amount.minus(applied);
    let change = ZERO, advance = ZERO;
    if (excess.gt(0)) {
      if (input.excess === "NONE") throw new DebtError(`Rs. ${excess.toFixed(2)} is more than the debt. Choose to keep it as advance credit or give it back as change.`);
      if (input.excess === "CHANGE") {
        if (input.method !== "CASH") throw new DebtError("Only cash can be given back as change.");
        change = excess;
      } else {
        if (input.method === "STORE_CREDIT") throw new DebtError("Store credit cannot be turned into more store credit.");
        if (input.method === "CHEQUE") throw new DebtError("A cheque can only settle the debt; take any extra once it has cleared.");
        advance = excess;
      }
    }
    if (applied.lte(0) && advance.lte(0)) throw new DebtError("This customer has no debt to pay.");

    if (input.method === "STORE_CREDIT" && amount.gt(ledger.storeCredit)) throw new DebtError(`Store credit available is Rs. ${ledger.storeCredit.toFixed(2)}.`);

    let alloc: Allocation[];
    if (input.allocation) {
      if (!can(user, "debt.allocate")) throw new DebtError("You are not allowed to change the allocation.");
      const problem = checkAllocation(ledger.obligations, input.allocation, applied.toFixed(2));
      if (problem) throw new DebtError(problem, "STALE");
      alloc = input.allocation;
    } else alloc = suggestAllocation(ledger.obligations, applied.toFixed(2));

    const { accountId, registerId } = await receivingAccount(tx, user, input.method, input.accountId, location.id);
    const paidAt = paidAtFor(user, input.paidOn);
    const received = amount.minus(change);
    const number = await nextNumber(tx, "DEBT_RECEIPT");

    const collection = await tx.debtCollection.create({
      data: {
        number, idempotencyKey: input.idempotencyKey, customerId: input.customerId, locationId: location.id, method: input.method,
        tendered: amount, change, received, allocated: applied, advance, debtBefore: ledger.debt, debtAfter: ledger.debt.minus(applied),
        accountId, registerId, paidAt, reference: input.reference ?? input.cheque?.number ?? null, note: input.note, createdById: user.personId,
      },
    });
    // The money movement, once: cash into this register, card/bank into the chosen account. Store credit is not money.
    const payment = await tx.payment.create({
      data: {
        number, direction: "IN", method: input.method, amount: received, accountId, registerId, contactId: input.customerId,
        collectionId: collection.id, paidAt, reference: collection.reference, createdById: user.personId,
      },
    });
    if (input.method === "CHEQUE") await attachCheque(tx, payment.id, "RECEIVED", input.cheque, null);
    if (input.method === "STORE_CREDIT")
      await tx.storeCreditEntry.create({ data: { contactId: input.customerId, amount: received.neg(), sourceType: "DebtCollection", sourceId: collection.id, reference: number } });
    if (advance.gt(0))
      await tx.storeCreditEntry.create({ data: { contactId: input.customerId, amount: advance, sourceType: "DebtCollection", sourceId: collection.id, reference: `${number} advance` } });

    const byKey = new Map(ledger.obligations.map((o) => [o.key, o]));
    for (const a of alloc) {
      const amt = D(a.amount);
      const before = D(byKey.get(a.key)!.due);
      if (a.key === OPENING) {
        await tx.contact.update({ where: { id: input.customerId }, data: { openingPaid: { increment: amt } } });
      } else {
        const s = await tx.sale.update({ where: { id: a.key }, data: { paid: { increment: amt } } });
        const left = D(s.total).minus(s.paid).minus(s.credited);
        await tx.sale.update({ where: { id: s.id }, data: { paymentState: left.lte(0) ? "PAID" : "PARTIAL" } });
      }
      await tx.debtAllocation.create({ data: { collectionId: collection.id, saleId: a.key === OPENING ? null : a.key, amount: amt, dueBefore: before, dueAfter: before.minus(amt) } });
    }

    await tx.auditEvent.create({
      data: {
        actorId: user.personId, action: "DEBT_PAYMENT_RECEIVED", subjectType: "DebtCollection", subjectId: collection.id,
        detail: { number, customerId: input.customerId, method: input.method, accountId, registerId, amount: amount.toFixed(2), change: change.toFixed(2), advance: advance.toFixed(2), paidAt: paidAt.toISOString(), allocation: alloc, manualAllocation: !!input.allocation },
      },
    });
    const done = await tx.debtCollection.findUniqueOrThrow({ where: { id: collection.id }, include: collectionInclude });
    return receiptView(done, user);
  });
}

// Look up a receipt by its idempotency key: after a timeout the POS asks before letting anyone collect again.
export async function collectionByKey(user: CurrentUser, key: string) {
  const c = await db.debtCollection.findUnique({ where: { idempotencyKey: key }, include: collectionInclude });
  return c ? receiptView(c, user, true) : null;
}

// Put back what a receipt settled (reversal or bounced cheque). Advance credit already spent blocks it.
export async function undoCollection(tx: Tx, collectionId: string) {
  const c = await tx.debtCollection.findUniqueOrThrow({ where: { id: collectionId }, include: { allocations: true } });
  await tx.$queryRaw`SELECT id FROM "Contact" WHERE id = ${c.customerId} FOR UPDATE`;
  if (D(c.advance).gt(0)) {
    const bal = await storeCreditBalance(tx, c.customerId);
    if (bal.lt(c.advance)) throw new DebtError(`Rs. ${D(c.advance).minus(bal).toFixed(2)} of this receipt's advance credit has already been used.`);
    await tx.storeCreditEntry.create({ data: { contactId: c.customerId, amount: D(c.advance).neg(), sourceType: "DebtCollection", sourceId: c.id, reference: `${c.number} reversed` } });
  }
  if (c.method === "STORE_CREDIT")
    await tx.storeCreditEntry.create({ data: { contactId: c.customerId, amount: c.received, sourceType: "DebtCollection", sourceId: c.id, reference: `${c.number} reversed` } });
  for (const a of c.allocations) {
    if (!a.saleId) {
      await tx.contact.update({ where: { id: c.customerId }, data: { openingPaid: { decrement: a.amount } } });
    } else {
      await tx.$queryRaw`SELECT id FROM "Sale" WHERE id = ${a.saleId} FOR UPDATE`;
      const s = await tx.sale.update({ where: { id: a.saleId }, data: { paid: { decrement: a.amount } } });
      const left = D(s.total).minus(s.paid).minus(s.credited);
      await tx.sale.update({ where: { id: s.id }, data: { paymentState: left.lte(0) ? "PAID" : D(s.paid).gt(0) ? "PARTIAL" : "DUE" } });
    }
  }
  return c;
}

// Correction: a linked reversal, never a delete. Money goes back out of the same account (cash from the reverser's till).
export async function reverseDebtPayment(user: CurrentUser, collectionId: string, reason: string) {
  if (!can(user, "debt.reverse")) throw new DebtError("You are not allowed to reverse debt payments.");
  if (reason.trim().length < 3) throw new DebtError("Give the reason for the reversal.");
  return posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "DebtCollection" WHERE id = ${collectionId} FOR UPDATE`;
    const c = await tx.debtCollection.findUniqueOrThrow({ where: { id: collectionId }, include: { payments: { include: { cheque: true } } } });
    if (c.state !== "POSTED") throw new DebtError(`This receipt is already ${c.state.toLowerCase()}.`);
    const original = c.payments.find((p) => p.direction === "IN" && !p.reversesId)!;
    if (original.cheque && ["PENDING", "DEPOSITED"].includes(original.cheque.status))
      throw new DebtError("This was paid by a cheque that has not cleared. Bounce or cancel it in the cheque register instead.");
    await undoCollection(tx, c.id);
    let registerId: string | null = null;
    if (c.method === "CASH" && c.registerId) {
      const reg = await tx.registerSession.findFirst({ where: { locationId: c.locationId, userId: user.personId, closedAt: null } });
      if (!reg) throw new DebtError("Open your cash register at this receipt's location to pay the cash back.");
      registerId = reg.id;
    }
    await tx.payment.create({
      data: {
        number: await nextNumber(tx, "PAYMENT_OUT"), direction: "OUT", method: c.method, amount: c.received, accountId: c.accountId, registerId,
        contactId: c.customerId, collectionId: c.id, reversesId: original.id, reference: `Reversal of ${c.number}`, createdById: user.personId,
      },
    });
    await tx.debtCollection.update({ where: { id: c.id }, data: { state: "REVERSED", stateReason: reason.trim().slice(0, 300), stateAt: new Date(), stateById: user.personId } });
    await tx.auditEvent.create({ data: { actorId: user.personId, action: "DEBT_PAYMENT_REVERSED", subjectType: "DebtCollection", subjectId: c.id, detail: { number: c.number, amount: c.received.toFixed(2), reason } } });
  });
}
