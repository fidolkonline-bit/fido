import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, fmtDate } from "@/lib/money";
import * as H from "@/lib/hr";
import { PageHead, DataTable, RowLink, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { newRun } from "../actions";
import { RUN_TONE } from "./status";

export const metadata = { title: "Payroll" };

export default async function Payroll() {
  await requirePermission("hr.payroll");
  const runs = await db.payrollRun.findMany({ orderBy: { periodStart: "desc" }, take: 36, include: { payslips: true } });
  const today = H.todayYmd();
  const [y, m] = today.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const start = prev.toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  return (
    <div className="stack">
      <PageHead eyebrow="HRM" title="Payroll" />
      <section className="panel">
        <h2>New payroll</h2>
        <ActionForm action={newRun} className="row" style={{ alignItems: "flex-end" }}>
          <label className="field" style={{ width: 170 }}><span>From</span><input type="date" name="start" defaultValue={start} required /></label>
          <label className="field" style={{ width: 170 }}><span>To</span><input type="date" name="end" defaultValue={end} required /></label>
          <label className="field" style={{ flex: "1 1 200px" }}><span>Notes</span><input name="notes" /></label>
          <SubmitButton pendingText="Calculating…">Calculate payroll</SubmitButton>
        </ActionForm>
        <p className="small muted">Everyone with an employee profile and a salary is included. The draft can be recalculated and adjusted until it is approved.</p>
      </section>
      <DataTable rows={runs} rowKey={(r) => r.id} empty="No payroll yet."
        columns={[
          { label: "Payroll", primary: true, render: (r) => <RowLink href={`/hrm/payroll/${r.id}`}>{r.number}</RowLink> },
          { label: "Period", render: (r) => `${fmtDate(r.periodStart)} – ${fmtDate(r.periodEnd)}` },
          { label: "Staff", num: true, render: (r) => r.payslips.length },
          { label: "Net pay", num: true, render: (r) => money(r.payslips.reduce((a, p) => a.plus(p.net), D(0))) },
          { label: "Paid", num: true, render: (r) => money(r.payslips.reduce((a, p) => a.plus(p.paid), D(0))) },
          { label: "State", render: (r) => <Badge tone={RUN_TONE[r.status]}>{r.status.toLowerCase().replace("_", " ")}</Badge> },
        ]} />
    </div>
  );
}
