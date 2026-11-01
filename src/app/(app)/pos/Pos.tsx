"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { searchProducts, type ProductHit, type DeviceHit } from "../search";
import { DevicePicker, deviceLabel } from "@/components/DevicePicker";
import { completeSale, searchCustomers } from "./actions";
import { quickAddCustomer } from "../contacts/actions";

type CartLine = { product: ProductHit; qty: number; price: string; discount: string; devices: DeviceHit[] };
type Pay = { key: string; method: "CASH" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "STORE_CREDIT" | "OTHER"; amount: string; accountId: string; reference: string };
type Customer = { id: string; name: string; phone: string | null; storeCredit?: number };
type Props = {
  locationName: string; rounding: number; maxDiscountPct: number; canQuickAdd: boolean; selfId: string;
  salespeople: { id: string; name: string }[]; agents: { id: string; name: string }[]; accounts: { id: string; name: string; type: string }[];
  initialCustomer: Customer | null;
};

const n = (v: string | number) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const fmt = (v: number) => v.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (v: number) => Math.round(v * 100) / 100;
const METHODS: { v: Pay["method"]; l: string }[] = [
  { v: "CASH", l: "Cash" }, { v: "CARD", l: "Card" }, { v: "BANK_TRANSFER", l: "Bank transfer" }, { v: "CHEQUE", l: "Cheque" }, { v: "OTHER", l: "Other" },
];

