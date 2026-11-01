import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { ClaimForm } from "../ClaimForm";

export const metadata = { title: "Supplier return" };

export default async function NewClaim() {
  const user = await requirePermission("purchases.claims");
  const suppliers = await db.contact.findMany({ where: { isSupplier: true, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <div style={{ maxWidth: 900 }}>
      <PageHead eyebrow={`Purchases / ${user.location?.name ?? ""}`} title="Return goods to supplier" />
      <ClaimForm suppliers={suppliers} />
    </div>
  );
}
