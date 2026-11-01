import Link from "next/link";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, fmtDate } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge } from "@/components/ui";

export const metadata = { title: "Expenses" };

export default async function Expenses({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await requirePermission("expenses.view");
  const { days = "30" } = await searchParams;
  const where = { ...(user.location ? { locationId: user.location.id } : {}), expenseDate: { gte: new Date(Date.now() - Number(days) * 86_400_000) } };
  const [rows, agg] = await Promise.all([
    db.expense.findMany({ where, orderBy: { expenseDate: "desc" }, take: 200, include: { category: true, contact: true } }),
    db.expense.aggregate({ where, _sum: { amount: true, tax: true, paid: true }, _count: true }),
  ]);
  const total = D(agg._sum.amount).plus(D(agg._sum.tax));
  return (
    <div>
      <PageHead eyebrow={`Expenses / ${user.location?.name ?? ""}`} title="Expenses" actions={can(user, "expenses.manage") && <Link className="btn btn-primary" href="/expenses/new">New expense</Link>} />
      <form className="toolbar">
        <select name="days" defaultValue={days} aria-label="Period" style={{ flex: "0 1 200px" }}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option></select>
        <button className="btn">Apply</button>
      </form>
      <DataTable rows={rows} rowKey={(e) => e.id} empty="No expenses in this period."
        columns={[
          { label: "Reference", primary: true, render: (e) => <RowLink href={`/expenses/${e.id}`}>{e.number}</RowLink> },
          { label: "Date", render: (e) => fmtDate(e.expenseDate) },
          { label: "Category", render: (e) => e.category.name },
          { label: "Description", render: (e) => e.description ?? e.contact?.name ?? "—" },
          { label: "Total", num: true, render: (e) => money(D(e.amount).plus(e.tax)) },
          { label: "Payment", render: (e) => { const due = D(e.amount).plus(e.tax).minus(e.paid); return <Badge tone={due.lte(0) ? "ok" : "warn"}>{due.lte(0) ? "Paid" : `${money(due)} due`}</Badge>; } },
        ]}
        footer={<tr><td data-label="Period total">All {agg._count} in period</td><td /><td /><td /><td className="num" data-label="Total">{money(total)}</td><td data-label="Due">{money(total.minus(D(agg._sum.paid)))} due</td></tr>} />
    </div>
  );
}
