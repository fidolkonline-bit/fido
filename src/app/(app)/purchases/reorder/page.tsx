import { randomUUID } from "crypto";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, qty } from "@/lib/money";
import { availability } from "@/lib/stock";
import { PageHead } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { orderSuggested } from "./actions";

export const metadata = { title: "Reorder suggestions" };

const DAYS = 30;
const COVER = 30; // order enough for this many days of sales

export default async function Reorder({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  const user = await requirePermission("purchases.view");
  const loc = user.location;
  const { supplier } = await searchParams;
  if (!loc) return <p className="note note-err">No business location is assigned to your login.</p>;
  const since = new Date(Date.now() - DAYS * 86_400_000);

  const [products, sold, onOrder, suppliers] = await Promise.all([
    db.product.findMany({ where: { active: true, stockManaged: true, notForSale: false }, select: { id: true, sku: true, name: true, alertQty: true, defaultCost: true } }),
    db.saleLine.groupBy({ by: ["productId"], where: { sale: { stage: "FINAL", locationId: loc.id, soldAt: { gte: since } } }, _sum: { qty: true, returnedQty: true } }),
    db.purchaseOrderLine.findMany({ where: { order: { locationId: loc.id, status: { in: ["ORDERED", "PART_RECEIVED"] } } }, select: { productId: true, qtyOrdered: true, qtyReceived: true } }),
    db.contact.findMany({ where: { isSupplier: true, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const stock = await availability(loc.id);
  const soldOf = new Map(sold.map((s) => [s.productId, D(s._sum.qty).minus(D(s._sum.returnedQty))]));
  const comingOf = new Map<string, ReturnType<typeof D>>();
  for (const l of onOrder) comingOf.set(l.productId, (comingOf.get(l.productId) ?? D(0)).plus(D(l.qtyOrdered).minus(l.qtyReceived)));

  // Needs ordering when stock (plus what is already on order) is at or below the alert level, or will not last the
  // cover period at the last 30 days' rate of sale. Suggested = enough to reach max(2 × alert level, 30 days of sales).
  const need = products.map((p) => {
    const have = stock.get(p.id) ?? D(0);
    const coming = comingOf.get(p.id) ?? D(0);
    const sold30 = soldOf.get(p.id) ?? D(0);
    const target = D(Math.max(D(p.alertQty).mul(2).toNumber(), sold30.mul(COVER).div(DAYS).toNumber()));
    const suggest = target.minus(have).minus(coming).ceil();
    const low = D(p.alertQty).gt(0) && have.plus(coming).lte(p.alertQty);
    const daysLeft = sold30.gt(0) ? have.div(sold30.div(DAYS)).toNumber() : null;
    return { ...p, have, coming, sold30, suggest, low, daysLeft };
  }).filter((p) => p.suggest.gt(0) && (p.low || (p.daysLeft != null && p.daysLeft < 14)));

  // Last supplier each item was bought from, to group the list.
  const last = need.length
    ? await db.receiptLine.findMany({ where: { productId: { in: need.map((p) => p.id) }, receipt: { status: "POSTED" } }, orderBy: { receipt: { receivedAt: "desc" } }, distinct: ["productId"], select: { productId: true, unitCost: true, receipt: { select: { supplierId: true, supplier: { select: { name: true } } } } } })
    : [];
  const lastOf = new Map(last.map((l) => [l.productId, l]));
  const groups = new Map<string, { name: string; rows: typeof need }>();
  for (const p of need) {
    const l = lastOf.get(p.id);
    const key = l?.receipt.supplierId ?? "";
    const g = groups.get(key) ?? { name: l?.receipt.supplier.name ?? "No supplier yet (imported / never received)", rows: [] };
    g.rows.push(p); groups.set(key, g);
  }
  const shown = [...groups.entries()].filter(([k]) => !supplier || k === supplier).sort((a, b) => b[1].rows.length - a[1].rows.length);
  const showCost = can(user, "cost.view");
  const canOrder = can(user, "purchases.post");

  return (
    <div className="stack">
      <PageHead eyebrow={`Purchases / ${loc.name}`} title="Reorder suggestions" />
      <p className="small muted" style={{ margin: 0 }}>
        Items at or below their alert level, or with under 14 days of stock at the last {DAYS} days&apos; rate of sale. Stock already on an open purchase order is counted as coming.
        Suggested quantity covers about {COVER} days. Change any quantity before ordering. Set alert levels on the product to make this list sharper.
      </p>
      {!need.length && <p className="note note-ok">Nothing needs ordering right now.</p>}
      {shown.map(([supplierId, g]) => (
        <ActionForm key={supplierId || "none"} action={orderSuggested} className="panel stack">
          <input type="hidden" name="key" value={randomUUID()} />
          <div className="row"><h2 style={{ margin: 0 }}>{g.name}</h2><span className="small muted">{g.rows.length} item{g.rows.length === 1 ? "" : "s"}</span></div>
          <div className="tablewrap cards">
            <table className="dt">
              <thead><tr><th>Order</th><th>Product</th><th className="num">In stock</th><th className="num">On order</th><th className="num">Sold {DAYS}d</th><th className="num">Days left</th><th className="num">Order qty</th>{showCost && <th className="num">Last cost</th>}</tr></thead>
              <tbody>
                {g.rows.sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999)).map((p) => {
                  const cost = lastOf.get(p.id)?.unitCost ?? p.defaultCost;
                  return (
                    <tr key={p.id}>
                      <td data-label="Order"><input type="checkbox" name="pick" value={p.id} defaultChecked aria-label={`Order ${p.name}`} disabled={!canOrder} /></td>
                      <td className="primary" data-label="Product">{p.sku} · {p.name}</td>
                      <td className="num" data-label="In stock" style={{ color: p.have.lte(0) ? "var(--err)" : undefined }}>{qty(p.have)}</td>
                      <td className="num" data-label="On order">{p.coming.gt(0) ? qty(p.coming) : "—"}</td>
                      <td className="num" data-label={`Sold ${DAYS}d`}>{qty(p.sold30)}</td>
                      <td className="num" data-label="Days left">{p.daysLeft == null ? "—" : Math.floor(p.daysLeft)}</td>
                      <td className="num" data-label="Order qty"><input name={`qty:${p.id}`} type="number" min="0" step="1" defaultValue={p.suggest.toString()} style={{ width: 80, textAlign: "right" }} inputMode="numeric" disabled={!canOrder} /><input type="hidden" name={`cost:${p.id}`} value={D(cost).toString()} /></td>
                      {showCost && <td className="num" data-label="Last cost">{money(cost)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {canOrder && (
            <div className="row">
              <label className="field"><span>Supplier</span><select name="supplierId" defaultValue={supplierId}><option value="">Select supplier…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
              <SubmitButton pendingText="Creating…">Create purchase order</SubmitButton>
            </div>
          )}
        </ActionForm>
      ))}
    </div>
  );
}
