import { Prisma } from "@prisma/client";
import { db, posting, type Tx } from "./db";
import { D, ZERO } from "./money";
import { nextNumber } from "./numbering";
import type { CurrentUser } from "./auth";

// One shared cash drawer per location (spec §8.3). Anyone allowed to operate the register there takes cash into it;
// one person counts and settles it. A partial unique index keeps at most one drawer open per location.

export const DENOMINATIONS = [5000, 2000, 1000, 500, 100, 50, 20, 10, 5, 2, 1];

export class RegisterError extends Error {}

// Why the counted cash differs from the expected cash. A reason and a note are required for any difference.
export const VARIANCE_REASONS: Record<string, string> = {
  OWNER_TOOK: "Owner took cash (not entered)",
  WRONG_CHANGE: "Wrong change given",
  UNRECORDED_EXPENSE: "Expense paid but not entered",
  UNRECORDED_SALE: "Sale or payment not entered",
  COUNTING_ERROR: "Counting mistake",
  OTHER: "Other",
};

// Cash put into or taken out of the drawer by hand. Never a sale or an expense.
export const MOVEMENT_REASONS: Record<string, { label: string; direction: "IN" | "OUT" }> = {
  OWNER_TOOK: { label: "Owner took cash", direction: "OUT" },
  BANK_DEPOSIT: { label: "Deposited to bank", direction: "OUT" },
  OTHER_OUT: { label: "Other cash out", direction: "OUT" },
  FLOAT_IN: { label: "Change / float added", direction: "IN" },
  OWNER_ADDED: { label: "Owner put cash in", direction: "IN" },
  OTHER_IN: { label: "Other cash in", direction: "IN" },
};
export const HANDOVER_REASONS = ["OWNER_TOOK", "BANK_DEPOSIT"] as const;

type Client = Tx | typeof db;

