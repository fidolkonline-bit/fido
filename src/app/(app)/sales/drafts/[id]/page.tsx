import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, qty, fmtDate, fmtDateTime } from "@/lib/money";
import type { DraftLine } from "@/lib/drafts";
import { Badge } from "@/components/ui";
import { PrintOnLoad } from "../../[id]/PrintOnLoad";

export const metadata = { title: "Quote" };

export default async function Draft({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sales.view");
  const d = await db.saleDraft.findUnique({ where: { id: (await params).id }, include: { customer: true, createdBy: true } });
  if (!d) notFound();
  const loc = await db.location.findUniqueOrThrow({ where: { id: d.locationId }, include: { business: true } });
  const lines = d.lines as DraftLine[];
  const title = d.kind === "QUOTE" ? "QUOTATION" : d.kind === "SUBSCRIPTION" ? "SUBSCRIPTION INVOICE (DRAFT)" : "SUSPENDED SALE";
  return (
    <div className="stack">
      <div className="row no-print">
        <Badge tone={d.status === "OPEN" ? "warn" : d.status === "CONVERTED" ? "ok" : "muted"}>{d.status.toLowerCase()}</Badge>
        {d.status === "OPEN" && <Link className="btn btn-primary" href={`/pos?draft=${d.id}`}>{d.kind === "SUSPENDED" ? "Resume at POS" : "Turn into a sale"}</Link>}
        {d.convertedSaleId && <Link className="btn" href={`/sales/${d.convertedSaleId}`}>View sale</Link>}
        <PrintOnLoad enabled={false} label="Print" />
      </div>
      <div className="doc paper-A4" style={{ maxWidth: 640 }}>
        <div className="doc-top">
          <div><h3>{loc.business.name.toUpperCase()}</h3><div className="small">{loc.name}{loc.phone ? ` · ${loc.phone}` : ""}</div></div>
          <div className="small" style={{ textAlign: "right" }}><strong>{title}</strong><br />{d.number}<br />{fmtDateTime(d.createdAt)}</div>
        </div>
        <div className="small" style={{ marginBottom: 10 }}>To: {d.customer?.name ?? "Walk-in customer"}{d.customer?.phone ? ` · ${d.customer.phone}` : ""}<br />Prepared by: {d.createdBy.fullName}</div>
        {lines.map((l, i) => (
          <div key={i} className="totalrow"><span>{l.name}<br /><span className="small muted">{l.sku} · {qty(l.qty)} × {money(l.unitPrice)}{l.discount ? ` − ${money(l.discount)}` : ""}</span></span><strong>{money(l.unitPrice * l.qty - (l.discount ?? 0))}</strong></div>
        ))}
        <div className="totalrow grand"><span>Total</span><strong>Rs. {money(d.total)}</strong></div>
        {d.kind === "QUOTE" && <p className="small">Valid until {fmtDate(d.validUntil)}. Prices and stock are confirmed when the sale is made. This is not an invoice.</p>}
        {d.notes && <p className="small">{d.notes}</p>}
      </div>
    </div>
  );
}
