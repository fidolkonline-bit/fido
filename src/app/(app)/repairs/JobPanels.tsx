"use client";

import { useActionState, useState, useTransition } from "react";
import { doStatus, doDiagnosis, doCharges, doPayment, doRefund, doIssuePart, doReveal, doRoute, doSendOutside, doReturnFromOutside, quickAddRepairShop } from "./actions";
import { SearchSelect, type SearchOption } from "@/components/SearchSelect";
import { SubmitButton } from "@/components/SubmitButton";
import { ProductSearch } from "@/components/ProductSearch";
import { listLayers, type LayerHit, type ProductHit } from "../search";
import { PatternPad } from "./PatternPad";

type Res = { error?: string; ok?: string } | undefined;
const Msg = ({ s }: { s: Res }) => (s?.error ? <p className="error-text" style={{ margin: 0 }}>{s.error}</p> : s?.ok ? <p className="small" style={{ color: "var(--ok)", margin: 0 }}>{s.ok}</p> : null);

// Each status button carries its own target: render separate tiny forms so the right one is submitted.
// "Ready" is split in two: repaired, or could not repair (with a reason and an optional checking fee).
export function StatusButtons({ jobId, next, labels, reasons, partsOnJob }: { jobId: string; next: string[]; labels: Record<string, string>; reasons: string[]; partsOnJob: number }) {
  const [state, action] = useActionState(doStatus, undefined);
  const [note, setNote] = useState("");
  const [failing, setFailing] = useState(false);
  if (!next.length) return null;
  const hidden = (to: string) => <><input type="hidden" name="jobId" value={jobId} /><input type="hidden" name="to" value={to} /><input type="hidden" name="note" value={note} /></>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for this change (optional)" aria-label="Status note" />
      <div className="row">
        {next.map((s) => s === "READY" ? (
          <span key={s} className="row" style={{ gap: 8 }}>
            <form action={action}>{hidden(s)}<input type="hidden" name="outcome" value="REPAIRED" />
              <SubmitButton className="btn btn-primary" pendingText="…">✓ Repaired — ready to collect</SubmitButton>
            </form>
            <button type="button" className="btn" aria-expanded={failing} onClick={() => setFailing(!failing)}>✗ Could not repair…</button>
          </span>
        ) : (
          <form key={s} action={action}>
            {hidden(s)}
            <SubmitButton className={s === "COLLECTED" ? "btn btn-primary" : s === "CANCELLED" ? "btn btn-danger" : "btn"} pendingText="…">{s === "COLLECTED" ? "Hand over to customer" : `→ ${labels[s]}`}</SubmitButton>
          </form>
        ))}
      </div>
      {failing && next.includes("READY") && (
        <form action={action} className="panel stack" style={{ gap: 10 }}>
          {hidden("READY")}<input type="hidden" name="outcome" value="NOT_REPAIRED" />
          <div className="grid2">
            <label className="field"><span>Why could it not be repaired?</span>
              <select name="reason" required defaultValue=""><option value="" disabled>Choose a reason</option>{reasons.map((r) => <option key={r}>{r}</option>)}</select>
            </label>
            <label className="field"><span>Checking fee to charge (Rs.)</span><input name="fee" inputMode="decimal" placeholder="Empty = keep the labour charge" /></label>
          </div>
          {partsOnJob > 0 && <p className="small" style={{ margin: 0, color: "var(--warn)" }}>{partsOnJob} part{partsOnJob > 1 ? "s are" : " is"} still issued to this job and on the bill. Return unused parts to stock first (Parts, below).</p>}
          <p className="small muted" style={{ margin: 0 }}>The customer gets a “could not repair” SMS, and the job gets no repair warranty.</p>
          <div className="row"><SubmitButton className="btn btn-primary" pendingText="…">Ready to collect — not repaired</SubmitButton><button type="button" className="btn" onClick={() => setFailing(false)}>Cancel</button></div>
        </form>
      )}
      <Msg s={state} />
    </div>
  );
}

