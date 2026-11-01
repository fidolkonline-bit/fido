"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { listLayers, type LayerHit, type ProductHit, type DeviceHit } from "../search";
import { submitAdjustment } from "./actions";
import { ProductSearch } from "@/components/ProductSearch";
import { DevicePicker, deviceLabel } from "@/components/DevicePicker";

type Mode = "REMOVE" | "ADD" | "RELEASE";
type Line = { key: string; product: ProductHit; mode: Mode; qty: string; layerId: string; unitCost: string; lotCode: string; toBucket: string; layers: LayerHit[]; devices: DeviceHit[]; picking: boolean };

const REASONS: [string, string, Mode][] = [
  ["WASTAGE", "Wastage", "REMOVE"], ["DAMAGE", "Damaged", "REMOVE"], ["LOSS", "Lost / stolen", "REMOVE"],
  ["COUNT_CORRECTION", "Stock count correction", "REMOVE"], ["FOUND", "Found stock", "ADD"], ["RELEASE_HOLD", "Release held stock", "RELEASE"], ["OTHER", "Other", "REMOVE"],
];
const bucketName = (b: string) => b.toLowerCase().replace("_", " ");

export function AdjustmentForm() {
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [reason, setReason] = useState("WASTAGE");
  const [kind, setKind] = useState("NORMAL");
  const [notes, setNotes] = useState("");
  const [recovered, setRecovered] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const defaultMode = REASONS.find((r) => r[0] === reason)![2];

  const loadLayers = async (k: string, product: ProductHit, mode: Mode) => {
    const layers = mode === "ADD" ? [] : await listLayers(product.id, mode === "RELEASE" ? ["INSPECTION", "SUPPLIER_HOLD"] : ["SALEABLE", "INSPECTION", "SUPPLIER_HOLD"]);
    setLines((ls) => ls.map((l) => (l.key === k ? { ...l, layers, layerId: mode === "RELEASE" ? layers[0]?.id ?? "" : "" } : l)));
  };
  const add = (p: ProductHit) => {
    const k = crypto.randomUUID();
    setLines((ls) => [...ls, { key: k, product: p, mode: defaultMode, qty: p.tracked ? "0" : "1", layerId: "", unitCost: p.cost ?? "", lotCode: "", toBucket: "SALEABLE", layers: [], devices: p.device ? [p.device] : [], picking: p.tracked && !p.device }]);
    loadLayers(k, p, defaultMode);
  };
  const update = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await submitAdjustment({
        idempotencyKey: key, reason, kind, notes: notes || null, recoveredAmount: Number(recovered) || 0,
        lines: lines.map((l) => ({
          productId: l.product.id, mode: l.mode, qty: l.product.tracked && l.mode !== "ADD" ? l.devices.length : Number(l.qty),
          costLayerId: l.layerId || null, unitCost: l.unitCost === "" ? null : Number(l.unitCost), lotCode: l.lotCode || null,
          toBucket: l.toBucket, deviceIds: l.devices.map((d) => d.id),
        })),
      });
      if (r.error) setError(r.error);
      else if (r.id) router.push(`/adjustments/${r.id}`);
    });
  };

  return (
    <div className="stack">
      <section className="panel grid3">
        <label className="field"><span>Reason</span>
          <select value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
        </label>
        <label className="field"><span>Type (legacy)</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}><option value="NORMAL">Normal</option><option value="ABNORMAL">Abnormal</option></select>
        </label>
        <label className="field"><span>Amount recovered (e.g. insurance, scrap)</span><input value={recovered} onChange={(e) => setRecovered(e.target.value)} inputMode="decimal" placeholder="0.00" /></label>
        <label className="field" style={{ gridColumn: "1 / -1" }}><span>Notes</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Items</h2>
        <ProductSearch onPick={add} />
        {lines.length === 0 && <p className="small muted" style={{ margin: 0 }}>Write-offs keep the original lot cost. Held stock (returns on inspection or supplier hold) is released here.</p>}
        {lines.map((l) => (
          <div key={l.key} className="stack" style={{ gap: 8, borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
            <div className="row"><strong style={{ fontWeight: 500 }}>{l.product.sku} · {l.product.name}</strong><div className="spacer" /><button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</button></div>
            <div className="grid3">
              <label className="field"><span>Action</span>
                <select value={l.mode} onChange={(e) => { const mode = e.target.value as Mode; update(l.key, { mode, layerId: "", devices: [] }); loadLayers(l.key, l.product, mode); }}>
                  <option value="REMOVE">Remove / write off</option>{!l.product.tracked && <option value="ADD">Add (found stock)</option>}<option value="RELEASE">Release held stock</option>
                </select>
              </label>
              {!(l.product.tracked && l.mode !== "ADD") && (
                <label className="field"><span>Quantity</span><input type="number" min="0" step="any" inputMode="decimal" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} /></label>
              )}
              {l.mode === "REMOVE" && !l.product.tracked && (
                <label className="field"><span>From lot</span>
                  <select value={l.layerId} onChange={(e) => update(l.key, { layerId: e.target.value })}>
                    <option value="">Oldest saleable first (FIFO)</option>
                    {l.layers.map((x) => <option key={x.id} value={x.id}>{x.lotCode ?? "No lot"} · {Number(x.qtyRemaining)} left · {bucketName(x.bucket)}</option>)}
                  </select>
                </label>
              )}
              {l.mode === "RELEASE" && !l.product.tracked && (
                <label className="field"><span>Held lot</span>
                  <select value={l.layerId} onChange={(e) => update(l.key, { layerId: e.target.value })}>
                    {l.layers.length === 0 && <option value="">No held stock</option>}
                    {l.layers.map((x) => <option key={x.id} value={x.id}>{x.lotCode ?? "No lot"} · {Number(x.qtyRemaining)} · {bucketName(x.bucket)}</option>)}
                  </select>
                </label>
              )}
              {l.mode === "RELEASE" && (
                <label className="field"><span>Move to</span>
                  <select value={l.toBucket} onChange={(e) => update(l.key, { toBucket: e.target.value })}>
                    <option value="SALEABLE">Saleable stock</option><option value="SUPPLIER_HOLD">Supplier recovery hold</option><option value="INSPECTION">Inspection hold</option>
                  </select>
                </label>
              )}
              {l.mode === "ADD" && <>
                <label className="field"><span>Unit cost</span><input value={l.unitCost} onChange={(e) => update(l.key, { unitCost: e.target.value })} inputMode="decimal" /></label>
                <label className="field"><span>Lot number</span><input value={l.lotCode} onChange={(e) => update(l.key, { lotCode: e.target.value })} /></label>
              </>}
            </div>
            {l.product.tracked && l.mode !== "ADD" && (
              <div className="stack" style={{ gap: 6 }}>
                <div className="row">
                  {l.devices.map((d) => <span key={d.id} className="badge badge-muted" style={{ fontVariantNumeric: "tabular-nums" }}>IMEI {deviceLabel(d)} <button type="button" className="btn-ghost" style={{ minHeight: 0, padding: "0 4px" }} onClick={() => update(l.key, { devices: l.devices.filter((x) => x.id !== d.id) })}>✕</button></span>)}
                  <button type="button" className="btn btn-sm" onClick={() => update(l.key, { picking: true })}>+ IMEI</button>
                </div>
                {l.picking && <DevicePicker productId={l.product.id} productName={l.product.name} state={l.mode === "RELEASE" ? "HELD" : "SALEABLE"} exclude={l.devices.map((d) => d.id)}
                  onPick={(d) => update(l.key, { devices: [...l.devices, d] })} onClose={() => update(l.key, { picking: false })} />}
              </div>
            )}
          </div>
        ))}
        {error && <p className="note note-err" role="alert">{error}</p>}
        <div className="form-actions" style={{ marginTop: 0 }}><button className="btn btn-primary" disabled={pending || !lines.length} onClick={submit}>{pending ? "Posting…" : "Post adjustment"}</button></div>
      </section>
    </div>
  );
}
