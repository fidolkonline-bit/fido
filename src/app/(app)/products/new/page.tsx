import { requirePermission, can } from "@/lib/auth";
import { PageHead } from "@/components/ui";
import { ProductForm } from "../ProductForm";
import { catalogOptions } from "../masters";
import { db } from "@/lib/db";

export const metadata = { title: "New product" };

export default async function NewProduct() {
  const user = await requirePermission("products.manage");
  const [opts, groups] = await Promise.all([catalogOptions(), db.priceGroup.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } })]);
  return (
    <div style={{ maxWidth: 860 }}>
      <PageHead eyebrow="Products" title="New product" />
      <ProductForm {...opts} showCost={can(user, "cost.view")} tiers={groups.map((g) => ({ id: g.id, name: g.name, active: true, price: null, zeroConfirmed: false }))} canPrice={can(user, "pricing.manage")} />
    </div>
  );
}