// In-house or outside shop: two big buttons until chosen, then a small "change" link.
export function RoutePicker({ jobId, route, locked }: { jobId: string; route: string | null; locked: boolean }) {
  const [state, action] = useActionState(doRoute, undefined);
  const [changing, setChanging] = useState(false);
  const btn = (r: string, label: string, hint: string) => (
    <form action={action} style={{ flex: "1 1 220px" }}>
      <input type="hidden" name="jobId" value={jobId} /><input type="hidden" name="route" value={r} />
      <SubmitButton className={"btn route-btn" + (route === r ? " btn-primary" : "")} pendingText="…"><strong style={{ fontWeight: 500 }}>{label}</strong><span className="small muted">{hint}</span></SubmitButton>
    </form>
  );
  if (route && !changing) {
    return (
      <div className="row">
        <span>{route === "IN_HOUSE" ? "In-house — our technician, parts from our stock." : "Outsourced — sent to an outside repair shop."}</span>
        {!locked && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setChanging(true)}>Change</button>}
        <Msg s={state} />
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ alignItems: "stretch" }}>
        {btn("IN_HOUSE", "Repair in-house", "We fix it here and issue spare parts")}
        {btn("OUTSOURCED", "Outsource", "Send it to another repair shop")}
      </div>
      {changing && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setChanging(false)}>Keep as it is</button>}
      <Msg s={state} />
    </div>
  );
}

export function SendOutsideForm({ jobId, shops }: { jobId: string; shops: SearchOption[] }) {
  const [state, action] = useActionState(doSendOutside, undefined);
  const [list, setList] = useState(shops);
  const [vendorId, setVendorId] = useState("");
  const [adding, setAdding] = useState<{ name: string; phone: string } | null>(null);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form action={action} className="stack" style={{ gap: 10 }}>
      <input type="hidden" name="jobId" value={jobId} />
      {adding ? (
        <div className="grid3">
          <input placeholder="Outside shop name" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} aria-label="Outside shop name" />
          <input placeholder="Phone" type="tel" value={adding.phone} onChange={(e) => setAdding({ ...adding, phone: e.target.value })} aria-label="Outside shop phone" />
          <div className="row">
            <button type="button" className="btn" onClick={() => setAdding(null)}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => start(async () => {
              const r = await quickAddRepairShop(adding.name, adding.phone);
              if (r.error || !r.id) { setAddErr(r.error ?? "Could not save."); return; }
              setList((l) => [...l, { id: r.id!, name: r.name! }]); setVendorId(r.id); setAdding(null); setAddErr(null);
            })}>Save shop</button>
          </div>
          {addErr && <p className="error-text" style={{ margin: 0 }}>{addErr}</p>}
        </div>
      ) : (
        <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-end" }}>
          <label className="field" style={{ flex: 1 }}><span>Outside shop *</span>
            <SearchSelect key={list.length} name="vendorId" label="Outside shop" options={list} defaultValue={vendorId} onChange={setVendorId} placeholder="Search shop…" noneLabel="Choose the shop…" />
          </label>
          <button type="button" className="btn" onClick={() => setAdding({ name: "", phone: "" })}>+ New shop</button>
        </div>
      )}
      <div className="grid3">
        <label className="field"><span>Their quote (Rs.)</span><input name="quote" inputMode="decimal" placeholder="If they gave one" /></label>
        <label className="field"><span>Expected back</span><input name="expectedAt" type="datetime-local" /></label>
        <label className="field"><span>Note</span><input name="note" placeholder="e.g. board repair, sent with charger" maxLength={300} /></label>
      </div>
      <div className="row"><SubmitButton className="btn btn-primary">Send to outside shop</SubmitButton><Msg s={state} /></div>
    </form>
  );
}

export function ReturnFromOutsideForm({ jobId, outsourceId, shop, quote }: { jobId: string; outsourceId: string; shop: string; quote: string }) {
  const [state, action] = useActionState(doReturnFromOutside, undefined);
  return (
    <form action={action} className="stack" style={{ gap: 10 }}>
      <input type="hidden" name="jobId" value={jobId} /><input type="hidden" name="outsourceId" value={outsourceId} />
      <p className="small" style={{ margin: 0 }}>When the device comes back from <strong style={{ fontWeight: 500 }}>{shop}</strong>:</p>
      <div className="grid3">
        <label className="field"><span>Did they fix it?</span>
          <select name="result" required defaultValue=""><option value="" disabled>Choose</option><option value="REPAIRED">Yes, fixed</option><option value="NOT_REPAIRED">No, not fixed</option></select>
        </label>
        <label className="field"><span>They charged us (Rs.)</span><input name="cost" inputMode="decimal" defaultValue={quote} /></label>
        <label className="field"><span>Note</span><input name="note" maxLength={300} /></label>
      </div>
      <div className="row"><SubmitButton className="btn btn-primary">Device is back</SubmitButton><Msg s={state} /></div>
      <p className="small muted" style={{ margin: 0 }}>It moves to Testing so you can check it here before calling the customer. Their charge becomes the job&apos;s outside cost.</p>
    </form>
  );
}

