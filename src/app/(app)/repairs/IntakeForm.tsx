"use client";

import { useRef, useState, useTransition } from "react";
import { submitIntake } from "./actions";
import { searchCustomers } from "../pos/actions";
import { quickAddCustomer } from "../contacts/actions";
import { PatternPad } from "./PatternPad";
import { SignaturePad } from "@/components/SignaturePad";
import { ScanButton } from "@/components/CameraScan";

type Customer = { id: string; name: string; phone: string | null };
const ACCESSORIES = ["Charger", "Cable", "Back cover / case", "Box", "Earphones", "Stylus"];
const PROBLEMS = ["Screen broken", "Battery drains fast", "Not charging", "No power", "Water damage", "Speaker / mic", "Camera", "Software / hanging"];
const CRED_TYPES = [["NONE", "None"], ["PIN", "PIN"], ["PATTERN", "Pattern"], ["PASSWORD", "Password"]] as const;

export type IntakePrefill = { customer: Customer | null; deviceModel: string; imei: string; serial: string; claim: { saleLineId: string; deviceId: string | null; label: string; inWarranty: boolean } | null };

// <input type="datetime-local"> wants local time as YYYY-MM-DDTHH:mm.
const localStamp = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
function promiseIn(days: number) {
  const d = new Date();
  if (days === 0 && d.getHours() >= 17) { d.setHours(d.getHours() + 1, 0, 0, 0); return localStamp(d); }
  d.setDate(d.getDate() + days);
  d.setHours(18, 0, 0, 0);
  return localStamp(d);
}

