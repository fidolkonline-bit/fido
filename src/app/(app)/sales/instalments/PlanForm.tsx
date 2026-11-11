"use client";

import { useActionState, useMemo, useState } from "react";
import { newPlan } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { dueDates, splitAmount, type Frequency } from "@/lib/instalment-rules";

export function PlanForm({ saleId, due, defaultFirst }: { saleId: string; due: number; defaultFirst: string }) {
  const [state, action] = useActionState(newPlan, undefined);
  const [count, setCount] = useState(3);
  const [frequency, setFrequency] = useState<Frequency>("MONTHLY");
  const [first, setFirst] = useState(defaultFirst);
  const preview = useMemo(() => {
    if (!(count >= 2 && count <= 36) || !first) return [];
    const amounts = splitAmount(due, count);
    return dueDates(new Date(`${first}T09:00:00+05:30`), count, frequency).map((d, i) => ({ d, amount: amounts[i] }));
  }, [count, frequency, first, due]);
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { timeZone: "Asia/Colombo", day: "2-digit", month: "short", year: "numeric" });
  return (
    <form action={action} className="panel stack">
      <input type="hidden" name="saleId" value={saleId} />
      <div className="grid3">
        <label className="field"><span>Number of instalments</span><input name="count" type="number" min={2} max={36} value={count} onChange={(e) => setCount(Number(e.target.value))} inputMode="numeric" /></label>
        <label className="field"><span>Every</span>
          <select name="frequency" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}><option value="WEEKLY">Week</option><option value="FORTNIGHTLY">Two weeks</option><option value="MONTHLY">Month</option></select>
        </label>
        <label className="field"><span>First instalment on</span><input name="firstDueAt" type="date" value={first} onChange={(e) => setFirst(e.target.value)} required /></label>
      </div>
      {preview.length > 0 && (
        <div className="small" style={{ fontVariantNumeric: "tabular-nums" }}>
          {preview.map((p, i) => <div key={i} className="totalrow"><span>{i + 1}. {fmt(p.d)}</span><strong>{p.amount.toLocaleString("en-LK", { minimumFractionDigits: 2 })}</strong></div>)}
        </div>
      )}
      <h3 style={{ margin: 0 }}>Guarantor (optional)</h3>
      <div className="grid3">
        <label className="field"><span>Name</span><input name="guarantorName" /></label>
        <label className="field"><span>Mobile</span><input name="guarantorPhone" type="tel" inputMode="tel" /></label>
        <label className="field"><span>NIC</span><input name="guarantorId" /></label>
      </div>
      <label className="field"><span>Notes</span><input name="notes" /></label>
      {state?.error && <p className="note note-err">{state.error}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}><SubmitButton>Create plan</SubmitButton></div>
    </form>
  );
}
