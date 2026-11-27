import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ZERO, money, fmtDate } from "@/lib/money";
import * as H from "@/lib/hr";
import { getCreditCommission } from "@/lib/credit-commission";
import { CREDIT_ROLES, CREDIT_ROLE_LABEL, heldForCollection, isCreditRole, saleDueAmount } from "@/lib/credit-commission-rules";
import { DataTable, Badge, Stat } from "@/components/ui";

type Line = {
  key: string; role: string; at: Date; invoice: string; customer: string; item: string; phones: number; due: Prisma.Decimal; held: boolean;
  amount: Prisma.Decimal; pending: Prisma.Decimal; approved: Prisma.Decimal; paid: Prisma.Decimal; thisMonth: boolean;
};

// The signed-in person's own Fintrex sale commission: a fixed amount per phone, on top of normal commission, held until
// the shop has collected the sale in full. This month's sales, plus anything earlier that is still unpaid.
export async function CreditCommission({ personId }: { personId: string }) {
  const today = H.todayYmd();
  const monthStart = H.dayStart(`${today.slice(0, 7)}-01`);
  const [rows, rates] = await Promise.all([
    db.commissionAccrual.findMany({
      where: { recipientId: personId, role: { in: [...CREDIT_ROLES] }, OR: [{ createdAt: { gte: monthStart } }, { settlementId: null }] },
      orderBy: { createdAt: "desc" },
      include: {
        saleLine: { select: { id: true, qty: true, returnedQty: true, nameSnapshot: true, sale: { select: { number: true, total: true, paid: true, credited: true, customer: { select: { name: true } } } } } },
      },
    }),
    getCreditCommission(),
  ]);
  if (!rows.length && !(rates.fintrex > 0)) return null;

  // One line per phone line and type: the net of what it earned and anything taken back.
  const lines = new Map<string, Line>();
  for (const r of rows) {
    if (!r.saleLine || !isCreditRole(r.role)) continue;
    const key = `${r.saleLine.id}|${r.role}`;
    const sale = r.saleLine.sale;
    const l = lines.get(key) ?? {
      key, role: r.role, at: r.createdAt, invoice: sale.number, customer: sale.customer?.name ?? "Walk-in", item: r.saleLine.nameSnapshot,
      phones: r.saleLine.qty.minus(r.saleLine.returnedQty).toNumber(), due: saleDueAmount(sale), held: heldForCollection(r),
      amount: ZERO, pending: ZERO, approved: ZERO, paid: ZERO, thisMonth: false,
    };
    l.amount = l.amount.plus(r.amount);
    if (r.settlementId) l.paid = l.paid.plus(r.amount); else if (r.approvedAt) l.approved = l.approved.plus(r.amount); else l.pending = l.pending.plus(r.amount);
    if (r.createdAt >= monthStart) l.thisMonth = true;
    if (r.createdAt < l.at) l.at = r.createdAt;
    lines.set(key, l);
  }
  const list = [...lines.values()].filter((l) => !l.amount.eq(0) || l.thisMonth);
  const earned = rows.filter((r) => r.createdAt >= monthStart).reduce((a, r) => a.plus(r.amount), ZERO);
  const phones = list.filter((l) => l.thisMonth && l.role === "FINTREX" && l.amount.gt(0)).reduce((a, l) => a + l.phones, 0);
  const open = list.filter((l) => !l.pending.plus(l.approved).eq(0));
  const held = open.filter((l) => l.held).reduce((a, l) => a.plus(l.pending).plus(l.approved), ZERO);
  const ready = open.filter((l) => !l.held).reduce((a, l) => a.plus(l.pending), ZERO);
  const approved = open.filter((l) => !l.held).reduce((a, l) => a.plus(l.approved), ZERO);

  return (
    <section className="stack">
      <h2 style={{ margin: 0 }}>Fintrex sale commission</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Extra commission of {money(rates.fintrex)} for each phone you sell through Fintrex, on top of your normal <Link href="/hrm/me/commission">sales commission</Link>.
        It is <strong>on hold</strong> until the shop has collected the sale in full; then the owner approves it and it is added to your next salary. A returned phone takes it back.
      </p>
      <div className="stats">
        <Stat label="Earned this month" value={money(earned)} basis={`${phones} Fintrex phone${phones === 1 ? "" : "s"}, after returns`} />
        <Stat label="On hold" value={money(held)} basis="Waiting for the full amount to be collected" />
        <Stat label="Collected, waiting for approval" value={money(ready)} basis="Not paid yet" />
        <Stat label="Approved" value={money(approved)} basis="Paid in the next payroll" />
      </div>
      <DataTable rows={list} rowKey={(l) => l.key} empty="No phones sold through Fintrex this month yet."
        columns={[
          { label: "Invoice", primary: true, render: (l) => <>{l.invoice} <span className="small muted">· {fmtDate(l.at)}</span></> },
          { label: "Customer", render: (l) => l.customer },
          { label: "Phone", render: (l) => <>{l.item}{l.phones > 1 ? ` × ${l.phones}` : ""}{l.role !== "FINTREX" && <span className="small muted"> · {CREDIT_ROLE_LABEL[l.role as keyof typeof CREDIT_ROLE_LABEL]}</span>}</> },
          { label: "Commission", num: true, render: (l) => money(l.amount) },
          {
            label: "", render: (l) => l.amount.eq(0) ? <Badge tone="muted">Taken back</Badge>
              : l.pending.eq(0) && l.approved.eq(0) ? <Badge tone="ok">Paid</Badge>
              : l.held ? <Badge tone="err">On hold · {money(l.due)} still due</Badge>
              : l.pending.eq(0) ? <Badge tone="warn">Approved — next payroll</Badge>
              : <Badge>Collected — waiting for approval</Badge>,
          },
        ]} />
    </section>
  );
}
