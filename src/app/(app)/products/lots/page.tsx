import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, qty, fmtDate } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge } from "@/components/ui";

export const metadata = { title: "Lots & stock ledger" };

export default async function Lots({ searchParams }: { searchParams: Promise<{ q?: string; all?: string }> }) {
  const user = await requirePermission("products.view");
  const { q, all } = await searchParams;
  const showCost = can(user, "cost.view");
  const layers = await db.costLayer.findMany({
    where: {
      ...(user.location ? { locationId: user.location.id } : {}),
      ...(all ? {} : { qtyRemaining: { gt: 0 } }),
      ...(q ? { OR: [{ lotCode: { contains: q, mode: "insensitive" } }, { product: { sku: { contains: q, mode: "insensitive" } } }, { product: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    },
    orderBy: [{ receivedAt: "desc" }],
    take: 300,
    include: { product: true, receiptLine: { include: { receipt: true } } },
  });

  return (
    <div>
      <PageHead eyebrow={`Products / ${user.location?.name ?? ""}`} title="Lots & cost layers" />
      <form className="toolbar" role="search">
        <input name="q" defaultValue={q} placeholder="Lot code, SKU or product" aria-label="Search lots" />
        <label className="check small"><input type="checkbox" name="all" defaultChecked={!!all} /> Include fully consumed</label>
        <button className="btn">Filter</button>
      </form>
      <DataTable
        rows={layers}
        rowKey={(l) => l.id}
        empty="No lots match these filters."
        columns={[
          { label: "SKU / product", primary: true, render: (l) => <RowLink href={`/products/${l.productId}`}>{l.product.sku} · {l.product.name}</RowLink> },
          { label: "Lot", render: (l) => l.lotCode ?? "—" },
          { label: "Receipt", render: (l) => (l.receiptLine ? <RowLink href={`/purchases/${l.receiptLine.receiptId}`}>{l.receiptLine.receipt.number}</RowLink> : "Opening") },
          { label: "Received", render: (l) => fmtDate(l.receivedAt) },
          { label: "In", num: true, render: (l) => qty(l.qtyIn) },
          { label: "Consumed", num: true, render: (l) => qty(l.qtyIn.minus(l.qtyRemaining)) },
          { label: "Remaining", num: true, render: (l) => qty(l.qtyRemaining) },
          ...(showCost ? [{ label: "Unit cost", num: true, render: (l: (typeof layers)[number]) => money(l.unitCost) }] : []),
          { label: "Bucket", render: (l) => <Badge tone={l.bucket === "SALEABLE" ? "ok" : "warn"}>{l.bucket.toLowerCase().replace("_", " ")}</Badge> },
        ]}
      />
    </div>
  );
}
