"use client";

import { useRef } from "react";

// Android unlock pattern: tap the dots in order. Stored as "1-5-9-6" (dots numbered left→right, top→bottom).
export function PatternPad({ value, onChange, readOnly = false }: { value: string; onChange?: (v: string) => void; readOnly?: boolean }) {
  const seq = value ? value.split("-").map(Number) : [];
  // Fast taps can arrive before React re-renders; build on the latest value, not this render's copy.
  const latest = useRef(value);
  latest.current = value;
  const pos = (n: number) => ({ x: ((n - 1) % 3) * 60 + 30, y: Math.floor((n - 1) / 3) * 60 + 30 });
  const tap = (n: number) => {
    if (readOnly) return;
    const cur = latest.current ? latest.current.split("-").map(Number) : [];
    if (cur.includes(n)) return;
    latest.current = [...cur, n].join("-");
    onChange?.(latest.current);
  };
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 6 }}>
      <svg width="180" height="180" viewBox="0 0 180 180" style={{ background: "var(--wash)", borderRadius: 8, touchAction: "none" }} aria-label={`Pattern ${value || "empty"}`}>
        {seq.length > 1 && <polyline points={seq.map((n) => `${pos(n).x},${pos(n).y}`).join(" ")} fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />}
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
          const i = seq.indexOf(n);
          return (
            <g key={n} onClick={() => tap(n)} style={{ cursor: readOnly ? "default" : "pointer" }}>
              <circle cx={pos(n).x} cy={pos(n).y} r="24" fill="transparent" />
              <circle cx={pos(n).x} cy={pos(n).y} r={i >= 0 ? 11 : 7} fill={i >= 0 ? "var(--accent)" : "var(--ink)"} />
              {i >= 0 && <text x={pos(n).x} y={pos(n).y + 4} textAnchor="middle" fontSize="11" fill="var(--accent-ink)" fontWeight="700">{i + 1}</text>}
            </g>
          );
        })}
      </svg>
      {!readOnly && <div className="row" style={{ gap: 6 }}><span className="small muted">{seq.length ? `${seq.length} dots` : "Tap dots in order"}</span><button type="button" className="btn btn-sm" onClick={() => { latest.current = ""; onChange?.(""); }}>Clear</button></div>}
    </div>
  );
}