// The open drawer at a location, share-locked for the rest of the transaction. Closing takes an update lock on the
// same row, so a sale either lands before the count (and is in it) or waits and then finds the drawer closed.
export async function openDrawer(tx: Tx, locationId: string | null | undefined) {
  if (!locationId) return null;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "RegisterSession" WHERE "locationId" = ${locationId} AND "closedAt" IS NULL FOR SHARE`;
  return rows[0]?.id ?? null;
}

export async function requireDrawer(tx: Tx, locationId: string | null | undefined, message = "Open the cash register first.") {
  const id = await openDrawer(tx, locationId);
  if (!id) throw new RegisterError(message);
  return id;
}

export function findOpenDrawer(locationId: string) {
  return db.registerSession.findFirst({ where: { locationId, closedAt: null }, include: { user: true } });
}

// What the last close at this location left in the drawer: the expected opening for the next day.
export async function lastCashLeft(client: Client, locationId: string) {
  const last = await client.registerSession.findFirst({ where: { locationId, closedAt: { not: null } }, orderBy: { closedAt: "desc" } });
  return last ? { cashLeft: last.cashLeft != null ? D(last.cashLeft) : D(last.countedCash), closedAt: last.closedAt } : null;
}

type PaymentForSource = {
  direction: string; saleId: string | null; returnId: string | null; collectionId: string | null; repairJobId: string | null;
  reloadRequestId: string | null; tradeInId: string | null; claimId: string | null; expenseId: string | null; payslipId: string | null;
  settlementId: string | null; walletId: string | null; registerMovement: { reason: string; atClose: boolean } | null;
};

// Where cash in the drawer came from or went to, in the shop's words.
export function cashSource(p: PaymentForSource) {
  if (p.registerMovement) return MOVEMENT_REASONS[p.registerMovement.reason]?.label ?? "Cash in / out";
  if (p.returnId) return "Refunds on returns";
  if (p.reloadRequestId) return "Reloads";
  if (p.saleId) return p.direction === "IN" ? "Sales" : "Sale refunds";
  if (p.collectionId) return p.direction === "IN" ? "Customer debt payments" : "Debt receipts reversed";
  if (p.repairJobId) return p.direction === "IN" ? "Repairs" : "Repair refunds";
  if (p.tradeInId) return "Trade-ins bought";
  if (p.claimId) return "Supplier refunds";
  if (p.expenseId) return "Expenses";
  if (p.payslipId) return "Salaries";
  if (p.settlementId) return "Commissions";
  if (p.walletId) return "Reload wallet top-ups";
  return p.direction === "IN" ? "Other cash in" : "Other cash out";
}

// Full picture of one drawer: opening, cash in and out by source, expected cash, hand-overs and non-cash totals.
export async function drawerSummary(client: Client, registerId: string) {
  const r = await client.registerSession.findUniqueOrThrow({
    where: { id: registerId },
    include: { user: true, closedBy: true, location: true, movements: { include: { createdBy: true }, orderBy: { createdAt: "asc" } } },
  });
  const cash = await client.payment.findMany({
    where: { registerId, method: "CASH" },
    select: {
      direction: true, amount: true, saleId: true, returnId: true, collectionId: true, repairJobId: true, reloadRequestId: true, tradeInId: true,
      claimId: true, expenseId: true, payslipId: true, settlementId: true, walletId: true, registerMovement: { select: { reason: true, atClose: true } },
    },
  });
  const inBy = new Map<string, Prisma.Decimal>();
  const outBy = new Map<string, Prisma.Decimal>();
  let cashIn = ZERO, cashOut = ZERO, handedOver = ZERO;
  for (const p of cash) {
    if (p.registerMovement?.atClose) { handedOver = handedOver.plus(p.amount); continue; }
    const m = p.direction === "IN" ? inBy : outBy;
    const k = cashSource(p);
    m.set(k, (m.get(k) ?? ZERO).plus(p.amount));
    if (p.direction === "IN") cashIn = cashIn.plus(p.amount);
    else cashOut = cashOut.plus(p.amount);
  }
  // Card, bank and cheque taken on this drawer's sales: listed, never counted as drawer cash.
  const nonCash = await client.payment.groupBy({
    by: ["method"], where: { sale: { registerId }, method: { notIn: ["CASH", "STORE_CREDIT"] }, direction: "IN" }, _sum: { amount: true },
  });
  const sales = await client.sale.aggregate({ where: { registerId, stage: "FINAL" }, _sum: { total: true }, _count: true });
  const opening = D(r.openingCash);
  const liveExpected = opening.plus(cashIn).minus(cashOut);
  const sort = (m: Map<string, Prisma.Decimal>) => [...m.entries()].sort((a, b) => b[1].comparedTo(a[1])).map(([label, amount]) => ({ label, amount }));
  return {
    register: r,
    opening, cashIn, cashOut,
    inBy: sort(inBy), outBy: sort(outBy),
    // Once closed, the stored figure is what the person closing saw.
    expected: r.expectedCash != null ? D(r.expectedCash) : liveExpected,
    handedOver,
    nonCash: nonCash.map((n) => ({ method: n.method, amount: D(n._sum.amount) })),
    salesCount: sales._count, salesTotal: D(sales._sum.total),
  };
}

const r2 = (n: number) => D(n).toDecimalPlaces(2);

export async function openRegister(user: CurrentUser, input: { openingCash: number; note: string | null }) {
  const loc = user.location;
  if (!loc) throw new RegisterError("No location assigned.");
  if (!Number.isFinite(input.openingCash) || input.openingCash < 0) throw new RegisterError("Enter the opening cash counted in the drawer.");
  const opening = r2(input.openingCash);
  return posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Location" WHERE id = ${loc.id} FOR UPDATE`;
    const open = await tx.registerSession.findFirst({ where: { locationId: loc.id, closedAt: null }, include: { user: true } });
    if (open) throw new RegisterError(`The cash register is already open (opened by ${open.user.fullName}).`);
    const prev = await lastCashLeft(tx, loc.id);
    const expectedOpening = prev?.cashLeft ?? null;
    if (expectedOpening && !expectedOpening.eq(opening) && !input.note)
      throw new RegisterError(`Last close left Rs. ${expectedOpening.toFixed(2)} in the drawer. Write a note saying why the opening cash is different.`);
    const r = await tx.registerSession.create({
      data: { locationId: loc.id, userId: user.personId, openingCash: opening, expectedOpening, openingNote: input.note },
    });
    await tx.auditEvent.create({
      data: { actorId: user.personId, action: "REGISTER_OPENED", subjectType: "RegisterSession", subjectId: r.id, detail: { openingCash: opening.toFixed(2), expectedOpening: expectedOpening?.toFixed(2) ?? null, note: input.note } },
    });
    return r;
  });
}

async function cashAccountId(tx: Tx, locationId: string) {
  return (await tx.account.findFirst({ where: { type: "CASH", active: true, OR: [{ locationId }, { locationId: null }] }, orderBy: [{ locationId: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }] }))?.id ?? null;
}

