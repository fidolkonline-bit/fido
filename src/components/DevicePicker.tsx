"use client";

import { useEffect, useState } from "react";
import { listDevices, type DeviceHit } from "@/app/(app)/search";

export const deviceLabel = (d: Pick<DeviceHit, "imei1" | "serial">) => d.imei1 ?? d.serial ?? "Unidentified device";

// Pick specific phones by IMEI/serial. Phones are never allocated FIFO: the exact device sold or moved is recorded.
export function DevicePicker({ productId, productName, state = "SALEABLE", exclude, onPick, onClose }: {
  productId: string;
  productName: string;
  state?: string;
  exclude: string[];
  onPick: (d: DeviceHit) => void;
  onClose: () => void;
}) {
  const [devices, setDevices] = useState<DeviceHit[] | null>(null);
  const [filter, setFilter] = useState("");
  useEffect(() => { listDevices(productId, state).then(setDevices); }, [productId, state]);
  const shown = (devices ?? []).filter((d) => !exclude.includes(d.id) && [d.imei1, d.imei2, d.serial].some((x) => x?.includes(filter.trim())));

  return (
    <div className="panel stack" style={{ gap: 8, borderColor: "var(--accent)" }}>
      <div className="row"><strong style={{ fontWeight: 600 }}>Choose IMEI · {productName}</strong><div className="spacer" /><button type="button" className="btn btn-sm" onClick={onClose}>Done</button></div>
      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Type or scan last digits of IMEI / serial" inputMode="numeric" aria-label="Filter devices" autoFocus />
      {devices === null ? (
        <p className="muted small" style={{ margin: 0 }}>Loading devices…</p>
      ) : shown.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>No {state === "HELD" ? "held" : "available"} devices{filter ? " match" : " here"}.</p>
      ) : (
        <div style={{ maxHeight: 220, overflowY: "auto" }}>
          {shown.map((d) => (
            <div key={d.id} className="pos-item">
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{deviceLabel(d)}<small>{d.imei2 ? `IMEI 2 ${d.imei2} · ` : ""}{d.condition.toLowerCase()}{d.lotCode || d.reference ? ` · lot ${d.lotCode ?? "—"} · ${d.reference ?? "—"}` : ""}</small></span>
              <button type="button" className="btn btn-sm" onClick={() => onPick(d)}>Add</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