export function DiagnosisForm({ jobId, diagnosis, estimate, technicianId, promisedAt, technicians, canAsk }: { jobId: string; diagnosis: string; estimate: string; technicianId: string; promisedAt: string; technicians: { id: string; name: string }[]; canAsk: boolean }) {
  const [state, action] = useActionState(doDiagnosis, undefined);
  return (
    <form action={action} className="stack" style={{ gap: 10 }}>
      <input type="hidden" name="jobId" value={jobId} />
      <label className="field"><span>Diagnosis / work needed</span><textarea name="diagnosis" defaultValue={diagnosis} rows={2} /></label>
      <div className="grid3">
        <label className="field"><span>Estimate (Rs.)</span><input name="estimate" defaultValue={estimate} inputMode="decimal" /></label>
        <label className="field"><span>Technician</span><select name="technicianId" defaultValue={technicianId}><option value="">Not assigned</option>{technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label className="field"><span>Promised</span><input name="promisedAt" type="datetime-local" defaultValue={promisedAt} /></label>
      </div>
      {canAsk && <label className="check"><input type="checkbox" name="askApproval" defaultChecked /> Ask customer to approve the estimate (SMS)</label>}
      <div className="row"><SubmitButton className="btn">Save diagnosis</SubmitButton><Msg s={state} /></div>
    </form>
  );
}

export function ChargesForm({ jobId, labour, other, discount, externalCost, warrantyDays, outsideFromTrips }: { jobId: string; labour: string; other: string; discount: string; externalCost: string; warrantyDays: string; outsideFromTrips: boolean }) {
  const [state, action] = useActionState(doCharges, undefined);
  return (
    <form action={action} className="stack" style={{ gap: 10 }}>
      <input type="hidden" name="jobId" value={jobId} />
      <div className="grid3">
        <label className="field"><span>Labour charge</span><input name="labour" defaultValue={labour} inputMode="decimal" /></label>
        <label className="field"><span>Other charge</span><input name="other" defaultValue={other} inputMode="decimal" /></label>
        <label className="field"><span>Discount</span><input name="discount" defaultValue={discount} inputMode="decimal" /></label>
        {outsideFromTrips
          ? <div className="field"><span>Outside repair cost (our cost)</span><span className="small muted">Rs. {externalCost} — from the outside shop records</span><input type="hidden" name="externalCost" value={externalCost} /></div>
          : <label className="field"><span>Outside repair cost (our cost)</span><input name="externalCost" defaultValue={externalCost} inputMode="decimal" /></label>}
        <label className="field"><span>Warranty days</span><input name="warrantyDays" defaultValue={warrantyDays} inputMode="numeric" /></label>
      </div>
      <div className="row"><SubmitButton className="btn">Update bill</SubmitButton><Msg s={state} /></div>
    </form>
  );
}

export function PaymentForm({ jobId, due, accounts }: { jobId: string; due: string; accounts: { id: string; name: string }[] }) {
  const [state, action] = useActionState(doPayment, undefined);
  const [method, setMethod] = useState("CASH");
  return (
    <form action={action} className="stack" style={{ gap: 10 }} key={due}>
      <input type="hidden" name="jobId" value={jobId} />
      <div className="grid3">
        <label className="field"><span>Amount</span><input name="amount" defaultValue={Number(due) > 0 ? due : ""} inputMode="decimal" /></label>
        <label className="field"><span>Method</span><select name="method" value={method} onChange={(e) => setMethod(e.target.value)}><option value="CASH">Cash (my register)</option><option value="CARD">Card</option><option value="BANK_TRANSFER">Bank transfer</option><option value="OTHER">Other</option></select></label>
        {method !== "CASH" && <label className="field"><span>Account</span><select name="accountId"><option value="">Default</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
      </div>
      <div className="row"><SubmitButton className="btn btn-primary">Take payment</SubmitButton><Msg s={state} /></div>
    </form>
  );
}

export function RefundForm({ jobId, owed, accounts }: { jobId: string; owed: string; accounts: { id: string; name: string }[] }) {
  const [state, action] = useActionState(doRefund, undefined);
  const [method, setMethod] = useState("CASH");
  return (
    <form action={action} className="stack" style={{ gap: 10 }} key={owed}>
      <input type="hidden" name="jobId" value={jobId} />
      <p className="small" style={{ margin: 0, color: "var(--warn)" }}>Rs. {owed} is owed back to the customer.</p>
      <div className="grid3">
        <label className="field"><span>Refund amount</span><input name="amount" defaultValue={owed} inputMode="decimal" /></label>
        <label className="field"><span>Given back by</span><select name="method" value={method} onChange={(e) => setMethod(e.target.value)}><option value="CASH">Cash (my register)</option><option value="CARD">Card reversal</option><option value="BANK_TRANSFER">Bank transfer</option><option value="OTHER">Other</option></select></label>
        {method !== "CASH" && <label className="field"><span>Account</span><select name="accountId"><option value="">Default</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
      </div>
      <div className="row"><SubmitButton className="btn">Refund customer</SubmitButton><Msg s={state} /></div>
    </form>
  );
}

export function IssuePart({ jobId }: { jobId: string }) {
  const [p, setP] = useState<ProductHit | null>(null);
  const [layers, setLayers] = useState<LayerHit[]>([]);
  const [form, setForm] = useState({ qty: "1", price: "", layerId: "" });
  const [res, setRes] = useState<Res>(undefined);
  const [pending, start] = useTransition();
  return (
    <div className="stack" style={{ gap: 8 }}>
      {!p ? (
        <ProductSearch placeholder="Search part to issue (e.g. screen, battery)" onPick={async (x) => { setP(x); setForm({ qty: "1", price: x.price, layerId: "" }); setLayers(await listLayers(x.id)); }} />
      ) : (
        <div className="row" style={{ alignItems: "flex-end" }}>
          <span style={{ flex: "1 1 180px" }}><strong style={{ fontWeight: 500 }}>{p.name}</strong><br /><span className="small muted">{p.available} in stock</span></span>
          <label className="field" style={{ width: 80 }}><span>Qty</span><input value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} inputMode="decimal" /></label>
          <label className="field" style={{ width: 110 }}><span>Charge each</span><input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" /></label>
          <label className="field" style={{ width: 170 }}><span>Lot</span><select value={form.layerId} onChange={(e) => setForm({ ...form, layerId: e.target.value })}><option value="">Oldest first</option>{layers.map((l) => <option key={l.id} value={l.id}>{l.lotCode ?? "No lot"} · {Number(l.qtyRemaining)}</option>)}</select></label>
          <button className="btn" onClick={() => setP(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={pending} onClick={() => start(async () => {
            const r = await doIssuePart(jobId, { productId: p.id, qty: Number(form.qty), unitPrice: Number(form.price) || 0, layerId: form.layerId || null });
            setRes(r);
            if (!r.error) setP(null);
          })}>{pending ? "Issuing…" : "Issue part"}</button>
        </div>
      )}
      <Msg s={res} />
    </div>
  );
}

export function CredentialReveal({ jobId, type }: { jobId: string; type: string }) {
  const [shown, setShown] = useState<{ type?: string; value?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  if (shown?.value) {
    return (
      <div className="stack" style={{ gap: 6 }}>
        {shown.type === "PATTERN" ? <PatternPad value={shown.value} readOnly /> : <strong style={{ fontSize: 22, letterSpacing: 3, fontVariantNumeric: "tabular-nums" }}>{shown.value}</strong>}
        <button className="btn btn-sm" onClick={() => setShown(null)}>Hide</button>
      </div>
    );
  }
  return (
    <div className="row">
      <span className="muted">{type.toLowerCase()} · ••••••</span>
      <button className="btn btn-sm" disabled={pending} onClick={() => start(async () => setShown(await doReveal(jobId)))}>Reveal (logged)</button>
      {shown?.error && <span className="error-text">{shown.error}</span>}
    </div>
  );
}
