"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { headers } from "next/headers";
import { clientIp, requireUser, requirePermission } from "@/lib/auth";
import * as H from "@/lib/hr";
import * as P from "@/lib/payroll";
import { D } from "@/lib/money";
import { formError, num, str } from "@/lib/forms";

type Res = { error?: string; ok?: string } | undefined;
async function wrap(paths: string[], fn: () => Promise<unknown>, ok = "Saved."): Promise<Res> {
  try { await fn(); } catch (e) { return formError(e); }
  paths.forEach((p) => revalidatePath(p));
  return { ok };
}

// ── Self-service ──
export async function clock(kind: "IN" | "OUT"): Promise<Res> {
  const user = await requireUser();
  const ip = clientIp(await headers());
  return wrap(["/hrm/me", "/hrm", "/start"], () => H.selfClock(user, kind, ip), kind === "IN" ? "Clocked in." : "Clocked out.");
}

export async function applyLeave(_: Res, f: FormData): Promise<Res> {
  const user = await requireUser();
  const employeeId = str(f, "employeeId") ?? (await db.employeeProfile.findUnique({ where: { personId: user.personId } }))?.id;
  if (!employeeId) return { error: "You do not have an employee profile." };
  return wrap(["/hrm/me", "/hrm/leave"], () => H.requestLeave(user, {
    employeeId, leaveTypeId: str(f, "leaveTypeId"), startDate: str(f, "startDate"), endDate: str(f, "endDate") ?? str(f, "startDate"),
    halfDay: f.get("halfDay") === "on", reason: str(f, "reason"),
  }), "Leave requested. Your manager will be asked to approve it.");
}

export async function cancelLeaveForm(f: FormData) {
  const user = await requireUser();
  await H.cancelLeave(user, String(f.get("id")));
  revalidatePath("/hrm/me"); revalidatePath("/hrm/leave");
}

export async function decideLeaveForm(f: FormData) {
  const user = await requirePermission("leave.approve");
  await H.decideLeave(user, String(f.get("id")), f.get("decision") === "approve", str(f, "note"));
  revalidatePath("/hrm/leave");
}

// ── Employees ──
export async function saveEmployeeForm(_: Res, f: FormData): Promise<Res> {
  const user = await requirePermission("hr.manage");
  const personId = String(f.get("personId"));
  return wrap([`/hrm/employees/${personId}`, "/hrm/employees"], () => H.saveEmployee(user, {
    personId, code: str(f, "code"), departmentId: str(f, "departmentId"), designationId: str(f, "designationId"), locationId: str(f, "locationId"),
    shiftId: str(f, "shiftId"), joinedOn: str(f, "joinedOn"), taxId: str(f, "taxId"),
  }));
}

export async function addSalaryForm(_: Res, f: FormData): Promise<Res> {
  const user = await requirePermission("hr.payroll");
  const employeeId = String(f.get("employeeId"));
  return wrap([`/hrm/employees/${f.get("personId")}`], () => H.addSalary(user, employeeId, { amount: num(f, "amount") ?? 0, payPeriod: String(f.get("payPeriod")), effectiveFrom: str(f, "effectiveFrom") ?? H.todayYmd(), note: str(f, "note") }));
}

export async function setBankForm(_: Res, f: FormData): Promise<Res> {
  const user = await requirePermission("hr.bank");
  return wrap([`/hrm/employees/${f.get("personId")}`], () => H.setBank(user, String(f.get("employeeId")), str(f, "bankName"), str(f, "account")), "Bank details saved (encrypted).");
}

export async function setLeftForm(f: FormData) {
  const user = await requirePermission("hr.manage");
  const id = String(f.get("employeeId"));
  const left = str(f, "leftOn");
  await db.employeeProfile.update({ where: { id }, data: { leftOn: left ? H.dateOnly(left) : null, status: left ? "LEFT" : "ACTIVE" } });
  await db.auditEvent.create({ data: { actorId: user.personId, action: left ? "EMPLOYEE_LEFT" : "EMPLOYEE_REINSTATED", subjectType: "EmployeeProfile", subjectId: id } });
  revalidatePath(`/hrm/employees/${f.get("personId")}`);
}

export async function assignComponentForm(_: Res, f: FormData): Promise<Res> {
  await requirePermission("hr.payroll");
  return wrap([`/hrm/employees/${f.get("personId")}`], async () => {
    const from = str(f, "fromDate");
    if (!from) throw new Error("Choose the start date.");
    const once = f.get("oneTime") === "on";
    await db.payComponentAssignment.create({
      data: { componentId: String(f.get("componentId")), employeeId: String(f.get("employeeId")), amount: num(f, "amount") ?? undefined, fromDate: H.dateOnly(from), toDate: once ? H.dateOnly(from) : str(f, "toDate") ? H.dateOnly(str(f, "toDate")!) : null },
    });
  });
}

