"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitExpense, submitExpensePayment, addExpenseCategory } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

type Opt = { id: string; name: string };
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

function PaymentFields({ pay, setPay, accounts }: { pay: { amount: string; method: string; accountId: string; reference: string }; setPay: (p: typeof pay) => void; accounts: Opt[] }) {
  return (
    <div className="grid2">
      <label className="field"><span>Amount paid</span><input value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} inputMode="decimal" /></label>
      <label className="field"><span>Method</span>
        <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
          <option value="CASH">Cash (from my register)</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CHEQUE">Cheque</option><option value="CARD">Card</option><option value="OTHER">Other</option>
        </select>
      </label>
      {pay.method !== "CASH" && (
        <label className="field"><span>Paid from account</span>
          <select value={pay.accountId} onChange={(e) => setPay({ ...pay, accountId: e.target.value })}><option value="">Select account…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        </label>
      )}
      <label className="field"><span>Reference</span><input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></label>
    </div>
  );
}

export function ExpenseForm({ categories, accounts, contacts }: { categories: Opt[]; accounts: Opt[]; contacts: Opt[] }) {
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [f, setF] = useState({ categoryId: categories[0]?.id ?? "", expenseDate: today(), amount: "", tax: "", contactId: "", description: "" });
  const [payNow, setPayNow] = useState(true);
  const [pay, setPay] = useState({ amount: "", method: "CASH", accountId: "", reference: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [catState, catAction] = useActionState(addExpenseCategory, undefined);
  const total = (Number(f.amount) || 0) + (Number(f.tax) || 0);

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await submitExpense({
        idempotencyKey: key, ...f, tax: f.tax || 0, contactId: f.contactId || null, description: f.description || null,
        payment: payNow ? { amount: pay.amount || total, method: pay.method, accountId: pay.accountId || null, reference: pay.reference || null } : null,
      });
      if (r.error) setError(r.error);
      else if (r.id) router.push(`/expenses/${r.id}`);
    });
  };

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="grid2">
          <label className="field"><span>Category</span>
            <select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
          <label className="field"><span>Date</span><input type="date" value={f.expenseDate} onChange={(e) => setF({ ...f, expenseDate: e.target.value })} /></label>
          <label className="field"><span>Amount (Rs.)</span><input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} inputMode="decimal" required /></label>
          <label className="field"><span>Tax</span><input value={f.tax} onChange={(e) => setF({ ...f, tax: e.target.value })} inputMode="decimal" placeholder="0.00" /></label>
          <label className="field"><span>Paid to (supplier / contact)</span>
            <select value={f.contactId} onChange={(e) => setF({ ...f, contactId: e.target.value })}><option value="">— None —</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
          <label className="field"><span>Description</span><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} /> Paid now (untick to record as due)</label>
        {payNow && <PaymentFields pay={pay} setPay={setPay} accounts={accounts} />}
        {error && <p className="note note-err" role="alert">{error}</p>}
        <div className="form-actions" style={{ marginTop: 0 }}><button className="btn btn-primary" disabled={pending || !f.amount || !f.categoryId} onClick={submit}>{pending ? "Saving…" : `Save expense · Rs. ${total.toFixed(2)}`}</button></div>
      </section>
      <details className="panel">
        <summary style={{ cursor: "pointer" }}>Add an expense category</summary>
        <form action={catAction} className="row" style={{ marginTop: 10, alignItems: "flex-end" }}>
          <label className="field" style={{ flex: "1 1 200px" }}><span>Category name</span><input name="name" required /></label>
          <SubmitButton pendingText="Adding…">Add</SubmitButton>
          {catState?.error && <p className="error-text" style={{ width: "100%" }}>{catState.error}</p>}
          {catState?.ok && <p className="small" style={{ width: "100%", color: "var(--ok)" }}>{catState.ok} Refresh to select it.</p>}
        </form>
      </details>
    </div>
  );
}

export function ExpensePaymentForm({ expenseId, due, accounts }: { expenseId: string; due: number; accounts: Opt[] }) {
  const router = useRouter();
  const [pay, setPay] = useState({ amount: due.toFixed(2), method: "CASH", accountId: "", reference: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="panel stack">
      <h2 style={{ margin: 0 }}>Record payment</h2>
      <PaymentFields pay={pay} setPay={setPay} accounts={accounts} />
      {error && <p className="note note-err">{error}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}>
        <button className="btn btn-primary" disabled={pending} onClick={() => start(async () => {
          const r = await submitExpensePayment(expenseId, { amount: pay.amount, method: pay.method, accountId: pay.accountId || null, reference: pay.reference || null });
          if (r.error) setError(r.error); else router.refresh();
        })}>{pending ? "Saving…" : "Record payment"}</button>
      </div>
    </section>
  );
}
