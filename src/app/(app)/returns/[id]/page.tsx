import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, qty, fmtDateTime } from "@/lib/money";
import { PageHead, Badge } from "@/components/ui";
import { PrintOnLoad } from "../../sales/[id]/PrintOnLoad";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const r = await db.saleReturn.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: r?.number ?? "Not found" };
}

const DISP: Record<string, string> = { SALEABLE: "Back to stock", INSPECTION: "Inspection hold", SUPPLIER_HOLD: "Supplier hold", WRITTEN_OFF: "Written off" };

export default async function ReturnDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("sales.view");
  const r = await db.saleReturn.findUnique({
    where: { id: (await params).id },
    include: { sale: { include: { customer: true } }, location: { include: { business: true } }, createdBy: true, lines: { include: { saleLine: true } }, payments: true },
  });
  if (!r) notFound();
  const showCost = can(user, "cost.view");
  return (
    <div className="stack">
      <div className="no-print">
        <PageHead eyebrow={`Sell / Return / ${r.location.name}`} title={r.number}
          actions={<>
            {r.storeCredit.gt(0) && r.sale.customerId && can(user, "sales.create") && <Link className="btn btn-primary" href={`/pos?customer=${r.sale.customerId}`}>Sell replacement</Link>}
            <PrintOnLoad enabled={false} label="Print credit note" />
          </>} />
      </div>
      <div className="doc">
        <div className="doc-top">
          <div><h3>{r.location.business.name.toUpperCase()}</h3><div className="small">{r.location.name}</div></div>
          <div className="small" style={{ textAlign: "right" }}><strong>CREDIT NOTE</strong><br />{r.number}<br />{fmtDateTime(r.createdAt)}</div>
        </div>
        <div className="small" style={{ marginBottom: 10 }}>
          Original invoice: {r.sale.number}<br />Customer: {r.sale.customer?.name ?? "Walk-in"}<br />Processed by: {r.createdBy.fullName}
          {r.reason && <><br />Reason: {r.reason}</>}
        </div>
        {r.lines.map((l) => (
          <div key={l.id} className="totalrow" style={{ fontSize: 13 }}>
            <span>{l.saleLine.nameSnapshot}<br /><span className="muted small">{qty(l.qty)} returned · {DISP[l.disposition]}{l.condition ? ` · ${l.condition}` : ""}</span></span>
            <strong>{money(l.value)}</strong>
          </div>
        ))}
        <div className="totalrow grand"><span>Credit value</span><strong>Rs. {money(r.totalValue)}</strong></div>
        {D(r.debtOffset).gt(0) && <div className="totalrow small"><span>Applied to unpaid balance</span><strong>{money(r.debtOffset)}</strong></div>}
        {D(r.refunded).gt(0) && <div className="totalrow small"><span>Refunded · {r.payments.map((p) => p.method.replace("_", " ").toLowerCase()).join(", ")}</span><strong>{money(r.refunded)}</strong></div>}
        {D(r.storeCredit).gt(0) && <div className="totalrow small"><span>Issued as store credit</span><strong>{money(r.storeCredit)}</strong></div>}
      </div>
      {showCost && (
        <p className="small muted no-print" style={{ textAlign: "center" }}>
          Original cost of returned items: Rs. {money(r.lines.reduce((a, l) => a.plus(l.costValue), D(0)))} · <Badge tone="warn">{r.lines.filter((l) => l.disposition !== "SALEABLE").length} line(s) held or written off</Badge>
        </p>
      )}
    </div>
  );
}
