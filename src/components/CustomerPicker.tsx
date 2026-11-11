"use client";

import { useRef, useState } from "react";
import { searchCustomers } from "@/app/(app)/pos/actions";
import { quickAddCustomer } from "@/app/(app)/contacts/actions";

export type PickedCustomer = { id: string; name: string; phone: string | null };

// Find a customer by name / mobile, or add one on the spot. Used wherever a form needs "who is this for".
export function CustomerPicker({ value, onChange, addLabel = "New customer" }: { value: PickedCustomer | null; onChange: (c: PickedCustomer | null) => void; addLabel?: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PickedCustomer[]>([]);
  const [draft, setDraft] = useState<{ name: string; phone: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const find = (v: string) => {
    setQ(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => setHits(v.trim() ? await searchCustomers(v) : []), 200);
  };

  if (value) {
    return (
      <div className="row">
        <strong style={{ fontWeight: 500 }}>{value.name}</strong><span className="muted">{value.phone ?? "no mobile"}</span>
        <div className="spacer" /><button type="button" className="btn btn-sm" onClick={() => onChange(null)}>Change</button>
      </div>
    );
  }
  if (draft) {
    return (
      <div className="stack">
        <div className="grid3">
          <input placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Customer name" />
          <input placeholder="Mobile" type="tel" inputMode="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} aria-label="Customer mobile" />
          <div className="row">
            <button type="button" className="btn" onClick={() => setDraft(null)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={async () => { try { onChange(await quickAddCustomer(draft.name, draft.phone || null)); setDraft(null); } catch (e) { setError((e as Error).message); } }}>Save</button>
          </div>
        </div>
        {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="row">
        <input style={{ flex: 1 }} placeholder="Search name or mobile" value={q} onChange={(e) => find(e.target.value)} aria-label="Search customer" />
        <button type="button" className="btn" onClick={() => setDraft({ name: q && !/^\d+$/.test(q) ? q : "", phone: /^\d+$/.test(q) ? q : "" })}>{addLabel}</button>
      </div>
      {hits.length > 0 && (
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {hits.map((c) => <button type="button" key={c.id} className="btn btn-sm" onClick={() => { onChange({ id: c.id, name: c.name, phone: c.phone }); setHits([]); setQ(""); }}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</button>)}
        </div>
      )}
    </div>
  );
}