export async function endComponentForm(f: FormData) {
  await requirePermission("hr.payroll");
  await db.payComponentAssignment.update({ where: { id: String(f.get("id")) }, data: { toDate: H.dateOnly(H.todayYmd()) } });
  revalidatePath(`/hrm/employees/${f.get("personId")}`);
}

// ── Masters ──
export async function saveMaster(_: Res, f: FormData): Promise<Res> {
  await requirePermission("hr.manage");
  const kind = str(f, "kind");
  const name = str(f, "name");
  if (!name) return { error: "Name is required." };
  return wrap(["/hrm/setup"], async () => {
    if (kind === "department") await db.department.create({ data: { name } });
    else if (kind === "designation") await db.designation.create({ data: { name } });
    else if (kind === "leaveType") await db.leaveType.create({ data: { name, maxCount: num(f, "maxCount"), interval: str(f, "interval") ?? "NONE", paid: f.get("paid") === "on" } });
    else if (kind === "shift") throw new Error("Use the shift form.");
    else if (kind === "component") {
      const amount = num(f, "amount");
      if (amount == null || amount < 0) throw new Error("Amount is required.");
      await db.payComponent.create({ data: { name, kind: str(f, "componentKind") ?? "EARNING", calc: str(f, "calc") ?? "FIXED", amount } });
    } else throw new Error("Unknown setting.");
  }, `${name} added.`);
}

// Add or change a shift. A change applies to every day worked on it, past days included (late / left early /
// auto clock-out are worked out from the shift when shown), so it is audited with the old and new values.
export async function saveShift(_: Res, f: FormData): Promise<Res> {
  const user = await requirePermission("hr.manage");
  const id = str(f, "id");
  const name = str(f, "name");
  const startTime = str(f, "startTime"), endTime = str(f, "endTime");
  const grace = num(f, "graceMinutes") ?? 10;
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!name) return { error: "Name is required." };
  if (!startTime || !endTime || !hhmm.test(startTime) || !hhmm.test(endTime)) return { error: "Start and end time are required." };
  if (startTime === endTime) return { error: "Start and end time cannot be the same." };
  if (!Number.isInteger(grace) || grace < 0 || grace > 240) return { error: "Grace minutes must be a whole number from 0 to 240." };
  const data = { name, startTime, endTime, graceMinutes: grace, restDays: [...new Set(f.getAll("restDays").map(Number))].filter((d) => d >= 0 && d <= 6).sort() };
  try {
    if (id) {
      const before = await db.shift.findUnique({ where: { id } });
      if (!before) return { error: "This shift no longer exists." };
      const after = await db.shift.update({ where: { id }, data: { ...data, active: f.get("active") === "on" } });
      await db.auditEvent.create({ data: { actorId: user.personId, action: "SHIFT_UPDATED", subjectType: "Shift", subjectId: id, detail: { before, after } } });
    } else {
      const s = await db.shift.create({ data });
      await db.auditEvent.create({ data: { actorId: user.personId, action: "SHIFT_CREATED", subjectType: "Shift", subjectId: s.id, detail: data } });
    }
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/hrm/setup");
  revalidatePath("/hrm/attendance");
  if (id) redirect("/hrm/setup?saved=shift#shifts");
  return { ok: `${name} added.` };
}

export async function addHoliday(_: Res, f: FormData): Promise<Res> {
  await requirePermission("hr.manage");
  const name = str(f, "name"), start = str(f, "startDate"), end = str(f, "endDate") ?? str(f, "startDate");
  if (!name || !start || !end || end < start) return { error: "Name and a valid date range are required." };
  return wrap(["/hrm/holidays"], () => db.holiday.create({ data: { name, startDate: H.dateOnly(start), endDate: H.dateOnly(end), locationId: str(f, "locationId"), note: str(f, "note") } }), `${name} added.`);
}

export async function removeHoliday(f: FormData) {
  await requirePermission("hr.manage");
  const h = await db.holiday.findUniqueOrThrow({ where: { id: String(f.get("id")) } });
  // Past holidays may already be in approved payroll; only upcoming ones are removed.
  if (H.dateOnlyYmd(h.startDate) <= H.todayYmd()) throw new Error("Past holidays stay on record.");
  await db.holiday.delete({ where: { id: h.id } });
  revalidatePath("/hrm/holidays");
}

