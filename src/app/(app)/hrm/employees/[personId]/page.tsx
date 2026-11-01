import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDate } from "@/lib/money";
import * as H from "@/lib/hr";
import { PageHead, DataTable } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { saveEmployeeForm, addSalaryForm, setBankForm, setLeftForm, assignComponentForm, endComponentForm } from "../../actions";

export const metadata = { title: "Employee" };

export default async function Employee({ params }: { params: Promise<{ personId: string }> }) {
  const user = await requirePermission("hr.view");
  const person = await db.person.findUnique({
    where: { id: (await params).personId },
    include: { employee: { include: { salaries: { orderBy: { effectiveFrom: "desc" } }, components: { include: { component: true }, orderBy: { fromDate: "desc" } } } } },
  });
  if (!person) notFound();
  const e = person.employee;
  const [departments, designations, shifts, locations, components] = await Promise.all([
    db.department.findMany({ orderBy: { name: "asc" } }), db.designation.findMany({ orderBy: { name: "asc" } }),
    db.shift.findMany({ where: { active: true } }), db.location.findMany({ where: { active: true } }), db.payComponent.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  const manage = can(user, "hr.manage");
  const pay = can(user, "hr.payroll");
  const bank = can(user, "hr.bank");
  const today = H.todayYmd();

  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <PageHead eyebrow="HRM / Employees" title={person.fullName} />
      {!e && <p className="note">No employee profile yet. Save the form below to add {person.fullName} to attendance, leave and payroll.</p>}

      <section className="panel">
        <h2>Employment</h2>
        <ActionForm action={saveEmployeeForm}>
          <input type="hidden" name="personId" value={person.id} />
          <fieldset disabled={!manage} style={{ border: 0, padding: 0, margin: 0 }} className="grid3">
            <label className="field"><span>Employee code</span><input name="code" defaultValue={e?.code ?? ""} /></label>
            <label className="field"><span>Joined on</span><input type="date" name="joinedOn" defaultValue={e ? H.dateOnlyYmd(e.joinedOn) : today} required /></label>
            <label className="field"><span>Location</span><select name="locationId" defaultValue={e?.locationId ?? ""}><option value="">—</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
            <label className="field"><span>Department</span><select name="departmentId" defaultValue={e?.departmentId ?? ""}><option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
            <label className="field"><span>Designation</span><select name="designationId" defaultValue={e?.designationId ?? ""}><option value="">—</option>{designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
            <label className="field"><span>Shift</span><select name="shiftId" defaultValue={e?.shiftId ?? ""}><option value="">—</option>{shifts.map((s) => <option key={s.id} value={s.id}>{s.name} {s.startTime}–{s.endTime}</option>)}</select></label>
            <label className="field"><span>Tax ID</span><input name="taxId" defaultValue={e?.taxId ?? ""} /></label>
          </fieldset>
          {manage && <div><SubmitButton>{e ? "Save" : "Create employee profile"}</SubmitButton></div>}
        </ActionForm>
        {e && manage && (
          <form action={setLeftForm} className="row" style={{ marginTop: 12 }}>
            <input type="hidden" name="employeeId" value={e.id} /><input type="hidden" name="personId" value={person.id} />
            <label className="field" style={{ width: 180 }}><span>{e.status === "LEFT" ? "Left on (clear to reinstate)" : "Mark as left on"}</span><input type="date" name="leftOn" defaultValue={e.leftOn ? H.dateOnlyYmd(e.leftOn) : ""} /></label>
            <SubmitButton className="btn">Save</SubmitButton>
          </form>
        )}
      </section>

      {e && pay && (
        <section className="panel stack">
          <h2 style={{ margin: 0 }}>Salary history</h2>
          <DataTable rows={e.salaries} rowKey={(s) => s.id} cards={false} empty="No salary yet — this person is skipped in payroll."
            columns={[
              { label: "From", render: (s) => fmtDate(s.effectiveFrom) },
              { label: "Amount", num: true, render: (s) => money(s.amount) },
              { label: "Per", render: (s) => s.payPeriod.toLowerCase() },
              { label: "Note", render: (s) => s.note ?? "" },
            ]} />
          <ActionForm action={addSalaryForm} className="row" style={{ alignItems: "flex-end" }}>
            <input type="hidden" name="employeeId" value={e.id} /><input type="hidden" name="personId" value={person.id} />
            <label className="field" style={{ width: 140 }}><span>New salary</span><input name="amount" inputMode="decimal" required /></label>
            <label className="field" style={{ width: 120 }}><span>Per</span><select name="payPeriod"><option value="MONTH">Month</option><option value="WEEK">Week</option><option value="DAY">Day</option></select></label>
            <label className="field" style={{ width: 160 }}><span>Effective from</span><input type="date" name="effectiveFrom" defaultValue={today} /></label>
            <label className="field" style={{ flex: "1 1 160px" }}><span>Note</span><input name="note" /></label>
            <SubmitButton className="btn">Add</SubmitButton>
          </ActionForm>
        </section>
      )}

      {e && pay && (
        <section className="panel stack">
          <h2 style={{ margin: 0 }}>Pay components</h2>
          <DataTable rows={e.components} rowKey={(c) => c.id} cards={false} empty="None."
            columns={[
              { label: "Component", render: (c) => `${c.component.name} (${c.component.kind.toLowerCase()})` },
              { label: "Amount", num: true, render: (c) => (c.component.calc === "PERCENT_OF_BASIC" ? `${(c.amount ?? c.component.amount).toString()}%` : money(c.amount ?? c.component.amount)) },
              { label: "From", render: (c) => fmtDate(c.fromDate) },
              { label: "To", render: (c) => (c.toDate ? fmtDate(c.toDate) : "ongoing") },
              { label: "", render: (c) => !c.toDate ? <form action={endComponentForm}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="personId" value={person.id} /><button className="btn btn-sm">End today</button></form> : null },
            ]} />
          <ActionForm action={assignComponentForm} className="row" style={{ alignItems: "flex-end" }}>
            <input type="hidden" name="employeeId" value={e.id} /><input type="hidden" name="personId" value={person.id} />
            <label className="field" style={{ flex: "1 1 180px" }}><span>Component</span><select name="componentId">{components.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="field" style={{ width: 130 }}><span>Amount (blank = default)</span><input name="amount" inputMode="decimal" /></label>
            <label className="field" style={{ width: 160 }}><span>From</span><input type="date" name="fromDate" defaultValue={today} /></label>
            <label className="check"><input type="checkbox" name="oneTime" /> One-time</label>
            <SubmitButton className="btn">Assign</SubmitButton>
          </ActionForm>
        </section>
      )}

      {e && bank && (
        <section className="panel">
          <h2>Bank details (restricted)</h2>
          <ActionForm action={setBankForm} className="row" style={{ alignItems: "flex-end" }}>
            <input type="hidden" name="employeeId" value={e.id} /><input type="hidden" name="personId" value={person.id} />
            <label className="field" style={{ width: 200 }}><span>Bank / branch</span><input name="bankName" defaultValue={e.bankName ?? ""} /></label>
            <label className="field" style={{ width: 220 }}><span>Account number</span><input name="account" defaultValue={H.bankAccount(e.bankAccountCipher) ?? ""} inputMode="numeric" autoComplete="off" /></label>
            <SubmitButton className="btn">Save</SubmitButton>
          </ActionForm>
          <p className="small muted">Stored encrypted. Only people with the bank-details permission see this section.</p>
        </section>
      )}
    </div>
  );
}
