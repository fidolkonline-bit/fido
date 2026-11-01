import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/money";
import * as H from "@/lib/hr";
import { PageHead, DataTable, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { manualClockForm, voidClockForm } from "../actions";

export const metadata = { title: "Attendance" };
const time = (d: Date | null) => (d ? d.toLocaleTimeString("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit" }) : "—");

export default async function Attendance({ searchParams }: { searchParams: Promise<{ day?: string; emp?: string }> }) {
  const user = await requirePermission("hr.view");
  const { day = H.todayYmd(), emp } = await searchParams;
  const employees = await db.employeeProfile.findMany({ where: { status: "ACTIVE" }, include: { person: true, shift: true }, orderBy: { person: { fullName: "asc" } } });
  const rows = await Promise.all(employees.map(async (e) => ({ e, a: (await H.attendance(e.id, day, day))[0] })));
  const events = emp ? await db.clockEvent.findMany({ where: { employeeId: emp, at: { gte: H.dayStart(day), lt: new Date(H.dayStart(day).getTime() + 86_400_000) } }, orderBy: { at: "asc" }, include: { correctedBy: true } }) : [];
  const manage = can(user, "attendance.manage");

  return (
    <div className="stack">
      <PageHead eyebrow="HRM" title="Attendance" actions={<form className="row"><input type="date" name="day" defaultValue={day} style={{ width: "auto" }} /><button className="btn">Show</button></form>} />
      <DataTable rows={rows} rowKey={(r) => r.e.id} empty="No employees yet."
        columns={[
          { label: "Employee", primary: true, render: (r) => <a href={`?day=${day}&emp=${r.e.id}`}>{r.e.person.fullName}</a> },
          { label: "Shift", render: (r) => r.e.shift ? `${r.e.shift.startTime}–${r.e.shift.endTime}` : "—" },
          { label: "In", render: (r) => time(r.a.firstIn) },
          { label: "Out", render: (r) => time(r.a.lastOut) },
          { label: "Hours", num: true, render: (r) => (r.a.minutes ? `${Math.floor(r.a.minutes / 60)}h ${String(r.a.minutes % 60).padStart(2, "0")}` : "") },
          { label: "Status", render: (r) => r.a.offDayWork ? <Badge tone="warn">Worked on {r.a.holiday ? "holiday" : "rest day"}</Badge> : r.a.holiday ? <Badge>{r.a.holiday}</Badge> : r.a.restDay ? <Badge tone="muted">Rest day</Badge> : r.a.leave ? <Badge tone="ok">{r.a.leave}</Badge> : r.a.missingOut ? <Badge tone="err">No clock-out</Badge> : r.a.late ? <Badge tone="warn">Late</Badge> : r.a.absent ? <Badge tone="err">Absent</Badge> : r.a.firstIn ? <Badge tone="ok">Present</Badge> : <span className="muted small">Not in yet</span> },
        ]} />
      <p className="small muted" style={{ margin: 0 }}>Late, absent and missing clock-outs are flags for review. They do not reduce pay unless a pay rule is set up.</p>

      {emp && (
        <section className="panel stack">
          <h2 style={{ margin: 0 }}>Clock records · {employees.find((e) => e.id === emp)?.person.fullName} · {day}</h2>
          <DataTable rows={events} rowKey={(e) => e.id} cards={false} empty="No clock records this day."
            columns={[
              { label: "Time", render: (e) => <span style={{ textDecoration: e.voidedAt ? "line-through" : undefined }}>{time(e.at)}</span> },
              { label: "Type", render: (e) => e.kind.toLowerCase() },
              { label: "Source", render: (e) => e.source === "SELF" ? "Phone" : `Manual — ${e.correctedBy?.fullName ?? ""}` },
              { label: "Note", render: (e) => e.voidedAt ? `Voided: ${e.voidReason}` : e.note ?? "" },
              { label: "", render: (e) => manage && !e.voidedAt ? <form action={voidClockForm} className="row" style={{ gap: 4, flexWrap: "nowrap" }}><input type="hidden" name="id" value={e.id} /><input name="reason" placeholder="Reason" required style={{ width: 130, minHeight: 32 }} /><button className="btn btn-sm">Void</button></form> : e.voidedAt ? fmtDateTime(e.voidedAt) : null },
            ]} />
          {manage && (
            <ActionForm action={manualClockForm} className="row" style={{ alignItems: "flex-end" }}>
              <input type="hidden" name="employeeId" value={emp} /><input type="hidden" name="day" value={day} />
              <label className="field" style={{ width: 100 }}><span>Add</span><select name="kind"><option value="IN">In</option><option value="OUT">Out</option></select></label>
              <label className="field" style={{ width: 120 }}><span>Time</span><input type="time" name="time" required /></label>
              <label className="field" style={{ flex: "1 1 200px" }}><span>Reason (required)</span><input name="note" required placeholder="Forgot to clock out — confirmed by manager" /></label>
              <SubmitButton className="btn">Add correction</SubmitButton>
            </ActionForm>
          )}
          <p className="small muted" style={{ margin: 0 }}>Original records are never edited — corrections are added or voided with a reason, and both stay visible.</p>
        </section>
      )}
    </div>
  );
}
