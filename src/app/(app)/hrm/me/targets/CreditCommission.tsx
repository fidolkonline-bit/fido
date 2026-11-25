import Link from "next/link";
import { db } from "@/lib/db";
import { D, ZERO, money, fmtDate } from "@/lib/money";
import * as H from "@/lib/hr";
import { getCreditCommission } from "@/lib/credit-commission";
import { CREDIT_ROLES, CREDIT_ROLE_LABEL, isCreditRole } from "@/lib/credit-commission-rules";
import { DataTable, Badge, Stat } from "@/components/ui";

// The signed-in person's own credit-sale commission: a fixed amount per phone sold through Fintrex or put on an
// instalment plan, on top of normal commission. This month's sales, plus anything earlier that is still unpaid.
export async function CreditCommission({ personId }: { personId: string }) {
  const today = H.todayYmd();
  const monthStart = H.dayStart(`${today.slice(0, 7)}-01`);
  const [rows, rates] = await Promise.all([
    db.commissionAccrual.findMany({
      where: { recipientId: personId, role: { in: [...CREDIT_ROLES] }, OR: [{ createdAt: { gte: monthStart } }, { settlementId: null }] },
      orderBy: { createdAt: "desc" },
      include: {
        settlement: { select: { method: true, payslip: { select: { id: true } } } },
        saleLine: { select: { id: true, qty: true, returnedQty: true, nameSnapshot: true, sale: { select: { number: true, soldAt: true, customer: { select: { name: true } } } } } },
      },
    }),
    getCreditCommission(),
  ]);
  if (!rows.length && !(rates.fintrex > 0 || rates.instalment > 0)) return null;

  // One line per phone line and type: the net of what it earned and anything taken back.
  type Line = { key: string; role: string; at: Date; invoice: string; customer: string; item: string; phones: number; amount: ReturnType<typeof D>; pending: ReturnType<typeof D>; approved: ReturnType<typeof D>; paid: ReturnType<typeof D>; thisMonth: boolean };
  const lines = new Map<string, Line>();
  for (const r of rows) {
    if (!r.saleLine || !isCreditRole(r.role)) continue;
    const key = `${r.saleLine.id}|${r.role}`;
    const l = lines.get(key) ?? {
      key, role: r.role, at: r.createdAt, invoice: r.saleLine.sale.number, customer: r.saleLine.sale.customer?.name ?? "Walk-in", item: r.saleLine.nameSnapshot,
      phones: D(r.saleLine.qty).minus(r.saleLine.returnedQty).toNumber(), amount: ZERO, pending: ZERO, approved: ZERO, paid: ZERO, thisMonth: false,
    };
    l.amount = l.amount.plus(r.amount);
    if (r.settlementId) l.paid = l.paid.plus(r.amount); else if (r.approvedAt) l.approved = l.approved.plus(r.amount); else l.pending = l.pending.plus(r.amount);
    if (r.createdAt >= monthStart) l.thisMonth = true;
    if (r.createdAt < l.at) l.at = r.createdAt;
    lines.set(key, l);
  }
  const list = [...lines.values()].filter((l) => !l.amount.eq(0) || l.thisMonth);
  const month = list.filter((l) => l.thisMonth);
  const monthRows = rows.filter((r) => r.createdAt >= monthStart);
  const earned = monthRows.reduce((a, r) => a.plus(r.amount), ZERO);
  const phones = (role: string) => month.filter((l) => l.role === role && l.amount.gt(0)).reduce((a, l) => a + l.phones, 0);
  const sum = (k: "pending" | "approved") => list.reduce((a, l) => a.plus(l[k]), ZERO);

  return (
    <section className="stack">
      <h2 style={{ margin: 0 }}>Credit sale commission</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Extra commission for each phone you sell on credit, on top of your normal <Link href="/hrm/me/commission">sales commission</Link>:
        {" "}{money(rates.fintrex)} per phone through Fintrex, {money(rates.instalment)} per phone on a shop instalment plan (earned when the plan is made).
        A returned phone or a cancelled plan takes it back. Approved amounts are paid in the next payroll.
      </p>
      <div className="stats">
        <Stat label="Earned this month" value={money(earned)} basis="After returns and cancelled plans" />
        <Stat label="Fintrex phones" value={phones("FINTREX")} basis="This month" />
        <Stat label="Instalment phones" value={phones("INSTALMENT")} basis="This month" />
        <Stat label="Waiting for approval" value={money(sum("pending"))} basis="Not paid yet" />
        <Stat label="Approved" value={money(sum("approved"))} basis="Paid in the next payroll" />
      </div>
      <DataTable rows={list} rowKey={(l) => l.key} empty="No phones sold on credit this month yet."
        columns={[
          { label: "Invoice", primary: true, render: (l) => <>{l.invoice} <span className="small muted">· {fmtDate(l.at)}</span></> },
          { label: "Customer", render: (l) => l.customer },
          { label: "Phone", render: (l) => <>{l.item}{l.phones > 1 ? ` × ${l.phones}` : ""}</> },
          { label: "Type", render: (l) => <Badge>{CREDIT_ROLE_LABEL[l.role as keyof typeof CREDIT_ROLE_LABEL]}</Badge> },
          { label: "Commission", num: true, render: (l) => money(l.amount) },
          {
            label: "", render: (l) => l.amount.eq(0) ? <Badge tone="muted">Taken back</Badge>
              : !l.paid.eq(0) && l.pending.eq(0) && l.approved.eq(0) ? <Badge tone="ok">Paid</Badge>
              : l.pending.eq(0) ? <Badge tone="warn">Approved — next payroll</Badge>
              : <Badge>Waiting for approval</Badge>,
          },
        ]} />
    </section>
  );
}