// ── Attendance corrections ──
export async function manualClockForm(_: Res, f: FormData): Promise<Res> {
  const user = await requirePermission("attendance.manage");
  const day = str(f, "day"), time = str(f, "time");
  if (!day || !time) return { error: "Date and time are required." };
  const at = new Date(H.dayStart(day).getTime() + (Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))) * 60_000);
  return wrap(["/hrm/attendance"], () => H.manualClock(user, { employeeId: String(f.get("employeeId")), kind: String(f.get("kind")) as "IN", at, note: str(f, "note") ?? "" }), "Correction recorded.");
}

export async function voidClockForm(f: FormData) {
  const user = await requirePermission("attendance.manage");
  await H.voidClock(user, String(f.get("id")), str(f, "reason") ?? "");
  revalidatePath("/hrm/attendance");
}

// ── Payroll ──
export async function newRun(_: Res, f: FormData): Promise<Res> {
  const user = await requirePermission("hr.payroll");
  let id: string;
  try { id = (await P.createRun(user, str(f, "start") ?? "", str(f, "end") ?? "", str(f, "notes"), str(f, "employeeId"))).id; } catch (e) { return formError(e); }
  redirect(`/hrm/payroll/${id}`);
}

export async function runAction(f: FormData) {
  const user = await requirePermission("hr.payroll");
  const id = String(f.get("runId"));
  const a = String(f.get("action"));
  if (a === "recalc") await P.calculateRun(user, id, str(f, "employeeId") ?? undefined);
  else if (a === "approve") await P.approveRun(user, id);
  else if (a === "reopen") await P.reopenRun(user, id);
  else if (a === "cancel") {
    const r = await db.payrollRun.findUniqueOrThrow({ where: { id } });
    if (r.status !== "DRAFT") throw new Error("Only a draft can be cancelled.");
    await db.payrollRun.update({ where: { id }, data: { status: "CANCELLED" } });
  }
  revalidatePath(`/hrm/payroll/${id}`);
}

export async function manualLineForm(_: Res, f: FormData): Promise<Res> {
  const user = await requirePermission("hr.payroll");
  return wrap([`/hrm/payroll/${f.get("runId")}`], () => P.addManualLine(user, String(f.get("payslipId")), { kind: String(f.get("kind")) as "EARNING", label: str(f, "label") ?? "", amount: num(f, "amount") ?? 0, note: str(f, "note") ?? "" }), "Line added.");
}

export async function payForm(_: Res, f: FormData): Promise<Res> {
  const user = await requirePermission("hr.payroll");
  return wrap([`/hrm/payroll/${f.get("runId")}`], () => P.payPayslip(user, String(f.get("payslipId")), { amount: num(f, "amount") ?? 0, method: String(f.get("method")), accountId: str(f, "accountId"), reference: str(f, "reference") }), "Payment recorded.");
}

export async function payAllForm(f: FormData) {
  const user = await requirePermission("hr.payroll");
  const runId = String(f.get("runId"));
  const slips = await db.payslip.findMany({ where: { runId } });
  for (const s of slips) {
    const due = D(s.net).minus(s.paid);
    if (due.gt(0)) await P.payPayslip(user, s.id, { amount: Number(due), method: String(f.get("method")), accountId: str(f, "accountId"), reference: str(f, "reference") });
  }
  revalidatePath(`/hrm/payroll/${runId}`);
}

// ── Commission ──
export async function approveCommissionForm(f: FormData) {
  const user = await requirePermission("commissions.manage");
  // "Up to" a business date (e.g. the last day of the month), so next month's commission stays unapproved.
  const upTo = String(f.get("upTo") ?? "");
  await P.approveCommission(user, String(f.get("recipientId")), /^\d{4}-\d{2}-\d{2}$/.test(upTo) ? new Date(`${upTo}T23:59:59.999+05:30`) : new Date());
  revalidatePath("/hrm/commissions");
}

export async function payCommissionForm(_: Res, f: FormData): Promise<Res> {
  const user = await requirePermission("commissions.manage");
  return wrap(["/hrm/commissions"], () => P.payCommissionDirect(user, String(f.get("recipientId")), { method: String(f.get("method")), accountId: str(f, "accountId"), reference: str(f, "reference") }), "Commission paid.");
}

