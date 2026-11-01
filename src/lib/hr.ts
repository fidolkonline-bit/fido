import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db, posting } from "./db";
import { D, ZERO } from "./money";
import { seal, unseal } from "./vault";
import type { CurrentUser } from "./auth";

export class HrError extends Error {}

// ───────────── Business dates (Asia/Colombo, UTC+05:30, no DST) ─────────────

const OFFSET = 330 * 60_000;
export const ymd = (d: Date) => new Date(d.getTime() + OFFSET).toISOString().slice(0, 10);
export const dateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`); // for @db.Date columns
export const dayStart = (s: string) => new Date(dateOnly(s).getTime() - OFFSET); // instant of local midnight
export const todayYmd = () => ymd(new Date());
export const dateOnlyYmd = (d: Date) => d.toISOString().slice(0, 10); // @db.Date values come back as UTC midnight
const weekday = (s: string) => dateOnly(s).getUTCDay();

export function eachDay(start: string, end: string) {
  const out: string[] = [];
  for (let t = dateOnly(start).getTime(); t <= dateOnly(end).getTime(); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

// ───────────── Calendar per employee ─────────────

export async function calendarFor(employeeId: string, start: string, end: string) {
  const emp = await db.employeeProfile.findUniqueOrThrow({ where: { id: employeeId }, include: { shift: true } });
  const holidays = await db.holiday.findMany({
    where: { startDate: { lte: dateOnly(end) }, endDate: { gte: dateOnly(start) }, OR: [{ locationId: null }, ...(emp.locationId ? [{ locationId: emp.locationId }] : [])] },
  });
  const rest = emp.shift?.restDays ?? [0];
  return eachDay(start, end).map((day) => {
    const holiday = holidays.find((h) => dateOnlyYmd(h.startDate) <= day && dateOnlyYmd(h.endDate) >= day);
    const restDay = rest.includes(weekday(day));
    return { day, holiday: holiday?.name ?? null, restDay, working: !holiday && !restDay };
  });
}

export async function countWorkingDays(employeeId: string, start: string, end: string) {
  return (await calendarFor(employeeId, start, end)).filter((d) => d.working).length;
}

// ───────────── Employees ─────────────

export const employeeInput = z.object({
  personId: z.string(),
  code: z.string().max(20).nullable().default(null),
  departmentId: z.string().nullable().default(null),
  designationId: z.string().nullable().default(null),
  locationId: z.string().nullable().default(null),
  shiftId: z.string().nullable().default(null),
  joinedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Joining date is required."),
  taxId: z.string().max(40).nullable().default(null),
});

export async function saveEmployee(user: CurrentUser, raw: unknown) {
  const input = employeeInput.parse(raw);
  const data = { ...input, joinedOn: dateOnly(input.joinedOn) };
  const e = await db.employeeProfile.upsert({ where: { personId: input.personId }, create: data, update: data });
  await db.auditEvent.create({ data: { actorId: user.personId, action: "EMPLOYEE_SAVED", subjectType: "EmployeeProfile", subjectId: e.id } });
  return e;
}

export async function addSalary(user: CurrentUser, employeeId: string, raw: { amount: number; payPeriod: string; effectiveFrom: string; note: string | null }) {
  if (!(raw.amount > 0)) throw new HrError("Salary must be more than zero.");
  if (!["MONTH", "WEEK", "DAY"].includes(raw.payPeriod)) throw new HrError("Choose a pay period.");
  // History is effective-dated and never overwritten (§4.1); past payroll keeps its own snapshot.
  await db.salaryHistory.create({ data: { employeeId, amount: D(raw.amount), payPeriod: raw.payPeriod, effectiveFrom: dateOnly(raw.effectiveFrom), note: raw.note, createdById: user.personId } });
  await db.auditEvent.create({ data: { actorId: user.personId, action: "SALARY_CHANGED", subjectType: "EmployeeProfile", subjectId: employeeId, detail: { effectiveFrom: raw.effectiveFrom } } });
}

export async function salaryOn(employeeId: string, day: string) {
  return db.salaryHistory.findFirst({ where: { employeeId, effectiveFrom: { lte: dateOnly(day) } }, orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }] });
}

export async function setBank(user: CurrentUser, employeeId: string, bankName: string | null, account: string | null) {
  await db.employeeProfile.update({ where: { id: employeeId }, data: { bankName, bankAccountCipher: account ? seal(account) : null } });
  await db.auditEvent.create({ data: { actorId: user.personId, action: "BANK_DETAILS_CHANGED", subjectType: "EmployeeProfile", subjectId: employeeId } });
}

export function bankAccount(cipher: string | null) {
  return cipher ? unseal(cipher) : null;
}

// ───────────── Leave (§14.3) ─────────────

function intervalBounds(interval: string, day: string): [string, string] | null {
  if (interval === "MONTH") {
    const [y, m] = day.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return [`${day.slice(0, 7)}-01`, `${day.slice(0, 7)}-${String(last).padStart(2, "0")}`];
  }
  if (interval === "YEAR") return [`${day.slice(0, 4)}-01-01`, `${day.slice(0, 4)}-12-31`]; // financial year starts January (observed)
  return null;
}

export async function leaveBalance(employeeId: string, leaveTypeId: string, day: string, client: Prisma.TransactionClient | typeof db = db) {
  const type = await client.leaveType.findUniqueOrThrow({ where: { id: leaveTypeId } });
  if (type.maxCount == null) return { cap: null, used: ZERO, remaining: null };
  const bounds = intervalBounds(type.interval, day);
  const used = await client.leaveRequest.aggregate({
    where: { employeeId, leaveTypeId, status: { in: ["APPROVED", "REQUESTED"] }, ...(bounds ? { startDate: { gte: dateOnly(bounds[0]), lte: dateOnly(bounds[1]) } } : {}) },
    _sum: { days: true },
  });
  const u = D(used._sum.days);
  return { cap: D(type.maxCount), used: u, remaining: D(type.maxCount).minus(u) };
}

export const leaveInput = z.object({
  employeeId: z.string(),
  leaveTypeId: z.string().min(1, "Choose the leave type."),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  halfDay: z.boolean().default(false),
  reason: z.string().max(300).nullable().default(null),
});

export async function requestLeave(user: CurrentUser, raw: unknown) {
  const input = leaveInput.parse(raw);
  if (input.endDate < input.startDate) throw new HrError("The end date is before the start date.");
  if (input.halfDay && input.endDate !== input.startDate) throw new HrError("A half day must start and end on the same date.");
  const own = await db.employeeProfile.findUnique({ where: { personId: user.personId } });
  if (own?.id !== input.employeeId && !user.permissions.has("leave.approve")) throw new HrError("You can only apply for your own leave.");
  // Holidays and rest days inside the range are not counted as leave taken.
  const working = await countWorkingDays(input.employeeId, input.startDate, input.endDate);
  const days = input.halfDay ? D(working ? 0.5 : 0) : D(working);
  if (days.lte(0)) throw new HrError("Those dates are all holidays or rest days — no leave is needed.");
  return posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "EmployeeProfile" WHERE id = ${input.employeeId} FOR UPDATE`;
    const bal = await leaveBalance(input.employeeId, input.leaveTypeId, input.startDate, tx);
    if (bal.remaining && days.gt(bal.remaining)) throw new HrError(`Only ${bal.remaining.toString()} day(s) of this leave are left for that period (cap ${bal.cap}).`);
    const overlap = await tx.leaveRequest.findFirst({
      where: { employeeId: input.employeeId, status: { in: ["APPROVED", "REQUESTED"] }, startDate: { lte: dateOnly(input.endDate) }, endDate: { gte: dateOnly(input.startDate) } },
    });
    if (overlap) throw new HrError("This overlaps another leave request for the same person.");
    return tx.leaveRequest.create({
      data: {
        employeeId: input.employeeId, leaveTypeId: input.leaveTypeId, startDate: dateOnly(input.startDate), endDate: dateOnly(input.endDate),
        halfDay: input.halfDay, days, reason: input.reason, balanceAtRequest: bal.remaining,
      },
    });
  });
}

