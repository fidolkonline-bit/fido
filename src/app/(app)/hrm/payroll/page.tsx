import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, fmtDate } from "@/lib/money";
import * as H from "@/lib/hr";
import { PageHead, DataTable, RowLink, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SearchSelect } from "@/components/SearchSelect";
import { SubmitButton } from "@/components/SubmitButton";
import { newRun } from "../actions";
import { RUN_TONE } from "./status";

export const metadata = { title: "Payroll" };

export default async function Payroll({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  await requirePermission("hr.payroll");
  const who = (await searchParams).who || null;
  const [runs, employees] = await Promise.all([
    db.payrollRun.findMany({
      where: who ? { payslips: { some: { employeeId: who } } } : {},
      orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }], take: 36,
      include: { payslips: true, employee: { include: { person: true } } },
    }),
    db.employeeProfile.findMany({ include: { person: true }, orderBy: { person: { fullName: "asc" } } }),
  ]);
  const people = employees.map((e) => ({ id: e.id, name: e.person.fullName + (e.leftOn ? " (left)" : "") }));
  const today = H.todayYmd();
  const [y, m] = today.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const start = prev.toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  // With a person filter, the money columns show that person's payslip only.
  const slips = (r: (typeof runs)[number]) => (who ? r.payslips.filter((p) => p.employeeId === who) : r.payslips);
  return (
    <div className="stack">
      <PageHead eyebrow="HRM" title="Payroll" />
      <section className="panel">
        <h2>New payroll</h2>
        <ActionForm action={newRun} className="row" style={{ alignItems: "flex-end" }}>
          <label className="field" style={{ width: 170 }}><span>From</span><input type="date" name="start" defaultValue={start} required /></label>
          <label className="field" style={{ width: 170 }}><span>To</span><input type="date" name="end" defaultValue={end} required /></label>
          <div className="field" style={{ flex: "1 1 220px" }}><span>Employee</span><SearchSelect name="employeeId" label="Employee" options={people} noneLabel="Everyone" placeholder="Search employee…" /></div>
          <label className="field" style={{ flex: "1 1 200px" }}><span>Notes</span><input name="notes" /></label>
          <SubmitButton pendingText="Calculating…">Calculate payroll</SubmitButton>
        </ActionForm>
        <p className="small muted">Leave Employee as Everyone to include everyone with a salary, or pick one person to calculate and pay them on their own (for example someone leaving mid-month). A person paid on their own is left out of the everyone payroll for the same period. The draft can be recalculated and adjusted until it is approved.</p>
      </section>
      <form className="toolbar dense" role="search" key={who ?? ""}>
        <div style={{ flex: "0 1 260px" }}>
          <SearchSelect name="who" label="Filter by employee" options={people} defaultValue={who} noneLabel="All employees" placeholder="Search employee…" />
        </div>
        <button className="btn">Filter</button>
        {who && <Link className="small" href="?">Clear</Link>}
      </form>
      <DataTable rows={runs} rowKey={(r) => r.id} empty={who ? "No payroll for this person yet." : "No payroll yet."}
        columns={[
          { label: "Payroll", primary: true, render: (r) => <RowLink href={`/hrm/payroll/${r.id}`}>{r.number}</RowLink> },
          { label: "Period", render: (r) => `${fmtDate(r.periodStart)} – ${fmtDate(r.periodEnd)}` },
          { label: "For", render: (r) => r.employee ? r.employee.person.fullName : <span className="muted">Everyone</span> },
          { label: "Staff", num: true, render: (r) => r.payslips.length },
          { label: "Net pay", num: true, render: (r) => money(slips(r).reduce((a, p) => a.plus(p.net), D(0))) },
          { label: "Paid", num: true, render: (r) => money(slips(r).reduce((a, p) => a.plus(p.paid), D(0))) },
          { label: "State", render: (r) => <Badge tone={RUN_TONE[r.status]}>{r.status.toLowerCase().replace("_", " ")}</Badge> },
        ]} />
    </div>
  );
}
