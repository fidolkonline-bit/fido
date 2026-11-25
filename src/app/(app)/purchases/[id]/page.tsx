import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, qty, fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge } from "@/components/ui";
import { PayForm } from "@/components/PayForm";
import { supplierPaymentForm } from "../../payment-actions";
import { pendingImpact } from "@/lib/quick-receive";
import { CompleteForm } from "./CompleteForm";

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
  const waiting = r.status === "PENDING_COST";
  const canComplete = waiting && showCost && can(user, "purchases.post");
  const costAddedBy = r.costAddedById ? await db.person.findUnique({ where: { id: r.costAddedById }, select: { fullName: true } }) : null;
  const complete = canComplete
    ? await Promise.all([
        pendingImpact(r.id),
        db.contact.findMany({ where: { isSupplier: true, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
        db.account.findMany({ where: { active: true, type: { not: "OWNER_COLLECTION" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
        db.category.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      ])
    : null;

  return (
    <div className="stack">
      <PageHead eyebrow={`Purchases / ${r.location.name}`} title={r.number}
        actions={<>{can(user, "products.view") && r.lines.some((l) => l.qtyAccepted.gt(0)) && <Link className="btn btn-primary" href={`/products/labels?grn=${r.id}`}>Print barcodes</Link>}<Badge tone={waiting ? "warn" : "ok"}>{waiting ? "waiting for cost" : r.status.toLowerCase()}</Badge></>} />
      {waiting && (
        <p className="note" style={{ margin: 0 }}>
          Quick receive by {r.createdBy.fullName}: the stock is on sale, but no cost, supplier or payment has been entered yet.
          {canComplete ? " Add them below." : " The owner has been asked to add the cost."}
        </p>
      )}
      <div className="grid3 small">
        <div><span className="muted">Supplier</span><br />{r.supplier ? <RowLink href={`/contacts/${r.supplier.id}`}>{r.supplier.name}</RowLink> : "Not set yet"}</div>
        <div><span className="muted">Supplier reference</span><br />{r.supplierRef ?? "—"}{r.purchaseOrder && <> · order <RowLink href={`/purchases/orders/${r.purchaseOrder.id}`}>{r.purchaseOrder.number}</RowLink></>}</div>
        <div><span className="muted">Received</span><br />{fmtDateTime(r.receivedAt)} · {r.createdBy.fullName}{costAddedBy && r.costAddedAt && <><br /><span className="muted">Cost added {fmtDateTime(r.costAddedAt)} · {costAddedBy.fullName}</span></>}</div>
      </div>
      <DataTable
        rows={r.lines}
        rowKey={(l) => l.id}
        columns={[
          { label: "Product", primary: true, render: (l) => <><RowLink href={`/products/${l.productId}`}>{l.product.sku} · {l.product.name}</RowLink>{l.newProduct && <> <span className="badge badge-muted">new</span></>}</> },
          { label: "Lot", render: (l) => l.lotCode ?? "—" },
          { label: "Received", num: true, render: (l) => qty(l.qtyReceived) },
          { label: "Rejected", num: true, render: (l) => qty(l.qtyRejected) },
          { label: "Accepted", num: true, render: (l) => qty(l.qtyAccepted) },
          { label: "Remaining", num: true, render: (l) => (l.costLayer ? qty(l.costLayer.qtyRemaining) : "—") },
          { label: "Labels printed", num: true, render: (l) => `${l.labelsPrinted} of ${qty(l.qtyAccepted)}` },
          ...(showCost && !waiting ? [
            { label: "Unit cost", num: true, render: (l: (typeof r.lines)[number]) => money(l.unitCost) },
            { label: "Line total", num: true, render: (l: (typeof r.lines)[number]) => money(D(l.qtyAccepted).mul(l.unitCost)) },
          ] : []),
        ]}
      />
      {complete && (
        <CompleteForm receiptId={r.id} supplierId={r.supplierId} notes={r.notes} suppliers={complete[1]} accounts={complete[2]} categories={complete[3]}
          lines={r.lines.map((l) => {
            const im = complete[0].find((x) => x.lineId === l.id);
            return {
              id: l.id, label: `${l.product.sku} · ${l.product.name}`, qty: Number(l.qtyAccepted), newProduct: l.newProduct, sellPrice: l.product.sellPrice.toFixed(2),
              lastCost: l.product.defaultCost.gt(0) ? l.product.defaultCost.toString() : null,
              sold: Number(im?.sold ?? 0), inStock: Number(im?.inStock ?? 0), elsewhere: Number(im?.elsewhere ?? 0),
            };
          })} />
      )}
      {showCost && !waiting && (
        <section className="panel" style={{ maxWidth: 420, marginLeft: "auto", width: "100%" }}>
          <div className="totalrow"><span>Receipt total</span><strong>{money(r.total)}</strong></div>
          <div className="totalrow"><span>Paid to supplier</span><strong>{money(r.paid)}</strong></div>
          <div className="totalrow grand"><span>Due</span><strong>{money(due)}</strong></div>
        </section>
      )}
      {showCost && due.gt(0) && can(user, "purchases.post") && (
        <section className="panel">
          <h2>Pay supplier · Rs. {money(due)} due</h2>
          <PayForm action={supplierPaymentForm} hidden={{ receiptId: r.id }} due={due.toFixed(2)} label="Record payment" methods={["BANK_TRANSFER", "CHEQUE", "CASH", "OTHER"]}
            accounts={await db.account.findMany({ where: { active: true, type: { in: ["BANK", "CASH"] } }, select: { id: true, name: true } })} />
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
