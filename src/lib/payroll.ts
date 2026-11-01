import "server-only";
import { Prisma } from "@prisma/client";
import { db, posting, type Tx } from "./db";
import { D, ZERO } from "./money";
import { nextNumber } from "./numbering";
import { attendance, dateOnly, dateOnlyYmd, salaryOn, HrError } from "./hr";
import type { CurrentUser } from "./auth";

export type PayLine = { kind: "EARNING" | "DEDUCTION"; label: string; amount: string; source: "COMPONENT" | "COMMISSION" | "LEAVE" | "MANUAL"; note?: string };

const r2 = (v: Prisma.Decimal) => v.toDecimalPlaces(2);

// ───────────── Commission (§9.2) ─────────────

// Outstanding = rows not yet in any settlement (accruals and their return reversals). Approved = approvedAt set.
export async function commissionOutstanding(recipientId?: string) {
  const rows = await db.commissionAccrual.findMany({
    where: { settlementId: null, ...(recipientId ? { recipientId } : {}) },
    include: { recipient: { include: { employee: true } }, saleLine: { include: { sale: true } } },
    orderBy: { createdAt: "asc" },
  });
  const by = new Map<string, { recipient: (typeof rows)[number]["recipient"]; approved: Prisma.Decimal; pending: Prisma.Decimal; rows: typeof rows }>();
  for (const r of rows) {
    const x = by.get(r.recipientId) ?? { recipient: r.recipient, approved: ZERO, pending: ZERO, rows: [] };
    if (r.approvedAt) x.approved = x.approved.plus(r.amount); else x.pending = x.pending.plus(r.amount);
    x.rows.push(r);
    by.set(r.recipientId, x);
  }
  return [...by.values()];
}

export async function approveCommission(user: CurrentUser, recipientId: string, upTo: Date) {
  const r = await db.commissionAccrual.updateMany({ where: { recipientId, settlementId: null, approvedAt: null, createdAt: { lte: upTo } }, data: { approvedAt: new Date() } });
  await db.auditEvent.create({ data: { actorId: user.personId, action: "COMMISSION_APPROVED", subjectType: "Person", subjectId: recipientId, detail: { rows: r.count } } });
  return r.count;
}

// Direct payout (agents, or staff paid outside payroll). Rows get one settlement only (AC-17).
export async function payCommissionDirect(user: CurrentUser, recipientId: string, raw: { method: string; accountId: string | null; reference: string | null }) {
  return posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Person" WHERE id = ${recipientId} FOR UPDATE`;
    const rows = await tx.commissionAccrual.findMany({ where: { recipientId, settlementId: null, approvedAt: { not: null } } });
    const amount = r2(rows.reduce((a, r) => a.plus(r.amount), ZERO));
    if (amount.lte(0)) throw new HrError("Nothing approved to pay (returns may have reversed it). Approve commission first.");
    let accountId = raw.accountId;
    let registerId: string | null = null;
    if (raw.method === "CASH") {
      registerId = (await tx.registerSession.findFirst({ where: { userId: user.personId, closedAt: null } }))?.id ?? null;
      accountId ??= (await tx.account.findFirst({ where: { type: "CASH", active: true, locationId: user.location?.id } }))?.id ?? null;
    }
    if (!accountId) throw new HrError("Choose the account the commission is paid from.");
    const s = await tx.commissionSettlement.create({ data: { recipientId, method: "DIRECT", amount, createdById: user.personId } });
    await tx.commissionAccrual.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { settlementId: s.id, state: "SETTLED" } });
    await tx.payment.create({
      data: { number: await nextNumber(tx, "PAYMENT_OUT"), direction: "OUT", method: raw.method, amount, accountId, registerId, settlementId: s.id, reference: raw.reference, createdById: user.personId },
    });
    return { amount: amount.toFixed(2) };
  });
}

// ───────────── Payroll (§14.5) ─────────────

