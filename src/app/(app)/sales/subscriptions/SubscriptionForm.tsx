"use client";

import { useRef, useState } from "react";
import { ProductSearch } from "@/components/ProductSearch";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { saveSubscription } from "../drafts/actions";
import { searchCustomers } from "../../pos/actions";

type Line = { productId: string; sku: string; name: string; qty: number; unitPrice: number; discount: number };

export function SubscriptionForm() {
  const [lines, setLines] = useState<Line[]>([]);
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [hits, setHits] = useState<{ id: string; name: string }[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <ActionForm action={saveSubscription} className="panel stack">
      <h2 style={{ margin: 0 }}>New subscription</h2>
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <input type="hidden" name="customerId" value={customer?.id ?? ""} />
      <div className="grid3">
        <label className="field"><span>Name</span><input name="name" placeholder="Monthly data plan top-up" required /></label>
        <div className="field" style={{ position: "relative" }}><span>Customer</span>
          {customer ? <div className="row"><strong style={{ color: "var(--ink)", fontWeight: 500 }}>{customer.name}</strong><button type="button" className="btn btn-sm" onClick={() => setCustomer(null)}>Change</button></div> : <>
            <input placeholder="Search name or mobile" onChange={(e) => { const v = e.target.value; clearTimeout(timer.current); timer.current = setTimeout(async () => setHits(v ? await searchCustomers(v) : []), 200); }} />
            {hits.length > 0 && <div className="panel" style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, padding: 0 }}>{hits.map((c) => <button type="button" key={c.id} className="btn-ghost" style={{ width: "100%", justifyContent: "flex-start", borderRadius: 0 }} onClick={() => { setCustomer(c); setHits([]); }}>{c.name}</button>)}</div>}
          </>}
        </div>
        <label className="field"><span>Every</span><select name="interval"><option value="MONTH">Month</option><option value="WEEK">Week</option></select></label>
        <label className="field"><span>First invoice date</span><input type="date" name="nextDate" required /></label>
        <label className="field"><span>End date (optional)</span><input type="date" name="endDate" /></label>
      </div>
      <ProductSearch forSale onPick={(p) => setLines((ls) => [...ls, { productId: p.id, sku: p.sku, name: p.name, qty: 1, unitPrice: Number(p.price), discount: 0 }])} />
      {lines.map((l, i) => (
        <div key={i} className="row">
          <span style={{ flex: 1 }}>{l.name}</span>
          <input style={{ width: 80 }} value={l.qty} inputMode="decimal" onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) || 1 } : x)))} aria-label="Quantity" />
          <input style={{ width: 110 }} value={l.unitPrice} inputMode="decimal" onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitPrice: Number(e.target.value) || 0 } : x)))} aria-label="Price" />
          <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <p className="small muted" style={{ margin: 0 }}>On each due date a draft invoice is created once for that period. Staff turn it into a sale at the POS, so stock and payment are posted only then.</p>
      <div><SubmitButton>Save subscription</SubmitButton></div>
    </ActionForm>
  );
}
