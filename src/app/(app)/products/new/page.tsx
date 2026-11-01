import { requirePermission, can } from "@/lib/auth";
import { PageHead } from "@/components/ui";
import { ProductForm } from "../ProductForm";
import { catalogOptions } from "../masters";

export const metadata = { title: "New product" };

export default async function NewProduct() {
  const user = await requirePermission("products.manage");
  const opts = await catalogOptions();
  return (
    <div style={{ maxWidth: 860 }}>
      <PageHead eyebrow="Products" title="New product" />
      <ProductForm {...opts} showCost={can(user, "cost.view")} />
    </div>
  );
}
