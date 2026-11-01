"use client";

import { useActionState, useState, useTransition } from "react";
import { doStatus, doDiagnosis, doCharges, doPayment, doIssuePart, doReveal } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { ProductSearch } from "@/components/ProductSearch";
import { listLayers, type LayerHit, type ProductHit } from "../search";
import { PatternPad } from "./PatternPad";

type Res = { error?: string; ok?: string } | undefined;
const Msg = ({ s }: { s: Res }) => (s?.error ? <p className="error-text" style={{ margin: 0 }}>{s.error}</p> : s?.ok ? <p className="small" style={{ color: "var(--ok)", margin: 0 }}>{s.ok}</p> : null);

// Each status button carries its own target: render separate tiny forms so the right one is submitted.
export function StatusButtons({ jobId, next, labels }: { jobId: string; next: string[]; labels: Record<string, string> }) {
  const [state, action] = useActionState(doStatus, undefined);
  const [note, setNote] = useState("");
  if (!next.length) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for this change (optional)" aria-label="Status note" />
      <div className="row">
        {next.map((s) => (
          <form key={s} action={action}>
            <input type="hidden" name="jobId" value={jobId} /><input type="hidden" name="to" value={s} /><input type="hidden" name="note" value={note} />
            <SubmitButton className={s === "READY" || s === "COLLECTED" ? "btn btn-primary" : s === "CANCELLED" ? "btn btn-danger" : "btn"} pendingText="…">{s === "COLLECTED" ? "Hand over to customer" : `→ ${labels[s]}`}</SubmitButton>
          </form>
        ))}
      </div>
      <Msg s={state} />
    </div>
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

export function ChargesForm({ jobId, labour, other, discount, externalCost, warrantyDays }: { jobId: string; labour: string; other: string; discount: string; externalCost: string; warrantyDays: string }) {
  const [state, action] = useActionState(doCharges, undefined);
  return (
    <form action={action} className="stack" style={{ gap: 10 }}>
      <input type="hidden" name="jobId" value={jobId} />
      <div className="grid3">
        <label className="field"><span>Labour charge</span><input name="labour" defaultValue={labour} inputMode="decimal" /></label>
        <label className="field"><span>Other charge</span><input name="other" defaultValue={other} inputMode="decimal" /></label>
        <label className="field"><span>Discount</span><input name="discount" defaultValue={discount} inputMode="decimal" /></label>
        <label className="field"><span>Outside repair cost (our cost)</span><input name="externalCost" defaultValue={externalCost} inputMode="decimal" /></label>
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
