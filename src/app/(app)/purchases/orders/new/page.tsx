import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { OrderForm } from "../OrderForm";

export const metadata = { title: "New purchase order" };

export default async function NewOrder() {
  const user = await requirePermission("purchases.post");
  const suppliers = await db.contact.findMany({ where: { isSupplier: true, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <div style={{ maxWidth: 900 }}>
      <PageHead eyebrow={`Purchases / ${user.location?.name ?? ""}`} title="New purchase order" />
      <OrderForm suppliers={suppliers} />
    </div>
  );
}
