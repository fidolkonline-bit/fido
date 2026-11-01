"use client";

import { useRef, useState, useTransition } from "react";
import { submitReload } from "./actions";
import { searchCustomers } from "../pos/actions";

type Wallet = { id: string; name: string; networks: string[]; balance: number };
type Opt = { id: string; name: string };
const NET = ["DIALOG", "MOBITEL", "HUTCH", "AIRTEL"] as const;

export function ReloadForm({ wallets, staff, locations, mode, defaultLocationId }: { wallets: Wallet[]; staff: Opt[]; locations: Opt[]; mode: "REQUEST" | "COUNTER"; defaultLocationId: string }) {
  const [key] = useState(() => crypto.randomUUID());
  const [network, setNetwork] = useState<(typeof NET)[number]>("DIALOG");
  const usable = wallets.filter((w) => w.networks.includes(network));
  const [walletId, setWalletId] = useState("");
  const [mobile, setMobile] = useState("");
  const [amount, setAmount] = useState("");
  const [collection, setCollection] = useState(mode === "REQUEST" ? "OWNER" : "SHOP");
  const [customer, setCustomer] = useState<Opt | null>(null);
  const [custQ, setCustQ] = useState("");
  const [hits, setHits] = useState<Opt[]>([]);
  const [assignee, setAssignee] = useState("");
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<"SUCCESSFUL" | "FAILED" | "UNCERTAIN">("SUCCESSFUL");
  const [ref, setRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wallet = usable.find((w) => w.id === walletId) ?? usable[0];

  return (
    <section className="panel stack">
      <div className="row">
        {NET.map((n) => <button key={n} type="button" className={"btn" + (n === network ? " btn-primary" : "")} onClick={() => { setNetwork(n); setWalletId(""); }}>{n[0] + n.slice(1).toLowerCase()}</button>)}
      </div>
      <div className="grid3">
        <label className="field"><span>Mobile number</span><input value={mobile} onChange={(e) => setMobile(e.target.value)} type="tel" inputMode="tel" placeholder="07XXXXXXXX" autoFocus /></label>
        <label className="field"><span>Amount (Rs.)</span><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label>
        <label className="field"><span>Wallet / channel</span>
          <select value={wallet?.id ?? ""} onChange={(e) => setWalletId(e.target.value)}>
            {usable.length === 0 && <option value="">No wallet for this network</option>}
            {usable.map((w) => <option key={w.id} value={w.id}>{w.name} · balance {w.balance.toLocaleString("en-LK")}</option>)}
          </select>
        </label>
      </div>
      <div className="row">{[100, 200, 500, 1000, 2000].map((v) => <button key={v} type="button" className="btn btn-sm" onClick={() => setAmount(String(v))}>{v}</button>)}</div>
      <div className="grid3">
        <label className="field"><span>Money collected by</span>
          <select value={collection} onChange={(e) => setCollection(e.target.value)}>
            <option value="SHOP">Shop counter (cash in register)</option><option value="OWNER">Owner (collected remotely)</option><option value="CREDIT">Customer owes (credit)</option>
          </select>
        </label>
        <div className="field" style={{ position: "relative" }}><span>Customer {collection === "CREDIT" ? "*" : "(optional)"}</span>
          {customer ? <div className="row"><strong style={{ fontWeight: 500, color: "var(--ink)" }}>{customer.name}</strong><button className="btn btn-sm" onClick={() => setCustomer(null)}>Change</button></div> : (
            <>
              <input value={custQ} placeholder="Search name or mobile" onChange={(e) => { const v = e.target.value; setCustQ(v); clearTimeout(timer.current); timer.current = setTimeout(async () => setHits(v.trim() ? await searchCustomers(v) : []), 200); }} />
              {hits.length > 0 && <div className="panel" style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 10, padding: 0 }}>{hits.map((c) => <button key={c.id} className="btn-ghost" style={{ width: "100%", justifyContent: "flex-start", borderRadius: 0 }} onClick={() => { setCustomer(c); setHits([]); }}>{c.name}</button>)}</div>}
            </>
          )}
        </div>
        {mode === "REQUEST" && <>
          <label className="field"><span>Shop</span><select value={locationId} onChange={(e) => setLocationId(e.target.value)}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <label className="field"><span>Assign to</span><select value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Anyone on shift</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        </>}
        <label className="field"><span>Notes</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </div>
      {mode === "COUNTER" && (
        <div className="grid2">
          <label className="field"><span>Provider result</span>
            <select value={result} onChange={(e) => setResult(e.target.value as typeof result)}><option value="SUCCESSFUL">Successful</option><option value="FAILED">Failed</option><option value="UNCERTAIN">Not sure yet (no confirmation)</option></select>
          </label>
          <label className="field"><span>Provider reference / SMS code</span><input value={ref} onChange={(e) => setRef(e.target.value)} /></label>
        </div>
      )}
      <p className="small muted" style={{ margin: 0 }}>
        {mode === "REQUEST" ? "The shop gets an alarm. Staff acknowledge, do the reload on the provider device, and record the result here." : "Do the reload on the provider device first, then record what happened."}
        {" "}A sale and wallet deduction are recorded only when the reload is confirmed successful.
      </p>
      {error && <p className="note note-err" role="alert">{error}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}>
        <button className="btn btn-primary" disabled={pending || !mobile || !amount || !wallet} onClick={() => start(async () => {
          setError(null);
          const r = await submitReload({
            idempotencyKey: key, walletId: wallet!.id, network, mobile, amount, customerId: customer?.id ?? null, collection, notes: notes || null,
            locationId: mode === "REQUEST" ? locationId : null, assignedToId: assignee || null,
            doneNow: mode === "COUNTER" ? { result, providerRef: ref || null } : null,
          });
          if (r?.error) setError(r.error);
        })}>{pending ? "Saving…" : mode === "REQUEST" ? "Send reload request" : "Record reload"}</button>
      </div>
    </section>
  );
}
