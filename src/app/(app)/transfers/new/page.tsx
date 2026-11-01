import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { TransferForm } from "../TransferForm";

export const metadata = { title: "New stock transfer" };

export default async function NewTransfer() {
  const user = await requirePermission("stock.transfer");
  const destinations = await db.location.findMany({ where: { active: true, id: { not: user.location?.id } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <div style={{ maxWidth: 860 }}>
      <PageHead eyebrow={`Stock Transfers / from ${user.location?.name ?? ""}`} title="New stock transfer" />
      {destinations.length === 0 ? <p className="note">There is only one location. Add another under Settings → Business & locations to transfer stock.</p> : <TransferForm destinations={destinations} />}
    </div>
  );
}
