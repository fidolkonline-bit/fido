import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDateTime, money, D } from "@/lib/money";
import { VARIANCE_REASONS } from "@/lib/register";
import * as H from "@/lib/hr";
import { PageHead, DataTable, Badge, RowLink } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { manualClockForm, voidClockForm } from "../actions";

export const metadata = { title: "Attendance" };
const time = (d: Date | null) => (d ? d.toLocaleTimeString("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit" }) : "—");

type Ev = { device: { name: string } | null; correctedBy: { fullName: string } | null };
const SOURCE: Record<string, (e: Ev) => string> = {
  LOGIN: (e) => `Sign-in on ${e.device?.name ?? "shop device"}`,
  LOGOUT: (e) => `End my day on ${e.device?.name ?? "this device"}`,
  SELF: (e) => (e.device ? `Clock button on ${e.device.name}` : "Clock button"),
  MANUAL: (e) => `Manual — ${e.correctedBy?.fullName ?? ""}`,
  AUTO: () => "Automatic (nightly)",
  IMPORT: () => "Import",
};

// Leave, holidays and rest days explain the day; otherwise every review flag is shown, not just the first.
function Status({ a }: { a: H.DayAttendance }) {
  if (a.offDayWork) return <Badge tone="warn">Worked on {a.holiday ? "holiday" : "rest day"}</Badge>;
  if (a.holiday) return <Badge>{a.holiday}</Badge>;
  if (a.restDay) return <Badge tone="muted">Rest day</Badge>;
  if (a.leave) return <Badge tone="ok">{a.leave}</Badge>;
  if (a.absent) return <Badge tone="err">Absent</Badge>;
  if (!a.firstIn) return <span className="muted small">Not in yet</span>;
  const flags: [boolean, "err" | "warn", string][] = [
    [a.missingOut, "err", "No clock-out"], [a.autoOut, "err", "Auto clock-out — check"], [a.late, "warn", "Late"], [a.leftEarly, "warn", "Left early"],
  ];
  const on = flags.filter(([f]) => f);
  return on.length ? <span className="row" style={{ gap: 4 }}>{on.map(([, tone, label]) => <Badge key={label} tone={tone}>{label}</Badge>)}</span> : <Badge tone="ok">Present</Badge>;
}

export default async function Attendance({ searchParams }: { searchParams: Promise<{ day?: string; emp?: string }> }) {
  const user = await requirePermission("hr.view");
  const { day = H.todayYmd(), emp } = await searchParams;
  const employees = await db.employeeProfile.findMany({ where: { status: "ACTIVE" }, include: { person: true, shift: true }, orderBy: { person: { fullName: "asc" } } });
  const rows = await Promise.all(employees.map(async (e) => ({ e, a: (await H.attendance(e.id, day, day))[0] })));
  const events = emp ? await db.clockEvent.findMany({ where: { employeeId: emp, at: { gte: H.dayStart(day), lt: new Date(H.dayStart(day).getTime() + 86_400_000) } }, orderBy: { at: "asc" }, include: { correctedBy: true, device: true } }) : [];
  const manage = can(user, "attendance.manage");
  const from = H.dayStart(day), to = new Date(H.dayStart(day).getTime() + 86_400_000);
  const [sales, drawers] = await Promise.all([
    db.sale.groupBy({ by: ["createdById"], where: { stage: "FINAL", createdAt: { gte: from, lt: to }, createdById: { in: employees.map((e) => e.personId) } }, _count: true, _sum: { total: true } }),
    db.registerSession.findMany({
      where: { OR: [{ openedAt: { gte: from, lt: to } }, { closedAt: { gte: from, lt: to } }] },
      orderBy: { openedAt: "asc" }, include: { location: true, user: true, closedBy: true },
    }),
  ]);
  const salesBy = new Map(sales.map((x) => [x.createdById, x]));

  return (
    <div className="stack">
      <PageHead eyebrow="HRM" title="Attendance" actions={<form className="row"><input type="date" name="day" defaultValue={day} style={{ width: "auto" }} /><button className="btn">Show</button></form>} />
      <DataTable rows={rows} rowKey={(r) => r.e.id} empty="No employees yet."
        columns={[
          { label: "Employee", primary: true, render: (r) => <a href={`?day=${day}&emp=${r.e.id}`}>{r.e.person.fullName}</a> },
          { label: "Shift", render: (r) => r.e.shift ? `${r.e.shift.startTime}–${r.e.shift.endTime}` : "—" },
          { label: "In", render: (r) => time(r.a.firstIn) },
          { label: "Out", render: (r) => <>{time(r.a.lastOut)}{r.a.autoOut && <span className="small muted"> (auto)</span>}</> },
          { label: "Hours", num: true, render: (r) => (r.a.minutes ? `${Math.floor(r.a.minutes / 60)}h ${String(r.a.minutes % 60).padStart(2, "0")}` : "") },
          { label: "Sales", num: true, render: (r) => { const x = salesBy.get(r.e.personId); return x ? <>{money(x._sum.total)} <span className="small muted">· {x._count}</span></> : ""; } },
          { label: "Status", render: (r) => <Status a={r.a} /> },
        ]} />
      <p className="small muted" style={{ margin: 0 }}>
        Late, early, absent, missing and automatic clock-outs are flags for review. They do not reduce pay unless a pay rule is set up. An automatic clock-out is set
        by the nightly job at the shift end when someone did not use End my day; correct it below if the time is wrong. Sales are the person&apos;s own sales that day (Rs. · count).
      </p>

      <section className="stack">
        <h2 style={{ margin: 0 }}>Cash drawer · {day}</h2>
        <DataTable rows={drawers} rowKey={(r) => r.id} empty="The drawer was not opened or closed this day."
          columns={[
            { label: "Shop", primary: true, render: (r) => <RowLink href={`/register/${r.id}`}>{r.location.name}</RowLink> },
            { label: "Opened", render: (r) => `${fmtDateTime(r.openedAt)} · ${r.user.fullName}` },
            { label: "Opening", num: true, render: (r) => money(r.openingCash) },
            { label: "Closed", render: (r) => (r.closedAt ? `${fmtDateTime(r.closedAt)} · ${r.closedBy?.fullName ?? ""}` : <Badge tone="warn">Still open</Badge>) },
            { label: "Expected", num: true, render: (r) => money(r.expectedCash) },
            { label: "Counted", num: true, render: (r) => money(r.countedCash) },
            { label: "Difference", num: true, render: (r) => <span style={{ color: r.variance && !D(r.variance).eq(0) ? "var(--err)" : undefined }}>{money(r.variance)}</span> },
            { label: "Reason", render: (r) => [r.varianceReason ? VARIANCE_REASONS[r.varianceReason] : "", r.notes].filter(Boolean).join(" · ") },
          ]} />
      </section>

      {emp && (
        <section className="panel stack">
          <h2 style={{ margin: 0 }}>Clock records · {employees.find((e) => e.id === emp)?.person.fullName} · {day}</h2>
          <DataTable rows={events} rowKey={(e) => e.id} cards={false} empty="No clock records this day."
            columns={[
              { label: "Time", render: (e) => <span style={{ textDecoration: e.voidedAt ? "line-through" : undefined }}>{time(e.at)}</span> },
              { label: "Type", render: (e) => e.kind.toLowerCase() },
              { label: "Source", render: (e) => SOURCE[e.source]?.(e) ?? e.source },
              { label: "IP address", render: (e) => e.ip ?? "—" },
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
