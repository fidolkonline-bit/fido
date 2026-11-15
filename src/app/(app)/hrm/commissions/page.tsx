import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDateTime } from "@/lib/money";
import { commissionOutstanding } from "@/lib/payroll";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { PageHead, DataTable, Badge, Pager, PAGE_SIZE, pageOf } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { approveCommissionForm, payCommissionForm } from "../actions";

export const metadata = { title: "Commission payout" };

type Search = { who?: string; type?: string; state?: string; method?: string; from?: string; to?: string; page?: string };

export default async function Commissions({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePermission("commissions.manage");
  const sp = await searchParams;
  const { who = "", type = "", state = "", method = "", from: fromDay = "", to: toDay = "" } = sp;
  const page = pageOf(sp.page);
  const from = fromDay ? new Date(`${fromDay}T00:00:00+05:30`) : undefined;
  const to = toDay ? new Date(`${toDay}T23:59:59.999+05:30`) : undefined;
  const isEmployee = type === "employee" ? { employee: { isNot: null } } : type === "agent" ? { employee: { is: null } } : {};
  const payoutWhere: Prisma.CommissionSettlementWhereInput = {
    ...(who ? { recipientId: who } : {}),
    ...(type ? { recipient: isEmployee } : {}),
    ...(method === "DIRECT" || method === "PAYROLL" ? { method } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  const [allGroups, found, paidTo, accounts] = await Promise.all([
    commissionOutstanding(who || undefined),
    db.commissionSettlement.findMany({ where: payoutWhere, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1, include: { recipient: true, payslip: { include: { run: true } } } }),
    db.commissionSettlement.findMany({ distinct: ["recipientId"], select: { recipient: { select: { id: true, fullName: true } } } }),
    db.account.findMany({ where: { active: true, type: { in: ["BANK", "CASH"] } }, select: { id: true, name: true } }),
  ]);
  const groups = allGroups
    .filter((g) => (type === "employee" ? !!g.recipient.employee : type === "agent" ? !g.recipient.employee : true))
    .filter((g) => (state === "pending" ? g.pending.abs().gt(0) : state === "approved" ? g.approved.gt(0) : true));
  const recent = found.slice(0, PAGE_SIZE);
  // Recipients with either outstanding commission or past payouts, so the picker covers both tables.
  const people = new Map<string, string>();
  for (const g of allGroups) people.set(g.recipient.id, g.recipient.fullName);
  for (const s of paidTo) people.set(s.recipient.id, s.recipient.fullName);
  const recipients = [...people].sort((x, y) => x[1].localeCompare(y[1]));
  const query = { who, type, state, method, from: fromDay, to: toDay };
  const filtered = Object.values(query).some(Boolean);
  return (
    <div className="stack">
      <PageHead eyebrow="HRM" title="Commission payout" />
      <p className="small muted" style={{ margin: 0 }}>Commission accrues on each sale and is reversed by returns. Approve it, then pay it either directly or through payroll — each commission line can be paid only once.</p>
      <form className="toolbar dense" role="search">
        <select name="who" defaultValue={who} aria-label="Recipient">
          <option value="">Everyone</option>
          {recipients.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select name="type" defaultValue={type} aria-label="Recipient type">
          <option value="">Employees and agents</option>
          <option value="employee">Employees only</option>
          <option value="agent">Agents only</option>
        </select>
        <select name="state" defaultValue={state} aria-label="Outstanding state">
          <option value="">Any outstanding</option>
          <option value="pending">Needs approval</option>
          <option value="approved">Approved, unpaid</option>
        </select>
        <select name="method" defaultValue={method} aria-label="Payout method">
          <option value="">Any payout method</option>
          <option value="DIRECT">Direct</option>
          <option value="PAYROLL">Payroll</option>
        </select>
        <input type="date" name="from" defaultValue={fromDay} aria-label="Paid from date" />
        <input type="date" name="to" defaultValue={toDay} aria-label="Paid to date" />
        <button className="btn">Filter</button>
        {filtered && <Link className="small" href="?">Clear</Link>}
      </form>
      <p className="small muted" style={{ margin: 0 }}>Recipient and type filter both tables. Outstanding state applies to the first table; payout method and dates apply to recent payouts.</p>
      <DataTable rows={groups} rowKey={(g) => g.recipient.id} empty={filtered ? "No outstanding commission matches these filters." : "No outstanding commission."}
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
        <DataTable rows={recent} rowKey={(s) => s.id} empty={filtered ? "No payouts match these filters." : "None yet."}
          columns={[
            { label: "Paid to", primary: true, render: (s) => s.recipient.fullName },
            { label: "When", render: (s) => fmtDateTime(s.createdAt) },
            { label: "How", render: (s) => (s.method === "PAYROLL" ? `Payroll ${s.payslip?.run.number ?? ""}` : "Direct") },
            { label: "Amount", num: true, render: (s) => money(s.amount) },
          ]} />
        <Pager page={page} hasNext={found.length > PAGE_SIZE} query={query} shown={recent.length} noun="payouts" />
      </section>
    </div>
  );
}
