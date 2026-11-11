import "server-only";
import { z } from "zod";
import { db, posting } from "./db";
import { D } from "./money";
import { nextNumber } from "./numbering";
import { applyPayments, dueDates, splitAmount, type DueState } from "./instalment-rules";
import { enqueueSms, kickSms } from "./sms";
import type { CurrentUser } from "./auth";

export class InstalmentError extends Error {}

export const planInput = z.object({
  saleId: z.string().min(1),
  count: z.coerce.number().int().min(2, "A plan needs at least 2 instalments.").max(36),
  frequency: z.enum(["WEEKLY", "FORTNIGHTLY", "MONTHLY"]),
  firstDueAt: z.coerce.date(),
  guarantorName: z.string().trim().max(100).nullable().default(null),
  guarantorPhone: z.string().trim().max(20).nullable().default(null),
  guarantorId: z.string().trim().max(30).nullable().default(null),
  notes: z.string().trim().max(500).nullable().default(null),
});

// A plan is a schedule over the unpaid balance of one credit sale. It moves no money and creates no debt of its own:
// the debt is the sale's, and instalments are settled by ordinary payments on that sale (POS › Receive payment, or
// the invoice), oldest instalment first. No interest is added — price the goods for instalment sale instead.
export async function createPlan(user: CurrentUser, raw: unknown) {
  const input = planInput.parse(raw);
  return posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Sale" WHERE id = ${input.saleId} FOR UPDATE`;
    const sale = await tx.sale.findUnique({ where: { id: input.saleId }, include: { instalmentPlan: true } });
    if (!sale || sale.stage !== "FINAL") throw new InstalmentError("Sale not found.");
    if (!sale.customerId) throw new InstalmentError("An instalment plan needs a named customer on the sale.");
    if (sale.instalmentPlan) throw new InstalmentError(`This sale already has plan ${sale.instalmentPlan.number}.`);
    const settled = D(sale.paid).plus(sale.credited);
    const due = D(sale.total).minus(settled);
    if (due.lte(0)) throw new InstalmentError("Nothing is due on this sale.");
    if (input.firstDueAt.getTime() < Date.now() - 86_400_000) throw new InstalmentError("The first instalment date is in the past.");
    const amounts = splitAmount(due.toNumber(), input.count);
    const dates = dueDates(input.firstDueAt, input.count, input.frequency);
    const number = await nextNumber(tx, "INSTALMENT");
    const plan = await tx.instalmentPlan.create({
      data: {
        number, saleId: sale.id, customerId: sale.customerId, financed: due, paidBefore: settled, count: input.count, frequency: input.frequency, firstDueAt: input.firstDueAt,
        guarantorName: input.guarantorName, guarantorPhone: input.guarantorPhone, guarantorId: input.guarantorId, notes: input.notes, createdById: user.personId,
        dues: { create: amounts.map((amount, i) => ({ seq: i + 1, amount, dueAt: dates[i] })) },
      },
    });
    await tx.auditEvent.create({ data: { actorId: user.personId, action: "INSTALMENT_PLAN_CREATED", subjectType: "Sale", subjectId: sale.id, detail: { number, financed: due.toString(), count: input.count, frequency: input.frequency } } });
    return { id: plan.id, number };
  });
}

export async function cancelPlan(user: CurrentUser, planId: string) {
  const plan = await db.instalmentPlan.update({ where: { id: planId }, data: { status: "CANCELLED" } });
  await db.auditEvent.create({ data: { actorId: user.personId, action: "INSTALMENT_PLAN_CANCELLED", subjectType: "Sale", subjectId: plan.saleId, detail: { number: plan.number } } });
}

type PlanWith = { paidBefore: unknown; financed: unknown; dues: { seq: number; dueAt: Date; amount: unknown }[]; sale: { paid: unknown; credited: unknown } };

export function planProgress(plan: PlanWith, now = new Date()) {
  const settled = D(plan.sale.paid as string).plus(D(plan.sale.credited as string)).minus(D(plan.paidBefore as string)).toNumber();
  const dues: DueState[] = applyPayments(plan.dues.map((d) => ({ seq: d.seq, dueAt: d.dueAt, amount: Number(d.amount) })), settled, now);
  const overdue = dues.filter((d) => d.state === "OVERDUE").reduce((a, d) => a + (d.amount - d.paid), 0);
  const next = dues.find((d) => d.state !== "PAID") ?? null;
  const balance = Math.max(Number(plan.financed) - Math.max(settled, 0), 0);
  return { dues, overdue: Math.round(overdue * 100) / 100, next, balance: Math.round(balance * 100) / 100, complete: balance <= 0 };
}

// Daily job: an SMS the day before (or on the day) an unpaid instalment falls due. Each instalment is reminded once.
export async function remindInstalments() {
  const soon = new Date(Date.now() + 36 * 3_600_000);
  const dues = await db.instalmentDue.findMany({
    where: { remindedAt: null, dueAt: { lte: soon, gte: new Date(Date.now() - 3 * 86_400_000) }, plan: { status: "ACTIVE" } },
    include: { plan: { include: { dues: true, sale: true, customer: true } } },
    take: 200,
  });
  let sent = 0;
  for (const due of dues) {
    const state = planProgress(due.plan).dues.find((d) => d.seq === due.seq);
    const claimed = await db.instalmentDue.updateMany({ where: { id: due.id, remindedAt: null }, data: { remindedAt: new Date() } });
    if (!claimed.count || !state || state.state === "PAID") continue;
    const date = due.dueAt.toLocaleDateString("en-GB", { timeZone: "Asia/Colombo", day: "2-digit", month: "short" });
    if (await enqueueSms("INSTALMENT_DUE", { to: due.plan.customer.phone, vars: { amount: (state.amount - state.paid).toFixed(2), date, invoice: due.plan.sale.number }, sourceType: "InstalmentDue", sourceId: due.id })) sent++;
  }
  if (sent) kickSms();
  return sent;
}
