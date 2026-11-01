"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { customerBalance, customerHistory, debtReceiptStatus, recordDebtPayment, smsDebtReceipt } from "./actions";
import type { LedgerView, ReceiptView } from "@/lib/debt";
import { ACCOUNT_TYPES, OPENING, checkAllocation, defaultAccount, maskPhone, suggestAllocation, sumAlloc, type Allocation } from "@/lib/debt-rules";

// Customer debt inside the POS (CR-03). Previous debt is always shown apart from the current sale and is paid with
// its own action and its own receipt; nothing typed here touches the cart, and nothing in the cart pays the debt.

export type DebtPerms = { view: boolean; receive: boolean; allocate: boolean; account: boolean; backdate: boolean };
export type RecvAccount = { id: string; name: string; type: string; locationId: string | null };
export type BalanceState = { status: "loading" } | { status: "ok"; ledger: LedgerView } | { status: "error"; error: string };

const n = (v: string | number) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const fmt = (v: string | number) => n(v).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const c2 = (v: string | number) => Math.round(n(v) * 100);
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Asia/Colombo", day: "2-digit", month: "short", year: "numeric" }) : "—");
const todayLocal = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const METHODS = [
  { v: "CASH", l: "Cash" }, { v: "CARD", l: "Card" }, { v: "BANK_TRANSFER", l: "Bank transfer" }, { v: "CHEQUE", l: "Cheque" }, { v: "OTHER", l: "Other" },
] as const;
const methodName = (m: string) => (m === "STORE_CREDIT" ? "Store credit" : METHODS.find((x) => x.v === m)?.l ?? m);

// Balance of the selected customer: loads live, and says so. A failed load never shows as Rs. 0.
export function useBalance(customerId: string | null, enabled: boolean) {
  const [state, setState] = useState<BalanceState>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!customerId || !enabled) return;
    let live = true;
    setState({ status: "loading" });
    customerBalance(customerId)
      .then((r) => { if (live) setState(r.ledger ? { status: "ok", ledger: r.ledger } : { status: "error", error: r.error ?? "Balance unavailable." }); })
      .catch(() => { if (live) setState({ status: "error", error: "Balance unavailable." }); });
    return () => { live = false; };
  }, [customerId, enabled, nonce]);
  return { state, reload: () => setNonce((x) => x + 1) };
}

export function DebtStrip({ state, perms, onReceive, onHistory, onRetry }: { state: BalanceState; perms: DebtPerms; onReceive: () => void; onHistory: () => void; onRetry: () => void }) {
  if (state.status === "loading") return <div className="small muted" aria-live="polite">Loading balance…</div>;
  if (state.status === "error") return <div className="row small" role="alert"><span style={{ color: "var(--err)" }}>Balance unavailable — {state.error}</span><button type="button" className="btn btn-sm" onClick={onRetry}>Retry</button></div>;
  const l = state.ledger;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="debt-strip" aria-label="Customer balance">
        <div>Previous debt<strong style={{ color: n(l.debt) > 0 ? "var(--err)" : undefined }}>Rs. {fmt(l.debt)}</strong></div>
        <div>Overdue<strong style={{ color: n(l.overdue) > 0 ? "var(--err)" : undefined }}>{l.customer.payTermDays === null && n(l.overdue) === 0 ? "No terms set" : `Rs. ${fmt(l.overdue)}`}</strong></div>
        <div>Advance / store credit<strong style={{ color: n(l.storeCredit) > 0 ? "var(--ok)" : undefined }}>Rs. {fmt(l.storeCredit)}</strong></div>
      </div>
      {n(l.otherBranches) > 0 && <span className="small muted">Includes Rs. {fmt(l.otherBranches)} on invoices at other branches.</span>}
      {n(l.pendingCheques) > 0 && <span className="small" style={{ color: "var(--warn)" }}>Rs. {fmt(l.pendingCheques)} paid by cheques not yet cleared.</span>}
      <div className="row">
        {perms.receive && <button type="button" className="btn btn-sm btn-primary" onClick={onReceive}>Receive payment</button>}
        <button type="button" className="btn btn-sm" onClick={onHistory}>Invoices &amp; history</button>
      </div>
    </div>
  );
}

