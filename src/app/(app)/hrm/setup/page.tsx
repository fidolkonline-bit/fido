import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead, DataTable } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { saveMaster } from "../actions";

export const metadata = { title: "HR setup" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function Setup() {
  await requirePermission("hr.manage");
  const [departments, designations, leaveTypes, shifts, components] = await Promise.all([
    db.department.findMany({ orderBy: { name: "asc" } }), db.designation.findMany({ orderBy: { name: "asc" } }),
    db.leaveType.findMany({ orderBy: { name: "asc" } }), db.shift.findMany({ orderBy: { name: "asc" } }), db.payComponent.findMany({ orderBy: { name: "asc" } }),
  ]);
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

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Shifts</h2>
        <DataTable rows={shifts} rowKey={(s) => s.id} cards={false}
          columns={[{ label: "Shift", render: (s) => s.name }, { label: "Hours", render: (s) => `${s.startTime}–${s.endTime}${s.endTime < s.startTime ? " (overnight)" : ""}` }, { label: "Grace", render: (s) => `${s.graceMinutes} min` }, { label: "Rest days", render: (s) => s.restDays.map((d) => DAYS[d]).join(", ") || "None" }]} />
        <ActionForm action={saveMaster} className="row" style={{ alignItems: "flex-end" }}>
          <input type="hidden" name="kind" value="shift" />
          <label className="field" style={{ flex: "1 1 140px" }}><span>Name</span><input name="name" required /></label>
          <label className="field" style={{ width: 110 }}><span>Start</span><input type="time" name="startTime" defaultValue="09:00" /></label>
          <label className="field" style={{ width: 110 }}><span>End</span><input type="time" name="endTime" defaultValue="18:00" /></label>
          <label className="field" style={{ width: 90 }}><span>Grace min</span><input name="graceMinutes" defaultValue="10" inputMode="numeric" /></label>
          <div className="row" style={{ gap: 6 }}>{DAYS.map((d, i) => <label key={d} className="check small"><input type="checkbox" name="restDays" value={i} defaultChecked={i === 0} /> {d}</label>)}</div>
          <SubmitButton className="btn">Add</SubmitButton>
        </ActionForm>
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
