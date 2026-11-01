import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, qty, fmtDate, fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge } from "@/components/ui";
import { finishOrder } from "../actions";
import { PO_STATUS } from "../status";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const o = await db.purchaseOrder.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: o?.number ?? "Not found" };
}

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("purchases.view");
  const o = await db.purchaseOrder.findUnique({
    where: { id: (await params).id },
    include: { supplier: true, location: true, createdBy: true, lines: { include: { product: true } }, receipts: { orderBy: { receivedAt: "asc" } } },
  });
  if (!o) notFound();
  const open = ["ORDERED", "PART_RECEIVED"].includes(o.status);
  const showCost = can(user, "cost.view");
  return (
    <div className="stack">
      <PageHead eyebrow={`Purchases / ${o.location.name}`} title={o.number}
        actions={<>
          <Badge tone={PO_STATUS[o.status]?.[1] ?? "muted"}>{PO_STATUS[o.status]?.[0] ?? o.status}</Badge>
          {open && can(user, "purchases.post") && (
            <>
              <form action={finishOrder}><input type="hidden" name="orderId" value={o.id} /><button className="btn">{o.status === "ORDERED" ? "Cancel order" : "Close (rest not coming)"}</button></form>
              <Link className="btn btn-primary" href={`/purchases/new?order=${o.id}`}>Receive goods</Link>
            </>
          )}
        </>} />
      <div className="grid3 small">
        <div><span className="muted">Supplier</span><br /><RowLink href={`/contacts/${o.supplierId}`}>{o.supplier.name}</RowLink></div>
        <div><span className="muted">Expected</span><br />{fmtDate(o.expectedAt)}</div>
        <div><span className="muted">Ordered</span><br />{fmtDateTime(o.createdAt)} · {o.createdBy.fullName}</div>
      </div>
      {o.notes && <p className="note">{o.notes}</p>}
      <DataTable rows={o.lines} rowKey={(l) => l.id}
        columns={[
          { label: "Product", primary: true, render: (l) => <RowLink href={`/products/${l.productId}`}>{l.product.sku} · {l.product.name}</RowLink> },
          { label: "Ordered", num: true, render: (l) => qty(l.qtyOrdered) },
          { label: "Received", num: true, render: (l) => qty(l.qtyReceived) },
          { label: "Still due", num: true, render: (l) => { const r = D(l.qtyOrdered).minus(l.qtyReceived); return r.gt(0) ? <strong style={{ fontWeight: 600 }}>{qty(r)}</strong> : "—"; } },
          ...(showCost ? [{ label: "Agreed cost", num: true, render: (l: (typeof o.lines)[number]) => money(l.unitCost) }] : []),
        ]} />
      <section>
        <h2>Goods received against this order</h2>
        <DataTable rows={o.receipts} rowKey={(r) => r.id} empty="Nothing received yet."
          columns={[
            { label: "GRN", primary: true, render: (r) => <RowLink href={`/purchases/${r.id}`}>{r.number}</RowLink> },
            { label: "Date", render: (r) => fmtDateTime(r.receivedAt) },
            { label: "Supplier ref", render: (r) => r.supplierRef ?? "—" },
            ...(showCost ? [{ label: "Value", num: true, render: (r: (typeof o.receipts)[number]) => money(r.total) }] : []),
          ]} />
      </section>
    </div>
  );
}
