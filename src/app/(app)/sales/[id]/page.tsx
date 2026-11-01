import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, qty, fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge } from "@/components/ui";
import { PrintOnLoad } from "./PrintOnLoad";
import { Barcode } from "@/components/Barcode";
import { PayForm } from "@/components/PayForm";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { salePaymentForm, newShipmentForm } from "../../payment-actions";
import { getInvoiceLayout, receiptPaper } from "@/lib/settings";
import { debtOf } from "@/lib/debt";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const row = await db.sale.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: row?.number ?? "Not found" };
}

export default async function SaleDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string; paper?: string }> }) {
  const user = await requirePermission("sales.view");
  const sale = await db.sale.findUnique({
    where: { id: (await params).id },
    include: {
      customer: true, location: { include: { business: true } }, createdBy: true, salesperson: true, agent: true,
      lines: { include: { product: { include: { warranty: true } }, allocations: { include: { costLayer: true } }, accruals: { include: { recipient: true } } } },
      payments: { include: { account: true }, orderBy: { paidAt: "asc" } },
      returns: { orderBy: { createdAt: "asc" } },
      shipments: { orderBy: { createdAt: "asc" } },
      debtAllocations: { include: { collection: { select: { id: true, number: true, method: true, paidAt: true, state: true } } }, orderBy: { collection: { paidAt: "asc" } } },
    },
  });
  if (!sale) notFound();
  const { print, paper: paperParam } = await searchParams;
  const layout = await getInvoiceLayout();
  const paper = (["A4", "80mm", "58mm"].includes(paperParam ?? "") ? paperParam : await receiptPaper(sale.locationId)) as string;
  const customerDue = layout.showCustomerDue && sale.customerId
    ? (await debtOf(db, [sale.customerId])).get(sale.customerId) ?? null
    : null;
  const showCost = can(user, "cost.view");
  const due = D(sale.total).minus(sale.paid).minus(sale.credited);
  const cost = sale.lines.reduce((a, l) => a.plus(l.costTotal), D(0));
  const netSales = D(sale.subtotal).minus(sale.discount);
  const lots = (l: (typeof sale.lines)[number]) => [...new Set(l.allocations.map((a) => a.costLayer.lotCode).filter(Boolean))].join(", ");

  return (
    <div className="stack">
      <div className="no-print">
        <PageHead
          eyebrow={`Sell / ${sale.location.name}`}
          title={sale.number}
          actions={<>{can(user, "returns.create") && sale.lines.some((l) => D(l.returnedQty).lt(l.qty)) && <Link className="btn" href={`/returns/new?sale=${sale.id}`}>Return / exchange</Link>}<Badge tone={sale.paymentState === "PAID" ? "ok" : "warn"}>{sale.paymentState === "PAID" ? "Paid" : sale.paymentState === "PARTIAL" ? "Part paid" : "Due"}</Badge><span className="row" style={{ gap: 4 }}>
            {(["80mm", "58mm", "A4"] as const).map((p) => <Link key={p} className={"btn btn-sm" + (p === paper ? " btn-primary" : "")} href={`?paper=${p}`} replace>{p}</Link>)}
          </span><PrintOnLoad enabled={print === "1"} /></>}
        />
      </div>

      {/* Paper size for this print; thermal rolls print edge to edge. */}
      <style>{paper === "A4" ? "@page { size: A4; margin: 12mm; }" : `@page { size: ${paper} auto; margin: 0; }`}</style>
      <div className={`doc paper-${paper}`}>
        <div className="doc-top">
          <div><h3>{sale.location.business.name.toUpperCase()}</h3><div className="small">{sale.location.name}{sale.location.phone ? ` · ${sale.location.phone}` : ""}</div>{layout.headerText && <div className="small" style={{ whiteSpace: "pre-line" }}>{layout.headerText}</div>}</div>
          <div className="small" style={{ textAlign: "right" }}><strong>INVOICE</strong><br />{sale.number}<br />{fmtDateTime(sale.soldAt)}</div>
        </div>
        <div className="small" style={{ marginBottom: 10 }}>
          Customer: {sale.customer ? `${sale.customer.name}${sale.customer.phone ? ` · ${sale.customer.phone}` : ""}` : "Walk-in"}<br />
          Served by: {sale.createdBy.fullName}
        </div>
        {sale.lines.map((l) => (
          <div key={l.id} className="totalrow" style={{ fontSize: 13 }}>
            <span>
              {l.nameSnapshot}
              <br /><span className="muted small">{qty(l.qty)} × {money(l.unitPrice)}{D(l.discount).gt(0) ? ` − ${money(l.discount)}` : ""}{layout.showLot && lots(l) ? ` · Lot ${lots(l)}` : ""}{layout.showWarranty && l.product.warranty ? ` · ${l.product.warranty.name}` : ""}</span>
              {layout.showImei && l.deviceLabels.length > 0 && <><br /><span className="small" style={{ fontVariantNumeric: "tabular-nums" }}>IMEI/SN {l.deviceLabels.join(", ")}</span></>}
              {D(l.returnedQty).gt(0) && <><br /><span className="small" style={{ color: "var(--warn)" }}>Returned {qty(l.returnedQty)}</span></>}
            </span>
            <strong>{money(l.lineTotal)}</strong>
          </div>
        ))}
        <div className="totalrow"><span>Subtotal</span><strong>{money(sale.subtotal)}</strong></div>
        {D(sale.discount).gt(0) && <div className="totalrow"><span>Discount</span><strong>−{money(sale.discount)}</strong></div>}
        {!D(sale.rounding).eq(0) && <div className="totalrow"><span>Rounding</span><strong>{money(sale.rounding)}</strong></div>}
        <div className="totalrow grand"><span>Total</span><strong>Rs. {money(sale.total)}</strong></div>
        {sale.payments.map((p) => (
          <div key={p.id} className="totalrow small"><span>{p.direction === "OUT" ? "Refunded" : "Paid"} · {p.method.replace("_", " ").toLowerCase()}{p.reference ? ` (${p.reference})` : ""}</span><strong>{p.direction === "OUT" ? "−" : ""}{money(p.amount)}</strong></div>
        ))}
        {sale.debtAllocations.filter((a) => a.collection.state === "POSTED").map((a) => (
          <div key={a.id} className="totalrow small"><span>Paid later · {a.collection.method.replace("_", " ").toLowerCase()} (receipt {a.collection.number})</span><strong>{money(a.amount)}</strong></div>
        ))}
        {sale.returns.map((r) => (
          <div key={r.id} className="totalrow small"><span>Returned · {r.number}</span><strong>−{money(r.totalValue)}</strong></div>
        ))}
        {due.gt(0) && <div className="totalrow"><span>Balance due</span><strong>{money(due)}</strong></div>}
        {customerDue && customerDue.gt(0) && <div className="totalrow small"><span>Your total balance with us</span><strong>{money(customerDue)}</strong></div>}
        {layout.footerText && <p className="small muted" style={{ textAlign: "center", marginTop: 14, whiteSpace: "pre-line" }}>{layout.footerText}</p>}
        {layout.showBarcode && <div style={{ textAlign: "center", marginTop: 8 }}><Barcode value={sale.number} height={paper === "58mm" ? 30 : 36} /></div>}
      </div>

      <div className="no-print stack">
        {due.gt(0) && can(user, "sales.create") && (
          <section className="panel">
            <h2>Receive payment · Rs. {money(due)} due</h2>
            <PayForm action={salePaymentForm} hidden={{ saleId: sale.id }} due={due.toFixed(2)} label="Receive payment"
              accounts={await db.account.findMany({ where: { active: true, type: { in: ["BANK", "CARD"] } }, select: { id: true, name: true } })} />
          </section>
        )}
        {(sale.shipments.length > 0 || can(user, "sales.create")) && (
          <section className="panel stack">
            <h2 style={{ margin: 0 }}>Delivery</h2>
            {sale.shipments.map((sh) => <div key={sh.id} className="totalrow small"><span>{sh.address}{sh.carrier ? ` · ${sh.carrier}` : ""}{sh.trackingRef ? ` ${sh.trackingRef}` : ""}{D(sh.codAmount).gt(0) ? ` · COD ${money(sh.codRemitted)}/${money(sh.codAmount)}` : ""}</span><Badge tone={sh.status === "DELIVERED" ? "ok" : "warn"}>{sh.status.toLowerCase()}</Badge></div>)}
            {can(user, "sales.create") && (
              <details><summary className="small" style={{ cursor: "pointer" }}>Ship this sale</summary>
                <ActionForm action={newShipmentForm} style={{ marginTop: 10 }}>
                  <input type="hidden" name="saleId" value={sale.id} />
                  <div className="grid3">
                    <label className="field" style={{ gridColumn: "span 2" }}><span>Delivery address</span><input name="address" required defaultValue={sale.customer?.address ?? ""} /></label>
                    <label className="field"><span>Receiver mobile</span><input name="contactPhone" defaultValue={sale.customer?.phone ?? ""} type="tel" /></label>
                    <label className="field"><span>Courier</span><input name="carrier" placeholder="Domex / Pronto / bus" /></label>
                    <label className="field"><span>Tracking no.</span><input name="trackingRef" /></label>
                    <label className="field"><span>Cash on delivery (Rs.)</span><input name="codAmount" defaultValue={due.gt(0) ? due.toFixed(2) : "0"} inputMode="decimal" /></label>
                  </div>
                  <div><SubmitButton className="btn">Create shipment</SubmitButton></div>
                </ActionForm>
              </details>
            )}
          </section>
        )}
        {(sale.pricingBasis || sale.lines.some((l) => l.priceRule)) && (
          <section className="panel">
            <h2>Pricing</h2>
            <p className="small muted" style={{ marginTop: 0 }}>As sold: {sale.pricingBasis ?? "Default price"}. Later price changes do not alter this invoice.</p>
            {sale.lines.map((l) => (
              <div className="totalrow small" key={l.id}><span>{l.nameSnapshot}<br /><span className="muted">{l.priceRule ?? "—"}</span></span><strong>{money(l.unitPrice)}{l.listPrice && !D(l.listPrice).eq(l.unitPrice) ? <span className="muted" style={{ fontWeight: 400 }}> (rule {money(l.listPrice)})</span> : null}</strong></div>
            ))}
          </section>
        )}
        {(sale.commissionMode !== "NONE" || showCost) && (
          <section className="grid2">
            {showCost && (
              <div className="panel">
                <h2>Cost & margin</h2>
                <div className="totalrow"><span>Net sales (excl. rounding)</span><strong>{money(netSales)}</strong></div>
                <div className="totalrow"><span>Cost of goods (FIFO lots)</span><strong>{money(cost)}</strong></div>
                <div className="totalrow"><span>Gross profit</span><strong>{money(netSales.minus(cost))}</strong></div>
              </div>
            )}
            {sale.commissionMode !== "NONE" && (
              <div className="panel">
                <h2>Commission · {sale.commissionMode.toLowerCase()}</h2>
                {sale.lines.flatMap((l) => l.accruals.map((a) => (
                  <div className="totalrow small" key={a.id}><span>{a.recipient.fullName} · {a.role.toLowerCase()} · {l.nameSnapshot}</span><strong>{money(a.amount)}</strong></div>
                )))}
                {sale.lines.every((l) => l.accruals.length === 0) && <p className="small muted">No commission accrued (category rates are zero).</p>}
              </div>
            )}
          </section>
        )}
        {showCost && (
          <section>
            <h2>Lot allocation</h2>
            <DataTable
              rows={sale.lines.flatMap((l) => l.allocations.map((a) => ({ ...a, line: l })))}
              rowKey={(a) => a.id}
              empty="No stock-managed items."
              columns={[
                { label: "Product", primary: true, render: (a) => <RowLink href={`/products/${a.line.productId}`}>{a.line.nameSnapshot}</RowLink> },
                { label: "Lot", render: (a) => a.costLayer.lotCode ?? "—" },
                { label: "Qty", num: true, render: (a) => qty(a.qty) },
                { label: "Unit cost", num: true, render: (a) => money(a.unitCost) },
              ]}
            />
          </section>
        )}
      </div>
    </div>
  );
}