async function addMovement(tx: Tx, user: CurrentUser, reg: { id: string; locationId: string }, reason: string, amount: Prisma.Decimal, note: string | null, atClose: boolean) {
  const def = MOVEMENT_REASONS[reason];
  const payment = await tx.payment.create({
    data: {
      number: await nextNumber(tx, def.direction === "IN" ? "PAYMENT_IN" : "PAYMENT_OUT"), direction: def.direction, method: "CASH", amount,
      accountId: await cashAccountId(tx, reg.locationId), registerId: reg.id, reference: def.label, createdById: user.personId,
    },
  });
  const m = await tx.registerMovement.create({
    data: { registerId: reg.id, direction: def.direction, reason, amount, note, atClose, paymentId: payment.id, createdById: user.personId },
  });
  await tx.auditEvent.create({
    data: { actorId: user.personId, action: "REGISTER_CASH_" + def.direction, subjectType: "RegisterSession", subjectId: reg.id, detail: { movementId: m.id, reason, amount: amount.toFixed(2), note, atClose } },
  });
  return m;
}

// Cash in or out of the open drawer during the day (owner took cash, change added…).
export async function recordMovement(user: CurrentUser, input: { reason: string; amount: number; note: string | null }) {
  const loc = user.location;
  if (!loc) throw new RegisterError("No location assigned.");
  const def = MOVEMENT_REASONS[input.reason];
  if (!def) throw new RegisterError("Choose why cash is going in or out.");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new RegisterError("Enter the amount.");
  if ((input.reason === "OTHER_IN" || input.reason === "OTHER_OUT") && !input.note) throw new RegisterError("Write a note saying what the cash was for.");
  const amount = r2(input.amount);
  return posting(async (tx) => {
    const id = await requireDrawer(tx, loc.id, "The cash register is closed. Open it first.");
    if (def.direction === "OUT") {
      const s = await drawerSummary(tx, id);
      if (amount.gt(s.expected)) throw new RegisterError(`The drawer should only hold Rs. ${s.expected.toFixed(2)}. Check the amount.`);
    }
    return addMovement(tx, user, { id, locationId: loc.id }, input.reason, amount, input.note, false);
  });
}

export type CloseInput = {
  registerId: string;
  counts: Record<string, number>;
  varianceReason: string | null;
  notes: string | null;
  cashLeft: number | null;
  handoverReason: string | null;
};

// Count, explain any difference, and hand over what does not stay in the drawer for tomorrow.
export async function closeRegister(user: CurrentUser, input: CloseInput) {
  let counted = ZERO;
  const counts: Record<string, number> = {};
  for (const d of DENOMINATIONS) {
    const c = input.counts[d] ?? 0;
    if (c < 0 || !Number.isInteger(c)) throw new RegisterError(`Count for Rs. ${d} must be a whole number.`);
    if (c) counts[d] = c;
    counted = counted.plus(D(d).mul(c));
  }
  const left = input.cashLeft == null ? counted : r2(input.cashLeft);
  if (left.lt(0) || left.gt(counted)) throw new RegisterError("Cash left in the drawer must be between 0 and the counted cash.");
  const handover = counted.minus(left);
  if (handover.gt(0) && !HANDOVER_REASONS.includes(input.handoverReason as (typeof HANDOVER_REASONS)[number]))
    throw new RegisterError("Say where the cash taken out of the drawer is going.");

  return posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "RegisterSession" WHERE id = ${input.registerId} FOR UPDATE`;
    const r = await tx.registerSession.findUnique({ where: { id: input.registerId } });
    if (!r || r.closedAt) throw new RegisterError("This cash register is already closed.");
    if (!user.locations.some((l) => l.id === r.locationId)) throw new RegisterError("This cash register belongs to another location.");
    const { expected } = await drawerSummary(tx, r.id);
    const variance = counted.minus(expected);
    if (!variance.eq(0)) {
      if (!input.varianceReason || !VARIANCE_REASONS[input.varianceReason]) throw new RegisterError("The count does not match. Choose the reason for the difference.");
      if (!input.notes) throw new RegisterError("The count does not match. Write a note explaining the difference.");
    }
    await tx.registerSession.update({
      where: { id: r.id },
      data: {
        closedAt: new Date(), closedById: user.personId, expectedCash: expected, countedCash: counted, variance, denominations: counts,
        varianceReason: variance.eq(0) ? null : input.varianceReason, notes: input.notes, cashLeft: left,
      },
    });
    if (handover.gt(0)) await addMovement(tx, user, r, input.handoverReason!, handover, null, true);
    await tx.auditEvent.create({
      data: {
        actorId: user.personId, action: "REGISTER_CLOSED", subjectType: "RegisterSession", subjectId: r.id,
        detail: { expected: expected.toFixed(2), counted: counted.toFixed(2), variance: variance.toFixed(2), reason: input.varianceReason, cashLeft: left.toFixed(2), handedOver: handover.toFixed(2) },
      },
    });
    return { expected, counted, variance, left, handover };
  });
}
