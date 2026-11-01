"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { searchProducts, type ProductHit } from "../search";
import { submitReceipt } from "./actions";

type Line = { key: string; poLineId?: string; due?: number; product: ProductHit; lotCode: string; qtyReceived: string; qtyRejected: string; unitCost: string; newSellPrice: string; devicesText: string; condition: "NEW" | "USED" };

// One device per line: "IMEI1", "IMEI1, IMEI2", or a serial. Text is kept as typed — leading zeros matter.
function parseDevices(text: string) {
  return text.split(/\n+/).map((row) => row.trim()).filter(Boolean).map((row) => {
    const [a, b] = row.split(/[,\s]+/);
    const isImei = (x?: string) => !!x && /^\d{14,17}$/.test(x);
    return isImei(a) ? { imei1: a, imei2: isImei(b) ? b : null, serial: null } : { imei1: null, imei2: null, serial: row };
  });
}
const n = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmt = (v: number) => v.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type OrderPrefill = { id: string; number: string; supplierId: string; lines: { poLineId: string; due: number; unitCost: string; product: ProductHit }[] };

export function ReceiveForm({ suppliers, accounts, order, parcelId = null }: { suppliers: { id: string; name: string }[]; accounts: { id: string; name: string; type: string }[]; order?: OrderPrefill | null; parcelId?: string | null }) {
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [supplierId, setSupplierId] = useState(order?.supplierId ?? "");
  const [supplierRef, setSupplierRef] = useState("");
  // Receiving against an order starts from the quantities still due; staff adjust to what actually arrived.
  const [lines, setLines] = useState<Line[]>(() => (order?.lines ?? []).map((l) => ({
    key: l.poLineId, poLineId: l.poLineId, due: l.due, product: l.product, lotCode: "", qtyReceived: String(l.due), qtyRejected: "0",
    unitCost: l.unitCost, newSellPrice: "", devicesText: "", condition: "NEW" as const,
  })));
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [payNow, setPayNow] = useState(false);
  const [pay, setPay] = useState({ amount: "", method: "CASH", accountId: "", reference: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const search = (v: string) => {
    setQ(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => setHits(v.trim() ? await searchProducts(v, false) : []), 200);
  };
  const add = (p: ProductHit) => {
    setLines((ls) => [...ls, { key: crypto.randomUUID(), product: p, lotCode: "", qtyReceived: "1", qtyRejected: "0", unitCost: p.cost ?? "0", newSellPrice: "", devicesText: "", condition: "NEW" }]);
    setQ(""); setHits([]);
  };
  const update = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const total = lines.reduce((a, l) => a + (n(l.qtyReceived) - n(l.qtyRejected)) * n(l.unitCost), 0);

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await submitReceipt({
        idempotencyKey: key, supplierId, supplierRef: supplierRef || null, purchaseOrderId: order?.id ?? null, parcelId,
        lines: lines.map((l) => ({
          productId: l.product.id, poLineId: l.poLineId ?? null, lotCode: l.lotCode || null, qtyReceived: l.qtyReceived, qtyRejected: l.qtyRejected || 0,
          unitCost: l.unitCost, newSellPrice: l.newSellPrice === "" ? null : l.newSellPrice,
          condition: l.condition, devices: l.product.tracked ? parseDevices(l.devicesText) : [],
        })),
        payment: payNow && n(pay.amount) > 0 ? { amount: pay.amount, method: pay.method, accountId: pay.accountId || null, reference: pay.reference || null } : null,
      });
      if (r.error) setError(r.error);
      else if (r.id) router.push(`/purchases/${r.id}`);
    });
  };

  return (
    <div className="stack">
      <section className="panel grid2">
        <label className="field"><span>Supplier *</span>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required disabled={!!order}>
            <option value="">Select supplier…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="field"><span>Supplier invoice / reference</span><input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} /></label>
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Items received</h2>
        <div style={{ position: "relative" }}>
          <input value={q} onChange={(e) => search(e.target.value)} placeholder="Scan or search product to add" aria-label="Add product" />
          {hits.length > 0 && (
            <div className="panel" style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 10, padding: 0, maxHeight: 280, overflowY: "auto" }}>
              {hits.map((h) => (
                <button key={h.id} type="button" onClick={() => add(h)} className="btn-ghost" style={{ width: "100%", justifyContent: "space-between", borderRadius: 0, borderBottom: "1px solid var(--rule)" }}>
                  <span>{h.sku} · {h.name}</span><span className="muted small">{h.available ?? "—"} in stock</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {lines.length === 0 && <p className="muted small" style={{ margin: 0 }}>No items yet. Lot codes are free text; the same code may appear on different products.</p>}
        {lines.map((l) => {
          const accepted = n(l.qtyReceived) - n(l.qtyRejected);
          return (
            <div key={l.key} style={{ borderTop: "1px solid var(--rule)", paddingTop: 12 }} className="stack">
              <div className="row"><strong>{l.product.sku} · {l.product.name}</strong>{l.poLineId && <span className="badge badge-muted">{l.due} due on {order?.number}</span>}<div className="spacer" /><button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</button></div>
              <div className="grid3">
                <label className="field"><span>Lot number</span><input value={l.lotCode} onChange={(e) => update(l.key, { lotCode: e.target.value })} /></label>
                <label className="field"><span>Qty received</span><input type="number" min="0" step="any" inputMode="decimal" value={l.qtyReceived} onChange={(e) => update(l.key, { qtyReceived: e.target.value })} /></label>
                <label className="field"><span>Rejected / damaged</span><input type="number" min="0" step="any" inputMode="decimal" value={l.qtyRejected} onChange={(e) => update(l.key, { qtyRejected: e.target.value })} /></label>
                <label className="field"><span>Unit cost</span><input type="number" min="0" step="0.0001" inputMode="decimal" value={l.unitCost} onChange={(e) => update(l.key, { unitCost: e.target.value })} /></label>
                <label className="field"><span>New selling price (optional)</span><input type="number" min="0" step="0.01" inputMode="decimal" placeholder={l.product.price} value={l.newSellPrice} onChange={(e) => update(l.key, { newSellPrice: e.target.value })} /></label>
                {l.product.tracked && (() => {
                  const count = parseDevices(l.devicesText).length;
                  return (
                    <>
                      <label className="field" style={{ gridColumn: "1 / -1" }}>
                        <span>IMEI / serial — one device per line (IMEI 1, IMEI 2) · {count} of {accepted} entered</span>
                        <textarea value={l.devicesText} onChange={(e) => update(l.key, { devicesText: e.target.value })} inputMode="numeric" rows={Math.min(Math.max(accepted, 2), 8)}
                          style={{ fontVariantNumeric: "tabular-nums", borderColor: count !== accepted ? "var(--warn)" : undefined }} placeholder={"356789012345678\n356789012345679, 356789012345680"} />
                      </label>
                      <label className="field"><span>Condition</span>
                        <select value={l.condition} onChange={(e) => update(l.key, { condition: e.target.value as "NEW" | "USED" })}><option value="NEW">New</option><option value="USED">Used</option></select>
                      </label>
                    </>
                  );
                })()}
                <div className="field"><span>Accepted → stock</span><strong style={{ fontSize: 15, color: "var(--ink)", paddingTop: 10 }}>{accepted} × {fmt(n(l.unitCost))} = {fmt(accepted * n(l.unitCost))}</strong></div>
              </div>
            </div>
          );
        })}
      </section>

      <section className="panel stack">
        <div className="totalrow grand"><span>Receipt total (accepted)</span><strong>Rs. {fmt(total)}</strong></div>
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
        <p className="small muted" style={{ margin: 0 }}>Posting adds accepted quantities to stock once. Payment is recorded separately; an unpaid GRN stays due to the supplier.</p>
        {error && <p className="note note-err" role="alert">{error}</p>}
        <div className="form-actions" style={{ marginTop: 0 }}>
          <button className="btn btn-primary" type="button" disabled={pending || !supplierId || lines.length === 0} onClick={submit}>{pending ? "Posting…" : "Post receipt"}</button>
        </div>
      </section>
    </div>
  );
}
