import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { qty, fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge } from "@/components/ui";
import { QuickReceiveForm } from "./QuickReceiveForm";

export const metadata = { title: "Quick receive" };

export default async function QuickReceive() {
  const user = await requirePermission("purchases.quick_receive");
  const [suppliers, mine] = await Promise.all([
    db.contact.findMany({ where: { isSupplier: true, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    // This person's quick receives still waiting, and ones the owner finished in the last two weeks.
    db.goodsReceipt.findMany({
      where: {
        createdById: user.personId, ...(user.location ? { locationId: user.location.id } : {}),
        OR: [{ status: "PENDING_COST" }, { costAddedAt: { gt: new Date(Date.now() - 14 * 86_400_000) } }],
      },
      orderBy: { receivedAt: "desc" }, take: 20,
      select: { id: true, number: true, receivedAt: true, status: true, lines: { select: { qtyAccepted: true, product: { select: { name: true } } } } },
    }),
  ]);
  const canOpen = can(user, "purchases.view");
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <PageHead eyebrow={`Purchases / ${user.location?.name ?? ""}`} title="Quick receive" />
      <p className="small muted" style={{ margin: 0 }}>Goods arrived and the owner is not here? Add them with just the product and quantity so you can sell them now. The owner adds the cost later.</p>
      <QuickReceiveForm suppliers={suppliers} />
      {mine.length > 0 && (
        <section className="stack">
          <h2 style={{ margin: 0 }}>Your quick receives</h2>
          <DataTable rows={mine} rowKey={(r) => r.id}
            columns={[
              { label: "GRN", primary: true, render: (r) => (canOpen ? <RowLink href={`/purchases/${r.id}`}>{r.number}</RowLink> : r.number) },
              { label: "Date", render: (r) => fmtDateTime(r.receivedAt) },
              { label: "Items", render: (r) => r.lines.map((l) => `${qty(l.qtyAccepted)} × ${l.product.name}`).join(", ") },
              { label: "Cost", render: (r) => <Badge tone={r.status === "PENDING_COST" ? "warn" : "ok"}>{r.status === "PENDING_COST" ? "Waiting for owner" : "Added"}</Badge> },
            ]} />
        </section>
      )}
    </div>
  );
}
