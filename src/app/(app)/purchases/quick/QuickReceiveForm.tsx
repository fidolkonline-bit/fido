"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { type ProductHit } from "../../search";
import { submitQuickReceive } from "./actions";
import { ProductSearch } from "@/components/ProductSearch";
import { SearchSelect } from "@/components/SearchSelect";

type Line = { key: string; product: ProductHit | null; newName: string; qty: string; sellPrice: string };

// Shop staff: what arrived and how many. No costs — the owner is alerted to add them.
export function QuickReceiveForm({ suppliers }: { suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const add = (p: ProductHit) => {
    setDone(null);
    if (p.tracked) { setError(`${p.name} is tracked by IMEI / serial. Phones go on a normal GRN by the owner.`); return; }
    setError(null);
    setLines((ls) => ls.some((l) => l.product?.id === p.id)
      ? ls.map((l) => (l.product?.id === p.id ? { ...l, qty: String(Number(l.qty || 0) + 1) } : l))
      : [...ls, { key: crypto.randomUUID(), product: p, newName: "", qty: "1", sellPrice: "" }]);
  };
  const addNew = () => {
    const name = newName.trim();
    if (name.length < 2) return;
    setDone(null);
    setLines((ls) => [...ls, { key: crypto.randomUUID(), product: null, newName: name, qty: "1", sellPrice: "" }]);
    setNewName("");
  };
  const update = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await submitQuickReceive({
        idempotencyKey: key, supplierId: supplierId || null, notes: notes.trim() || null,
        lines: lines.map((l) => ({ productId: l.product?.id ?? null, newName: l.product ? null : l.newName, qty: l.qty, sellPrice: l.product ? null : l.sellPrice || null })),
      });
      if (r.error) { setError(r.error); return; }
      setDone(`${r.number} saved. The stock can be sold now; the owner has been asked to add the cost.`);
      setLines([]); setNotes(""); setSupplierId(""); setKey(crypto.randomUUID());
      router.refresh();
    });
  };

  const missingPrice = lines.some((l) => !l.product && !(Number(l.sellPrice) > 0));
  const badQty = lines.some((l) => !(Number(l.qty) > 0) || !Number.isInteger(Number(l.qty)));

  return (
    <div className="stack">
      {done && <p className="note note-ok" role="status">{done}</p>}
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>What arrived</h2>
        <ProductSearch onPick={add} placeholder="Scan or search an existing product" />
        <div className="row" style={{ gap: 8 }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNew(); } }}
            placeholder="New product name" aria-label="New product name (not in the system yet)" style={{ flex: 1, minWidth: 0 }} />
          <button type="button" className="btn" onClick={addNew} disabled={newName.trim().length < 2}>Add new</button>
        </div>
        {lines.length === 0 && <p className="muted small" style={{ margin: 0 }}>No items yet. Search for each product, or type the name of one that is not in the system.</p>}
        {lines.map((l) => (
          <div key={l.key} style={{ borderTop: "1px solid var(--rule)", paddingTop: 12 }} className="stack">
            <div className="row">
              <strong>{l.product ? `${l.product.sku} · ${l.product.name}` : l.newName}</strong>
              {!l.product && <span className="badge badge-warn">New product</span>}
              <div className="spacer" />
              <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</button>
            </div>
            <div className="grid2">
              <label className="field"><span>Quantity received</span>
                <input type="number" min="1" step="1" inputMode="numeric" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} />
              </label>
              {l.product
                ? <div className="field"><span>Selling price</span><strong style={{ fontSize: 15, paddingTop: 10 }}>Rs. {Number(l.product.price).toLocaleString("en-LK", { minimumFractionDigits: 2 })}</strong></div>
                : <label className="field"><span>Selling price *</span>
                    <input type="number" min="0" step="0.01" inputMode="decimal" value={l.sellPrice} onChange={(e) => update(l.key, { sellPrice: e.target.value })} placeholder="Price to sell at" />
                  </label>}
            </div>
          </div>
        ))}
      </section>

      <section className="panel stack">
        <div className="grid2">
          <label className="field"><span>Supplier (if you know)</span>
            <SearchSelect key={key} name="supplierId" label="Supplier" options={suppliers} defaultValue={supplierId} onChange={setSupplierId} placeholder="Search supplier…" noneLabel="Don't know / owner will set" />
          </label>
          <label className="field"><span>Note for the owner</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. delivered by Ruwan, bill in the drawer" maxLength={500} />
          </label>
        </div>
        <p className="small muted" style={{ margin: 0 }}>The stock is added now and can be sold straight away. The owner gets an alert to add the cost and pay the supplier.</p>
        {error && <p className="note note-err" role="alert">{error}</p>}
        <div className="form-actions" style={{ marginTop: 0 }}>
          <button className="btn btn-primary" type="button" disabled={pending || lines.length === 0 || missingPrice || badQty} onClick={submit}>{pending ? "Saving…" : "Add to stock"}</button>
        </div>
        {missingPrice && <p className="small muted" style={{ margin: 0 }}>Enter a selling price for each new product.</p>}
      </section>
    </div>
  );
}
