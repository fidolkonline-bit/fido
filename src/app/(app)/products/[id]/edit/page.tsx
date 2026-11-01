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
  const opts = await catalogOptions();
  return (
    <div style={{ maxWidth: 860 }}>
      <PageHead eyebrow={`Products / ${p.sku}`} title={`Edit ${p.name}`} />
      <ProductForm
        {...opts}
        showCost={can(user, "cost.view")}
        product={{
          ...p, sellPrice: p.sellPrice.toString(), minSellPrice: p.minSellPrice?.toString() ?? null,
          defaultCost: p.defaultCost.toString(), alertQty: p.alertQty.toString(),
        }}
      />
    </div>
  );
}