export async function decideLeave(user: CurrentUser, id: string, approve: boolean, note: string | null) {
  await posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "LeaveRequest" WHERE id = ${id} FOR UPDATE`;
    const r = await tx.leaveRequest.findUniqueOrThrow({ where: { id }, include: { employee: true } });
    if (r.status !== "REQUESTED") throw new HrError(`This request is already ${r.status.toLowerCase()}.`);
    if (r.employee.personId === user.personId) throw new HrError("Someone else has to approve your own leave.");
    await tx.leaveRequest.update({ where: { id }, data: { status: approve ? "APPROVED" : "REJECTED", decidedById: user.personId, decidedAt: new Date(), decisionNote: note } });
  });
}

export async function cancelLeave(user: CurrentUser, id: string) {
  const r = await db.leaveRequest.findUniqueOrThrow({ where: { id }, include: { employee: true } });
  const own = r.employee.personId === user.personId;
  if (!own && !user.permissions.has("leave.approve")) throw new HrError("Not allowed.");
  if (r.status === "APPROVED" && dateOnlyYmd(r.startDate) <= todayYmd() && !user.permissions.has("leave.approve")) throw new HrError("Leave that has started can only be cancelled by a manager.");
  if (!["REQUESTED", "APPROVED"].includes(r.status)) throw new HrError("Already closed.");
  await db.leaveRequest.update({ where: { id }, data: { status: "CANCELLED", decidedById: user.personId, decidedAt: new Date() } });
}

// ───────────── Clock in / out (§14.4) ─────────────

export async function selfClock(user: CurrentUser, kind: "IN" | "OUT") {
  const emp = await db.employeeProfile.findUnique({ where: { personId: user.personId } });
  if (!emp || emp.status !== "ACTIVE") throw new HrError("You do not have an employee profile. Ask the manager to add one.");
  const last = await db.clockEvent.findFirst({ where: { employeeId: emp.id, voidedAt: null }, orderBy: { at: "desc" } });
  if (last?.kind === kind && Date.now() - last.at.getTime() < 16 * 3_600_000)
    throw new HrError(kind === "IN" ? "You are already clocked in." : "You are already clocked out.");
  // Server time is authoritative; the phone's clock is never trusted.
  return db.clockEvent.create({ data: { employeeId: emp.id, kind, at: new Date(), source: "SELF", locationId: user.location?.id ?? null } });
}

export async function manualClock(user: CurrentUser, raw: { employeeId: string; kind: "IN" | "OUT"; at: Date; note: string }) {
  if (!raw.note?.trim()) throw new HrError("A reason is required for a manual correction.");
  if (raw.at.getTime() > Date.now() + 60_000) throw new HrError("A correction cannot be in the future.");
  return db.clockEvent.create({ data: { employeeId: raw.employeeId, kind: raw.kind, at: raw.at, source: "MANUAL", note: raw.note, correctedById: user.personId } });
}

export async function voidClock(user: CurrentUser, id: string, reason: string) {
  if (!reason?.trim()) throw new HrError("A reason is required.");
  await db.clockEvent.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason, correctedById: user.personId } });
}

export type DayAttendance = {
  day: string; working: boolean; holiday: string | null; restDay: boolean; firstIn: Date | null; lastOut: Date | null;
  minutes: number; late: boolean; missingOut: boolean; leave: string | null; leavePaid: boolean | null; leaveDays: number; absent: boolean;
  offDayWork: boolean; // clocked in on a rest day or holiday: a review item, paid only if a rule is set up
};

// Pairs IN→OUT per business day (overnight shifts count to the IN day); exceptions are flags, not penalties.
export async function attendance(employeeId: string, start: string, end: string): Promise<DayAttendance[]> {
  const [cal, emp, events, leaves] = await Promise.all([
    calendarFor(employeeId, start, end),
    db.employeeProfile.findUniqueOrThrow({ where: { id: employeeId }, include: { shift: true } }),
    db.clockEvent.findMany({ where: { employeeId, voidedAt: null, at: { gte: dayStart(start), lt: new Date(dayStart(end).getTime() + 86_400_000 + 12 * 3_600_000) } }, orderBy: { at: "asc" } }),
    db.leaveRequest.findMany({ where: { employeeId, status: "APPROVED", startDate: { lte: dateOnly(end) }, endDate: { gte: dateOnly(start) } }, include: { leaveType: true } }),
  ]);
  const byDay = new Map<string, { ins: Date[]; minutes: number; open: Date | null; lastOut: Date | null }>();
  let open: { day: string; at: Date } | null = null;
  for (const e of events) {
    if (e.kind === "IN") {
      const day = ymd(e.at);
      const rec = byDay.get(day) ?? { ins: [], minutes: 0, open: null, lastOut: null };
      rec.ins.push(e.at);
      byDay.set(day, rec);
      open = { day, at: e.at };
    } else if (open) {
      const rec = byDay.get(open.day)!;
      rec.minutes += Math.round((e.at.getTime() - open.at.getTime()) / 60_000);
      rec.lastOut = e.at;
      open = null;
    }
  }
  const [sh, sm] = (emp.shift?.startTime ?? "09:00").split(":").map(Number);
  const grace = emp.shift?.graceMinutes ?? 10;
  const nowYmd = todayYmd();
  return cal.map((c) => {
    const rec = byDay.get(c.day);
    const lv = leaves.find((l) => dateOnlyYmd(l.startDate) <= c.day && dateOnlyYmd(l.endDate) >= c.day);
    const firstIn = rec?.ins[0] ?? null;
    const late = !!firstIn && c.working && firstIn.getTime() > dayStart(c.day).getTime() + ((sh * 60 + sm + grace) * 60_000);
    const missingOut = !!rec && !rec.lastOut && c.day < nowYmd;
    const leaveDays = lv ? (lv.halfDay ? 0.5 : 1) : 0;
    return {
      ...c, firstIn, lastOut: rec?.lastOut ?? null, minutes: rec?.minutes ?? 0, late, missingOut,
      leave: lv?.leaveType.name ?? null, leavePaid: lv ? lv.leaveType.paid : null, leaveDays,
      absent: c.working && !rec && !lv && c.day < nowYmd,
      offDayWork: !c.working && !!rec,
    };
  });
}
