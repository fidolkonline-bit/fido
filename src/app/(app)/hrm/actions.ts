"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser, requirePermission } from "@/lib/auth";
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
  return wrap(["/hrm/me", "/hrm"], () => H.selfClock(user, kind), kind === "IN" ? "Clocked in." : "Clocked out.");
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
    else if (kind === "shift") {
      const start = str(f, "startTime"), end = str(f, "endTime");
      if (!start || !end) throw new Error("Start and end time are required.");
      await db.shift.create({ data: { name, startTime: start, endTime: end, graceMinutes: num(f, "graceMinutes") ?? 10, restDays: f.getAll("restDays").map(Number) } });
    } else if (kind === "component") {
      const amount = num(f, "amount");
      if (amount == null || amount < 0) throw new Error("Amount is required.");
      await db.payComponent.create({ data: { name, kind: str(f, "componentKind") ?? "EARNING", calc: str(f, "calc") ?? "FIXED", amount } });
    } else throw new Error("Unknown setting.");
  }, `${name} added.`);
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
  try { id = (await P.createRun(user, str(f, "start") ?? "", str(f, "end") ?? "", str(f, "notes"))).id; } catch (e) { return formError(e); }
  redirect(`/hrm/payroll/${id}`);
}

export async function runAction(f: FormData) {
  const user = await requirePermission("hr.payroll");
  const id = String(f.get("runId"));
  const a = String(f.get("action"));
  if (a === "recalc") await P.calculateRun(user, id);
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
  await P.approveCommission(user, String(f.get("recipientId")), new Date());
  revalidatePath("/hrm/commissions");
}

export async function payCommissionForm(_: Res, f: FormData): Promise<Res> {
  const user = await requirePermission("commissions.manage");
  return wrap(["/hrm/commissions"], () => P.payCommissionDirect(user, String(f.get("recipientId")), { method: String(f.get("method")), accountId: str(f, "accountId"), reference: str(f, "reference") }), "Commission paid.");
}