// ── Sales targets (§9.3) ──
export async function newTargetForm(_: Res, f: FormData): Promise<Res> {
  await requirePermission("hr.payroll");
  const personIds = [...new Set(f.getAll("personIds").map(String).filter(Boolean))];
  return wrap(["/hrm/targets"], async () => {
    const T = await import("@/lib/targets");
    if (!personIds.length) throw new Error("Choose at least one employee.");
    const mode = str(f, "mode") ?? "FIXED";
    const cadence = str(f, "cadence") === "DAILY" ? "DAILY" : "PERIOD";
    const bands = [0, 1, 2, 3].flatMap((i) => {
      const from = num(f, `from${i}`), bonus = num(f, `bonus${i}`);
      if (from == null && bonus == null) return [];
      if (from == null || bonus == null) throw new Error(`Band ${i + 1} needs both "sales from" and a bonus.`);
      return [{ from, to: num(f, `to${i}`), ...(mode === "FIXED" ? { amount: bonus } : { percent: bonus }) }];
    });
    const start = str(f, "periodStart"), end = str(f, "periodEnd");
    if (!start || !end || end < start) throw new Error("Choose a valid period.");
    const validBands = T.validateBands(bands, mode);
    const categoryIds = [...new Set(f.getAll("categoryIds").map(String).filter(Boolean))];
    const known = await db.category.count({ where: { id: { in: categoryIds } } });
    if (known !== categoryIds.length) throw new Error("A chosen category no longer exists.");
    const people = await db.person.count({ where: { id: { in: personIds }, employee: { isNot: null } } });
    if (people !== personIds.length) throw new Error("A chosen employee no longer exists.");
    await db.salesTarget.createMany({
      data: personIds.map((personId) => ({ personId, periodStart: H.dateOnly(start), periodEnd: H.dateOnly(end), bands: validBands, mode, cadence, categoryIds })),
    });
  }, personIds.length > 1 ? `${personIds.length} targets saved.` : "Target saved.");
}

// Repeats the targets of one period for the period after it, for employees who are still active.
export async function copyTargetsForm(_: Res, f: FormData): Promise<Res> {
  await requirePermission("hr.payroll");
  let made = 0, period = "";
  try {
    const C = await import("@/lib/target-calc");
    const [start, end] = (str(f, "period") ?? "").split("|");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(end ?? "")) throw new Error("Choose the period to copy.");
    const src = await db.salesTarget.findMany({
      where: { periodStart: H.dateOnly(start), periodEnd: H.dateOnly(end), person: { active: true, employee: { isNot: null } } },
      orderBy: { createdAt: "asc" },
    });
    if (!src.length) throw new Error("That period has no targets for current employees.");
    const next = C.nextPeriod(start, end);
    const existing = new Set((await db.salesTarget.findMany({ where: { periodStart: H.dateOnly(next.start) }, select: { personId: true } })).map((t) => t.personId));
    const rows = src.filter((t) => !existing.has(t.personId));
    if (!rows.length) throw new Error(`Everyone already has a target starting ${next.start}.`);
    await db.salesTarget.createMany({
      data: rows.map((t) => ({ personId: t.personId, periodStart: H.dateOnly(next.start), periodEnd: H.dateOnly(next.end), bands: t.bands ?? [], mode: t.mode, cadence: t.cadence, categoryIds: t.categoryIds })),
    });
    made = rows.length;
    period = `${next.start} – ${next.end}`;
  } catch (e) { return formError(e); }
  revalidatePath("/hrm/targets");
  return { ok: `Copied ${made} target${made === 1 ? "" : "s"} to ${period}.` };
}

export async function deleteTargetForm(f: FormData) {
  await requirePermission("hr.payroll");
  const t = await db.salesTarget.findUniqueOrThrow({ where: { id: String(f.get("id")) } });
  if (t.approvedAt) throw new Error("An approved target cannot be deleted.");
  await db.salesTarget.delete({ where: { id: t.id } });
  revalidatePath("/hrm/targets");
}

export async function approveTargetForm(f: FormData) {
  const user = await requirePermission("hr.payroll");
  const T = await import("@/lib/targets");
  const t = await db.salesTarget.findUniqueOrThrow({ where: { id: String(f.get("id")) } });
  if (t.payslipId) throw new Error("Already paid in payroll.");
  if (t.approvedAt) throw new Error("Already approved.");
  if (H.dateOnlyYmd(t.periodEnd) >= H.todayYmd()) throw new Error("Approve after the target period has ended.");
  const r = await T.targetResult(t);
  const categories = t.categoryIds.length ? (await db.category.findMany({ where: { id: { in: t.categoryIds } }, select: { name: true } })).map((c) => c.name) : null;
  await db.salesTarget.update({
    where: { id: t.id },
    data: {
      approvedAt: new Date(),
      snapshot: {
        achieved: r.value.toFixed(2), earning: r.earning.toFixed(2), by: user.name, cadence: t.cadence, mode: t.mode, categories,
        ...(r.days ? { days: r.days.map((d) => ({ day: d.day, value: d.value.toFixed(2), earning: d.earning.toFixed(2) })) } : {}),
      },
    },
  });
  revalidatePath("/hrm/targets");
}
