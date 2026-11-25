import Link from "next/link";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge, Tabs } from "@/components/ui";

export const metadata = { title: "Purchases" };

export default async function Purchases({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const user = await requirePermission("purchases.view");
  const { q, status } = await searchParams;
  const pendingOnly = status === "pending";
  const here = user.location ? { locationId: user.location.id } : {};
  const pendingCount = await db.goodsReceipt.count({ where: { ...here, status: "PENDING_COST" } });
  const receipts = await db.goodsReceipt.findMany({
    where: {
      ...here,
      ...(pendingOnly ? { status: "PENDING_COST" } : {}),
      ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { supplierRef: { contains: q, mode: "insensitive" } }, { supplier: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    },
    orderBy: { receivedAt: "desc" }, take: 100,
    include: { supplier: true, _count: { select: { lines: true } } },
  });
  const showCost = can(user, "cost.view");
  return (
    <div>
      <PageHead
        eyebrow={`Purchases / ${user.location?.name ?? ""}`}
        title="Purchases / GRNs"
        actions={<>
          {can(user, "purchases.quick_receive") && <Link className="btn" href="/purchases/quick">Quick receive</Link>}
          {can(user, "purchases.post") && <Link className="btn btn-primary" href="/purchases/new">Receive goods</Link>}
        </>}
      />
      <Tabs items={[
        { label: "All", href: "/purchases", active: !pendingOnly },
        { label: `Waiting for cost${pendingCount ? ` (${pendingCount})` : ""}`, href: "/purchases?status=pending", active: pendingOnly },
      ]} />
      {pendingOnly && <p className="small muted" style={{ margin: 0 }}>Stock that shop staff received without cost. It is already on sale; open each one to add the cost, supplier and payment.</p>}
      <form className="toolbar" role="search">
        <input name="q" defaultValue={q} placeholder="GRN number, supplier or supplier reference" aria-label="Search purchases" />
        <button className="btn">Search</button>
      </form>
      <DataTable
        rows={receipts}
        rowKey={(r) => r.id}
        empty={pendingOnly ? "Nothing is waiting for cost." : "No goods received yet."}
        columns={[
          { label: "Reference", primary: true, render: (r) => <RowLink href={`/purchases/${r.id}`}>{r.number}</RowLink> },
          { label: "Date", render: (r) => fmtDateTime(r.receivedAt) },
          { label: "Supplier", render: (r) => r.supplier?.name ?? "—" },
          { label: "Supplier ref", render: (r) => r.supplierRef ?? "—" },
          { label: "Lines", num: true, render: (r) => r._count.lines },
          { label: "Receipt", render: (r) => <Badge tone={r.status === "POSTED" ? "ok" : "warn"}>{r.status === "PENDING_COST" ? "waiting for cost" : r.status.toLowerCase()}</Badge> },
          ...(showCost ? [
            { label: "Total", num: true, render: (r: (typeof receipts)[number]) => (r.status === "PENDING_COST" ? "—" : money(r.total)) },
            { label: "Payment", render: (r: (typeof receipts)[number]) => { if (r.status === "PENDING_COST") return <Badge tone="warn">Add cost</Badge>; const due = D(r.total).minus(r.paid); return <Badge tone={due.lte(0) ? "ok" : "warn"}>{due.lte(0) ? "Paid" : r.paid.gt(0) ? `Part paid · ${money(due)} due` : "Due"}</Badge>; } },
          ] : []),
        ]}
      />
    </div>
  );
}
