import Link from "next/link";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge } from "@/components/ui";

export const metadata = { title: "Purchases" };

export default async function Purchases({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePermission("purchases.view");
  const { q } = await searchParams;
  const receipts = await db.goodsReceipt.findMany({
    where: {
      ...(user.location ? { locationId: user.location.id } : {}),
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
        actions={can(user, "purchases.post") && <Link className="btn btn-primary" href="/purchases/new">Receive goods</Link>}
      />
      <form className="toolbar" role="search">
        <input name="q" defaultValue={q} placeholder="GRN number, supplier or supplier reference" aria-label="Search purchases" />
        <button className="btn">Search</button>
      </form>
      <DataTable
        rows={receipts}
        rowKey={(r) => r.id}
        empty="No goods received yet."
        columns={[
          { label: "Reference", primary: true, render: (r) => <RowLink href={`/purchases/${r.id}`}>{r.number}</RowLink> },
          { label: "Date", render: (r) => fmtDateTime(r.receivedAt) },
          { label: "Supplier", render: (r) => r.supplier.name },
          { label: "Supplier ref", render: (r) => r.supplierRef ?? "—" },
          { label: "Lines", num: true, render: (r) => r._count.lines },
          { label: "Receipt", render: (r) => <Badge tone={r.status === "POSTED" ? "ok" : "warn"}>{r.status.toLowerCase()}</Badge> },
          ...(showCost ? [
            { label: "Total", num: true, render: (r: (typeof receipts)[number]) => money(r.total) },
            { label: "Payment", render: (r: (typeof receipts)[number]) => { const due = D(r.total).minus(r.paid); return <Badge tone={due.lte(0) ? "ok" : "warn"}>{due.lte(0) ? "Paid" : r.paid.gt(0) ? `Part paid · ${money(due)} due` : "Due"}</Badge>; } },
          ] : []),
        ]}
      />
    </div>
  );
}
