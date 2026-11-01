import Link from "next/link";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge } from "@/components/ui";

export const metadata = { title: "Supplier returns" };

export default async function Claims() {
  const user = await requirePermission("purchases.view");
  const [claims, held] = await Promise.all([
    db.supplierClaim.findMany({ where: user.location ? { locationId: user.location.id } : {}, orderBy: { sentAt: "desc" }, take: 100, include: { supplier: true } }),
    db.costLayer.aggregate({ where: { bucket: "SUPPLIER_HOLD", qtyRemaining: { gt: 0 }, ...(user.location ? { locationId: user.location.id } : {}) }, _sum: { qtyRemaining: true }, _count: true }),
  ]);
  return (
    <div className="stack">
      <PageHead eyebrow="Purchases" title="Supplier returns / recovery" actions={can(user, "purchases.claims") && <Link className="btn btn-primary" href="/purchases/returns/new">Return to supplier</Link>} />
      {held._count > 0 && <p className="note">{Number(held._sum.qtyRemaining)} unit(s) are waiting on supplier hold. Send them back from “Return to supplier”.</p>}
      <DataTable rows={claims} rowKey={(c) => c.id} empty="No supplier returns yet."
        columns={[
          { label: "Claim", primary: true, render: (c) => <RowLink href={`/purchases/returns/${c.id}`}>{c.number}</RowLink> },
          { label: "Supplier", render: (c) => c.supplier.name },
          { label: "Sent", render: (c) => fmtDateTime(c.sentAt) },
          { label: "Cost sent", num: true, render: (c) => money(c.claimValue) },
          { label: "Recovered", num: true, render: (c) => (c.status === "SETTLED" ? money(c.claimValue.minus(c.lossValue)) : "—") },
          { label: "Loss", num: true, render: (c) => (c.status === "SETTLED" ? <span style={{ color: c.lossValue.gt(0) ? "var(--err)" : undefined }}>{money(c.lossValue)}</span> : "—") },
          { label: "State", render: (c) => <Badge tone={c.status === "SETTLED" ? "ok" : "warn"}>{c.status === "SENT" ? "Awaiting supplier" : c.status.toLowerCase()}</Badge> },
        ]} />
    </div>
  );
}
