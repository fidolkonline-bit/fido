"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { listLayers, type LayerHit, type ProductHit, type DeviceHit } from "../../search";
import { submitClaim } from "./actions";
import { ProductSearch } from "@/components/ProductSearch";
import { DevicePicker, deviceLabel } from "@/components/DevicePicker";

type Line = { key: string; product: ProductHit; layers: LayerHit[]; layerId: string; qty: string; devices: DeviceHit[]; picking: "" | "HELD" | "SALEABLE" };
const fmt = (v: number) => v.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ClaimForm({ suppliers }: { suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [supplierId, setSupplierId] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const update = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));

  const add = async (p: ProductHit) => {
    const k = crypto.randomUUID();
    setLines((ls) => [...ls, { key: k, product: p, layers: [], layerId: "", qty: "1", devices: [], picking: p.tracked ? "HELD" : "" }]);
    if (!p.tracked) {
      // Supplier-hold lots first: they are what usually goes back.
      const layers = (await listLayers(p.id, ["SUPPLIER_HOLD", "INSPECTION", "SALEABLE"])).sort((a, b) => Number(b.bucket === "SUPPLIER_HOLD") - Number(a.bucket === "SUPPLIER_HOLD"));
      update(k, { layers, layerId: layers[0]?.id ?? "" });
    }
  };
  const value = lines.reduce((a, l) => {
    if (l.product.tracked) return a;
    const layer = l.layers.find((x) => x.id === l.layerId);
    return a + (layer?.unitCost ? Number(layer.unitCost) * (Number(l.qty) || 0) : 0);
  }, 0);

  return (
    <div className="stack">
      <section className="panel grid3">
        <label className="field"><span>Supplier *</span>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Select supplier…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </label>
        <label className="field"><span>Reason</span><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Faulty, wrong item, warranty…" /></label>
        <label className="field"><span>Notes (courier, reference)</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </section>
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Items going back</h2>
        <ProductSearch onPick={add} />
        {lines.map((l) => (
          <div key={l.key} className="stack" style={{ gap: 8, borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
            <div className="row"><strong style={{ fontWeight: 500 }}>{l.product.sku} · {l.product.name}</strong><div className="spacer" /><button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</button></div>
            {l.product.tracked ? (
              <>
                <div className="row">
                  {l.devices.map((d) => <span key={d.id} className="badge badge-muted" style={{ fontVariantNumeric: "tabular-nums" }}>IMEI {deviceLabel(d)} <button type="button" className="btn-ghost" style={{ minHeight: 0, padding: "0 4px" }} onClick={() => update(l.key, { devices: l.devices.filter((x) => x.id !== d.id) })}>✕</button></span>)}
                  <button type="button" className="btn btn-sm" onClick={() => update(l.key, { picking: "HELD" })}>+ Held phone</button>
                  <button type="button" className="btn btn-sm" onClick={() => update(l.key, { picking: "SALEABLE" })}>+ Phone in stock</button>
                </div>
                {l.picking && <DevicePicker key={l.picking} productId={l.product.id} productName={l.product.name} state={l.picking} exclude={l.devices.map((d) => d.id)} onPick={(d) => update(l.key, { devices: [...l.devices, d] })} onClose={() => update(l.key, { picking: "" })} />}
              </>
            ) : (
              <div className="grid2">
                <label className="field"><span>Lot</span>
                  <select value={l.layerId} onChange={(e) => update(l.key, { layerId: e.target.value })}>
                    {l.layers.length === 0 && <option value="">No stock</option>}
                    {l.layers.map((x) => <option key={x.id} value={x.id}>{x.lotCode ?? "No lot"} · {Number(x.qtyRemaining)} · {x.bucket.toLowerCase().replace("_", " ")}{x.unitCost ? ` @ ${fmt(Number(x.unitCost))}` : ""}</option>)}
                  </select>
                </label>
                <label className="field"><span>Quantity</span><input type="number" min="0" step="any" inputMode="decimal" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} /></label>
              </div>
            )}
          </div>
        ))}
        {value > 0 && <div className="totalrow"><span>Original cost of goods sent</span><strong>{fmt(value)}</strong></div>}
        <p className="small muted" style={{ margin: 0 }}>Goods leave stock when sent. Credit, refund or replacement is recorded later, when the supplier actually responds.</p>
        {error && <p className="note note-err" role="alert">{error}</p>}
        <div className="form-actions" style={{ marginTop: 0 }}>
          <button className="btn btn-primary" disabled={pending || !supplierId || !lines.length} onClick={() => start(async () => {
            setError(null);
            const r = await submitClaim({
              idempotencyKey: key, supplierId, reason: reason || null, notes: notes || null,
              lines: lines.map((l) => ({ productId: l.product.id, costLayerId: l.layerId || null, qty: l.product.tracked ? l.devices.length : l.qty, deviceIds: l.devices.map((d) => d.id) })),
            });
            if (r.error) setError(r.error); else if (r.id) router.push(`/purchases/returns/${r.id}`);
          })}>{pending ? "Sending…" : "Send to supplier"}</button>
        </div>
      </section>
    </div>
  );
}
