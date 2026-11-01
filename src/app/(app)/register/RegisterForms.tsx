"use client";

import { useActionState, useState } from "react";
import { openRegister, closeRegister } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

const fmt = (v: number) => v.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function OpenRegisterForm() {
  const [state, action] = useActionState(openRegister, undefined);
  return (
    <form action={action} className="panel stack" style={{ maxWidth: 420 }}>
      <h2 style={{ margin: 0 }}>Open register</h2>
      <label className="field"><span>Opening cash in drawer (Rs.)</span><input name="openingCash" type="number" step="0.01" min="0" inputMode="decimal" required autoFocus /></label>
      {state?.error && <p className="note note-err">{state.error}</p>}
      <SubmitButton pendingText="Opening…">Open register</SubmitButton>
    </form>
  );
}

export function CloseRegisterForm({ registerId, expected, denominations }: { registerId: string; expected: number; denominations: number[] }) {
  const [state, action] = useActionState(closeRegister, undefined);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const counted = denominations.reduce((a, d) => a + d * (Number(counts[d]) || 0), 0);
  const variance = counted - expected;
  return (
    <form action={action} className="panel stack">
      <input type="hidden" name="registerId" value={registerId} />
      <h2 style={{ margin: 0 }}>Close register · count cash</h2>
      <div className="grid3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
        {denominations.map((d) => (
          <label key={d} className="field"><span>Rs. {d.toLocaleString()} ×</span>
            <input name={`d${d}`} type="number" min="0" step="1" inputMode="numeric" value={counts[d] ?? ""} onChange={(e) => setCounts({ ...counts, [d]: e.target.value })} />
          </label>
        ))}
      </div>
      <div>
        <div className="totalrow"><span>Expected cash</span><strong>{fmt(expected)}</strong></div>
        <div className="totalrow"><span>Counted cash</span><strong>{fmt(counted)}</strong></div>
        <div className="totalrow grand"><span>Variance</span><strong style={{ color: variance === 0 ? "var(--ok)" : "var(--err)" }}>{variance > 0 ? "+" : ""}{fmt(variance)}</strong></div>
      </div>
      <label className="field"><span>Notes (explain any variance)</span><textarea name="notes" /></label>
      {state?.error && <p className="note note-err">{state.error}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}><SubmitButton pendingText="Closing…">Close register</SubmitButton></div>
    </form>
  );
}
