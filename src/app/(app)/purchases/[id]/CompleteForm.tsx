"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitCompleteReceipt } from "../actions";
import { SearchSelect } from "@/components/SearchSelect";

export type CompleteLine = {
  id: string; label: string; qty: number; newProduct: boolean; sellPrice: string; lastCost: string | null;
  sold: number; inStock: number; elsewhere: number;
};

const n = (v: string) => (v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : NaN);
const fmt = (v: number) => v.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Owner: add cost (and supplier, payment) to a quick-received GRN. Sales already made from it get this cost too.
export function CompleteForm({ receiptId, lines, suppliers, accounts, categories, supplierId: initialSupplier, notes: initialNotes }: {
  receiptId: string; lines: CompleteLine[]; suppliers: { id: string; name: string }[]; accounts: { id: string; name: string }[];
  categories: { id: string; name: string }[]; supplierId: string | null; notes: string | null;
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(initialSupplier ?? "");
  const [supplierRef, setSupplierRef] = useState("");
  const [rows, setRows] = useState(() => Object.fromEntries(lines.map((l) => [l.id, { unitCost: "", newSellPrice: "", categoryId: "" }])));
  const [payNow, setPayNow] = useState(false);
  const [pay, setPay] = useState({ amount: "", method: "CASH", accountId: "", reference: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const set = (id: string, patch: Partial<(typeof rows)[string]>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  const total = lines.reduce((a, l) => a + l.qty * (n(rows[l.id].unitCost) || 0), 0);
  const missing = lines.some((l) => !(n(rows[l.id].unitCost) >= 0));
  const soldTotal = lines.reduce((a, l) => a + l.sold, 0);

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await submitCompleteReceipt({
        receiptId, supplierId, supplierRef: supplierRef.trim() || null, notes: initialNotes,
        lines: lines.map((l) => ({ lineId: l.id, unitCost: rows[l.id].unitCost, newSellPrice: rows[l.id].newSellPrice === "" ? null : rows[l.id].newSellPrice, categoryId: rows[l.id].categoryId || null })),
        payment: payNow && n(pay.amount) > 0 ? { amount: pay.amount, method: pay.method, accountId: pay.accountId || null, reference: pay.reference || null } : null,
      });
      if (r.error) setError(r.error);
      else router.refresh();
    });
  };

  return (
    <section className="panel stack" aria-labelledby="add-cost">
      <h2 id="add-cost" style={{ margin: 0 }}>Add cost</h2>
      {soldTotal > 0 && <p className="note" style={{ margin: 0 }}>{soldTotal} unit{soldTotal === 1 ? "" : "s"} from this GRN {soldTotal === 1 ? "is" : "are"} already sold. Their profit is updated with the cost you enter here.</p>}
      <div className="grid2">
        <label className="field"><span>Supplier *</span>
          <SearchSelect name="supplierId" label="Supplier" options={suppliers} defaultValue={supplierId} onChange={setSupplierId} placeholder="Search supplier…" noneLabel="Select supplier…" />
        </label>
        <label className="field"><span>Supplier invoice / reference</span><input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} /></label>
      </div>
      {lines.map((l) => {
        const r = rows[l.id];
        const cost = n(r.unitCost);
        const price = r.newSellPrice === "" ? Number(l.sellPrice) : n(r.newSellPrice);
        const margin = price > 0 && cost >= 0 ? ((price - cost) / price) * 100 : null;
        return (
          <div key={l.id} style={{ borderTop: "1px solid var(--rule)", paddingTop: 12 }} className="stack">
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              <strong>{l.label}</strong>
              {l.newProduct && <span className="badge badge-warn">New product</span>}
              <span className="badge badge-muted">{l.qty} received · {l.sold} sold · {l.inStock} in stock{l.elsewhere ? ` · ${l.elsewhere} held / elsewhere` : ""}</span>
            </div>
            <div className="grid3">
              <label className="field"><span>Unit cost *</span>
                <input type="number" min="0" step="0.0001" inputMode="decimal" value={r.unitCost} onChange={(e) => set(l.id, { unitCost: e.target.value })}
                  placeholder={l.lastCost ? `Last: ${fmt(Number(l.lastCost))}` : "Cost per unit"} />
              </label>
              <label className="field"><span>New selling price (optional)</span>
                <input type="number" min="0" step="0.01" inputMode="decimal" value={r.newSellPrice} onChange={(e) => set(l.id, { newSellPrice: e.target.value })} placeholder={fmt(Number(l.sellPrice))} />
              </label>
              {l.newProduct && (
                <label className="field"><span>Category</span>
                  <select value={r.categoryId} onChange={(e) => set(l.id, { categoryId: e.target.value })}>
                    <option value="">No category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div className="small muted">
              {cost >= 0 ? <>Line total Rs. {fmt(l.qty * cost)}</> : "Enter the cost per unit."}
              {margin !== null && <> · Margin at Rs. {fmt(price)}: <strong style={{ color: margin < 0 ? "var(--err)" : undefined }}>{margin.toFixed(1)}%</strong></>}
            </div>
          </div>
        );
      })}
      <div className="totalrow grand"><span>Receipt total</span><strong>Rs. {fmt(total)}</strong></div>
      <label className="check"><input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} /> Record a supplier payment now</label>
      {payNow && (
        <div className="grid2">
          <label className="field"><span>Amount</span><input type="number" min="0" step="0.01" inputMode="decimal" value={pay.amount} placeholder={total.toFixed(2)} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></label>
          <label className="field"><span>Method</span>
            <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
              <option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CHEQUE">Cheque</option><option value="CARD">Card</option><option value="OTHER">Other</option>
            </select>
          </label>
          <label className="field"><span>Paid from account</span>
            <select value={pay.accountId} onChange={(e) => setPay({ ...pay, accountId: e.target.value })}>
              <option value="">Select account…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="field"><span>Reference</span><input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></label>
        </div>
      )}
      {error && <p className="note note-err" role="alert">{error}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}>
        <button className="btn btn-primary" type="button" disabled={pending || !supplierId || missing} onClick={submit}>{pending ? "Saving…" : "Complete GRN"}</button>
      </div>
    </section>
  );
}