async function computeSlip(tx: Tx, employeeId: string, start: string, end: string, keepManual: PayLine[]) {
  const sal = await salaryOn(employeeId, end);
  if (!sal) return null;
  const days = await attendance(employeeId, start, end);
  const working = days.filter((d) => d.working);
  const workingDays = working.length;
  const worked = working.filter((d) => d.firstIn).length;
  const paidLeave = working.filter((d) => d.leave && d.leavePaid).reduce((a, d) => a + d.leaveDays, 0);
  const unpaidLeave = working.filter((d) => d.leave && !d.leavePaid).reduce((a, d) => a + d.leaveDays, 0);
  const absent = working.filter((d) => d.absent).length;
  const offDays = days.filter((d) => d.offDayWork).length;
  const base = D(sal.amount);

  // Monthly: full salary less unpaid leave days. Weekly: per full week in the period. Daily: days worked + paid leave.
  // Absence is shown as an exception only; no automatic penalty without a configured rule (§14.4).
  let basicEarned: Prisma.Decimal;
  if (sal.payPeriod === "DAY") basicEarned = base.mul(worked + paidLeave);
  else if (sal.payPeriod === "WEEK") basicEarned = base.mul(Math.round(days.length / 7));
  else basicEarned = workingDays > 0 ? base.minus(base.div(workingDays).mul(unpaidLeave)) : base;
  basicEarned = r2(Prisma.Decimal.max(basicEarned, ZERO));

  const lines: PayLine[] = [];
  if (unpaidLeave > 0 && sal.payPeriod === "MONTH") lines.push({ kind: "DEDUCTION", label: `Unpaid leave (${unpaidLeave} day${unpaidLeave === 1 ? "" : "s"})`, amount: r2(base.minus(basicEarned)).toString(), source: "LEAVE", note: "Shown for information; already taken off basic" });
  const assigns = await tx.payComponentAssignment.findMany({
    where: { employeeId, fromDate: { lte: dateOnly(end) }, OR: [{ toDate: null }, { toDate: { gte: dateOnly(start) } }], component: { active: true } },
    include: { component: true },
  });
  for (const a of assigns) {
    const amt = a.amount ?? a.component.amount;
    const value = a.component.calc === "PERCENT_OF_BASIC" ? r2(basicEarned.mul(amt).div(100)) : r2(D(amt));
    lines.push({ kind: a.component.kind as PayLine["kind"], label: a.component.name + (a.component.calc === "PERCENT_OF_BASIC" ? ` (${D(amt).toString()}%)` : ""), amount: value.toString(), source: "COMPONENT" });
  }

  // Approved, unsettled commission for this person is included once; approval of the run settles it.
  const emp = await tx.employeeProfile.findUniqueOrThrow({ where: { id: employeeId } });
  const comm = await tx.commissionAccrual.findMany({ where: { recipientId: emp.personId, settlementId: null, approvedAt: { not: null } } });
  const commTotal = r2(comm.reduce((a, c) => a.plus(c.amount), ZERO));
  const commissionIds = commTotal.gt(0) ? comm.map((c) => c.id) : [];
  if (commTotal.gt(0)) lines.push({ kind: "EARNING", label: "Sales commission (approved)", amount: commTotal.toString(), source: "COMMISSION" });

  // Rest-day / holiday work is listed for the reviewer; add a manual earning if the shop pays extra for it.
  if (offDays > 0) lines.push({ kind: "EARNING", label: `Worked on rest days / holidays: ${offDays} (review — not paid automatically)`, amount: "0.00", source: "LEAVE" });
  lines.push(...keepManual);
  const earnings = lines.filter((l) => l.kind === "EARNING").reduce((a, l) => a.plus(l.amount), ZERO);
  const deductions = lines.filter((l) => l.kind === "DEDUCTION" && l.source !== "LEAVE").reduce((a, l) => a.plus(l.amount), ZERO);
  const gross = r2(basicEarned.plus(earnings));
  return {
    payPeriod: sal.payPeriod, baseSalary: base, workingDays: D(workingDays), daysWorked: D(worked), paidLeaveDays: D(paidLeave), unpaidLeaveDays: D(unpaidLeave),
    absentDays: D(absent), basicEarned, lines, commissionIds, gross, deductions: r2(deductions), net: r2(gross.minus(deductions)),
  };
}

