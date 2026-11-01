"use client";

import { useRef, useState } from "react";
import { searchProducts, type ProductHit } from "@/app/(app)/search";

// Search box that resolves to one product; used by adjustments, transfers and receiving.
export function ProductSearch({ onPick, placeholder = "Scan or search product to add", forSale = false }: { onPick: (p: ProductHit) => void; placeholder?: string; forSale?: boolean }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const seq = useRef(0);
  const run = (v: string) => {
    setQ(v);
    clearTimeout(timer.current);
    const mine = ++seq.current;
    timer.current = setTimeout(async () => {
      const r = v.trim() ? await searchProducts(v, forSale) : [];
      if (mine === seq.current) setHits(r);
    }, 180);
  };
  const pick = (p: ProductHit) => { seq.current++; setQ(""); setHits([]); onPick(p); };
  return (
    <div style={{ position: "relative" }}>
      <input value={q} onChange={(e) => run(e.target.value)} placeholder={placeholder} aria-label="Find product" autoComplete="off"
        onKeyDown={async (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const r = await searchProducts(q, forSale);
          const exact = r.find((h) => h.device) ?? r.find((h) => h.sku.toLowerCase() === q.trim().toLowerCase() || h.barcode === q.trim()) ?? (r.length === 1 ? r[0] : null);
          if (exact) pick(exact); else setHits(r);
        }} />
      {hits.length > 0 && (
        <div className="panel" style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 10, padding: 0, maxHeight: 280, overflowY: "auto" }}>
          {hits.map((h) => (
            <button key={h.id} type="button" onClick={() => pick(h)} className="btn-ghost" style={{ width: "100%", justifyContent: "space-between", borderRadius: 0, borderBottom: "1px solid var(--rule)" }}>
              <span>{h.sku} · {h.name}</span><span className="muted small">{h.available ?? "—"} available{h.tracked ? " · IMEI" : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
