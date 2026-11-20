import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead, DataTable, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import Link from "next/link";
import { saveMaster, saveShift } from "../actions";

export const metadata = { title: "HR setup" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function Setup({ searchParams }: { searchParams: Promise<{ shift?: string; saved?: string }> }) {
  await requirePermission("hr.manage");
  const q = await searchParams;
  const [departments, designations, leaveTypes, shifts, components] = await Promise.all([
    db.department.findMany({ orderBy: { name: "asc" } }), db.designation.findMany({ orderBy: { name: "asc" } }),
    db.leaveType.findMany({ orderBy: { name: "asc" } }), db.shift.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], include: { _count: { select: { employees: { where: { status: "ACTIVE" } } } } } }), db.payComponent.findMany({ orderBy: { name: "asc" } }),
  ]);
  const editing = q.shift ? shifts.find((x) => x.id === q.shift) ?? null : null;
  return (
    <div className="stack" style={{ maxWidth: 960 }}>
      <PageHead eyebrow="HRM" title="HR setup" />
      <p className="note">These are company settings, not legal rules. Statutory deductions (EPF/ETF, tax), holiday pay and overtime must be checked and set up as pay components before the first live payroll.</p>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Leave types</h2>
        <DataTable rows={leaveTypes} rowKey={(t) => t.id} cards={false}
          columns={[{ label: "Type", render: (t) => t.name }, { label: "Cap", num: true, render: (t) => t.maxCount?.toString() ?? "No cap" }, { label: "Per", render: (t) => ({ MONTH: "month", YEAR: "year", NONE: "—" })[t.interval] }, { label: "Pay", render: (t) => (t.paid ? "Paid" : "Unpaid") }]} />
        <ActionForm action={saveMaster} className="row" style={{ alignItems: "flex-end" }}>
          <input type="hidden" name="kind" value="leaveType" />
          <label className="field" style={{ flex: "1 1 160px" }}><span>Name</span><input name="name" required /></label>
          <label className="field" style={{ width: 90 }}><span>Cap</span><input name="maxCount" inputMode="decimal" /></label>
          <label className="field" style={{ width: 120 }}><span>Per</span><select name="interval"><option value="MONTH">Month</option><option value="YEAR">Year</option><option value="NONE">No interval</option></select></label>
          <label className="check"><input type="checkbox" name="paid" defaultChecked /> Paid</label>
          <SubmitButton className="btn">Add</SubmitButton>
        </ActionForm>
      </section>

      <section className="panel stack" id="shifts">
        <h2 style={{ margin: 0 }}>Shifts</h2>
        {q.saved === "shift" && <p className="small" style={{ color: "var(--ok)", margin: 0 }}>Shift saved.</p>}
        <DataTable rows={shifts} rowKey={(s) => s.id} cards={false}
          columns={[
            { label: "Shift", render: (s) => <>{s.name}{!s.active && <> <Badge>Stopped</Badge></>}</> },
            { label: "Hours", render: (s) => `${s.startTime}–${s.endTime}${s.endTime < s.startTime ? " (overnight)" : ""}` },
            { label: "Grace", render: (s) => `${s.graceMinutes} min` },
            { label: "Rest days", render: (s) => s.restDays.map((d) => DAYS[d]).join(", ") || "None" },
            { label: "Employees", num: true, render: (s) => s._count.employees },
            { label: "", render: (s) => <Link className="btn btn-sm" href={`?shift=${s.id}#shift-form`}>Edit</Link> },
          ]} />
        <ShiftForm shift={editing} />
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Pay components</h2>
        <DataTable rows={components} rowKey={(c) => c.id} cards={false} empty="None yet."
          columns={[{ label: "Component", render: (c) => c.name }, { label: "Type", render: (c) => c.kind.toLowerCase() }, { label: "Default", render: (c) => (c.calc === "PERCENT_OF_BASIC" ? `${c.amount.toString()}% of basic` : `Rs. ${c.amount.toFixed(2)}`) }]} />
        <ActionForm action={saveMaster} className="row" style={{ alignItems: "flex-end" }}>
          <input type="hidden" name="kind" value="component" />
          <label className="field" style={{ flex: "1 1 160px" }}><span>Name</span><input name="name" required placeholder="Travel allowance" /></label>
          <label className="field" style={{ width: 130 }}><span>Type</span><select name="componentKind"><option value="EARNING">Earning</option><option value="DEDUCTION">Deduction</option></select></label>
          <label className="field" style={{ width: 150 }}><span>Calculated as</span><select name="calc"><option value="FIXED">Fixed amount</option><option value="PERCENT_OF_BASIC">% of basic</option></select></label>
          <label className="field" style={{ width: 110 }}><span>Amount / %</span><input name="amount" inputMode="decimal" required /></label>
          <SubmitButton className="btn">Add</SubmitButton>
        </ActionForm>
      </section>

      <section className="grid2">
        {([["department", "Departments", departments], ["designation", "Designations", designations]] as const).map(([kind, title, rows]) => (
          <div key={kind} className="panel stack">
            <h2 style={{ margin: 0 }}>{title}</h2>
            <p className="small" style={{ margin: 0 }}>{rows.map((r) => r.name).join(" · ") || "None"}</p>
            <ActionForm action={saveMaster} className="row" style={{ alignItems: "flex-end" }}>
              <input type="hidden" name="kind" value={kind} />
              <label className="field" style={{ flex: 1 }}><span>Add</span><input name="name" required /></label>
              <SubmitButton className="btn">Add</SubmitButton>
            </ActionForm>
          </div>
        ))}
      </section>
    </div>
  );
}