export async function createRun(user: CurrentUser, start: string, end: string, notes: string | null) {
  if (end < start) throw new HrError("Period end is before the start.");
  const run = await posting(async (tx) => {
    const clash = await tx.payrollRun.findFirst({ where: { periodStart: dateOnly(start), status: { not: "CANCELLED" } } });
    if (clash) throw new HrError(`Payroll ${clash.number} already covers this period. Open it instead.`);
    return tx.payrollRun.create({ data: { number: await nextNumber(tx, "PAYROLL"), periodStart: dateOnly(start), periodEnd: dateOnly(end), notes, createdById: user.personId } });
  });
  await calculateRun(user, run.id);
  return run;
}

// Recalculate a draft run from current salary/attendance/leave/components. Manual lines are kept.
export async function calculateRun(user: CurrentUser, runId: string) {
  const run = await db.payrollRun.findUniqueOrThrow({ where: { id: runId }, include: { payslips: true } });
  if (run.status !== "DRAFT") throw new HrError("Only a draft payroll can be recalculated.");
  const start = dateOnlyYmd(run.periodStart);
  const end = dateOnlyYmd(run.periodEnd);
  const employees = await db.employeeProfile.findMany({
    where: { joinedOn: { lte: run.periodEnd }, OR: [{ leftOn: null }, { leftOn: { gte: run.periodStart } }] },
  });
  const skipped: string[] = [];
  await posting(async (tx) => {
    for (const e of employees) {
      const existing = run.payslips.find((p) => p.employeeId === e.id);
      const manual = ((existing?.lines as PayLine[] | undefined) ?? []).filter((l) => l.source === "MANUAL");
      const s = await computeSlip(tx, e.id, start, end, manual);
      if (!s) { skipped.push(e.id); continue; }
      const data = { ...s, lines: s.lines as unknown as Prisma.InputJsonValue };
      if (existing) await tx.payslip.update({ where: { id: existing.id }, data });
      else await tx.payslip.create({ data: { ...data, runId, employeeId: e.id, periodStart: run.periodStart } });
    }
  }, 60_000);
  await db.auditEvent.create({ data: { actorId: user.personId, action: "PAYROLL_CALCULATED", subjectType: "PayrollRun", subjectId: runId } });
  return { skipped: skipped.length };
}

export async function addManualLine(user: CurrentUser, payslipId: string, raw: { kind: "EARNING" | "DEDUCTION"; label: string; amount: number; note: string }) {
  if (!raw.label?.trim() || !(raw.amount > 0)) throw new HrError("Enter a description and an amount.");
  if (!raw.note?.trim()) throw new HrError("A reason is required for manual pay lines.");
  await posting(async (tx) => {
    const p = await tx.payslip.findUniqueOrThrow({ where: { id: payslipId }, include: { run: true } });
    if (p.run.status !== "DRAFT") throw new HrError("This payroll is approved and locked.");
    const lines = [...(p.lines as PayLine[]), { kind: raw.kind, label: raw.label, amount: D(raw.amount).toFixed(2), source: "MANUAL" as const, note: `${raw.note} — ${user.name}` }];
    const earnings = lines.filter((l) => l.kind === "EARNING").reduce((a, l) => a.plus(l.amount), ZERO);
    const deductions = lines.filter((l) => l.kind === "DEDUCTION" && l.source !== "LEAVE").reduce((a, l) => a.plus(l.amount), ZERO);
    const gross = r2(D(p.basicEarned).plus(earnings));
    await tx.payslip.update({ where: { id: payslipId }, data: { lines: lines as unknown as Prisma.InputJsonValue, gross, deductions: r2(deductions), net: r2(gross.minus(deductions)) } });
  });
}

