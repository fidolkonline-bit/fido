"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProductHit, DeviceHit } from "../search";
import { submitTransfer } from "../adjustments/actions";
import { ProductSearch } from "@/components/ProductSearch";
import { DevicePicker, deviceLabel } from "@/components/DevicePicker";

type Line = { key: string; product: ProductHit; qty: string; devices: DeviceHit[]; picking: boolean };

export function TransferForm({ destinations }: { destinations: { id: string; name: string }[] }) {
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [to, setTo] = useState(destinations[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const update = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await submitTransfer({
        idempotencyKey: key, toLocationId: to, notes: notes || null,
        lines: lines.map((l) => ({ productId: l.product.id, qty: l.product.tracked ? l.devices.length : Number(l.qty), deviceIds: l.devices.map((d) => d.id) })),
      });
      if (r.error) setError(r.error);
      else if (r.id) router.push(`/transfers/${r.id}`);
    });
  };

  return (
    <div className="stack">
      <section className="panel grid2">
        <label className="field"><span>Send to</span>
          <select value={to} onChange={(e) => setTo(e.target.value)}>{destinations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        </label>
        <label className="field"><span>Notes (carrier, bus, who is taking it)</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </section>
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Items to send</h2>
        <ProductSearch onPick={(p) => setLines((ls) => [...ls, { key: crypto.randomUUID(), product: p, qty: "1", devices: p.device ? [p.device] : [], picking: p.tracked && !p.device }])} />
        {lines.map((l) => (
          <div key={l.key} className="stack" style={{ gap: 8, borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
            <div className="row">
              <strong style={{ fontWeight: 500 }}>{l.product.sku} · {l.product.name}</strong>
              <span className="small muted">{l.product.available} available</span>
              <div className="spacer" />
              {!l.product.tracked && <input style={{ width: 100 }} type="number" min="0" step="any" inputMode="decimal" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} aria-label="Quantity" />}
              <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</button>
            </div>
            {l.product.tracked && (
              <>
                <div className="row">
                  {l.devices.map((d) => <span key={d.id} className="badge badge-muted" style={{ fontVariantNumeric: "tabular-nums" }}>IMEI {deviceLabel(d)} <button type="button" className="btn-ghost" style={{ minHeight: 0, padding: "0 4px" }} onClick={() => update(l.key, { devices: l.devices.filter((x) => x.id !== d.id) })}>✕</button></span>)}
                  <button type="button" className="btn btn-sm" onClick={() => update(l.key, { picking: true })}>+ IMEI</button>
                </div>
                {l.picking && <DevicePicker productId={l.product.id} productName={l.product.name} exclude={l.devices.map((d) => d.id)} onPick={(d) => update(l.key, { devices: [...l.devices, d] })} onClose={() => update(l.key, { picking: false })} />}
              </>
            )}
          </div>
        ))}
        <p className="small muted" style={{ margin: 0 }}>Stock leaves this location when sent (in transit) and is added at the destination only when received there. Lot and cost travel with it, oldest lots first.</p>
        {error && <p className="note note-err" role="alert">{error}</p>}
        <div className="form-actions" style={{ marginTop: 0 }}><button className="btn btn-primary" disabled={pending || !lines.length || !to} onClick={submit}>{pending ? "Sending…" : "Send transfer"}</button></div>
      </section>
    </div>
  );
}
