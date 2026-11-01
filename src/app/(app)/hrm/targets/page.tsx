import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDate } from "@/lib/money";
import { targetResult, type Band } from "@/lib/targets";
import { PageHead, DataTable, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { newTargetForm, approveTargetForm } from "../actions";
import * as H from "@/lib/hr";

export const metadata = { title: "Sales targets" };

export default async function Targets() {
  await requirePermission("hr.payroll");
  const [targets, people] = await Promise.all([
    db.salesTarget.findMany({ orderBy: { periodStart: "desc" }, take: 60, include: { person: true, payslip: { include: { run: true } } } }),
    db.person.findMany({ where: { active: true, employee: { isNot: null } }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
  ]);
  const live = await Promise.all(targets.map((t) => (t.snapshot ? Promise.resolve(null) : targetResult(t))));
  const today = H.todayYmd();
  return (
    <div className="stack">
      <PageHead eyebrow="HRM" title="Sales targets" />
      <p className="small muted" style={{ margin: 0 }}>A target bonus is separate from category commission and is never added to it automatically. Achieved = the person&apos;s net sales in the period after returns (reloads excluded). Approve after the period ends; the bonus is then paid once through payroll.</p>
      <DataTable rows={targets} rowKey={(t) => t.id} empty="No targets set."
        columns={[
          { label: "Employee", primary: true, render: (t) => t.person.fullName },
          { label: "Period", render: (t) => `${fmtDate(t.periodStart)} – ${fmtDate(t.periodEnd)}` },
          { label: "Bands", render: (t) => <span className="small">{(t.bands as Band[]).map((b) => `${money(b.from)}–${b.to == null ? "∞" : money(b.to)}: ${b.percent}%`).join(" · ")} ({t.mode.toLowerCase()})</span> },
          { label: "Achieved", num: true, render: (t, ) => money((t.snapshot as { achieved: string } | null)?.achieved ?? live[targets.indexOf(t)]?.value) },
          { label: "Bonus", num: true, render: (t) => money((t.snapshot as { earning: string } | null)?.earning ?? live[targets.indexOf(t)]?.earning) },
          {
            label: "", render: (t) => t.payslip ? <Badge tone="ok">Paid · {t.payslip.run.number}</Badge> : t.approvedAt ? <Badge tone="warn">Approved — next payroll</Badge>
              : H.dateOnlyYmd(t.periodEnd) < today ? <form action={approveTargetForm}><input type="hidden" name="id" value={t.id} /><button className="btn btn-sm btn-primary">Approve bonus</button></form>
              : <span className="small muted">In progress</span>,
          },
        ]} />
      <ActionForm action={newTargetForm} className="panel stack">
        <h2 style={{ margin: 0 }}>New target</h2>
        <div className="grid3">
          <label className="field"><span>Employee</span><select name="personId">{people.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}</select></label>
          <label className="field"><span>From</span><input type="date" name="periodStart" required /></label>
          <label className="field"><span>To</span><input type="date" name="periodEnd" required /></label>
          <label className="field"><span>How bands pay</span><select name="mode"><option value="FLAT">Whole amount at the band reached</option><option value="PROGRESSIVE">Each slice at its own band</option></select></label>
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="row" style={{ alignItems: "flex-end" }}>
            <label className="field" style={{ width: 140 }}><span>Sales from</span><input name={`from${i}`} inputMode="decimal" placeholder={i === 0 ? "500000" : ""} /></label>
            <label className="field" style={{ width: 140 }}><span>to (blank = no top)</span><input name={`to${i}`} inputMode="decimal" /></label>
            <label className="field" style={{ width: 100 }}><span>Bonus %</span><input name={`pct${i}`} inputMode="decimal" /></label>
          </div>
        ))}
        <div><SubmitButton>Save target</SubmitButton></div>
      </ActionForm>
    </div>
  );
}