type Phase = { kind: "edit" } | { kind: "posting" } | { kind: "unknown" } | { kind: "done"; receipt: ReceiptView };

export function RepaymentDialog({ customerId, perms, accounts, locationId, onClose, onRecorded }: {
  customerId: string; perms: DebtPerms; accounts: RecvAccount[]; locationId: string;
  onClose: () => void; onRecorded: () => void;
}) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [ledger, setLedger] = useState<BalanceState>({ status: "loading" });
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [accountId, setAccountId] = useState("");
  const [paidOn, setPaidOn] = useState(todayLocal());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [cheque, setCheque] = useState({ number: "", bank: "", realizeDate: todayLocal() });
  const [excess, setExcess] = useState<"NONE" | "ADVANCE" | "CHANGE">("NONE");
  const [manual, setManual] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "edit" });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [sms, setSms] = useState<string | null>(null);

  const load = async () => {
    setLedger({ status: "loading" });
    try {
      const r = await customerBalance(customerId);
      setLedger(r.ledger ? { status: "ok", ledger: r.ledger } : { status: "error", error: r.error ?? "Balance unavailable." });
    } catch { setLedger({ status: "error", error: "Balance unavailable." }); }
  };
  useEffect(() => { load(); }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const l = ledger.status === "ok" ? ledger.ledger : null;
  const debt = l ? n(l.debt) : 0;
  const amt = n(amount);
  const applied = Math.min(c2(amt), c2(debt)) / 100;
  const over = Math.max(0, c2(amt) - c2(debt)) / 100;
  const suggested = useMemo(() => (l ? suggestAllocation(l.obligations, applied) : []), [l, applied]);
  const alloc: Allocation[] = manual ? Object.entries(manual).filter(([, v]) => n(v) > 0).map(([k, v]) => ({ key: k, amount: n(v).toFixed(2) })) : suggested;
  const allocProblem = l && manual ? checkAllocation(l.obligations, alloc, applied) : null;
  const methods = [...METHODS, ...(l && n(l.storeCredit) > 0 ? [{ v: "STORE_CREDIT", l: "Store credit" } as const] : [])];
  const choosable = accounts.filter((a) => method !== "STORE_CREDIT" && ACCOUNT_TYPES[method]?.includes(a.type) && (!a.locationId || a.locationId === locationId));
  const fallback = method === "STORE_CREDIT" ? null : defaultAccount(accounts, method, locationId);
  const account = accountId ? accounts.find((a) => a.id === accountId) ?? null : fallback;
  const refOf = (k: string) => l?.obligations.find((o) => o.key === k)?.ref ?? k;

  const blocker =
    !l ? "Wait for the balance to load." :
    amt <= 0 ? "Enter the amount received." :
    over > 0 && excess === "NONE" ? "Choose what to do with the extra amount." :
    over > 0 && excess === "CHANGE" && method !== "CASH" ? "Only cash can be given back as change." :
    over > 0 && excess === "ADVANCE" && (method === "CHEQUE" || method === "STORE_CREDIT") ? `${methodName(method)} cannot become advance credit.` :
    method === "STORE_CREDIT" && amt > n(l.storeCredit) ? `Store credit available is Rs. ${fmt(l.storeCredit)}.` :
    method === "CHEQUE" && (!cheque.number.trim() || !cheque.realizeDate) ? "Enter the cheque number and date." :
    method !== "STORE_CREDIT" && !account ? "No receiving account is set up for this method." :
    allocProblem;

  const submit = async () => {
    if (!l || blocker) return;
    setError(null); setNotice(null); setPhase({ kind: "posting" });
    try {
      const r = await recordDebtPayment({
        idempotencyKey: key, customerId, amount: amt, method, accountId: perms.account && accountId ? accountId : null,
        paidOn: perms.backdate ? paidOn : null, reference: reference || null, note: note || null,
        cheque: method === "CHEQUE" ? { number: cheque.number, bank: cheque.bank || null, realizeDate: cheque.realizeDate } : null,
        expectedDebt: l.debt, allocation: manual ? alloc : null, excess: over > 0 ? excess : "NONE",
      });
      if (r.receipt) { setPhase({ kind: "done", receipt: r.receipt }); onRecorded(); return; }
      setPhase({ kind: "edit" });
      setError(r.error ?? "The payment could not be recorded.");
      // Someone else changed the debt: reload it and show the new split. The amount entered is kept.
      if (r.stale) { setManual(null); setNotice("The balance changed. Review the updated debt and allocation, then record again."); load(); }
    } catch {
      setPhase({ kind: "unknown" }); // lost connection / timeout: the outcome must be checked before collecting again
    }
  };

  const checkStatus = async () => {
    setError(null);
    try {
      const r = await debtReceiptStatus(key);
      if (r.receipt) { setPhase({ kind: "done", receipt: r.receipt }); onRecorded(); }
      else if (r.error) setError(r.error);
      else { setPhase({ kind: "edit" }); setNotice("That payment was not recorded. You can record it again — it will not be taken twice."); }
    } catch { setError("Still cannot reach the server. Try again before collecting anything."); }
  };

  const close = () => {
    if (phase.kind === "edit" && amount && !confirmDiscard) return setConfirmDiscard(true);
    if (phase.kind === "unknown") return setError("Check the receipt status first, so the customer is not charged twice.");
    onClose();
  };

  const sendSms = async (id: string) => {
    setSms("Sending…");
    try { const r = await smsDebtReceipt(id); setSms(r.ok ?? r.error ?? null); } catch { setSms("SMS could not be queued. The payment is recorded."); }
  };

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="Receive payment for previous debt" onKeyDown={(e) => { if (e.key === "Escape") close(); }}>
      <div className="modal stack" style={{ gap: 12 }}>
        <div className="row"><h2>Receive payment · previous debt</h2><div className="spacer" /><button type="button" className="btn btn-sm btn-ghost" onClick={close} aria-label="Close">✕</button></div>

        {ledger.status === "loading" && <p className="muted small" style={{ margin: 0 }} aria-live="polite">Loading balance…</p>}
        {ledger.status === "error" && <p className="note note-err" role="alert">Balance unavailable — {ledger.error} <button type="button" className="btn btn-sm" onClick={load}>Retry</button></p>}

        {l && (
          <div className="small">
            <strong style={{ fontSize: 15 }}>{l.customer.name}</strong>
            <span className="muted"> · {maskPhone(l.customer.phone) || "no mobile"} · ID {l.customer.code ?? l.customer.id.slice(-6).toUpperCase()}</span>
          </div>
        )}

        {phase.kind === "done" ? (
          <Result receipt={phase.receipt} sms={sms} onSms={() => sendSms(phase.receipt.id)} onClose={onClose}
            onAnother={() => { setPhase({ kind: "edit" }); setKey(crypto.randomUUID()); setAmount(""); setManual(null); setExcess("NONE"); setReference(""); setNote(""); setSms(null); load(); }} />
        ) : l && (
          <>
            <div className="stack" style={{ gap: 0 }}>
              <div className="totalrow grand"><span>Current debt</span><strong>Rs. {fmt(l.debt)}</strong></div>
              {n(l.overdue) > 0 && <div className="totalrow small" style={{ color: "var(--err)" }}><span>of which overdue</span><strong>{fmt(l.overdue)}</strong></div>}
              {l.obligations.map((o) => (
                <div key={o.key} className="totalrow small">
                  <span>{o.ref}<span className="muted"> · {o.kind === "OPENING" ? `reference ${fmtDate(o.docDate)}` : fmtDate(o.docDate)}{o.restricted && o.location ? ` · ${o.location}` : ""} · {o.dueDate ? `due ${fmtDate(o.dueDate)}` : "no due date"}</span>{o.overdue && <span className="badge badge-err"> overdue</span>}</span>
                  <strong>{fmt(o.due)}</strong>
                </div>
              ))}
              {l.obligations.length === 0 && <p className="small muted">No outstanding debt.</p>}
              {n(l.storeCredit) > 0 && <div className="totalrow small" style={{ color: "var(--ok)" }}><span>Advance / store credit available (not deducted)</span><strong>{fmt(l.storeCredit)}</strong></div>}
            </div>

            <div className="grid2" style={{ gap: 10 }}>
              <label className="field"><span>Amount received</span>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" autoFocus style={{ textAlign: "right" }} aria-label="Amount received" />
              </label>
              <div className="field"><span>&nbsp;</span>
                <button type="button" className="btn" disabled={debt <= 0} onClick={() => { setAmount(debt.toFixed(2)); setManual(null); }}>Pay full debt</button>
              </div>
              <label className="field"><span>Payment method</span>
                <select value={method} onChange={(e) => { setMethod(e.target.value); setAccountId(""); }} aria-label="Payment method">
                  {methods.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
                </select>
              </label>
              <label className="field"><span>Receiving account</span>
                {method === "STORE_CREDIT" ? <input value="Customer's store credit" readOnly aria-label="Receiving account" /> : perms.account ? (
                  <select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Receiving account">
                    <option value="">{fallback ? `${fallback.name} (default)` : "No default account"}</option>
                    {choosable.filter((a) => a.id !== fallback?.id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                ) : <input value={fallback ? `${fallback.name}${method === "CASH" ? " · this register" : ""}` : "No account set up"} readOnly aria-label="Receiving account" />}
              </label>
              <label className="field"><span>Paid on</span>
                <input type="date" value={paidOn} max={todayLocal()} disabled={!perms.backdate} onChange={(e) => setPaidOn(e.target.value)} aria-label="Paid on" />
              </label>
            </div>

            {method === "CHEQUE" && (
              <div className="grid3" style={{ gap: 10 }}>
                <label className="field"><span>Cheque no.</span><input value={cheque.number} onChange={(e) => setCheque({ ...cheque, number: e.target.value })} /></label>
                <label className="field"><span>Bank</span><input value={cheque.bank} onChange={(e) => setCheque({ ...cheque, bank: e.target.value })} /></label>
                <label className="field"><span>Cheque date</span><input type="date" value={cheque.realizeDate} onChange={(e) => setCheque({ ...cheque, realizeDate: e.target.value })} /></label>
              </div>
            )}
            <details>
              <summary className="small" style={{ cursor: "pointer" }}>Reference / note</summary>
              <div className="grid2" style={{ gap: 10, marginTop: 8 }}>
                <label className="field"><span>Reference</span><input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Slip / transfer ref." maxLength={80} /></label>
                <label className="field"><span>Note</span><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></label>
              </div>
            </details>

            {over > 0 && (
              <div className="note stack" style={{ gap: 6 }}>
                <strong>Rs. {fmt(over)} more than the debt</strong>
                <label className="check small"><input type="radio" name="excess" checked={excess === "ADVANCE"} onChange={() => setExcess("ADVANCE")} disabled={method === "CHEQUE" || method === "STORE_CREDIT"} /> Keep Rs. {fmt(over)} as advance credit for this customer</label>
                <label className="check small"><input type="radio" name="excess" checked={excess === "CHANGE"} onChange={() => setExcess("CHANGE")} disabled={method !== "CASH"} /> Give Rs. {fmt(over)} back as change (cash only)</label>
              </div>
            )}

            {applied > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <div className="row"><strong style={{ fontSize: 13, fontWeight: 600 }}>Allocation {manual ? "(changed by hand)" : "(oldest due first)"}</strong><div className="spacer" />
                  {perms.allocate && (manual
                    ? <button type="button" className="btn btn-sm" onClick={() => setManual(null)}>Use suggested</button>
                    : <button type="button" className="btn btn-sm" onClick={() => setManual(Object.fromEntries(l.obligations.map((o) => [o.key, suggested.find((s) => s.key === o.key)?.amount ?? ""])))}>Change allocation</button>)}
                </div>
                <div className="alloc">
                  <span className="muted small">Reference</span><span className="muted small num">Due</span><span className="muted small num">Pays</span>
                  {(manual ? l.obligations : l.obligations.filter((o) => alloc.some((a) => a.key === o.key))).map((o) => (
                    <span key={o.key} style={{ display: "contents" }}>
                      <span>{o.ref}{o.key === OPENING ? <span className="muted"> (opening balance)</span> : null}</span>
                      <span className="num muted">{fmt(o.due)}</span>
                      {manual
                        ? <input value={manual[o.key] ?? ""} inputMode="decimal" placeholder="0.00" aria-label={`Amount for ${o.ref}`} onChange={(e) => setManual({ ...manual, [o.key]: e.target.value })} />
                        : <strong className="num">{fmt(alloc.find((a) => a.key === o.key)?.amount ?? 0)}</strong>}
                    </span>
                  ))}
                </div>
                <div className="totalrow"><span>Debt after this payment</span><strong>Rs. {fmt((c2(debt) - c2(applied)) / 100)}</strong></div>
                {manual && <span className="small muted">Allocated {fmt(sumAlloc(alloc))} of {fmt(applied)}.</span>}
              </div>
            )}

            {notice && <p className="note" role="status">{notice}</p>}
            {error && <p className="note note-err" role="alert">{error}</p>}
            {phase.kind === "unknown" && (
              <div className="note note-err stack" role="alert" style={{ gap: 6 }}>
                <span>The connection dropped before we heard back. The payment may or may not be recorded — check before collecting again.</span>
                <div><button type="button" className="btn btn-sm btn-primary" onClick={checkStatus}>Check receipt status</button></div>
              </div>
            )}
            {confirmDiscard ? (
              <div className="row"><span className="small">Discard this unsubmitted Rs. {fmt(amt)} payment?</span><div className="spacer" />
                <button type="button" className="btn btn-sm" onClick={() => setConfirmDiscard(false)}>Keep editing</button>
                <button type="button" className="btn btn-sm btn-danger" onClick={onClose}>Discard</button>
              </div>
            ) : phase.kind !== "unknown" && (
              <div className="row">
                <button type="button" className="btn" onClick={close} disabled={phase.kind === "posting"}>Cancel</button>
                <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={submit} disabled={!!blocker || phase.kind === "posting"} title={blocker ?? undefined}>
                  {phase.kind === "posting" ? "Recording…" : `Record payment${amt > 0 ? ` · Rs. ${fmt(amt)}` : ""}`}
                </button>
              </div>
            )}
            {blocker && amt > 0 && phase.kind === "edit" && <p className="small muted" style={{ margin: 0 }}>{blocker}</p>}
          </>
        )}
      </div>
    </div>
  );
}

function Result({ receipt: r, sms, onSms, onClose, onAnother }: { receipt: ReceiptView; sms: string | null; onSms: () => void; onClose: () => void; onAnother: () => void }) {
  return (
    <div className="stack" style={{ gap: 8 }} aria-live="polite">
      <p className="note note-ok" style={{ margin: 0 }}>{r.replay ? "This payment was already recorded — same receipt, nothing taken twice." : "Payment recorded."}</p>
      <div className="totalrow grand"><span>Receipt</span><strong>{r.number}</strong></div>
      <div className="totalrow"><span>Received · {methodName(r.method)}{r.account ? ` → ${r.account}` : ""}</span><strong>Rs. {fmt(r.received)}</strong></div>
      {n(r.change) > 0 && <div className="totalrow" style={{ color: "var(--ok)" }}><span>Give change</span><strong>{fmt(r.change)}</strong></div>}
      {r.allocations.map((a, i) => <div key={i} className="totalrow small"><span>Paid {a.ref} · left {fmt(a.dueAfter)}</span><strong>{fmt(a.amount)}</strong></div>)}
      {n(r.advance) > 0 && <div className="totalrow small" style={{ color: "var(--ok)" }}><span>Kept as advance credit</span><strong>{fmt(r.advance)}</strong></div>}
      <div className="totalrow"><span>Remaining debt</span><strong>Rs. {fmt(r.debtAfter)}</strong></div>
      {r.chequeStatus && r.chequeStatus !== "CLEARED" && <p className="note" style={{ margin: 0 }}>Cheque pending clearance. If it bounces, the debt is put back on these invoices.</p>}
      {sms && <p className="small muted" style={{ margin: 0 }}>{sms}</p>}
      <div className="row">
        <a className="btn" href={`/sales/collections/${r.id}?print=1`} target="_blank" rel="noreferrer">Print receipt</a>
        {r.phone && <button type="button" className="btn" onClick={onSms} disabled={sms === "Sending…" || sms === "SMS receipt queued."}>SMS receipt</button>}
        <button type="button" className="btn" onClick={onAnother}>Another payment</button>
        <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={onClose} autoFocus>Back to sale</button>
      </div>
    </div>
  );
}

type History = Awaited<ReturnType<typeof customerHistory>>;

export function HistoryDialog({ customerId, state, onClose }: { customerId: string; state: BalanceState; onClose: () => void }) {
  const [h, setH] = useState<History | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => { customerHistory(customerId).then(setH).catch(() => setFailed(true)); }, [customerId]);
  const l = state.status === "ok" ? state.ledger : null;
  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="Invoices and payment history" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="modal stack" style={{ gap: 12 }}>
        <div className="row"><h2>Invoices &amp; history{l ? ` · ${l.customer.name}` : ""}</h2><div className="spacer" /><button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close" autoFocus>✕</button></div>
        <section>
          <strong style={{ fontSize: 13 }}>Outstanding</strong>
          {!l ? <p className="small muted">{state.status === "loading" ? "Loading balance…" : "Balance unavailable."}</p> : l.obligations.length === 0 ? <p className="small muted">Nothing outstanding.</p> : l.obligations.map((o) => (
            <div key={o.key} className="totalrow small">
              <span>{o.kind === "INVOICE" && !o.restricted ? <Link href={`/sales/${o.key}`} target="_blank">{o.ref}</Link> : o.ref}<span className="muted"> · {fmtDate(o.docDate)} · {o.dueDate ? `due ${fmtDate(o.dueDate)}` : "no due date"}</span>{o.overdue && <span className="badge badge-err"> overdue</span>}</span>
              <strong>{fmt(o.due)}</strong>
            </div>
          ))}
        </section>
        <section>
          <strong style={{ fontSize: 13 }}>Debt payments</strong>
          {failed ? <p className="small" style={{ color: "var(--err)" }}>History unavailable.</p> : !h ? <p className="small muted">Loading…</p> : h.receipts.length === 0 ? <p className="small muted">None yet.</p> : h.receipts.map((r) => (
            <div key={r.id} className="totalrow small">
              <span><Link href={`/sales/collections/${r.id}`} target="_blank">{r.number}</Link><span className="muted"> · {fmtDate(r.paidAt)} · {methodName(r.method)} · {r.applied || "advance only"}</span>{r.state !== "POSTED" && <span className="badge badge-warn"> {r.state.toLowerCase()}</span>}</span>
              <strong>{fmt(r.amount)}</strong>
            </div>
          ))}
        </section>
        <section>
          <strong style={{ fontSize: 13 }}>Payments at sale / on invoices</strong>
          {h && (h.payments.length === 0 ? <p className="small muted">None yet.</p> : h.payments.map((p) => (
            <div key={p.id} className="totalrow small"><span>{p.number}<span className="muted"> · {fmtDate(p.paidAt)} · {methodName(p.method)} · {p.invoice}</span></span><strong>{p.direction === "OUT" ? "−" : ""}{fmt(p.amount)}</strong></div>
          )))}
        </section>
        <div><Link className="btn btn-sm" href={`/contacts/${customerId}`} target="_blank">Open customer page</Link></div>
      </div>
    </div>
  );
}
