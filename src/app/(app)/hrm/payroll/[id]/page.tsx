import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, fmtDate, fmtDateTime } from "@/lib/money";
import type { PayLine } from "@/lib/payroll";
import { PageHead, Badge, Stat } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { runAction, manualLineForm, payForm, payAllForm } from "../../actions";
import { RUN_TONE } from "../status";

export const metadata = { title: "Payroll run" };

export default async function Run({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("hr.payroll");
  const run = await db.payrollRun.findUnique({ where: { id: (await params).id }, include: { payslips: { include: { employee: { include: { person: true } } }, orderBy: { employee: { person: { fullName: "asc" } } } } } });
  if (!run) notFound();
  const accounts = await db.account.findMany({ where: { active: true, type: { in: ["BANK", "CASH"] } }, select: { id: true, name: true } });
  const draft = run.status === "DRAFT";
  const payable = ["APPROVED", "PART_PAID"].includes(run.status);
  const sum = (f: "gross" | "deductions" | "net" | "paid") => run.payslips.reduce((a, p) => a.plus(p[f]), D(0));

  return (
    <div className="stack">
      <PageHead eyebrow="HRM / Payroll" title={`${run.number} · ${fmtDate(run.periodStart)} – ${fmtDate(run.periodEnd)}`} actions={<Badge tone={RUN_TONE[run.status]}>{run.status.toLowerCase().replace("_", " ")}</Badge>} />
      <div className="stats">
        <Stat label="Gross" value={`Rs. ${money(sum("gross"))}`} basis={`${run.payslips.length} employees`} />
        <Stat label="Deductions" value={`Rs. ${money(sum("deductions"))}`} />
        <Stat label="Net pay" value={`Rs. ${money(sum("net"))}`} />
        <Stat label="Paid" value={`Rs. ${money(sum("paid"))}`} basis={run.approvedAt ? `Approved ${fmtDateTime(run.approvedAt)}` : "Not approved"} />
      </div>
      <div className="row">
        {draft && <form action={runAction}><input type="hidden" name="runId" value={run.id} /><input type="hidden" name="action" value="recalc" /><SubmitButton className="btn" pendingText="Recalculating…">Recalculate</SubmitButton></form>}
        {draft && <form action={runAction}><input type="hidden" name="runId" value={run.id} /><input type="hidden" name="action" value="approve" /><SubmitButton>Approve payroll</SubmitButton></form>}
        {draft && <form action={runAction}><input type="hidden" name="runId" value={run.id} /><input type="hidden" name="action" value="cancel" /><button className="btn btn-ghost btn-danger">Cancel draft</button></form>}
        {run.status === "APPROVED" && <form action={runAction}><input type="hidden" name="runId" value={run.id} /><input type="hidden" name="action" value="reopen" /><button className="btn">Reopen (no payments yet)</button></form>}
      </div>
      {draft && <p className="note">Draft: figures follow the latest salary, attendance, leave, components and approved commission each time you recalculate. Approving locks the payslips and settles the included commission so it cannot be paid twice.</p>}
      {payable && (
        <form action={payAllForm} className="panel row" style={{ alignItems: "flex-end" }}>
          <input type="hidden" name="runId" value={run.id} />
          <strong style={{ fontWeight: 600 }}>Pay everyone the balance</strong>
          <label className="field" style={{ width: 150 }}><span>Method</span><select name="method"><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option><option value="CHEQUE">Cheque</option></select></label>
          <label className="field" style={{ width: 200 }}><span>From account</span><select name="accountId">{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="field" style={{ flex: "1 1 140px" }}><span>Reference</span><input name="reference" /></label>
          <SubmitButton>Pay all</SubmitButton>
        </form>
      )}

      {run.payslips.map((p) => {
        const lines = p.lines as PayLine[];
        const due = D(p.net).minus(p.paid);
        return (
          <section key={p.id} className="panel stack" style={{ gap: 8 }}>
            <div className="row"><strong style={{ fontWeight: 600, fontSize: 15 }}>{p.employee.person.fullName}</strong><span className="small muted">{p.payPeriod.toLowerCase()} · worked {p.daysWorked.toString()}/{p.workingDays.toString()} days{D(p.paidLeaveDays).gt(0) ? ` · paid leave ${p.paidLeaveDays}` : ""}{D(p.unpaidLeaveDays).gt(0) ? ` · unpaid leave ${p.unpaidLeaveDays}` : ""}{D(p.absentDays).gt(0) ? ` · absent ${p.absentDays} (not deducted)` : ""}</span><div className="spacer" /><Link className="small" href={`/hrm/payslips/${p.id}`}>Payslip</Link></div>
            <div className="totalrow small"><span>Basic ({money(p.baseSalary)} / {p.payPeriod.toLowerCase()})</span><strong>{money(p.basicEarned)}</strong></div>
            {lines.map((l, i) => <div key={i} className="totalrow small"><span>{l.kind === "DEDUCTION" ? "− " : "+ "}{l.label}{l.source === "MANUAL" ? ` · ${l.note}` : ""}{l.source === "LEAVE" ? " (in basic)" : ""}</span><strong>{money(l.amount)}</strong></div>)}
            <div className="totalrow"><span>Net pay</span><strong>Rs. {money(p.net)}</strong></div>
            {D(p.paid).gt(0) && <div className="totalrow small"><span>Paid</span><strong>{money(p.paid)}</strong></div>}
            {draft && (
              <details><summary className="small" style={{ cursor: "pointer" }}>Add a manual line (advance, bonus, overtime…)</summary>
                <ActionForm action={manualLineForm} className="row" style={{ alignItems: "flex-end", marginTop: 8 }}>
                  <input type="hidden" name="runId" value={run.id} /><input type="hidden" name="payslipId" value={p.id} />
                  <label className="field" style={{ width: 130 }}><span>Type</span><select name="kind"><option value="EARNING">Earning</option><option value="DEDUCTION">Deduction</option></select></label>
                  <label className="field" style={{ flex: "1 1 160px" }}><span>Description</span><input name="label" required /></label>
                  <label className="field" style={{ width: 110 }}><span>Amount</span><input name="amount" inputMode="decimal" required /></label>
                  <label className="field" style={{ flex: "1 1 160px" }}><span>Reason (required)</span><input name="note" required /></label>
                  <SubmitButton className="btn">Add</SubmitButton>
                </ActionForm>
              </details>
            )}
            {payable && due.gt(0) && (
              <ActionForm action={payForm} className="row" style={{ alignItems: "flex-end" }}>
                <input type="hidden" name="runId" value={run.id} /><input type="hidden" name="payslipId" value={p.id} />
                <label className="field" style={{ width: 120 }}><span>Pay</span><input name="amount" defaultValue={due.toFixed(2)} inputMode="decimal" /></label>
                <label className="field" style={{ width: 140 }}><span>Method</span><select name="method"><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option><option value="CHEQUE">Cheque</option></select></label>
                <label className="field" style={{ width: 180 }}><span>From</span><select name="accountId">{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
                <SubmitButton className="btn">Record payment</SubmitButton>
              </ActionForm>
            )}
          </section>
        );
      })}
    </div>
  );
}
