import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, fmtDate, fmtDateTime } from "@/lib/money";
import { PageHead, DataTable } from "@/components/ui";
import { ExpensePaymentForm } from "../ExpenseForm";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const r = await db.expense.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: r?.number ?? "Not found" };
}

export default async function ExpenseDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("expenses.view");
  const e = await db.expense.findUnique({ where: { id: (await params).id }, include: { category: true, contact: true, createdBy: true, location: true, payments: { include: { account: true } } } });
  if (!e) notFound();
  const total = D(e.amount).plus(e.tax);
  const due = total.minus(e.paid);
  const accounts = can(user, "expenses.manage") && due.gt(0)
    ? await db.account.findMany({ where: { active: true, type: { not: "OWNER_COLLECTION" } }, orderBy: { name: "asc" }, select: { id: true, name: true } })
    : [];
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <PageHead eyebrow={`Expenses / ${e.location.name}`} title={e.number} />
      <div className="stats">
        <div className="stat">Total<strong>{money(total)}</strong>{D(e.tax).gt(0) ? `incl. tax ${money(e.tax)}` : "No tax"}</div>
        <div className="stat">Paid<strong>{money(e.paid)}</strong>{e.payments.length} payment(s)</div>
        <div className="stat">Due<strong style={{ color: due.gt(0) ? "var(--err)" : undefined }}>{money(due)}</strong>{e.category.name}</div>
        <div className="stat">Date<strong>{fmtDate(e.expenseDate)}</strong>{e.createdBy.fullName}</div>
      </div>
      {(e.description || e.contact) && <p>{e.description}{e.contact ? ` · ${e.contact.name}` : ""}</p>}
      <DataTable rows={e.payments} rowKey={(p) => p.id} empty="No payments yet."
        columns={[
          { label: "Payment", primary: true, render: (p) => p.number },
          { label: "Date", render: (p) => fmtDateTime(p.paidAt) },
          { label: "Method", render: (p) => p.method.replace("_", " ").toLowerCase() + (p.registerId ? " · from register" : "") },
          { label: "Account", render: (p) => p.account?.name ?? "—" },
          { label: "Amount", num: true, render: (p) => money(p.amount) },
        ]} />
      {accounts.length > 0 && <ExpensePaymentForm expenseId={e.id} due={Number(due)} accounts={accounts} />}
    </div>
  );
}
