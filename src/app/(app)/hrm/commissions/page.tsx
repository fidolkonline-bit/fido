import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDateTime } from "@/lib/money";
import { commissionOutstanding } from "@/lib/payroll";
import { PageHead, DataTable, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { approveCommissionForm, payCommissionForm } from "../actions";

export const metadata = { title: "Commission payout" };

export default async function Commissions() {
  await requirePermission("commissions.manage");
  const [groups, recent, accounts] = await Promise.all([
    commissionOutstanding(),
    db.commissionSettlement.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { recipient: true, payslip: { include: { run: true } } } }),
    db.account.findMany({ where: { active: true, type: { in: ["BANK", "CASH"] } }, select: { id: true, name: true } }),
  ]);
  return (
    <div className="stack">
      <PageHead eyebrow="HRM" title="Commission payout" />
      <p className="small muted" style={{ margin: 0 }}>Commission accrues on each sale and is reversed by returns. Approve it, then pay it either directly or through payroll — each commission line can be paid only once.</p>
      <DataTable rows={groups} rowKey={(g) => g.recipient.id} empty="No outstanding commission."
        columns={[
          { label: "Recipient", primary: true, render: (g) => <>{g.recipient.fullName} {g.recipient.employee ? <Badge>Employee</Badge> : <Badge tone="muted">Agent</Badge>}</> },
          { label: "Lines", num: true, render: (g) => g.rows.length },
          { label: "Not yet approved", num: true, render: (g) => money(g.pending) },
          { label: "Approved, unpaid", num: true, render: (g) => money(g.approved) },
          {
            label: "", render: (g) => (
              <div className="stack" style={{ gap: 6 }}>
                {g.pending.abs().gt(0) && <form action={approveCommissionForm}><input type="hidden" name="recipientId" value={g.recipient.id} /><SubmitButton className="btn btn-sm">Approve {money(g.pending)}</SubmitButton></form>}
                {g.approved.gt(0) && (
                  <ActionForm action={payCommissionForm} className="row" style={{ gap: 4 }}>
                    <input type="hidden" name="recipientId" value={g.recipient.id} />
                    <select name="method" style={{ width: 110, minHeight: 32 }}><option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank</option></select>
                    <select name="accountId" style={{ width: 140, minHeight: 32 }}><option value="">Default till</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                    <SubmitButton className="btn btn-sm btn-primary">Pay {money(g.approved)} now</SubmitButton>
                  </ActionForm>
                )}
                {g.recipient.employee && g.approved.gt(0) && <span className="small muted">…or leave it for the next payroll.</span>}
              </div>
            ),
          },
        ]} />
      <section>
        <h2>Recent payouts</h2>
        <DataTable rows={recent} rowKey={(s) => s.id} empty="None yet."
          columns={[
            { label: "Paid to", primary: true, render: (s) => s.recipient.fullName },
            { label: "When", render: (s) => fmtDateTime(s.createdAt) },
            { label: "How", render: (s) => (s.method === "PAYROLL" ? `Payroll ${s.payslip?.run.number ?? ""}` : "Direct") },
            { label: "Amount", num: true, render: (s) => money(s.amount) },
          ]} />
      </section>
    </div>
  );
}
