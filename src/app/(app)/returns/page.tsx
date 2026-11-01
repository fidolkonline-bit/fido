import Link from "next/link";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge } from "@/components/ui";

export const metadata = { title: "Sell returns" };

const SETTLE: Record<string, string> = { REFUND: "Refund", STORE_CREDIT: "Store credit", DEBT_ONLY: "Debt offset" };

export default async function Returns({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePermission("sales.view");
  const { q } = await searchParams;
  const returns = await db.saleReturn.findMany({
    where: {
      ...(user.location ? { locationId: user.location.id } : {}),
      ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { sale: { number: { contains: q, mode: "insensitive" } } }] } : {}),
    },
    orderBy: { createdAt: "desc" }, take: 100,
    include: { sale: { include: { customer: true } }, lines: true, createdBy: true },
  });
  return (
    <div>
      <PageHead eyebrow="Sell" title="Sell Return / Exchange" actions={can(user, "returns.create") && <Link className="btn btn-primary" href="/returns/new">New return</Link>} />
      <form className="toolbar" role="search"><input name="q" defaultValue={q} placeholder="Credit note or original invoice" aria-label="Search returns" /><button className="btn">Search</button></form>
      <DataTable rows={returns} rowKey={(r) => r.id} empty="No returns yet."
        columns={[
          { label: "Credit note", primary: true, render: (r) => <RowLink href={`/returns/${r.id}`}>{r.number}</RowLink> },
          { label: "Original sale", render: (r) => <RowLink href={`/sales/${r.saleId}`}>{r.sale.number}</RowLink> },
          { label: "Date", render: (r) => fmtDateTime(r.createdAt) },
          { label: "Customer", render: (r) => r.sale.customer?.name ?? "Walk-in" },
          { label: "Value", num: true, render: (r) => money(r.totalValue) },
          { label: "Settlement", render: (r) => <Badge tone="ok">{SETTLE[r.settlement] ?? r.settlement}</Badge> },
          { label: "Item destination", render: (r) => [...new Set(r.lines.map((l) => l.disposition.toLowerCase().replace("_", " ")))].join(", ") },
        ]} />
    </div>
  );
}
