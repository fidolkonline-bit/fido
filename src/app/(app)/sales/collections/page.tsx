import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDateTime, colomboDayStart } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge } from "@/components/ui";

export const metadata = { title: "Debt payments" };

const method = (m: string) => m.replace("_", " ").toLowerCase();

// Receipts for previous debt taken at this location (newest first). Report RP-37 has the full allocation detail.
export default async function Collections({ searchParams }: { searchParams: Promise<{ q?: string; range?: string }> }) {
  const user = await requirePermission("debt.view");
  const { q, range = "30" } = await searchParams;
  const since = range === "today" ? colomboDayStart() : range === "all" ? undefined : new Date(Date.now() - Number(range) * 86_400_000);
  const where: Prisma.DebtCollectionWhereInput = {
    ...(user.location ? { locationId: user.location.id } : {}),
    ...(since ? { paidAt: { gte: since } } : {}),
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }, { customer: { phone: { contains: q } } }] } : {}),
  };
  const rows = await db.debtCollection.findMany({ where, orderBy: { paidAt: "desc" }, take: 100, include: { customer: true, account: true, createdBy: true } });
  return (
    <div>
      <PageHead eyebrow={`Sell / ${user.location?.name ?? ""}`} title="Debt payments" actions={can(user, "sales.create") && <Link className="btn btn-primary" href="/pos">Receive at POS</Link>} />
      <form className="toolbar" role="search">
        <input name="q" defaultValue={q} placeholder="Receipt, customer name or mobile" aria-label="Search debt payments" />
        <select name="range" defaultValue={range} aria-label="Period"><option value="today">Today</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All</option></select>
        <button className="btn">Show</button>
      </form>
      <DataTable rows={rows} rowKey={(r) => r.id} empty="No debt payments in this period."
        columns={[
          { label: "Receipt", primary: true, render: (r) => <RowLink href={`/sales/collections/${r.id}`}>{r.number}</RowLink> },
          { label: "Paid on", render: (r) => fmtDateTime(r.paidAt) },
          { label: "Customer", render: (r) => r.customer.name },
          { label: "Method", render: (r) => `${method(r.method)}${r.account ? ` · ${r.account.name}` : ""}` },
          { label: "By", render: (r) => r.createdBy.fullName },
          { label: "State", render: (r) => <Badge tone={r.state === "POSTED" ? "ok" : "warn"}>{r.state.toLowerCase()}</Badge> },
          { label: "Received", num: true, render: (r) => money(r.received) },
          { label: "Debt left", num: true, render: (r) => money(r.debtAfter) },
        ]} />
    </div>
  );
}
