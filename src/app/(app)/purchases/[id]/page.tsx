import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, qty, fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge } from "@/components/ui";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const row = await db.goodsReceipt.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: row?.number ?? "Not found" };
}

export default async function ReceiptDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("purchases.view");
  const r = await db.goodsReceipt.findUnique({
    where: { id: (await params).id },
    include: { supplier: true, location: true, createdBy: true, purchaseOrder: true, lines: { include: { product: true, costLayer: true } }, payments: { include: { account: true } } },
  });
  if (!r) notFound();
  const showCost = can(user, "cost.view");
  const due = D(r.total).minus(r.paid);

  return (
    <div className="stack">
      <PageHead eyebrow={`Purchases / ${r.location.name}`} title={r.number} actions={<Badge tone="ok">{r.status.toLowerCase()}</Badge>} />
      <div className="grid3 small">
        <div><span className="muted">Supplier</span><br /><RowLink href={`/contacts/${r.supplierId}`}>{r.supplier.name}</RowLink></div>
        <div><span className="muted">Supplier reference</span><br />{r.supplierRef ?? "—"}{r.purchaseOrder && <> · order <RowLink href={`/purchases/orders/${r.purchaseOrder.id}`}>{r.purchaseOrder.number}</RowLink></>}</div>
        <div><span className="muted">Received</span><br />{fmtDateTime(r.receivedAt)} · {r.createdBy.fullName}</div>
      </div>
      <DataTable
        rows={r.lines}
        rowKey={(l) => l.id}
        columns={[
          { label: "Product", primary: true, render: (l) => <RowLink href={`/products/${l.productId}`}>{l.product.sku} · {l.product.name}</RowLink> },
          { label: "Lot", render: (l) => l.lotCode ?? "—" },
          { label: "Received", num: true, render: (l) => qty(l.qtyReceived) },
          { label: "Rejected", num: true, render: (l) => qty(l.qtyRejected) },
          { label: "Accepted", num: true, render: (l) => qty(l.qtyAccepted) },
          { label: "Remaining", num: true, render: (l) => (l.costLayer ? qty(l.costLayer.qtyRemaining) : "—") },
          ...(showCost ? [
            { label: "Unit cost", num: true, render: (l: (typeof r.lines)[number]) => money(l.unitCost) },
            { label: "Line total", num: true, render: (l: (typeof r.lines)[number]) => money(D(l.qtyAccepted).mul(l.unitCost)) },
          ] : []),
        ]}
      />
      {showCost && (
        <section className="panel" style={{ maxWidth: 420, marginLeft: "auto", width: "100%" }}>
          <div className="totalrow"><span>Receipt total</span><strong>{money(r.total)}</strong></div>
          <div className="totalrow"><span>Paid to supplier</span><strong>{money(r.paid)}</strong></div>
          <div className="totalrow grand"><span>Due</span><strong>{money(due)}</strong></div>
        </section>
      )}
      {r.payments.length > 0 && (
        <section>
          <h2>Payments</h2>
          <DataTable rows={r.payments} rowKey={(p) => p.id}
            columns={[
              { label: "Reference", primary: true, render: (p) => p.number },
              { label: "Date", render: (p) => fmtDateTime(p.paidAt) },
              { label: "Method", render: (p) => p.method.replace("_", " ").toLowerCase() },
              { label: "Account", render: (p) => p.account?.name ?? "—" },
              { label: "Amount", num: true, render: (p) => money(p.amount) },
            ]} />
        </section>
      )}
      {r.notes && <p className="note">{r.notes}</p>}
    </div>
  );
}
