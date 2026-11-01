import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, qty, fmtDate, fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, Badge, RowLink } from "@/components/ui";
import { setProductActive } from "../actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const row = await db.product.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: row?.name ?? "Not found" };
}

export default async function ProductDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("products.view");
  const { id } = await params;
  const p = await db.product.findUnique({ where: { id }, include: { category: true, brand: true, unit: true, warranty: true, prices: { include: { priceGroup: true } } } });
  if (!p) notFound();
  const showCost = can(user, "cost.view");
  const locId = user.location?.id;

  const [layers, moves] = await Promise.all([
    db.costLayer.findMany({
      where: { productId: id, ...(locId ? { locationId: locId } : {}) },
      orderBy: { receivedAt: "desc" }, take: 50,
      include: { receiptLine: { include: { receipt: true } } },
    }),
    db.stockMovement.findMany({ where: { productId: id, ...(locId ? { locationId: locId } : {}) }, orderBy: { createdAt: "desc" }, take: 30, include: { costLayer: true } }),
  ]);
  const saleable = layers.filter((l) => l.bucket === "SALEABLE").reduce((a, l) => a.plus(l.qtyRemaining), D(0));
  const blocked = layers.filter((l) => l.bucket !== "SALEABLE" && l.bucket !== "WRITTEN_OFF").reduce((a, l) => a.plus(l.qtyRemaining), D(0));

  const href = (m: (typeof moves)[number]) => (m.sourceType === "Sale" ? `/sales/${m.sourceId}` : m.sourceType === "GoodsReceipt" ? `/purchases/${m.sourceId}` : null);

  return (
    <div className="stack">
      <PageHead
        eyebrow={`Products / ${p.sku}`}
        title={p.name}
        actions={can(user, "products.manage") && (
          <>
            <form action={setProductActive}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="active" value={String(!p.active)} /><button className="btn">{p.active ? "Deactivate" : "Reactivate"}</button></form>
            <Link className="btn btn-primary" href={`/products/${p.id}/edit`}>Edit</Link>
          </>
        )}
      />
      <div className="stats">
        <div className="stat">Available (saleable)<strong>{qty(saleable)}</strong>{user.location?.name}</div>
        <div className="stat">Blocked / held<strong>{qty(blocked)}</strong>Not available for sale</div>
        <div className="stat">Selling price<strong>Rs. {money(p.sellPrice)}</strong>{p.minSellPrice ? `Min ${money(p.minSellPrice)}` : "No minimum"}</div>
        {showCost && <div className="stat">Last purchase cost<strong>Rs. {money(p.defaultCost)}</strong>Default for next GRN</div>}
      </div>
      <div className="grid3 small">
        <div><span className="muted">Category</span><br />{p.category?.name ?? "—"}</div>
        <div><span className="muted">Brand / unit</span><br />{p.brand?.name ?? "—"} · {p.unit?.shortName ?? "—"}</div>
        <div><span className="muted">Warranty</span><br />{p.warranty?.name ?? "—"}</div>
        <div><span className="muted">Barcode</span><br />{p.barcode ?? "—"}</div>
        <div><span className="muted">Tier prices</span><br />{p.prices.length ? p.prices.filter((x) => x.priceGroup.active).sort((a, b) => a.priceGroup.sortOrder - b.priceGroup.sortOrder).map((x) => (
          <span key={x.id} style={{ display: "block" }}>{x.priceGroup.name}: {x.price.isZero() && !x.zeroConfirmed ? <span style={{ color: "var(--warn)" }}>0 (not verified — default price is used)</span> : `Rs. ${money(x.price)}`}</span>
        )) : "None — default price for every tier"}</div>
        <div><span className="muted">Status</span><br />{p.active ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>}{p.notForSale && <> <Badge tone="warn">Not for sale</Badge></>}</div>
      </div>

      {p.stockManaged && (
        <section>
          <h2>Lots & cost layers</h2>
          <DataTable
            rows={layers}
            rowKey={(l) => l.id}
            empty="No stock received yet. Receive goods through a GRN."
            columns={[
              { label: "Lot / receipt", primary: true, render: (l) => <>{l.lotCode ?? "No lot"} / {l.receiptLine ? <RowLink href={`/purchases/${l.receiptLine.receiptId}`}>{l.receiptLine.receipt.number}</RowLink> : "Opening"}</> },
              { label: "Received", render: (l) => fmtDate(l.receivedAt) },
              { label: "In", num: true, render: (l) => qty(l.qtyIn) },
              { label: "Remaining", num: true, render: (l) => qty(l.qtyRemaining) },
              ...(showCost ? [{ label: "Unit cost", num: true, render: (l: (typeof layers)[number]) => money(l.unitCost) }] : []),
              { label: "Bucket", render: (l) => <Badge tone={l.bucket === "SALEABLE" ? "ok" : "warn"}>{l.bucket.replace("_", " ").toLowerCase()}</Badge> },
            ]}
          />
        </section>
      )}

      <section>
        <h2>Stock movements</h2>
        <DataTable
          rows={moves}
          rowKey={(m) => m.id}
          empty="No movements yet."
          columns={[
            { label: "Reference", primary: true, render: (m) => { const h = href(m); return h ? <RowLink href={h}>{m.reference}</RowLink> : m.reference; } },
            { label: "When", render: (m) => fmtDateTime(m.createdAt) },
            { label: "Type", render: (m) => m.kind.replace("_", " ").toLowerCase() },
            { label: "Lot", render: (m) => m.costLayer?.lotCode ?? "—" },
            { label: "Qty", num: true, render: (m) => <span style={{ color: m.qty.lt(0) ? "var(--err)" : "var(--ok)" }}>{m.qty.gt(0) ? "+" : ""}{qty(m.qty)}</span> },
          ]}
        />
      </section>
    </div>
  );
}
