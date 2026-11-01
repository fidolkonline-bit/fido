import { requirePermission } from "@/lib/auth";
import { PageHead } from "@/components/ui";
import { AdjustmentForm } from "../AdjustmentForm";

export const metadata = { title: "New stock adjustment" };

export default async function NewAdjustment() {
  const user = await requirePermission("stock.adjust");
  return (
    <div style={{ maxWidth: 900 }}>
      <PageHead eyebrow={`Stock Adjustment / ${user.location?.name ?? ""}`} title="New stock adjustment" />
      <AdjustmentForm />
    </div>
  );
}
