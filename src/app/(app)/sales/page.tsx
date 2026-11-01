import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, fmtDateTime, colomboDayStart } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge } from "@/components/ui";

export const metadata = { title: "All sales" };

export default async function Sales({ searchParams }: { searchParams: Promise<{ q?: string; pay?: string; range?: string }> }) {
  const user = await requirePermission("sales.view");
  const { q, pay, range = "30" } = await searchParams;
  const since = range === "today" ? colomboDayStart() : range === "all" ? undefined : new Date(Date.now() - Number(range) * 86_400_000);
  const where: Prisma.SaleWhereInput = {
    stage: "FINAL",
    ...(user.location ? { locationId: user.location.id } : {}),
    ...(since ? { soldAt: { gte: since } } : {}),
    ...(pay === "due" ? { paymentState: { not: "PAID" } } : pay === "paid" ? { paymentState: "PAID" } : {}),
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }, { customer: { phone: { contains: q } } }] } : {}),
  };
  const [sales, agg] = await Promise.all([
    db.sale.findMany({ where, orderBy: { soldAt: "desc" }, take: 100, include: { customer: true, createdBy: true } }),
    db.sale.aggregate({ where, _sum: { total: true, paid: true, credited: true }, _count: true }),
  ]);

  return (
    <div>
      <PageHead eyebrow={`Sell / ${user.location?.name ?? ""}`} title="All sales" actions={can(user, "sales.create") && <Link className="btn btn-primary" href="/pos">New sale</Link>} />
      <form className="toolbar" role="search">
        <input name="q" defaultValue={q} placeholder="Invoice, customer name or mobile" aria-label="Search sales" />
        <select name="range" defaultValue={range} aria-label="Period">
          <option value="today">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All time</option>
        </select>
        <select name="pay" defaultValue={pay ?? ""} aria-label="Payment state"><option value="">Any payment</option><option value="due">Due / part paid</option><option value="paid">Paid</option></select>
        <button className="btn">Filter</button>
      </form>
      <DataTable
        rows={sales}
        rowKey={(s) => s.id}
        empty="No sales match these filters."
        columns={[
          { label: "Invoice", primary: true, render: (s) => <RowLink href={`/sales/${s.id}`}>{s.number}</RowLink> },
          { label: "Date", render: (s) => fmtDateTime(s.soldAt) },
          { label: "Customer", render: (s) => s.customer?.name ?? "Walk-in" },
          { label: "Staff", render: (s) => s.createdBy.fullName },
          { label: "Total", num: true, render: (s) => money(s.total) },
          { label: "Paid", num: true, render: (s) => money(s.paid) },
          { label: "Returned", num: true, render: (s) => (D(s.credited).gt(0) ? money(s.credited) : "—") },
          { label: "Due", num: true, render: (s) => { const d = D(s.total).minus(s.paid).minus(s.credited); return d.gt(0) ? <span style={{ color: "var(--err)" }}>{money(d)}</span> : "—"; } },
          { label: "Payment", render: (s) => <Badge tone={s.paymentState === "PAID" ? "ok" : "warn"}>{s.paymentState === "PAID" ? "Paid" : s.paymentState === "PARTIAL" ? "Part paid" : "Due"}</Badge> },
        ]}
        footer={
          <tr>
            <td data-label="Filtered totals">All filtered ({agg._count})</td><td /><td /><td />
            <td className="num" data-label="Total">{money(agg._sum.total)}</td>
            <td className="num" data-label="Paid">{money(agg._sum.paid)}</td>
            <td className="num" data-label="Returned">{money(agg._sum.credited)}</td>
            <td className="num" data-label="Due">{money(D(agg._sum.total).minus(D(agg._sum.paid)).minus(D(agg._sum.credited)))}</td><td />
          </tr>
        }
      />
      {sales.length === 100 && <p className="small muted">Showing the latest 100 rows; totals cover all {agg._count} filtered sales.</p>}
    </div>
  );
}
