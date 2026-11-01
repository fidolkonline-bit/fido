"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProductHit } from "../../search";
import { submitOrder } from "./actions";
import { ProductSearch } from "@/components/ProductSearch";

type Line = { key: string; product: ProductHit; qty: string; unitCost: string };
const fmt = (v: number) => v.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function OrderForm({ suppliers }: { suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [supplierId, setSupplierId] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const update = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const total = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0);

  return (
    <div className="stack">
      <section className="panel grid3">
        <label className="field"><span>Supplier *</span>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Select supplier…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </label>
        <label className="field"><span>Expected delivery</span><input type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} /></label>
        <label className="field"><span>Notes</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </section>
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Items to order</h2>
        <ProductSearch onPick={(p) => setLines((ls) => [...ls, { key: crypto.randomUUID(), product: p, qty: "1", unitCost: p.cost ?? "0" }])} />
        {lines.map((l) => (
          <div key={l.key} className="row" style={{ borderTop: "1px solid var(--rule)", paddingTop: 10 }}>
            <span style={{ flex: "1 1 200px" }}>{l.product.sku} · {l.product.name}<br /><span className="small muted">{l.product.available ?? "—"} in stock</span></span>
            <label className="field" style={{ width: 100 }}><span>Qty</span><input type="number" min="0" step="any" inputMode="decimal" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} /></label>
            <label className="field" style={{ width: 120 }}><span>Agreed cost</span><input type="number" min="0" step="0.0001" inputMode="decimal" value={l.unitCost} onChange={(e) => update(l.key, { unitCost: e.target.value })} /></label>
            <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</button>
          </div>
        ))}
        <div className="totalrow grand"><span>Order total</span><strong>Rs. {fmt(total)}</strong></div>
        <p className="small muted" style={{ margin: 0 }}>An order does not add stock or create a payable. Receive goods against it when they arrive.</p>
        {error && <p className="note note-err" role="alert">{error}</p>}
        <div className="form-actions" style={{ marginTop: 0 }}>
          <button className="btn btn-primary" disabled={pending || !supplierId || !lines.length} onClick={() => start(async () => {
            setError(null);
            const r = await submitOrder({ idempotencyKey: key, supplierId, expectedAt: expectedAt || null, notes: notes || null, lines: lines.map((l) => ({ productId: l.product.id, qty: l.qty, unitCost: l.unitCost })) });
            if (r.error) setError(r.error); else if (r.id) router.push(`/purchases/orders/${r.id}`);
          })}>{pending ? "Saving…" : "Place order"}</button>
        </div>
      </section>
    </div>
  );
}
