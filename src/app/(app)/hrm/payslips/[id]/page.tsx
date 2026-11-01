import { notFound } from "next/navigation";
import { requireUser, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, fmtDate, fmtDateTime } from "@/lib/money";
import type { PayLine } from "@/lib/payroll";
import { PrintOnLoad } from "../../../sales/[id]/PrintOnLoad";

export const metadata = { title: "Payslip" };

// Own payslip, or payroll staff only (AC-40).
export default async function Payslip({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const p = await db.payslip.findUnique({
    where: { id: (await params).id },
    include: { run: true, employee: { include: { person: true, department: true, designation: true, location: { include: { business: true } } } }, payments: { orderBy: { paidAt: "asc" } } },
  });
  if (!p || (p.employee.personId !== user.personId && !can(user, "hr.payroll"))) notFound();
  if (p.run.status === "DRAFT" && !can(user, "hr.payroll")) notFound();
  const lines = p.lines as PayLine[];
  return (
    <div className="stack">
      <div className="no-print"><PrintOnLoad enabled={false} label="Print / save PDF" /></div>
      <div className="doc paper-A4" style={{ maxWidth: 640 }}>
        <div className="doc-top">
          <div><h3>{p.employee.location?.business.name.toUpperCase() ?? "FIDO"}</h3><div className="small">Payslip · {fmtDate(p.run.periodStart)} – {fmtDate(p.run.periodEnd)}</div></div>
          <div className="small" style={{ textAlign: "right" }}><strong>{p.employee.person.fullName}</strong><br />{[p.employee.designation?.name, p.employee.department?.name].filter(Boolean).join(" · ")}<br />{p.run.number}{p.run.status === "DRAFT" ? " · DRAFT" : ""}</div>
        </div>
        <div className="grid3 small" style={{ marginBottom: 10 }}>
          <div>Working days<br /><strong>{p.workingDays.toString()}</strong></div>
          <div>Days worked<br /><strong>{p.daysWorked.toString()}</strong></div>
          <div>Leave (paid / unpaid)<br /><strong>{p.paidLeaveDays.toString()} / {p.unpaidLeaveDays.toString()}</strong></div>
        </div>
        <div className="totalrow"><span>Basic salary ({money(p.baseSalary)} per {p.payPeriod.toLowerCase()})</span><strong>{money(p.basicEarned)}</strong></div>
        {lines.filter((l) => l.kind === "EARNING").map((l, i) => <div key={i} className="totalrow"><span>{l.label}</span><strong>{money(l.amount)}</strong></div>)}
        <div className="totalrow"><span><strong>Gross earnings</strong></span><strong>{money(p.gross)}</strong></div>
        {lines.filter((l) => l.kind === "DEDUCTION").map((l, i) => <div key={i} className="totalrow"><span>{l.label}{l.source === "LEAVE" ? " (already in basic)" : ""}</span><strong>−{money(l.amount)}</strong></div>)}
        <div className="totalrow grand"><span>Net pay</span><strong>Rs. {money(p.net)}</strong></div>
        {p.payments.map((pm) => <div key={pm.id} className="totalrow small"><span>Paid {fmtDateTime(pm.paidAt)} · {pm.method.toLowerCase().replace("_", " ")}{pm.reference ? ` · ${pm.reference}` : ""}</span><strong>{money(pm.amount)}</strong></div>)}
        {D(p.net).gt(p.paid) && <div className="totalrow"><span>Balance to be paid</span><strong>{money(D(p.net).minus(p.paid))}</strong></div>}
        <p className="small muted" style={{ marginTop: 12 }}>Statutory deductions appear only as configured by the employer.</p>
      </div>
    </div>
  );
}
