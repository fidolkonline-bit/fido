"use client";

import { useRef, useState, useTransition } from "react";
import { submitIntake } from "./actions";
import { searchCustomers } from "../pos/actions";
import { quickAddCustomer } from "../contacts/actions";
import { PatternPad } from "./PatternPad";

type Customer = { id: string; name: string; phone: string | null };
const ACCESSORIES = ["Charger", "Cable", "Back cover / case", "Box", "Earphones", "Stylus"];

export function IntakeForm({ technicians }: { technicians: { id: string; name: string }[] }) {
  const [key] = useState(() => crypto.randomUUID());
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [custQ, setCustQ] = useState("");
  const [hits, setHits] = useState<Customer[]>([]);
  const [newCust, setNewCust] = useState<{ name: string; phone: string } | null>(null);
  const [f, setF] = useState({ serviceType: "CARRY_IN", deviceBrand: "", deviceModel: "", imei: "", serial: "", color: "", simCount: "0", memoryCard: false, condition: "", problem: "", technicianId: "", estimate: "", promisedAt: "" });
  const [acc, setAcc] = useState<string[]>([]);
  const [credType, setCredType] = useState<"NONE" | "PIN" | "PATTERN" | "PASSWORD">("NONE");
  const [cred, setCred] = useState("");
  const [deposit, setDeposit] = useState({ amount: "", method: "CASH" });
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  const find = (v: string) => {
    setCustQ(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => setHits(v.trim() ? await searchCustomers(v) : []), 200);
  };

  const submit = () => start(async () => {
    setError(null);
    const r = await submitIntake({
      idempotencyKey: key, customerId: customer?.id ?? "", serviceType: f.serviceType, deviceBrand: f.deviceBrand || null, deviceModel: f.deviceModel,
      imei: f.imei || null, serial: f.serial || null, color: f.color || null, simCount: Number(f.simCount), memoryCard: f.memoryCard,
      accessories: acc.join(", ") || null, condition: f.condition || null, problem: f.problem, credentialType: credType, credential: credType === "NONE" ? null : cred,
      technicianId: f.technicianId || null, estimate: f.estimate === "" ? null : Number(f.estimate), promisedAt: f.promisedAt ? new Date(f.promisedAt) : null,
      deposit: Number(deposit.amount) > 0 ? { amount: Number(deposit.amount), method: deposit.method } : null, notifyCustomer: notify,
    });
    if (r?.error) setError(r.error);
  });

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>1 · Customer</h2>
        {customer ? (
          <div className="row"><strong style={{ fontWeight: 500 }}>{customer.name}</strong><span className="muted">{customer.phone ?? "no mobile — SMS updates off"}</span><div className="spacer" /><button className="btn btn-sm" onClick={() => setCustomer(null)}>Change</button></div>
        ) : newCust ? (
          <div className="grid3">
            <input placeholder="Customer name" value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} />
            <input placeholder="Mobile (for SMS updates)" type="tel" inputMode="tel" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} />
            <div className="row"><button className="btn" onClick={() => setNewCust(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={async () => { try { setCustomer(await quickAddCustomer(newCust.name, newCust.phone)); setNewCust(null); } catch (e) { setError((e as Error).message); } }}>Save</button></div>
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input value={custQ} onChange={(e) => find(e.target.value)} placeholder="Search name or mobile" aria-label="Find customer" />
              <button className="btn" onClick={() => setNewCust({ name: /^\d/.test(custQ) ? "" : custQ, phone: /^\d/.test(custQ) ? custQ : "" })}>+ New</button>
            </div>
            {hits.length > 0 && (
              <div className="panel" style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 10, padding: 0 }}>
                {hits.map((c) => <button key={c.id} className="btn-ghost" style={{ width: "100%", justifyContent: "space-between", borderRadius: 0 }} onClick={() => { setCustomer(c); setHits([]); setCustQ(""); }}><span>{c.name}</span><span className="muted small">{c.phone}</span></button>)}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>2 · Device</h2>
        <div className="grid3">
          <label className="field"><span>Brand</span><input value={f.deviceBrand} onChange={(e) => set("deviceBrand", e.target.value)} placeholder="Samsung" /></label>
          <label className="field"><span>Model *</span><input value={f.deviceModel} onChange={(e) => set("deviceModel", e.target.value)} placeholder="Galaxy A15" /></label>
          <label className="field"><span>Colour</span><input value={f.color} onChange={(e) => set("color", e.target.value)} /></label>
          <label className="field"><span>IMEI</span><input value={f.imei} onChange={(e) => set("imei", e.target.value)} inputMode="numeric" /></label>
          <label className="field"><span>Serial</span><input value={f.serial} onChange={(e) => set("serial", e.target.value)} /></label>
          <label className="field"><span>Service</span>
            <select value={f.serviceType} onChange={(e) => set("serviceType", e.target.value)}><option value="CARRY_IN">Carry-in</option><option value="PICKUP">Pickup</option><option value="ON_SITE">On-site</option></select>
          </label>
        </div>
        <div className="row" style={{ gap: 16 }}>
          <label className="field" style={{ width: 120 }}><span>SIM cards in</span><select value={f.simCount} onChange={(e) => set("simCount", e.target.value)}><option>0</option><option>1</option><option>2</option></select></label>
          <label className="check"><input type="checkbox" checked={f.memoryCard} onChange={(e) => set("memoryCard", e.target.checked)} /> Memory card in</label>
          {ACCESSORIES.map((a) => <label key={a} className="check"><input type="checkbox" checked={acc.includes(a)} onChange={(e) => setAcc(e.target.checked ? [...acc, a] : acc.filter((x) => x !== a))} /> {a}</label>)}
        </div>
        <label className="field"><span>Condition (scratches, cracks, missing screws…)</span><textarea value={f.condition} onChange={(e) => set("condition", e.target.value)} rows={2} /></label>
        <label className="field"><span>Problem reported *</span><textarea value={f.problem} onChange={(e) => set("problem", e.target.value)} rows={2} /></label>
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>3 · Unlock code</h2>
        <p className="small muted" style={{ margin: 0 }}>Stored encrypted. Only people allowed to see unlock codes can reveal it, every reveal is logged, and it is deleted at handover. It never prints on stickers or goes in SMS.</p>
        <div className="row">
          {(["NONE", "PIN", "PATTERN", "PASSWORD"] as const).map((t) => <label key={t} className="check"><input type="radio" name="cred" checked={credType === t} onChange={() => { setCredType(t); setCred(""); }} /> {t === "NONE" ? "None / not given" : t.toLowerCase()}</label>)}
        </div>
        {(credType === "PIN" || credType === "PASSWORD") && <input value={cred} onChange={(e) => setCred(e.target.value)} type="password" autoComplete="off" inputMode={credType === "PIN" ? "numeric" : "text"} placeholder={credType === "PIN" ? "PIN" : "Password"} style={{ maxWidth: 260 }} />}
        {credType === "PATTERN" && <PatternPad value={cred} onChange={setCred} />}
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>4 · Job</h2>
        <div className="grid3">
          <label className="field"><span>Technician</span><select value={f.technicianId} onChange={(e) => set("technicianId", e.target.value)}><option value="">Not assigned</option>{technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label className="field"><span>Estimate (Rs.)</span><input value={f.estimate} onChange={(e) => set("estimate", e.target.value)} inputMode="decimal" /></label>
          <label className="field"><span>Promised date / time</span><input type="datetime-local" value={f.promisedAt} onChange={(e) => set("promisedAt", e.target.value)} /></label>
          <label className="field"><span>Advance / deposit</span><input value={deposit.amount} onChange={(e) => setDeposit({ ...deposit, amount: e.target.value })} inputMode="decimal" placeholder="0.00" /></label>
          {Number(deposit.amount) > 0 && <label className="field"><span>Paid by</span><select value={deposit.method} onChange={(e) => setDeposit({ ...deposit, method: e.target.value })}><option value="CASH">Cash</option><option value="CARD">Card</option><option value="BANK_TRANSFER">Bank transfer</option></select></label>}
        </div>
        <label className="check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> SMS the job number to the customer</label>
        {error && <p className="note note-err" role="alert">{error}</p>}
        <div className="form-actions" style={{ marginTop: 0 }}><button className="btn btn-primary" disabled={pending || !customer || !f.deviceModel || !f.problem} onClick={submit}>{pending ? "Saving…" : "Create job"}</button></div>
      </section>
    </div>
  );
}
