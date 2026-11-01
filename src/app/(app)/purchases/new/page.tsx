import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { ReceiveForm, type OrderPrefill } from "../ReceiveForm";

export const metadata = { title: "Receive goods" };

export default async function NewReceipt({ searchParams }: { searchParams: Promise<{ order?: string; parcel?: string }> }) {
  const user = await requirePermission("purchases.post");
  const { order: orderId, parcel: parcelId } = await searchParams;
  const parcel = parcelId ? await db.busParcel.findFirst({ where: { id: parcelId, status: { in: ["CHECKED", "EXCEPTION"] }, receiptId: null } }) : null;
  const po = orderId
    ? await db.purchaseOrder.findFirst({ where: { id: orderId, status: { in: ["ORDERED", "PART_RECEIVED"] } }, include: { lines: { include: { product: true } } } })
    : null;
  const order: OrderPrefill | null = po && {
    id: po.id, number: po.number, supplierId: po.supplierId,
    lines: po.lines.filter((l) => l.qtyReceived.lt(l.qtyOrdered)).map((l) => ({
      poLineId: l.id, due: Number(l.qtyOrdered.minus(l.qtyReceived)), unitCost: l.unitCost.toString(),
      product: {
        id: l.product.id, sku: l.product.sku, barcode: l.product.barcode, name: l.product.name, price: l.product.sellPrice.toFixed(2),
        minPrice: null, cost: l.unitCost.toString(), available: null, lot: null, tracked: l.product.trackDevices, offer: null,
      },
    })),
  };
  const [suppliers, accounts] = await Promise.all([
    db.contact.findMany({ where: { isSupplier: true, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.account.findMany({ where: { active: true, type: { not: "OWNER_COLLECTION" } }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }),
  ]);
  return (
    <div style={{ maxWidth: 960 }}>
      <PageHead eyebrow={`Purchases / ${user.location?.name ?? ""}`} title={order ? `Receive against ${order.number}` : "Receive goods / GRN"} />
      {suppliers.length === 0 ? <p className="note">Add a supplier under Contacts → Suppliers first.</p> : <>{parcel && <p className="note">Receiving bus parcel {parcel.number} from {parcel.sender}: {parcel.contents}.{parcel.discrepancy ? ` Problem noted: ${parcel.checkNotes}.` : ""} Enter only what was accepted.</p>}<ReceiveForm suppliers={suppliers} accounts={accounts} order={order} parcelId={parcel?.id ?? null} /></>}
    </div>
  );
}
