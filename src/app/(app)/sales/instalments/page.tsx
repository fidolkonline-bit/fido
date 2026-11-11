import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDate } from "@/lib/money";
import { planProgress } from "@/lib/instalments";
import { PageHead, DataTable, RowLink, Badge, Stat, Tabs } from "@/components/ui";

export const metadata = { title: "Instalment plans" };

export default async function Plans({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePermission("sales.view");
  const { tab = "active" } = await searchParams;
  const plans = await db.instalmentPlan.findMany({
    where: { status: tab === "cancelled" ? "CANCELLED" : "ACTIVE", ...(user.location ? { sale: { locationId: user.location.id } } : {}) },
    include: { dues: true, sale: true, customer: true }, orderBy: { createdAt: "desc" }, take: 300,
  });
  const rows = plans.map((p) => ({ p, s: planProgress(p) })).filter((r) => (tab === "done" ? r.s.complete : tab === "cancelled" ? true : !r.s.complete));
  const overdue = rows.reduce((a, r) => a + r.s.overdue, 0);
  const balance = rows.reduce((a, r) => a + r.s.balance, 0);
  return (
    <div className="stack">
      <PageHead eyebrow="Sell" title="Instalment plans" />
      <Tabs items={[{ label: "Active", href: "?tab=active", active: tab === "active" }, { label: "Completed", href: "?tab=done", active: tab === "done" }, { label: "Cancelled", href: "?tab=cancelled", active: tab === "cancelled" }]} />
      {tab === "active" && (
        <div className="stats">
          <Stat label="Plans running" value={rows.length} basis="Not yet fully paid" />
          <Stat label="Still to collect" value={`Rs. ${money(balance)}`} basis="All instalments left" />
          <Stat label="Overdue now" value={<span style={{ color: overdue > 0 ? "var(--err)" : undefined }}>Rs. {money(overdue)}</span>} basis={`${rows.filter((r) => r.s.overdue > 0).length} customers behind`} />
        </div>
      )}
      <DataTable rows={rows.sort((a, b) => b.s.overdue - a.s.overdue)} rowKey={(r) => r.p.id} empty="No plans here. Open a credit sale and choose “Instalment plan”."
        columns={[
          { label: "Plan", primary: true, render: (r) => <RowLink href={`/sales/instalments/${r.p.id}`}>{r.p.number}</RowLink> },
          { label: "Customer", render: (r) => <>{r.p.customer.name}<br /><span className="small muted">{r.p.customer.phone ?? "no mobile"}</span></> },
          { label: "Invoice", render: (r) => <RowLink href={`/sales/${r.p.saleId}`}>{r.p.sale.number}</RowLink> },
          { label: "Financed", num: true, render: (r) => money(r.p.financed) },
          { label: "Balance", num: true, render: (r) => money(r.s.balance) },
          { label: "Next", render: (r) => (r.s.next ? `${money(r.s.next.amount - r.s.next.paid)} on ${fmtDate(r.s.next.dueAt)}` : "—") },
          { label: "State", render: (r) => r.s.complete ? <Badge tone="ok">Paid off</Badge> : r.s.overdue > 0 ? <Badge tone="err">Overdue {money(r.s.overdue)}</Badge> : <Badge tone="warn">On track</Badge> },
        ]} />
    </div>
  );
}
