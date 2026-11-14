"use client";

import { useActionState, useState } from "react";
import { openRegister, closeRegister, moveCash } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

const fmt = (v: number) => v.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v));

export function OpenRegisterForm({ expectedOpening }: { expectedOpening: number | null }) {
  const [state, action] = useActionState(openRegister, undefined);
  const [value, setValue] = useState(expectedOpening != null ? String(expectedOpening) : "");
  const diff = expectedOpening != null && value !== "" ? Number(value) - expectedOpening : 0;
  return (
    <form action={action} className="panel stack" style={{ maxWidth: 460 }}>
      <h2 style={{ margin: 0 }}>Open cash register</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Count the cash in the drawer before the first sale. {expectedOpening != null ? <>The last close left <strong>Rs. {fmt(expectedOpening)}</strong> in the drawer.</> : "This is the first opening at this shop."}
      </p>
      <label className="field"><span>Cash counted in drawer (Rs.)</span>
        <input name="openingCash" type="number" step="0.01" min="0" inputMode="decimal" required autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      {diff !== 0 && (
        <>
          <p className="note note-err" style={{ margin: 0 }}>That is Rs. {signed(diff)} compared with what was left at the last close.</p>
          <label className="field"><span>Why is it different? (required)</span><textarea name="openingNote" required /></label>
        </>
      )}
      {state?.error && <p className="note note-err">{state.error}</p>}
      <SubmitButton pendingText="Opening…">Open register</SubmitButton>
    </form>
  );
}

export function CashMoveForm({ reasons }: { reasons: { value: string; label: string; direction: "IN" | "OUT" }[] }) {
  const [state, action] = useActionState(moveCash, undefined);
  const [dir, setDir] = useState<"OUT" | "IN">("OUT");
  const list = reasons.filter((r) => r.direction === dir);
  return (
    <form action={action} className="panel stack" id="move">
      <h2 style={{ margin: 0 }}>Cash in / out</h2>
      <p className="small muted" style={{ margin: 0 }}>Use this when cash leaves or enters the drawer without a sale, e.g. the owner takes cash. Pay expenses from Expenses.</p>
      <div className="row" role="radiogroup" aria-label="Direction">
        <button type="button" className={"btn btn-sm" + (dir === "OUT" ? " btn-primary" : "")} aria-pressed={dir === "OUT"} onClick={() => setDir("OUT")}>Take cash out</button>
        <button type="button" className={"btn btn-sm" + (dir === "IN" ? " btn-primary" : "")} aria-pressed={dir === "IN"} onClick={() => setDir("IN")}>Put cash in</button>
      </div>
      <div className="grid2">
        <label className="field"><span>Reason</span>
          <select name="reason" key={dir} defaultValue={list[0]?.value}>
            {list.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <label className="field"><span>Amount (Rs.)</span><input name="amount" type="number" step="0.01" min="0.01" inputMode="decimal" required /></label>
      </div>
      <label className="field"><span>Note</span><input name="note" placeholder="Who took it, what for…" /></label>
      {state?.error && <p className="note note-err" style={{ margin: 0 }}>{state.error}</p>}
      {state?.ok && <p className="note note-ok" style={{ margin: 0 }}>{state.ok}</p>}
      <div><SubmitButton pendingText="Saving…">{dir === "OUT" ? "Record cash out" : "Record cash in"}</SubmitButton></div>
    </form>
  );
}

export function CloseRegisterForm({ registerId, expected, denominations, varianceReasons }: {
  registerId: string; expected: number; denominations: number[]; varianceReasons: { value: string; label: string }[];
}) {
  const [state, action] = useActionState(closeRegister, undefined);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [left, setLeft] = useState<string>("");
  const counted = denominations.reduce((a, d) => a + d * (Number(counts[d]) || 0), 0);
  const variance = Math.round((counted - expected) * 100) / 100;
  const leftNum = left === "" ? counted : Number(left);
  const handover = Math.max(0, Math.round((counted - leftNum) * 100) / 100);
  return (
    <form action={action} className="panel stack" id="close">
      <input type="hidden" name="registerId" value={registerId} />
      <h2 style={{ margin: 0 }}>Count cash and close</h2>
      <p className="small muted" style={{ margin: 0 }}>Count every note and coin in the drawer.</p>
      <div className="grid3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}>
        {denominations.map((d) => (
          <label key={d} className="field"><span>Rs. {d.toLocaleString()} ×</span>
            <input name={`d${d}`} type="number" min="0" step="1" inputMode="numeric" value={counts[d] ?? ""} onChange={(e) => setCounts({ ...counts, [d]: e.target.value })} />
          </label>
        ))}
      </div>
      <div>
        <div className="totalrow"><span>System says the drawer should have</span><strong>{fmt(expected)}</strong></div>
        <div className="totalrow"><span>Counted in the drawer</span><strong>{fmt(counted)}</strong></div>
        <div className="totalrow grand"><span>{variance === 0 ? "Balanced" : variance > 0 ? "Extra cash" : "Short"}</span><strong style={{ color: variance === 0 ? "var(--ok)" : "var(--err)" }}>{signed(variance)}</strong></div>
      </div>
      {variance !== 0 && (
        <div className="grid2">
          <label className="field"><span>Reason for the difference (required)</span>
            <select name="varianceReason" required defaultValue="">
              <option value="" disabled>Choose…</option>
              {varianceReasons.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          <label className="field"><span>Note (required)</span><input name="notes" required placeholder="What happened?" /></label>
        </div>
      )}
      {variance === 0 && <label className="field"><span>Note (optional)</span><input name="notes" /></label>}
      <h3 style={{ margin: "6px 0 0" }}>Hand over</h3>
      <div className="grid2">
        <label className="field"><span>Leave in drawer for tomorrow (Rs.)</span>
          <input name="cashLeft" type="number" step="0.01" min="0" inputMode="decimal" placeholder={fmt(counted)} value={left} onChange={(e) => setLeft(e.target.value)} />
        </label>
        {handover > 0 && (
          <label className="field"><span>Rs. {fmt(handover)} taken out goes to</span>
            <select name="handoverReason" defaultValue="OWNER_TOOK">
              <option value="OWNER_TOOK">Owner</option>
              <option value="BANK_DEPOSIT">Bank deposit</option>
            </select>
          </label>
        )}
      </div>
      {state?.error && <p className="note note-err">{state.error}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}><SubmitButton pendingText="Closing…">Close register</SubmitButton></div>
    </form>
  );
}
