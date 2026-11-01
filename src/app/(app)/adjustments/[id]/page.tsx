import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, qty, fmtDateTime } from "@/lib/money";
import { ADJUST_REASONS } from "@/lib/adjustments";
import { PageHead, DataTable, RowLink } from "@/components/ui";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const r = await db.stockAdjustment.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: r?.number ?? "Not found" };
}

const b = (x: string | null) => (x ? x.toLowerCase().replace("_", " ") : "—");

export default async function AdjustmentDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("products.view");
  const a = await db.stockAdjustment.findUnique({ where: { id: (await params).id }, include: { lines: { include: { product: true } }, createdBy: true, location: true } });
  if (!a) notFound();
  const showCost = can(user, "cost.view");
  return (
    <div className="stack">
      <PageHead eyebrow={`Stock Adjustment / ${a.location.name}`} title={a.number} />
      <div className="grid3 small">
        <div><span className="muted">Reason</span><br />{ADJUST_REASONS[a.reason as keyof typeof ADJUST_REASONS] ?? a.reason} · {a.kind.toLowerCase()}</div>
        <div><span className="muted">Posted</span><br />{fmtDateTime(a.createdAt)} · {a.createdBy.fullName}</div>
        <div><span className="muted">Recovered</span><br />Rs. {money(a.recoveredAmount)}</div>
      </div>
      {a.notes && <p className="note">{a.notes}</p>}
      <DataTable rows={a.lines} rowKey={(l) => l.id}
        columns={[
          { label: "Product", primary: true, render: (l) => <RowLink href={`/products/${l.productId}`}>{l.product.sku} · {l.product.name}</RowLink> },
          { label: "Lot", render: (l) => l.lotCode ?? "—" },
          { label: "From", render: (l) => b(l.fromBucket) },
          { label: "To", render: (l) => b(l.toBucket) },
          { label: "Qty", num: true, render: (l) => qty(l.qty) },
          ...(showCost ? [{ label: "Unit cost", num: true, render: (l: (typeof a.lines)[number]) => money(l.unitCost) }] : []),
        ]} />
    </div>
  );
}
