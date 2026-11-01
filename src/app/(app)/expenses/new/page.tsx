import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { ExpenseForm } from "../ExpenseForm";

export const metadata = { title: "New expense" };

export default async function NewExpense() {
  const user = await requirePermission("expenses.manage");
  const [categories, accounts, contacts] = await Promise.all([
    db.expenseCategory.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.account.findMany({ where: { active: true, type: { not: "OWNER_COLLECTION" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.contact.findMany({ where: { active: true, isSupplier: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <div style={{ maxWidth: 820 }}>
      <PageHead eyebrow={`Expenses / ${user.location?.name ?? ""}`} title="New expense" />
      <ExpenseForm categories={categories} accounts={accounts} contacts={contacts} />
    </div>
  );
}
