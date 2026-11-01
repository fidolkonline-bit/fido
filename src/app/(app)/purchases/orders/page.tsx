import Link from "next/link";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, qty, fmtDate } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge, Tabs } from "@/components/ui";
import { PO_STATUS } from "./status";

export const metadata = { title: "Purchase orders" };

export default async function Orders({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const user = await requirePermission("purchases.view");
  const { open = "1" } = await searchParams;
  const orders = await db.purchaseOrder.findMany({
    where: { ...(user.location ? { locationId: user.location.id } : {}), ...(open === "1" ? { status: { in: ["ORDERED", "PART_RECEIVED"] } } : {}) },
    orderBy: { createdAt: "desc" }, take: 100, include: { supplier: true, lines: true },
  });
  return (
    <div>
      <PageHead eyebrow="Purchases" title="Purchase orders" actions={can(user, "purchases.post") && <Link className="btn btn-primary" href="/purchases/orders/new">New order</Link>} />
      <Tabs items={[{ label: "Open", href: "/purchases/orders?open=1", active: open === "1" }, { label: "All", href: "/purchases/orders?open=0", active: open !== "1" }]} />
      <DataTable rows={orders} rowKey={(o) => o.id} empty={open === "1" ? "No open purchase orders." : "No purchase orders yet."}
        columns={[
          { label: "Order", primary: true, render: (o) => <RowLink href={`/purchases/orders/${o.id}`}>{o.number}</RowLink> },
          { label: "Supplier", render: (o) => o.supplier.name },
          { label: "Expected", render: (o) => fmtDate(o.expectedAt) },
          { label: "Ordered", num: true, render: (o) => qty(o.lines.reduce((a, l) => a.plus(l.qtyOrdered), D(0))) },
          { label: "Received", num: true, render: (o) => qty(o.lines.reduce((a, l) => a.plus(l.qtyReceived), D(0))) },
          ...(can(user, "cost.view") ? [{ label: "Value", num: true, render: (o: (typeof orders)[number]) => money(o.total) }] : []),
          { label: "State", render: (o) => <Badge tone={PO_STATUS[o.status]?.[1] ?? "muted"}>{PO_STATUS[o.status]?.[0] ?? o.status}</Badge> },
        ]} />
    </div>
  );
}
