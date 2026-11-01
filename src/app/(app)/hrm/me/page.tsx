import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDate } from "@/lib/money";
import * as H from "@/lib/hr";
import { PageHead, DataTable, Badge, Stat } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { ClockButton } from "../ClockButton";
import { applyLeave, cancelLeaveForm } from "../actions";

export const metadata = { title: "My attendance & leave" };

const time = (d: Date | null) => (d ? d.toLocaleTimeString("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit" }) : "—");
const LEAVE_TONE: Record<string, "ok" | "warn" | "err" | "muted"> = { APPROVED: "ok", REQUESTED: "warn", REJECTED: "err", CANCELLED: "muted" };

export default async function Me() {
  const user = await requireUser();
  const emp = await db.employeeProfile.findUnique({ where: { personId: user.personId }, include: { shift: true } });
  if (!emp) {
    return (
      <div className="stack" style={{ maxWidth: 600 }}>
        <PageHead eyebrow="HRM" title="My attendance & leave" />
        <p className="note">You don&apos;t have an employee profile yet. Ask the owner to add one under HRM → Employees.</p>
      </div>
    );
  }
  const today = H.todayYmd();
  const monthStart = `${today.slice(0, 7)}-01`;
  const [last, days, leaves, types, slips] = await Promise.all([
    db.clockEvent.findFirst({ where: { employeeId: emp.id, voidedAt: null }, orderBy: { at: "desc" } }),
    H.attendance(emp.id, monthStart, today),
    db.leaveRequest.findMany({ where: { employeeId: emp.id }, orderBy: { startDate: "desc" }, take: 20, include: { leaveType: true } }),
    db.leaveType.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.payslip.findMany({ where: { employeeId: emp.id, run: { status: { in: ["APPROVED", "PART_PAID", "PAID"] } } }, orderBy: { periodStart: "desc" }, take: 12, include: { run: true } }),
  ]);
  const balances = await Promise.all(types.filter((t) => t.maxCount != null).map(async (t) => ({ t, b: await H.leaveBalance(emp.id, t.id, today) })));
  const clockedIn = last?.kind === "IN" && Date.now() - last.at.getTime() < 16 * 3_600_000;
  const worked = days.filter((d) => d.firstIn).length;

  return (
    <div className="stack">
      <PageHead eyebrow="HRM" title="My attendance & leave" />
      <section className="panel"><ClockButton clockedIn={clockedIn} since={clockedIn ? time(last!.at) : null} /></section>

      <div className="stats">
        <Stat label="Days worked this month" value={worked} basis={`${days.filter((d) => d.working).length} working days so far`} />
        <Stat label="Late arrivals" value={days.filter((d) => d.late).length} basis={emp.shift ? `${emp.shift.name} ${emp.shift.startTime}` : "No shift set"} />
        {balances.map(({ t, b }) => <Stat key={t.id} label={`${t.name} left`} value={b.remaining?.toString() ?? "—"} basis={`of ${b.cap} ${t.interval === "MONTH" ? "this month" : t.interval === "YEAR" ? "this year" : ""}`} />)}
      </div>

      <section>
        <h2>This month</h2>
        <DataTable rows={days.slice().reverse()} rowKey={(d) => d.day} cards={false}
          columns={[
            { label: "Date", render: (d) => fmtDate(H.dateOnly(d.day)) },
            { label: "In", render: (d) => time(d.firstIn) },
            { label: "Out", render: (d) => time(d.lastOut) },
            { label: "Hours", num: true, render: (d) => (d.minutes ? `${Math.floor(d.minutes / 60)}h ${String(d.minutes % 60).padStart(2, "0")}` : "") },
            { label: "", render: (d) => d.offDayWork ? <Badge tone="warn">Worked on {d.holiday ? "holiday" : "rest day"}</Badge> : d.holiday ? <Badge>{d.holiday}</Badge> : d.restDay ? <span className="muted small">Rest day</span> : d.leave ? <Badge tone="ok">{d.leave}</Badge> : d.missingOut ? <Badge tone="err">No clock-out</Badge> : d.late ? <Badge tone="warn">Late</Badge> : d.absent ? <Badge tone="err">Absent</Badge> : null },
          ]} />
      </section>

      <section className="panel">
        <h2>Apply for leave</h2>
        <ActionForm action={applyLeave}>
          <div className="grid3">
            <label className="field"><span>Type</span><select name="leaveTypeId">{types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.paid ? "" : " (unpaid)"}</option>)}</select></label>
            <label className="field"><span>From</span><input type="date" name="startDate" required defaultValue={today} /></label>
            <label className="field"><span>To</span><input type="date" name="endDate" defaultValue={today} /></label>
          </div>
          <label className="field"><span>Reason</span><input name="reason" /></label>
          <div className="row"><label className="check"><input type="checkbox" name="halfDay" /> Half day</label><div className="spacer" /><SubmitButton>Request leave</SubmitButton></div>
        </ActionForm>
      </section>

      <section>
        <h2>My leave</h2>
        <DataTable rows={leaves} rowKey={(l) => l.id} empty="No leave requests."
          columns={[
            { label: "Leave", primary: true, render: (l) => `${l.leaveType.name} · ${l.days.toString()} day(s)` },
            { label: "Dates", render: (l) => `${fmtDate(l.startDate)}${l.endDate.getTime() !== l.startDate.getTime() ? ` – ${fmtDate(l.endDate)}` : ""}` },
            { label: "Status", render: (l) => <Badge tone={LEAVE_TONE[l.status]}>{l.status.toLowerCase()}</Badge> },
            { label: "", render: (l) => ["REQUESTED", "APPROVED"].includes(l.status) && H.dateOnlyYmd(l.startDate) > today ? <form action={cancelLeaveForm}><input type="hidden" name="id" value={l.id} /><button className="btn btn-sm">Cancel</button></form> : l.decisionNote ?? "" },
          ]} />
      </section>

      <section>
        <h2>My payslips</h2>
        <DataTable rows={slips} rowKey={(s) => s.id} empty="No approved payslips yet."
          columns={[
            { label: "Period", primary: true, render: (s) => <Link href={`/hrm/payslips/${s.id}`}>{fmtDate(s.run.periodStart)} – {fmtDate(s.run.periodEnd)}</Link> },
            { label: "Net pay", num: true, render: (s) => money(s.net) },
            { label: "Paid", num: true, render: (s) => money(s.paid) },
          ]} />
      </section>
    </div>
  );
}
