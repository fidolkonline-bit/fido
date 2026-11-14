import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { TradeInForm } from "../TradeInForm";

export const metadata = { title: "New trade-in" };

export default async function NewTradeIn() {
  const user = await requirePermission("tradein.create");
  const loc = user.location;
  const [products, accounts, register] = await Promise.all([
    db.product.findMany({ where: { active: true, trackDevices: true, stockManaged: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.account.findMany({ where: { active: true, type: { not: "CASH" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    loc ? db.registerSession.findFirst({ where: { locationId: loc.id, closedAt: null }, select: { id: true } }) : null,
  ]);
  return (
    <div style={{ maxWidth: 900 }}>
      <PageHead eyebrow="Purchases" title="Buy a used phone / trade-in" />
      <TradeInForm products={products} accounts={accounts} registerOpen={!!register} />
    </div>
  );
}