function Pick({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className="pick" aria-pressed={on} onClick={onClick}>{children}</button>;
}

export function IntakeForm({ technicians, terms, prefill }: { technicians: { id: string; name: string }[]; terms: string; prefill?: IntakePrefill }) {
  const [key] = useState(() => crypto.randomUUID());
  const [customer, setCustomer] = useState<Customer | null>(prefill?.customer ?? null);
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [custQ, setCustQ] = useState("");
  const [hits, setHits] = useState<Customer[]>([]);
  const [newCust, setNewCust] = useState<{ name: string; phone: string } | null>(null);
  const [f, setF] = useState({ serviceType: "CARRY_IN", deviceBrand: "", deviceModel: prefill?.deviceModel ?? "", imei: prefill?.imei ?? "", serial: prefill?.serial ?? "", color: "", simCount: "0", memoryCard: false, condition: "", problem: "", technicianId: "", estimate: "", promisedAt: "" });
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
  const startNewCustomer = () => setNewCust({ name: /^\d/.test(custQ) ? "" : custQ, phone: /^\d/.test(custQ) ? custQ : "" });

  // Quick problem buttons add/remove their phrase in the problem text; anything typed stays.
  const problemParts = f.problem.split(",").map((s) => s.trim()).filter(Boolean);
  const toggleProblem = (p: string) => set("problem", (problemParts.includes(p) ? problemParts.filter((x) => x !== p) : [...problemParts, p]).join(", "));

  const extrasFilled = [f.deviceBrand, f.color, f.serial, f.serviceType !== "CARRY_IN", f.condition, f.technicianId, f.estimate, f.promisedAt, Number(deposit.amount) > 0].filter(Boolean).length;
  const missing = [!customer && "customer", !f.deviceModel.trim() && "model", !f.problem.trim() && "problem", credType !== "NONE" && !cred && "unlock code"].filter(Boolean) as string[];

  const submit = () => start(async () => {
    setError(null);
    const r = await submitIntake({
      idempotencyKey: key, customerId: customer?.id ?? "", serviceType: f.serviceType, deviceBrand: f.deviceBrand || null, deviceModel: f.deviceModel,
      imei: f.imei || null, serial: f.serial || null, color: f.color || null, simCount: Number(f.simCount), memoryCard: f.memoryCard,
      accessories: acc.join(", ") || null, condition: f.condition || null, problem: f.problem, credentialType: credType, credential: credType === "NONE" ? null : cred,
      technicianId: f.technicianId || null, estimate: f.estimate === "" ? null : Number(f.estimate), promisedAt: f.promisedAt ? new Date(f.promisedAt) : null,
      deposit: Number(deposit.amount) > 0 ? { amount: Number(deposit.amount), method: deposit.method } : null, notifyCustomer: notify,
      termsAccepted: agreed, signature: agreed ? signature : null, claimSaleLineId: prefill?.claim?.saleLineId ?? null, claimDeviceId: prefill?.claim?.deviceId ?? null,
    });
    if (r?.error) setError(r.error);
  });

  return (
    <div className="stack">
      {prefill?.claim && (
        <p className={"note " + (prefill.claim.inWarranty ? "note-ok" : "note-err")}>
          {prefill.claim.inWarranty ? "Warranty claim" : "Out of warranty"} — {prefill.claim.label}. The job is linked to the original sale.
          {!prefill.claim.inWarranty && " Charge it as a normal repair."}
        </p>
      )}

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>1 · Customer *</h2>
        {customer ? (
          <div className="row"><strong style={{ fontWeight: 500 }}>{customer.name}</strong><span className="muted">{customer.phone ?? "no mobile — SMS updates off"}</span><div className="spacer" /><button className="btn btn-sm" onClick={() => setCustomer(null)}>Change</button></div>
        ) : newCust ? (
          <div className="grid3">
            <input placeholder="Customer name" value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} aria-label="Customer name" />
            <input placeholder="Mobile (for SMS updates)" type="tel" inputMode="tel" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} aria-label="Mobile" />
            <div className="row"><button className="btn" onClick={() => setNewCust(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={async () => { try { setCustomer(await quickAddCustomer(newCust.name, newCust.phone)); setNewCust(null); } catch (e) { setError((e as Error).message); } }}>Save customer</button></div>
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input value={custQ} onChange={(e) => find(e.target.value)} placeholder="Name or mobile" aria-label="Find customer" />
              <button className="btn" onClick={startNewCustomer}>+ New customer</button>
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
        <h2 style={{ margin: 0 }}>2 · Device and problem</h2>
        <div className="grid2">
          <label className="field"><span>Model *</span><input value={f.deviceModel} onChange={(e) => set("deviceModel", e.target.value)} placeholder="e.g. Samsung Galaxy A15" /></label>
          <label className="field"><span>IMEI</span><span className="row" style={{ flexWrap: "nowrap" }}><input value={f.imei} onChange={(e) => set("imei", e.target.value)} inputMode="numeric" /><ScanButton onCode={(c) => set("imei", c.replace(/\D/g, ""))} label="Scan IMEI" /></span></label>
        </div>
        <div>
          <p className="pick-label">What is wrong? * — tap any that apply, or type below</p>
          <div className="picks">{PROBLEMS.map((p) => <Pick key={p} on={problemParts.includes(p)} onClick={() => toggleProblem(p)}>{p}</Pick>)}</div>
        </div>
        <textarea value={f.problem} onChange={(e) => set("problem", e.target.value)} rows={2} placeholder="Problem in the customer's words" aria-label="Problem reported" />
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>3 · Left with the device</h2>
        <div>
          <p className="pick-label">SIM cards inside</p>
          <div className="picks">{["0", "1", "2"].map((n) => <Pick key={n} on={f.simCount === n} onClick={() => set("simCount", n)}>{n === "0" ? "No SIM" : `${n} SIM`}</Pick>)}</div>
        </div>
        <div>
          <p className="pick-label">Also left — tap what the customer handed over</p>
          <div className="picks">
            <Pick on={f.memoryCard} onClick={() => set("memoryCard", !f.memoryCard)}>Memory card</Pick>
            {ACCESSORIES.map((a) => <Pick key={a} on={acc.includes(a)} onClick={() => setAcc(acc.includes(a) ? acc.filter((x) => x !== a) : [...acc, a])}>{a}</Pick>)}
          </div>
        </div>
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>4 · Unlock code</h2>
        <div className="picks">{CRED_TYPES.map(([t, label]) => <Pick key={t} on={credType === t} onClick={() => { setCredType(t); setCred(""); }}>{label}</Pick>)}</div>
        {(credType === "PIN" || credType === "PASSWORD") && <input value={cred} onChange={(e) => setCred(e.target.value)} type="password" autoComplete="off" inputMode={credType === "PIN" ? "numeric" : "text"} placeholder={credType === "PIN" ? "Enter PIN" : "Enter password"} aria-label={credType === "PIN" ? "PIN" : "Password"} style={{ maxWidth: 260 }} />}
        {credType === "PATTERN" && <PatternPad value={cred} onChange={setCred} />}
        <p className="small muted" style={{ margin: 0 }}>Kept encrypted and deleted at handover. Never printed or sent by SMS.</p>
      </section>

      <details className="panel fold" open={!!prefill?.serial || undefined}>
        <summary><h2>More details</h2><span className="small muted">{extrasFilled ? `${extrasFilled} filled` : "optional — technician, estimate, date…"}</span></summary>
        <div className="stack">
          <div className="grid3">
            <label className="field"><span>Technician</span><select value={f.technicianId} onChange={(e) => set("technicianId", e.target.value)}><option value="">Not assigned</option>{technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <label className="field"><span>Estimate (Rs.)</span><input value={f.estimate} onChange={(e) => set("estimate", e.target.value)} inputMode="decimal" /></label>
            <label className="field"><span>Advance paid (Rs.)</span><input value={deposit.amount} onChange={(e) => setDeposit({ ...deposit, amount: e.target.value })} inputMode="decimal" placeholder="0.00" /></label>
            {Number(deposit.amount) > 0 && <label className="field"><span>Advance paid by</span><select value={deposit.method} onChange={(e) => setDeposit({ ...deposit, method: e.target.value })}><option value="CASH">Cash</option><option value="CARD">Card</option><option value="BANK_TRANSFER">Bank transfer</option></select></label>}
          </div>
          <div>
            <p className="pick-label">Ready by</p>
            <div className="row">
              <Pick on={false} onClick={() => set("promisedAt", promiseIn(0))}>Today</Pick>
              <Pick on={false} onClick={() => set("promisedAt", promiseIn(1))}>Tomorrow</Pick>
              <Pick on={false} onClick={() => set("promisedAt", promiseIn(3))}>In 3 days</Pick>
              <input type="datetime-local" value={f.promisedAt} onChange={(e) => set("promisedAt", e.target.value)} aria-label="Ready by date and time" style={{ width: "auto", minWidth: 200 }} />
            </div>
          </div>
          <label className="field"><span>Condition (scratches, cracks, missing screws…)</span><textarea value={f.condition} onChange={(e) => set("condition", e.target.value)} rows={2} /></label>
          <div className="grid3">
            <label className="field"><span>Brand</span><input value={f.deviceBrand} onChange={(e) => set("deviceBrand", e.target.value)} placeholder="Samsung" /></label>
            <label className="field"><span>Colour</span><input value={f.color} onChange={(e) => set("color", e.target.value)} /></label>
            <label className="field"><span>Serial</span><input value={f.serial} onChange={(e) => set("serial", e.target.value)} /></label>
            <label className="field"><span>Service</span>
              <select value={f.serviceType} onChange={(e) => set("serviceType", e.target.value)}><option value="CARRY_IN">Carry-in</option><option value="PICKUP">Pickup</option><option value="ON_SITE">On-site</option></select>
            </label>
          </div>
        </div>
      </details>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>5 · Finish</h2>
        <label className="check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> SMS the job number to the customer</label>
        <label className="check"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> The customer accepts the repair terms</label>
        <details className="fold">
          <summary><span className="small">Read the terms</span></summary>
          <p className="small" style={{ margin: 0, whiteSpace: "pre-line" }}>{terms}</p>
        </details>
        {agreed && <SignaturePad onChange={setSignature} />}
        <p className="small muted" style={{ margin: 0 }}>You can add photos of the device on the next screen.</p>
      </section>

      {error && <p className="note note-err" role="alert">{error}</p>}
      <div className="intake-bar">
        <span className={"small " + (missing.length ? "muted" : "")} aria-live="polite">{missing.length ? `Still needed: ${missing.join(", ")}` : "Ready to create the job"}</span>
        <div className="spacer" />
        <button className="btn btn-primary" disabled={pending || missing.length > 0} onClick={submit}>{pending ? "Saving…" : "Create job"}</button>
      </div>
    </div>
  );
}
