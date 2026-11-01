"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitSettlement } from "./actions";

type Line = { id: string; name: string; lot: string | null; qty: number; unitCost: number; device: string | null };
const fmt = (v: number) => v.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function SettleForm({ claimId, claimValue, lines, accounts }: { claimId: string; claimValue: number; lines: Line[]; accounts: { id: string; name: string }[] }) {
  const router = useRouter();
  const [credit, setCredit] = useState("");
  const [refund, setRefund] = useState({ amount: "", method: "BANK_TRANSFER", accountId: "", reference: "" });
  const [rows, setRows] = useState(() => Object.fromEntries(lines.map((l) => [l.id, { replaced: "0", rejected: "0", rejectedTo: "SUPPLIER_HOLD" }])));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (id: string, patch: Partial<(typeof rows)[string]>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  const replacedValue = lines.reduce((a, l) => a + (Number(rows[l.id].replaced) || 0) * l.unitCost, 0);
  const backValue = lines.reduce((a, l) => a + (rows[l.id].rejectedTo === "SUPPLIER_HOLD" ? (Number(rows[l.id].rejected) || 0) * l.unitCost : 0), 0);
  const loss = claimValue - (Number(credit) || 0) - (Number(refund.amount) || 0) - replacedValue - backValue;

  return (
    <section className="panel stack">
      <h2 style={{ margin: 0 }}>Record the supplier&apos;s response</h2>
      {lines.map((l) => (
        <div key={l.id} className="stack" style={{ gap: 8, borderTop: "1px solid var(--rule)", paddingTop: 10 }}>
          <strong style={{ fontWeight: 500 }}>{l.name}<span className="muted small"> · {l.device ? `IMEI ${l.device}` : `lot ${l.lot ?? "—"}`} · sent {l.qty}</span></strong>
          <div className="grid3">
            <label className="field"><span>Replaced (new stock)</span><input type="number" min="0" max={l.qty} step="any" inputMode="decimal" disabled={!!l.device} value={rows[l.id].replaced} onChange={(e) => set(l.id, { replaced: e.target.value })} /></label>
            <label className="field"><span>Rejected / sent back to us</span><input type="number" min="0" max={l.qty} step="any" inputMode="decimal" value={rows[l.id].rejected} onChange={(e) => set(l.id, { rejected: e.target.value })} /></label>
            <label className="field"><span>Rejected goods</span>
              <select value={rows[l.id].rejectedTo} onChange={(e) => set(l.id, { rejectedTo: e.target.value })}><option value="SUPPLIER_HOLD">Back on supplier hold</option><option value="WRITTEN_OFF">Write off</option></select>
            </label>
          </div>
        </div>
      ))}
      <div className="grid2" style={{ borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
        <label className="field"><span>Credit note from supplier (reduces what we owe)</span><input value={credit} onChange={(e) => setCredit(e.target.value)} inputMode="decimal" placeholder="0.00" /></label>
        <label className="field"><span>Money refunded to us</span><input value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} inputMode="decimal" placeholder="0.00" /></label>
        {Number(refund.amount) > 0 && <>
          <label className="field"><span>Refund received by</span>
            <select value={refund.method} onChange={(e) => setRefund({ ...refund, method: e.target.value })}><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash (into my register)</option><option value="CHEQUE">Cheque</option><option value="OTHER">Other</option></select>
          </label>
          {refund.method !== "CASH" && <label className="field"><span>Into account</span><select value={refund.accountId} onChange={(e) => setRefund({ ...refund, accountId: e.target.value })}><option value="">Select…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
        </>}
      </div>
      <div>
        <div className="totalrow"><span>Original cost sent</span><strong>{fmt(claimValue)}</strong></div>
        <div className="totalrow"><span>Recovered (credit + refund + replacements + returned to hold)</span><strong>{fmt(claimValue - loss)}</strong></div>
        <div className="totalrow grand"><span>{loss >= 0 ? "Loss on this claim" : "Gain on this claim"}</span><strong style={{ color: loss > 0 ? "var(--err)" : "var(--ok)" }}>{fmt(Math.abs(loss))}</strong></div>
      </div>
      {error && <p className="note note-err" role="alert">{error}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}>
        <button className="btn btn-primary" disabled={pending} onClick={() => start(async () => {
          setError(null);
          const r = await submitSettlement({
            claimId, creditAmount: Number(credit) || 0,
            refund: Number(refund.amount) > 0 ? { amount: refund.amount, method: refund.method, accountId: refund.accountId || null, reference: refund.reference || null } : null,
            lines: lines.map((l) => ({ lineId: l.id, qtyReplaced: Number(rows[l.id].replaced) || 0, qtyRejected: Number(rows[l.id].rejected) || 0, rejectedTo: rows[l.id].rejectedTo })),
          });
          if (r.error) setError(r.error); else router.refresh();
        })}>{pending ? "Saving…" : "Settle claim"}</button>
      </div>
    </section>
  );
}
