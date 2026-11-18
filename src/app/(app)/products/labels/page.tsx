import Link from "next/link";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { getLabelTemplates } from "@/lib/settings";
import { PageHead } from "@/components/ui";
import { LabelPrinter, type GrnRow } from "./LabelPrinter";

export const metadata = { title: "Print labels" };

export default async function Labels({ searchParams }: { searchParams: Promise<{ grn?: string }> }) {
  const user = await requirePermission("products.view");
  const { grn: grnId } = await searchParams;
  const [templates, business, grn] = await Promise.all([
    getLabelTemplates(),
    db.business.findFirstOrThrow(),
    grnId ? db.goodsReceipt.findUnique({ where: { id: grnId }, include: { lines: { include: { product: true, costLayer: true } } } }) : null,
  ]);
  // Opened from a GRN: one row per received item, copies preset to what is not printed yet (staff can change it).
  const grnRows: GrnRow[] = (grn?.lines ?? []).filter((l) => l.qtyAccepted.gt(0)).map((l) => {
    const received = Math.floor(Number(l.qtyAccepted));
    return {
      lineId: l.id, lot: l.lotCode ?? "", received, printed: l.labelsPrinted,
      inStock: l.costLayer ? Math.floor(Number(l.costLayer.qtyRemaining)) : null,
      product: {
        id: l.product.id, sku: l.product.sku, barcode: l.product.barcode, name: l.product.name, price: l.product.sellPrice.toFixed(2),
        minPrice: null, cost: null, available: null, lot: l.lotCode, tracked: l.product.trackDevices, offer: null, tierPrices: {}, zeroUnverified: [],
      },
    };
  });
  return (
    <div>
      <div className="label-controls">
        <PageHead
          eyebrow={grn ? `Purchases / ${grn.number}` : "Products"}
          title={grn ? `Barcodes for ${grn.number}` : "Print stock labels"}
          actions={<>{grn && <Link className="btn" href={`/purchases/${grn.id}`}>Back to GRN</Link>}{can(user, "settings.manage") && <Link className="btn" href="/settings/labels">Label sizes</Link>}</>}
        />
      </div>
      <LabelPrinter key={grn?.id ?? "free"} templates={templates} business={business.name} canManage={can(user, "settings.manage")} grnRows={grnRows} />
    </div>
  );
}