// Add a shift, or change the one picked with Edit. Keyed by the shift so the fields reset when another is picked.
function ShiftForm({ shift }: { shift: { id: string; name: string; startTime: string; endTime: string; graceMinutes: number; restDays: number[]; active: boolean; _count: { employees: number } } | null }) {
  return (
    <ActionForm key={shift?.id ?? "new"} action={saveShift} className="stack" style={{ borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
      <span id="shift-form" />
      <strong>{shift ? `Edit ${shift.name}` : "Add a shift"}</strong>
      {shift && <input type="hidden" name="id" value={shift.id} />}
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="field" style={{ flex: "1 1 140px" }}><span>Name</span><input name="name" required defaultValue={shift?.name} /></label>
        <label className="field" style={{ width: 140 }}><span>Start</span><input type="time" name="startTime" required defaultValue={shift?.startTime ?? "09:00"} /></label>
        <label className="field" style={{ width: 140 }}><span>End</span><input type="time" name="endTime" required defaultValue={shift?.endTime ?? "18:00"} /></label>
        <label className="field" style={{ width: 90 }}><span>Grace min</span><input name="graceMinutes" type="number" min="0" max="240" step="1" defaultValue={shift?.graceMinutes ?? 10} inputMode="numeric" /></label>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <span className="small muted">Rest days:</span>
        {DAYS.map((d, i) => <label key={d} className="check small"><input type="checkbox" name="restDays" value={i} defaultChecked={shift ? shift.restDays.includes(i) : i === 0} /> {d}</label>)}
      </div>
      {shift && (
        <>
          <label className="check"><input type="checkbox" name="active" defaultChecked={shift.active} /> In use (a stopped shift can no longer be picked for an employee; people already on it keep it)</label>
          <p className="small muted" style={{ margin: 0 }}>
            {shift._count.employees} employee{shift._count.employees === 1 ? " is" : "s are"} on this shift. A change applies to every day worked on it, past days included:
            late, left early and the time of an automatic clock-out are worked out from the shift. The old and new values are kept in the audit log.
          </p>
        </>
      )}
      <div className="row">
        <SubmitButton className={shift ? "btn btn-primary" : "btn"}>{shift ? "Save changes" : "Add"}</SubmitButton>
        {shift && <Link className="btn" href="/hrm/setup#shifts">Cancel</Link>}
      </div>
    </ActionForm>
  );
}