export async function approveRun(user: CurrentUser, runId: string) {
  await posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PayrollRun" WHERE id = ${runId} FOR UPDATE`;
    const run = await tx.payrollRun.findUniqueOrThrow({ where: { id: runId }, include: { payslips: { include: { employee: true } } } });
    if (run.status !== "DRAFT") throw new HrError("This payroll is not a draft.");
    if (!run.payslips.length) throw new HrError("No payslips — add salaries to employees and recalculate.");
    if (run.payslips.some((p) => D(p.net).lt(0))) throw new HrError("A payslip has negative net pay. Fix deductions first.");
    for (const p of run.payslips) {
      if (!p.commissionIds.length) continue;
      // Settle the exact commission rows this payslip included; if any were paid directly meanwhile, stop.
      const rows = await tx.commissionAccrual.findMany({ where: { id: { in: p.commissionIds } } });
      if (rows.some((r) => r.settlementId)) throw new HrError(`Commission for ${p.employee.personId} was paid in the meantime. Recalculate the payroll.`);
      const amount = r2(rows.reduce((a, r) => a.plus(r.amount), ZERO));
      const s = await tx.commissionSettlement.create({ data: { recipientId: p.employee.personId, method: "PAYROLL", amount, payslipId: p.id, createdById: user.personId } });
      await tx.commissionAccrual.updateMany({ where: { id: { in: p.commissionIds } }, data: { settlementId: s.id, state: "SETTLED" } });
    }
    await tx.payrollRun.update({ where: { id: runId }, data: { status: "APPROVED", approvedById: user.personId, approvedAt: new Date() } });
    await tx.auditEvent.create({ data: { actorId: user.personId, action: "PAYROLL_APPROVED", subjectType: "PayrollRun", subjectId: runId } });
  });
}

// An approved run with no payments can go back to draft; commission is released again.
export async function reopenRun(user: CurrentUser, runId: string) {
  await posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PayrollRun" WHERE id = ${runId} FOR UPDATE`;
    const run = await tx.payrollRun.findUniqueOrThrow({ where: { id: runId }, include: { payslips: true } });
    if (run.status !== "APPROVED") throw new HrError("Only an approved, unpaid payroll can be reopened.");
    if (run.payslips.some((p) => D(p.paid).gt(0))) throw new HrError("Payments were made; correct with an adjustment in the next payroll.");
    const settlements = await tx.commissionSettlement.findMany({ where: { payslipId: { in: run.payslips.map((p) => p.id) } } });
    for (const s of settlements) {
      await tx.commissionAccrual.updateMany({ where: { settlementId: s.id }, data: { settlementId: null, state: "ACCRUED" } });
      await tx.commissionSettlement.delete({ where: { id: s.id } });
    }
    await tx.payrollRun.update({ where: { id: runId }, data: { status: "DRAFT", approvedById: null, approvedAt: null } });
    await tx.auditEvent.create({ data: { actorId: user.personId, action: "PAYROLL_REOPENED", subjectType: "PayrollRun", subjectId: runId } });
  });
}

export async function payPayslip(user: CurrentUser, payslipId: string, raw: { amount: number; method: string; accountId: string | null; reference: string | null }) {
  await posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payslip" WHERE id = ${payslipId} FOR UPDATE`;
    const p = await tx.payslip.findUniqueOrThrow({ where: { id: payslipId }, include: { run: true, employee: true } });
    if (!["APPROVED", "PART_PAID"].includes(p.run.status)) throw new HrError("Approve the payroll before paying.");
    const amount = D(raw.amount).toDecimalPlaces(2);
    const due = D(p.net).minus(p.paid);
    if (amount.lte(0) || amount.gt(due)) throw new HrError(`Pay between 0.01 and ${due.toFixed(2)}.`);
    let accountId = raw.accountId;
    let registerId: string | null = null;
    if (raw.method === "CASH") {
      registerId = (await tx.registerSession.findFirst({ where: { userId: user.personId, closedAt: null } }))?.id ?? null;
      accountId ??= (await tx.account.findFirst({ where: { type: "CASH", active: true, locationId: user.location?.id } }))?.id ?? null;
    }
    if (!accountId) throw new HrError("Choose the account salary is paid from.");
    // Paying a payslip settles the approved payable; it is not a second expense (§14.5).
    await tx.payment.create({
      data: { number: await nextNumber(tx, "PAYMENT_OUT"), direction: "OUT", method: raw.method, amount, accountId, registerId, payslipId, contactId: null, reference: raw.reference, createdById: user.personId },
    });
    await tx.payslip.update({ where: { id: payslipId }, data: { paid: { increment: amount } } });
    const slips = await tx.payslip.findMany({ where: { runId: p.runId } });
    const allPaid = slips.every((s) => D(s.paid).gte(s.net));
    await tx.payrollRun.update({ where: { id: p.runId }, data: { status: allPaid ? "PAID" : "PART_PAID" } });
  });
}
