"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitTransferReceipt } from "../adjustments/actions";

export function ReceiveTransferForm({ transferId, lines }: { transferId: string; lines: { id: string; name: string; lot: string | null; sent: number; tracked: boolean }[] }) {
  const router = useRouter();
  const [got, setGot] = useState(() => Object.fromEntries(lines.map((l) => [l.id, String(l.sent)])));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const short = lines.some((l) => Number(got[l.id]) < l.sent);
  return (
    <section className="panel stack">
      <h2 style={{ margin: 0 }}>Receive at this location</h2>
      {lines.map((l) => (
        <div key={l.id} className="row">
          <span style={{ flex: 1 }}>{l.name}<span className="small muted"> · lot {l.lot ?? "—"} · sent {l.sent}</span></span>
          <input style={{ width: 110 }} type="number" min="0" max={l.sent} step="any" inputMode="decimal" disabled={l.tracked} value={got[l.id]} onChange={(e) => setGot({ ...got, [l.id]: e.target.value })} aria-label={`Received ${l.name}`} />
        </div>
      ))}
      {short && <p className="note">Received less than sent — the shortfall stays on record as a transfer discrepancy.</p>}
      {error && <p className="note note-err" role="alert">{error}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}>
        <button className="btn btn-primary" disabled={pending} onClick={() => start(async () => {
          const r = await submitTransferReceipt({ transferId, lines: lines.map((l) => ({ lineId: l.id, qtyReceived: Number(got[l.id]) })) });
          if (r.error) setError(r.error); else router.refresh();
        })}>{pending ? "Receiving…" : "Confirm received"}</button>
      </div>
    </section>
  );
}
