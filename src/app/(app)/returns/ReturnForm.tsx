"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitReturn } from "./actions";

type Device = { id: string; label: string };
type Line = { id: string; name: string; sku: string; sold: number; remaining: number; unitValue: number; remainingValue: number; tracked: boolean; devices: Device[] };
const DISP: [string, string][] = [
  ["SALEABLE", "Back to saleable stock"],
  ["INSPECTION", "Inspection hold"],
  ["SUPPLIER_HOLD", "Supplier recovery hold"],
  ["WRITTEN_OFF", "Wastage / write-off"],
];
const fmt = (v: number) => v.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (v: number) => Math.round(v * 100) / 100;

export function ReturnForm({ saleId, saleNumber, lines, due, hasCustomer, customerName, accounts }: {
  saleId: string; saleNumber: string; lines: Line[]; due: number; hasCustomer: boolean; customerName: string | null;
  accounts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [rows, setRows] = useState(() => Object.fromEntries(lines.map((l) => [l.id, { qty: 0, disposition: "SALEABLE", condition: "", devices: [] as string[] }])));
  const [reason, setReason] = useState("");
  const [settlement, setSettlement] = useState<"REFUND" | "STORE_CREDIT">(hasCustomer ? "STORE_CREDIT" : "REFUND");
  const [refund, setRefund] = useState({ method: "CASH", accountId: "", reference: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const set = (id: string, patch: Partial<(typeof rows)[string]>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  // Mirrors the server: the last units take whatever value is left, so rounding never over-refunds.
  const value = useMemo(() => round2(lines.reduce((a, l) => {
    const q = rows[l.id].qty;
    return a + (q <= 0 ? 0 : q === l.remaining ? l.remainingValue : round2(l.unitValue * q));
  }, 0)), [rows, lines]);
  const offset = Math.min(Math.max(due, 0), value);
  const excess = round2(value - offset);
  const selected = lines.filter((l) => rows[l.id].qty > 0);

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await submitReturn({
        idempotencyKey: key, saleId, reason: reason || null, settlement,
        refund: settlement === "REFUND" ? { method: refund.method, accountId: refund.accountId || null, reference: refund.reference || null } : null,
        lines: selected.map((l) => ({ saleLineId: l.id, qty: rows[l.id].qty, disposition: rows[l.id].disposition, condition: rows[l.id].condition || null, deviceIds: rows[l.id].devices })),
      });
      if (r.error) setError(r.error);
      else if (r.id) router.push(`/returns/${r.id}`);
    });
  };

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>1 · Items coming back from {saleNumber}</h2>
        {lines.map((l) => {
          const row = rows[l.id];
          return (
            <div key={l.id} className="stack" style={{ gap: 8, borderTop: "1px solid var(--rule)", paddingTop: 12, opacity: l.remaining <= 0 ? 0.55 : 1 }}>
              <div className="row">
                <strong style={{ fontWeight: 500 }}>{l.name}</strong><span className="muted small">{l.sku}</span><div className="spacer" />
                <span className="small muted">Sold {l.sold} · returnable {l.remaining} · {fmt(l.unitValue)} each</span>
              </div>
              {l.remaining > 0 && (l.tracked ? (
                <div className="row">
                  {l.devices.map((d) => (
                    <label key={d.id} className="check small" style={{ fontVariantNumeric: "tabular-nums" }}>
                      <input type="checkbox" checked={row.devices.includes(d.id)} onChange={(e) => {
                        const devices = e.target.checked ? [...row.devices, d.id] : row.devices.filter((x) => x !== d.id);
                        set(l.id, { devices, qty: devices.length });
                      }} /> IMEI {d.label}
                    </label>
                  ))}
                </div>
              ) : (
                <label className="field" style={{ maxWidth: 160 }}><span>Return qty</span>
                  <input type="number" min={0} max={l.remaining} step="any" inputMode="decimal" value={row.qty || ""} placeholder="0"
                    onChange={(e) => set(l.id, { qty: Math.min(Math.max(Number(e.target.value) || 0, 0), l.remaining) })} />
                </label>
              ))}
              {row.qty > 0 && (
                <div className="grid2">
                  <label className="field"><span>Item goes to</span>
                    <select value={row.disposition} onChange={(e) => set(l.id, { disposition: e.target.value })}>{DISP.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
                  </label>
                  <label className="field"><span>Condition / fault</span><input value={row.condition} onChange={(e) => set(l.id, { condition: e.target.value })} placeholder="e.g. not charging, box opened" /></label>
                </div>
              )}
            </div>
          );
        })}
        <label className="field"><span>Reason for return</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>2 · Customer settlement</h2>
        <div className="row" style={{ gap: 18 }}>
          <label className="check"><input type="radio" name="settle" checked={settlement === "REFUND"} onChange={() => setSettlement("REFUND")} /> Refund money</label>
          <label className="check" style={{ opacity: hasCustomer ? 1 : 0.5 }}><input type="radio" name="settle" disabled={!hasCustomer} checked={settlement === "STORE_CREDIT"} onChange={() => setSettlement("STORE_CREDIT")} /> Store credit / exchange{!hasCustomer && " (needs a customer)"}</label>
        </div>
        {settlement === "REFUND" && excess > 0 && (
          <div className="grid3">
            <label className="field"><span>Refund by</span>
              <select value={refund.method} onChange={(e) => setRefund({ ...refund, method: e.target.value })}>
                <option value="CASH">Cash from register</option><option value="CARD">Card reversal</option><option value="BANK_TRANSFER">Bank transfer</option><option value="OTHER">Other</option>
              </select>
            </label>
            {refund.method !== "CASH" && (
              <label className="field"><span>From account</span>
                <select value={refund.accountId} onChange={(e) => setRefund({ ...refund, accountId: e.target.value })}><option value="">Default account</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              </label>
            )}
            <label className="field"><span>Reference</span><input value={refund.reference} onChange={(e) => setRefund({ ...refund, reference: e.target.value })} /></label>
          </div>
        )}
      </section>

      <section className="panel stack" style={{ gap: 0 }}>
        <h2>3 · Review</h2>
        <div className="totalrow"><span>Value of returned items</span><strong>{fmt(value)}</strong></div>
        {due > 0 && <div className="totalrow"><span>Cancels unpaid balance on {saleNumber}</span><strong>−{fmt(offset)}</strong></div>}
        <div className="totalrow grand"><span>{excess <= 0 ? "Nothing to pay out" : settlement === "REFUND" ? "Refund to customer" : `Store credit for ${customerName}`}</span><strong>Rs. {fmt(excess)}</strong></div>
        <p className="small muted" style={{ marginTop: 10 }}>
          Stock: {selected.length ? selected.map((l) => `${l.name} × ${rows[l.id].qty} → ${DISP.find(([v]) => v === rows[l.id].disposition)?.[1].toLowerCase()}`).join("; ") : "nothing selected"}.
          {" "}Commission on returned items is reversed. Damaged items never become available for sale.
        </p>
        {error && <p className="note note-err" role="alert">{error}</p>}
        <div className="form-actions"><button className="btn btn-primary" disabled={pending || selected.length === 0} onClick={submit}>{pending ? "Posting…" : "Complete return"}</button></div>
      </section>
    </div>
  );
}