export function Pos(props: Props) {
  const [idem, setIdem] = useState(() => crypto.randomUUID());
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(props.initialCustomer);
  const [custQ, setCustQ] = useState("");
  const [custHits, setCustHits] = useState<Customer[]>([]);
  const [newCust, setNewCust] = useState<{ name: string; phone: string } | null>(null);
  const [mode, setMode] = useState<"NONE" | "USER" | "AGENT" | "DUAL">("NONE");
  const [salespersonId, setSalespersonId] = useState(props.salespeople.some((s) => s.id === props.selfId) ? props.selfId : "");
  const [agentId, setAgentId] = useState("");
  const [invDisc, setInvDisc] = useState("");
  const [pays, setPays] = useState<Pay[]>([{ key: "p0", method: "CASH", amount: "", accountId: "", reference: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<ProductHit | null>(null);
  const [smsReceipt, setSmsReceipt] = useState(true);
  const [done, setDone] = useState<{ id: string; number: string; change: string } | null>(null);
  const [pending, start] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const searchSeq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const custTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => { if (window.matchMedia("(pointer: fine)").matches) searchRef.current?.focus(); }, [done]);

  const lineTotal = (l: CartLine) => Math.max(round2(n(l.price) * l.qty - n(l.discount)), 0);
  const subtotal = useMemo(() => round2(cart.reduce((a, l) => a + lineTotal(l), 0)), [cart]);
  const beforeRound = Math.max(round2(subtotal - n(invDisc)), 0);
  const total = props.rounding > 0 ? round2(Math.round(beforeRound / props.rounding) * props.rounding) : beforeRound;
  const rounding = round2(total - beforeRound);
  const tendered = round2(pays.reduce((a, p) => a + n(p.amount), 0));
  const change = Math.max(round2(tendered - total), 0);
  const due = Math.max(round2(total - tendered), 0);

  const runSearch = (v: string) => {
    setQ(v);
    clearTimeout(timer.current);
    const seq = ++searchSeq.current;
    timer.current = setTimeout(async () => {
      const results = v.trim() ? await searchProducts(v) : [];
      if (seq === searchSeq.current) setHits(results); // ignore responses overtaken by newer input
    }, 180);
  };

  // Phones are added by exact device: a scanned IMEI adds it directly, otherwise the IMEI picker opens.
  const addDevice = (p: ProductHit, d: DeviceHit) => {
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id);
      if (i < 0) return [...c, { product: p, qty: 1, price: p.price, discount: "", devices: [d] }];
      if (c[i].devices.some((x) => x.id === d.id)) return c;
      return c.map((l, j) => (j === i ? { ...l, devices: [...l.devices, d], qty: l.devices.length + 1 } : l));
    });
  };
  const removeDevice = (productId: string, deviceId: string) =>
    setCart((c) => c.flatMap((l) => {
      if (l.product.id !== productId) return [l];
      const devices = l.devices.filter((d) => d.id !== deviceId);
      return devices.length ? [{ ...l, devices, qty: devices.length }] : [];
    }));

  const add = (p: ProductHit, fromScan = false) => {
    if (p.tracked) {
      if (p.device) addDevice(p, p.device);
      else setPicker(p);
      setHits([]); setError(null);
      if (!fromScan) { clearTimeout(timer.current); searchSeq.current++; setQ(""); }
      return;
    }
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id);
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { product: p, qty: 1, price: p.price, discount: "", devices: [] }];
    });
    setHits([]); setError(null);
    if (!fromScan) {
      // A scan already cleared the box on Enter; clearing again would eat the next scan's first characters.
      clearTimeout(timer.current);
      searchSeq.current++; // drop any search response still in flight
      setQ("");
    }
    searchRef.current?.focus();
  };

  // Scanners type the code then press Enter. Always resolve the code just entered —
  // never reuse a result list from an earlier keystroke, or a fast second scan adds the wrong item.
  const onSearchKey = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    clearTimeout(timer.current);
    setQ(""); setHits([]);
    // Each scan resolves independently, so back-to-back scans each add their own item.
    const results = await searchProducts(term);
    const t = term.toLowerCase();
    const exact = results.find((h) => h.device) ?? results.find((h) => h.sku.toLowerCase() === t || h.barcode === term) ?? (results.length === 1 ? results[0] : null);
    if (exact) add(exact, true);
    else {
      setQ(term);
      setHits(results);
      if (!results.length) setError(`No product found for “${term}”.`);
    }
  };

  const setLine = (id: string, patch: Partial<CartLine>) => setCart((c) => c.map((l) => (l.product.id === id ? { ...l, ...patch } : l)));
  const setPay = (key: string, patch: Partial<Pay>) => setPays((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const findCustomer = (v: string) => {
    setCustQ(v);
    clearTimeout(custTimer.current);
    custTimer.current = setTimeout(async () => setCustHits(v.trim() ? await searchCustomers(v) : []), 200);
  };

  const reset = () => {
    setCart([]); setPicker(null); setCustomer(null); setCustQ(""); setMode("NONE"); setAgentId(""); setInvDisc("");
    setPays([{ key: "p0", method: "CASH", amount: "", accountId: "", reference: "" }]);
    setError(null); setDone(null); setIdem(crypto.randomUUID());
  };

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await completeSale({
        idempotencyKey: idem,
        customerId: customer?.id ?? null,
        lines: cart.map((l) => ({ productId: l.product.id, qty: l.qty, unitPrice: l.price, discount: n(l.discount), deviceIds: l.devices.map((d) => d.id) })),
        invoiceDiscount: n(invDisc),
        commissionMode: mode,
        salespersonId: mode === "USER" || mode === "DUAL" ? salespersonId || null : null,
        agentId: mode === "AGENT" || mode === "DUAL" ? agentId || null : null,
        smsReceipt: smsReceipt && !!customer?.phone,
        payments: pays.filter((p) => n(p.amount) > 0).map((p) => ({ method: p.method, amount: p.amount, accountId: p.accountId || null, reference: p.reference || null })),
      });
      if (r.error) setError(r.error);
      else if (r.id) setDone({ id: r.id, number: r.number!, change: r.change ?? "0.00" });
    });
  };

  if (done) {
    return (
      <div className="panel stack" style={{ maxWidth: 480, margin: "24px auto", textAlign: "center" }}>
        <div className="eyebrow">Sale completed</div>
        <h1>{done.number}</h1>
        {n(done.change) > 0 && <div className="totalrow grand"><span>Give change</span><strong>Rs. {fmt(n(done.change))}</strong></div>}
        <div className="row" style={{ justifyContent: "center" }}>
          <Link className="btn" href={`/sales/${done.id}?print=1`}>Print receipt</Link>
          <Link className="btn" href={`/sales/${done.id}`}>View sale</Link>
          <button className="btn btn-primary" onClick={reset} autoFocus>New sale</button>
        </div>
      </div>
    );
  }

  return (
    <div className="pos">
      <section className="stack" style={{ gap: 12 }}>
        <div className="row"><h1 style={{ fontSize: 20 }}>POS</h1><span className="muted small">{props.locationName}</span></div>
        <div style={{ position: "relative" }}>
          <input ref={searchRef} value={q} onChange={(e) => runSearch(e.target.value)} onKeyDown={onSearchKey}
            placeholder="Scan barcode / search product, SKU or lot" aria-label="Scan or search product" autoComplete="off" enterKeyHint="search" />
        </div>
        {hits.length > 0 && (
          <div className="pos-results">
            {hits.map((h) => {
              const out = h.available !== null && n(h.available) <= 0;
              return (
                <div className="pos-item" key={h.id}>
                  <span>{h.name}<small>{h.sku}{h.lot ? ` · next lot ${h.lot}` : ""} · {h.available === null ? "not stocked" : `${n(h.available)} available`}</small></span>
                  <button className="btn" disabled={out} onClick={() => add(h)} aria-label={`Add ${h.name}`}>{out ? "Out of stock" : h.tracked && !h.device ? "Choose IMEI" : `${fmt(n(h.price))} +`}</button>
                </div>
              );
            })}
          </div>
        )}

        {picker && (
          <DevicePicker
            productId={picker.id}
            productName={picker.name}
            exclude={cart.find((l) => l.product.id === picker.id)?.devices.map((d) => d.id) ?? []}
            onPick={(d) => addDevice(picker, d)}
            onClose={() => { setPicker(null); searchRef.current?.focus(); }}
          />
        )}

        <div className="panel pos-cart" style={{ padding: "6px 14px" }}>
          {cart.length === 0 ? (
            <div className="empty">Cart is empty. Scan or search to add items.</div>
          ) : (
            cart.map((l) => {
              const over = l.product.available !== null && l.qty > n(l.product.available);
              return (
                <div className="cart-line" key={l.product.id}>
                  <div className="c-name">
                    <span><strong style={{ fontWeight: 500 }}>{l.product.name}</strong><br /><span className="small muted">{l.product.sku}{over && !l.product.tracked && <span style={{ color: "var(--err)" }}> · only {n(l.product.available!)} available</span>}</span>
                      {l.devices.map((d) => (
                        <span key={d.id} className="small" style={{ display: "flex", gap: 6, alignItems: "center", fontVariantNumeric: "tabular-nums" }}>
                          IMEI {deviceLabel(d)}
                          <button type="button" className="btn-ghost" style={{ minHeight: 0, padding: "0 4px", color: "var(--err)" }} onClick={() => removeDevice(l.product.id, d.id)} aria-label={`Remove device ${deviceLabel(d)}`}>✕</button>
                        </span>
                      ))}
                    </span>
                    <button className="btn btn-sm btn-ghost btn-danger" style={{ display: "inline-flex" }} onClick={() => setCart((c) => c.filter((x) => x.product.id !== l.product.id))} aria-label="Remove">✕</button>
                  </div>
                  <div className="qty-step c-qty">
                    <span className="c-label">Qty</span>
                    {l.product.tracked ? (
                      <div className="steps"><button type="button" className="btn-sm" onClick={() => setPicker(l.product)} style={{ width: "100%" }}>{l.qty} · + IMEI</button></div>
                    ) : (
                    <div className="steps">
                      <button type="button" onClick={() => setLine(l.product.id, { qty: Math.max(1, l.qty - 1) })} aria-label="Decrease">−</button>
                      <input value={l.qty} inputMode="decimal" aria-label="Quantity" onChange={(e) => setLine(l.product.id, { qty: Math.max(0, n(e.target.value)) })} />
                      <button type="button" onClick={() => setLine(l.product.id, { qty: l.qty + 1 })} aria-label="Increase">+</button>
                    </div>
                    )}
                  </div>
                  <label className="c-price"><span className="c-label">Price</span><input value={l.price} inputMode="decimal" aria-label="Unit price" onChange={(e) => setLine(l.product.id, { price: e.target.value })} /></label>
                  <label className="c-disc"><span className="c-label">Discount</span><input value={l.discount} inputMode="decimal" placeholder="0" aria-label="Line discount" onChange={(e) => setLine(l.product.id, { discount: e.target.value })} /></label>
                  <div className="c-total num" style={{ fontWeight: 500 }}><span className="c-label">Line total</span>{fmt(lineTotal(l))}</div>
                  <div className="c-remove" />
                </div>
              );
            })
          )}
        </div>
      </section>

      {cart.length > 0 && (
        <div className="checkout-bar">
          <div><span className="small muted">To collect</span><br /><strong>Rs. {fmt(total)}</strong></div>
          <div className="spacer" />
          <button className="btn btn-primary" onClick={() => summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>Checkout</button>
        </div>
      )}

      <section ref={summaryRef} className="panel pos-summary stack" style={{ gap: 12, scrollMarginTop: "calc(var(--topbar-h) + 8px)" }}>
        <h2 style={{ margin: 0 }}>Sale summary</h2>

        <div className="field">
          <span>Customer</span>
          {customer ? (
            <div className="row"><strong style={{ color: "var(--ink)", fontWeight: 500 }}>{customer.name}</strong><span className="muted">{customer.phone}</span>{!!customer.storeCredit && <span className="badge badge-ok">Store credit {fmt(customer.storeCredit)}</span>}<div className="spacer" /><button className="btn btn-sm" onClick={() => setCustomer(null)}>Change</button></div>
          ) : newCust ? (
            <div className="stack" style={{ gap: 8 }}>
              <input placeholder="Customer name" value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} />
              <input placeholder="Mobile number" type="tel" inputMode="tel" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} />
              <div className="row">
                <button className="btn btn-sm" onClick={() => setNewCust(null)}>Cancel</button>
                <button className="btn btn-sm btn-primary" onClick={async () => {
                  try { setCustomer(await quickAddCustomer(newCust.name, newCust.phone)); setNewCust(null); } catch (e) { setError((e as Error).message); }
                }}>Save customer</button>
              </div>
            </div>
          ) : (
            <div style={{ position: "relative" }}>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <input value={custQ} onChange={(e) => findCustomer(e.target.value)} placeholder="Walk-in · search name or mobile" aria-label="Find customer" />
                {props.canQuickAdd && <button className="btn" onClick={() => setNewCust({ name: custQ, phone: "" })} aria-label="Add customer">+ New</button>}
              </div>
              {custHits.length > 0 && (
                <div className="panel" style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 10, padding: 0 }}>
                  {custHits.map((c) => (
                    <button key={c.id} className="btn-ghost" style={{ width: "100%", justifyContent: "space-between", borderRadius: 0 }} onClick={() => { setCustomer(c); setCustHits([]); setCustQ(""); }}>
                      <span>{c.name}</span><span className="muted small">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid2" style={{ gap: 10 }}>
          <label className="field"><span>Commission mode</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="NONE">None</option><option value="USER">User</option><option value="AGENT">Agent</option><option value="DUAL">Dual</option>
            </select>
          </label>
          {(mode === "USER" || mode === "DUAL") && (
            <label className="field"><span>Salesperson</span>
              <select value={salespersonId} onChange={(e) => setSalespersonId(e.target.value)}><option value="">Select…</option>{props.salespeople.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </label>
          )}
          {(mode === "AGENT" || mode === "DUAL") && (
            <label className="field"><span>Referral agent</span>
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)}><option value="">Select…</option>{props.agents.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </label>
          )}
        </div>

        <div>
          <div className="totalrow"><span>Subtotal · {cart.reduce((a, l) => a + l.qty, 0)} items</span><strong>{fmt(subtotal)}</strong></div>
          <div className="totalrow" style={{ alignItems: "center" }}>
            <span>Invoice discount</span>
            <input value={invDisc} onChange={(e) => setInvDisc(e.target.value)} inputMode="decimal" placeholder="0.00" style={{ width: 110, textAlign: "right", minHeight: 36 }} aria-label="Invoice discount" />
          </div>
          <div className="totalrow"><span>Rounding</span><strong>{fmt(rounding)}</strong></div>
          <div className="totalrow grand"><span>To collect</span><strong>Rs. {fmt(total)}</strong></div>
        </div>

        <div>
          <div className="row" style={{ marginBottom: 8 }}><strong style={{ fontWeight: 600, fontSize: 13 }}>Payment</strong><div className="spacer" />
            <button className="btn btn-sm" onClick={() => setPays((ps) => ps.map((p, i) => (i === 0 ? { ...p, amount: String(round2(total - ps.slice(1).reduce((a, x) => a + n(x.amount), 0))) } : p)))}>Exact amount</button>
          </div>
          {pays.map((p, i) => (
            <div key={p.key}>
              <div className="payrow">
                <select value={p.method} onChange={(e) => setPay(p.key, { method: e.target.value as Pay["method"], accountId: "" })} aria-label="Payment method">
                  {METHODS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
                  {!!customer?.storeCredit && <option value="STORE_CREDIT">Store credit</option>}
                </select>
                <input value={p.amount} onChange={(e) => setPay(p.key, { amount: e.target.value })} inputMode="decimal" placeholder="0.00" aria-label="Amount" style={{ textAlign: "right" }} />
                {i > 0 ? <button className="btn btn-ghost btn-danger" onClick={() => setPays((ps) => ps.filter((x) => x.key !== p.key))} aria-label="Remove payment">✕</button> : <span />}
              </div>
              {p.method !== "CASH" && p.method !== "STORE_CREDIT" && (
                <div className="payrow">
                  <select value={p.accountId} onChange={(e) => setPay(p.key, { accountId: e.target.value })} aria-label="Account">
                    <option value="">Default account</option>{props.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <input value={p.reference} onChange={(e) => setPay(p.key, { reference: e.target.value })} placeholder="Reference / last 4 digits" aria-label="Payment reference" />
                  <span />
                </div>
              )}
            </div>
          ))}
          <button className="btn btn-sm" onClick={() => setPays((ps) => [...ps, { key: crypto.randomUUID(), method: "CARD", amount: due > 0 ? String(due) : "", accountId: "", reference: "" }])}>+ Split payment</button>
          {change > 0 && <div className="totalrow" style={{ color: "var(--ok)" }}><span>Change to give</span><strong>{fmt(change)}</strong></div>}
          {due > 0 && cart.length > 0 && <div className="totalrow" style={{ color: "var(--warn)" }}><span>{customer ? "Balance on credit" : "Still to collect"}</span><strong>{fmt(due)}</strong></div>}
        </div>

        {customer?.phone && <label className="check small"><input type="checkbox" checked={smsReceipt} onChange={(e) => setSmsReceipt(e.target.checked)} /> SMS receipt to {customer.phone}</label>}
        {error && <p className="note note-err" role="alert">{error}</p>}
        <div className="row">
          <button className="btn" onClick={reset} disabled={pending || cart.length === 0}>Clear</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={submit} disabled={pending || cart.length === 0 || (due > 0 && !customer)}>
            {pending ? "Completing…" : due > 0 && customer ? `Complete · ${fmt(due)} on credit` : "Complete sale"}
          </button>
        </div>
        {due > 0 && !customer && cart.length > 0 && <p className="small muted" style={{ margin: 0 }}>Collect the full amount, or select a customer to leave a balance on credit.</p>}
      </section>
    </div>
  );
}
