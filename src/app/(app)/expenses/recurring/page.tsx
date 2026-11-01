import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDate } from "@/lib/money";
import { generateRecurringExpenses } from "@/lib/drafts";
import { PageHead, DataTable, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { recurringForm, stopRecurring } from "../../payment-actions";

export const metadata = { title: "Recurring expenses" };

export default async function Recurring() {
  await requirePermission("expenses.manage");
  await generateRecurringExpenses();
  const [rules, categories, contacts] = await Promise.all([
    db.recurringExpense.findMany({ orderBy: [{ active: "desc" }, { nextDate: "asc" }] }),
    db.expenseCategory.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.contact.findMany({ where: { active: true, isSupplier: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  return (
    <div className="stack">
      <PageHead eyebrow="Expenses" title="Recurring expenses" />
      <DataTable rows={rules} rowKey={(r) => r.id} empty="No recurring expenses."
        columns={[
          { label: "Expense", primary: true, render: (r) => r.name },
          { label: "Category", render: (r) => cat.get(r.categoryId) ?? "—" },
          { label: "Amount", num: true, render: (r) => money(r.amount) },
          { label: "Every", render: (r) => r.interval.toLowerCase() },
          { label: "Next", render: (r) => (r.active ? fmtDate(r.nextDate) : "—") },
          { label: "", render: (r) => r.active ? <form action={stopRecurring}><input type="hidden" name="id" value={r.id} /><button className="btn btn-sm">Stop</button></form> : <Badge>Stopped</Badge> },
        ]} />
      <ActionForm action={recurringForm} className="panel stack">
        <h2 style={{ margin: 0 }}>New recurring expense</h2>
        <div className="grid3">
          <label className="field"><span>Name</span><input name="name" required placeholder="Shop rent" /></label>
          <label className="field"><span>Category</span><select name="categoryId">{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="field"><span>Amount</span><input name="amount" inputMode="decimal" required /></label>
          <label className="field"><span>Every</span><select name="interval"><option value="MONTH">Month</option><option value="WEEK">Week</option></select></label>
          <label className="field"><span>First date</span><input type="date" name="nextDate" required /></label>
          <label className="field"><span>End (optional)</span><input type="date" name="endDate" /></label>
          <label className="field"><span>Paid to</span><select name="contactId"><option value="">—</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        </div>
        <p className="small muted" style={{ margin: 0 }}>Each date creates one expense marked as due. Paying it later is a payment, not another expense.</p>
        <div><SubmitButton>Save</SubmitButton></div>
      </ActionForm>
    </div>
  );
}
