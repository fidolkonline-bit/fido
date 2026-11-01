import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { ProductForm } from "../../ProductForm";
import { catalogOptions } from "../../masters";

export const metadata = { title: "Edit product" };

export default async function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("products.manage");
  const p = await db.product.findUnique({ where: { id: (await params).id } });
  if (!p) notFound();
  const [opts, groups] = await Promise.all([catalogOptions(), db.priceGroup.findMany({ orderBy: [{ active: "desc" }, { sortOrder: "asc" }], include: { prices: { where: { productId: p.id } } } })]);
  // Inactive tiers are shown only where this product still has a price in them.
  const tiers = groups.filter((g) => g.active || g.prices.length).map((g) => ({ id: g.id, name: g.name, active: g.active, price: g.prices[0]?.price.toString() ?? null, zeroConfirmed: g.prices[0]?.zeroConfirmed ?? false }));
  return (
    <div style={{ maxWidth: 860 }}>
      <PageHead eyebrow={`Products / ${p.sku}`} title={`Edit ${p.name}`} />
      <ProductForm
        {...opts}
        showCost={can(user, "cost.view")}
        tiers={tiers}
        canPrice={can(user, "pricing.manage")}
        product={{
          ...p, sellPrice: p.sellPrice.toString(), minSellPrice: p.minSellPrice?.toString() ?? null,
          defaultCost: p.defaultCost.toString(), alertQty: p.alertQty.toString(),
        }}
      />
    </div>
  );
}
