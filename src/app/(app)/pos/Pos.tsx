"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ScanButton } from "@/components/CameraScan";
import { searchProducts, listLayers, type ProductHit, type DeviceHit, type LayerHit } from "../search";
import { resolvePrice, type Policy } from "@/lib/price-rules";
import { DevicePicker, deviceLabel } from "@/components/DevicePicker";
import { completeSale, searchCustomers } from "./actions";
import { quickAddCustomer } from "../contacts/actions";
import { saveDraftAction } from "../sales/drafts/actions";
import { SALE_CHANNELS, CHANNEL_LABEL, type SaleChannel } from "@/lib/sale-channels";
import { DebtStrip, HistoryDialog, RepaymentDialog, useBalance, type DebtPerms, type RecvAccount } from "./DebtPanel";

// lots: the lots this line takes (one row, or a split); lotOptions: eligible lots here, oldest first (null = loading).
// lotMode "FIFO" fills from the oldest lot and follows the quantity; "CHOSEN" is the salesperson's own pick and is kept
// as they set it. Either way the server receives the exact lots and quantities and rechecks them under lock.
type LotPick = { layerId: string; qty: number };
type LotMode = "FIFO" | "CHOSEN";
type CartLine = {
  product: ProductHit; qty: number; price: string; discount: string; devices: DeviceHit[];
  rule: string; listPrice: number; fallback: boolean; lots: LotPick[]; lotOptions: LayerHit[] | null; lotMode: LotMode; lotOpen: boolean;
};
export type DraftPrefill = { id: string; number: string; lines: { product: ProductHit; qty: number; price: string; discount: string }[] };
type Pay = { key: string; method: "CASH" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "STORE_CREDIT" | "OTHER"; amount: string; accountId: string; reference: string };
type Customer = { id: string; name: string; phone: string | null; code?: string | null; phoneMasked?: string; storeCredit?: number; pricing?: Policy };
type Tier = { id: string; name: string; allowed: boolean };
const STANDARD: Policy = { tier: null, adjustmentPct: null, groupName: null };
const needsLot = (l: CartLine) => l.product.available !== null && !l.product.tracked;
const r4 = (x: number) => Math.round(x * 10000) / 10000;
// First in, first out: take from the oldest lot, then the next oldest, until the quantity is covered (or stock runs out).
const fifoFill = (opts: LayerHit[], qty: number): LotPick[] => {
  const out: LotPick[] = [];
  let need = r4(qty);
  for (const o of opts) {
    if (need <= 0) break;
    const take = Math.min(Number(o.qtyRemaining), need);
    if (take > 0) { out.push({ layerId: o.id, qty: r4(take) }); need = r4(need - take); }
  }
  return out;
};
const lotDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Colombo" });
type Props = {
  locationName: string; rounding: number; maxDiscountPct: number; canQuickAdd: boolean; selfId: string;
  salespeople: { id: string; name: string }[]; agents: { id: string; name: string }[]; accounts: { id: string; name: string; type: string }[];
  initialCustomer: Customer | null;
  initialDraft: DraftPrefill | null;
  tiers: Tier[]; canOverrideTier: boolean;
  locationId: string; debtPerms: DebtPerms; recvAccounts: RecvAccount[];
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
  const [cart, setCart] = useState<CartLine[]>(() => (props.initialDraft?.lines ?? []).map((l) => {
    // A resumed quote keeps its saved price; the rule shows whether that still matches today's pricing.
    const r = resolvePrice(l.product, props.initialCustomer?.pricing ?? STANDARD);
    return { ...l, devices: [], listPrice: r.price, fallback: r.fallback, rule: n(l.price) === r.price ? r.rule : "Saved price from the quote / parked sale", lots: [], lotOptions: null, lotMode: "FIFO" as LotMode, lotOpen: false };
  }));
  const [draftId, setDraftId] = useState<string | null>(props.initialDraft?.id ?? null);
  const [saved, setSaved] = useState<{ id: string; number: string; kind: string } | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(props.initialCustomer);
  // Tier override for this sale: undefined = follow the customer's group policy, null = default price, id = that tier.
  const [override, setOverride] = useState<string | null | undefined>(undefined);
  const [reprice, setReprice] = useState<{ customer: Customer | null; override: string | null | undefined; clearedTier: string | null; before: number; after: number; rows: { id: string; name: string; from: number; to: number; rule: string; fallback: boolean; discount: number; manual: boolean }[] } | null>(null);
  const [custEditing, setCustEditing] = useState(false);
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
  const [channel, setChannel] = useState<SaleChannel>("IN_STORE");
  const [channelRef, setChannelRef] = useState("");
  const [done, setDone] = useState<{ id: string; number: string; change: string } | null>(null);
  const [pending, start] = useTransition();
  // Previous debt of the selected customer: loaded live, shown apart from the sale, paid in its own dialog.
  const { state: balance, reload: reloadBalance } = useBalance(customer?.id ?? null, props.debtPerms.view);
  const [repayOpen, setRepayOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const searchSeq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const custTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const policyFor = (c: Customer | null, o: string | null | undefined): Policy =>
    o === undefined ? (c?.pricing ?? STANDARD) : o === null ? STANDARD : { tier: props.tiers.find((t) => t.id === o) ?? null, adjustmentPct: null, groupName: null };
  const policy = policyFor(customer, override);
  const priced = (p: ProductHit) => { const r = resolvePrice(p, policy); return { price: r.price.toFixed(2), listPrice: r.price, rule: r.rule, fallback: r.fallback }; };
  const newLine = (p: ProductHit, devices: DeviceHit[] = []): CartLine => ({ product: p, qty: Math.max(1, devices.length), discount: "", devices, lots: [], lotOptions: null, lotMode: "FIFO", lotOpen: false, ...priced(p) });

  // Changing customer or tier with items in the cart shows the price changes first; lots, devices and quantities never change.
  const applyPricing = (c: Customer | null, o: string | null | undefined) => {
    const next = policyFor(c, o);
    setCustomer(c); setOverride(o); setReprice(null);
    setCart((cs) => cs.map((l) => { const r = resolvePrice(l.product, next); return { ...l, price: r.price.toFixed(2), listPrice: r.price, rule: r.rule, fallback: r.fallback }; }));
  };
  // A different customer never inherits the previous customer's manual tier: it is cleared, and the preview says so.
  const requestPricing = (c: Customer | null, o: string | null | undefined) => {
    const switching = (c?.id ?? null) !== (customer?.id ?? null);
    const clearedTier = switching && o !== undefined ? (o === null ? "Default price" : props.tiers.find((t) => t.id === o)?.name ?? "manual tier") : null;
    if (clearedTier) o = undefined;
    const next = policyFor(c, o);
    const rows = cart.map((l) => { const r = resolvePrice(l.product, next); return { id: l.product.id, name: l.product.name, from: n(l.price), to: r.price, rule: r.rule, fallback: r.fallback, discount: round2(n(l.discount) + offerAmt(l)), manual: n(l.price) !== l.listPrice }; });
    if (!clearedTier && rows.every((r, i) => r.from === r.to && cart[i].rule === r.rule)) return applyPricing(c, o);
    const after = round2(cart.reduce((a, l, i) => a + Math.max(round2(rows[i].to * l.qty - offerAmt(l) - n(l.discount)), 0), 0));
    setReprice({ customer: c, override: o, clearedTier, before: subtotal, after, rows });
  };

  // Eligible lots for a line: this location's saleable stock only, oldest first. FIFO picks the oldest automatically;
  // a lot the salesperson chose (or scanned) is kept while it is still available.
  const loadLots = async (productId: string) => {
    const opts = await listLayers(productId);
    setCart((cs) => cs.map((l) => {
      if (l.product.id !== productId) return l;
      const kept = l.lots.filter((x) => opts.some((o) => o.id === x.layerId));
      if (l.lotMode === "CHOSEN" && kept.length) return { ...l, lotOptions: opts, lots: kept };
      return { ...l, lotOptions: opts, lotMode: "FIFO", lots: fifoFill(opts, l.qty) };
    }));
  };
  const lotsKey = cart.filter((l) => needsLot(l) && l.lotOptions === null).map((l) => l.product.id).join(",");
  useEffect(() => { for (const id of lotsKey.split(",").filter(Boolean)) loadLots(id); }, [lotsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // FIFO lines refill from the oldest lot when the quantity changes; a single chosen lot follows the quantity.
  const withQty = (l: CartLine, qty: number): CartLine =>
    l.lotMode === "FIFO" ? { ...l, qty, lots: l.lotOptions ? fifoFill(l.lotOptions, qty) : [] }
      : { ...l, qty, lots: l.lots.length === 1 ? [{ ...l.lots[0], qty }] : l.lots };
  const setQty = (id: string, qty: number) => setCart((cs) => cs.map((l) => (l.product.id !== id ? l : withQty(l, qty))));
  const patchLine = (id: string, f: (l: CartLine) => CartLine) => setCart((cs) => cs.map((l) => (l.product.id !== id ? l : f(l))));
  // The salesperson's own choice: sell the whole quantity from one lot.
  const chooseLot = (id: string, layerId: string) => patchLine(id, (l) => ({ ...l, lotMode: "CHOSEN", lots: [{ layerId, qty: l.qty }] }));
  // Split by hand: set how many come from one lot (0 drops it). The line quantity becomes the total of the lots.
  const setLotQty = (id: string, layerId: string, qty: number) => patchLine(id, (l) => {
    const has = l.lots.some((x) => x.layerId === layerId);
    const lots = (has ? l.lots.map((x) => (x.layerId === layerId ? { ...x, qty: r4(qty) } : x)) : [...l.lots, { layerId, qty: r4(qty) }]).filter((x) => x.qty > 0);
    const opts = l.lotOptions ?? [];
    lots.sort((a, b) => opts.findIndex((o) => o.id === a.layerId) - opts.findIndex((o) => o.id === b.layerId));
    const total = r4(lots.reduce((a, x) => a + x.qty, 0));
    return { ...l, lotMode: "CHOSEN", lots, qty: total > 0 ? total : l.qty };
  });
  const backToFifo = (id: string) => patchLine(id, (l) => ({ ...l, lotMode: "FIFO", lots: l.lotOptions ? fifoFill(l.lotOptions, l.qty) : [] }));
  // A chosen lot that is short: keep what it has and take the rest from the other lots, oldest first.
  const fillRest = (id: string) => patchLine(id, (l) => {
    const opts = l.lotOptions ?? [];
    const kept = l.lots.map((x) => { const o = opts.find((op) => op.id === x.layerId); return o ? { ...x, qty: Math.min(x.qty, n(o.qtyRemaining)) } : x; }).filter((x) => x.qty > 0);
    const rest = r4(l.qty - kept.reduce((a, x) => a + x.qty, 0));
    const lots = [...kept, ...fifoFill(opts.filter((o) => !kept.some((x) => x.layerId === o.id)), rest)];
    lots.sort((a, b) => opts.findIndex((o) => o.id === a.layerId) - opts.findIndex((o) => o.id === b.layerId));
    return { ...l, lots };
  });
  const lotOf = (l: CartLine, layerId: string) => l.lotOptions?.find((o) => o.id === layerId);
  const lotIssue = (l: CartLine): string | null => {
    if (!needsLot(l)) return null;
    if (!l.lotOptions) return "Loading lots…";
    if (!l.lotOptions.length) return "No stock in any lot at this location";
    if (!l.lots.length) return "Choose the lot being sold";
    for (const x of l.lots) {
      const o = lotOf(l, x.layerId);
      if (!o) return "That lot is no longer available — choose another";
      if (x.qty > n(o.qtyRemaining)) return `Lot ${o.lotCode ?? "(no lot)"} has only ${n(o.qtyRemaining)} — ${round2(x.qty - n(o.qtyRemaining))} short`;
    }
    const inLots = r4(l.lots.reduce((a, x) => a + x.qty, 0));
    if (Math.abs(inLots - l.qty) > 1e-9) {
      const stock = r4(l.lotOptions.reduce((a, o) => a + n(o.qtyRemaining), 0));
      return l.lotMode === "FIFO" || stock < l.qty ? `Only ${stock} in stock here — ${r4(l.qty - stock)} short` : "Lot quantities do not add up to the line quantity";
    }
    return null;
  };

  useEffect(() => { if (window.matchMedia("(pointer: fine)").matches) searchRef.current?.focus(); }, [done]);

  // A running offer is per unit, so it follows the quantity; the manual discount is on top of it.
  const offerAmt = (l: CartLine) => (l.product.offer ? round2(n(l.product.offer.perUnit) * l.qty) : 0);
  const lineTotal = (l: CartLine) => Math.max(round2(n(l.price) * l.qty - offerAmt(l) - n(l.discount)), 0);
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
      if (i < 0) return [...c, newLine(p, [d])];
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
    const scanned = fromScan ? p.scannedLayerId : undefined;
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id);
      if (i < 0) return [...c, scanned ? { ...newLine(p), lotMode: "CHOSEN", lots: [{ layerId: scanned, qty: 1 }] } : newLine(p)];
      return c.map((l, j) => {
        if (j !== i) return l;
        // A scanned lot label is the item in hand: that unit comes from the scanned lot, the rest stay where they were.
        if (scanned && !l.lots.length) return { ...l, qty: l.qty + 1, lotMode: "CHOSEN", lots: [{ layerId: scanned, qty: l.qty + 1 }] };
        if (scanned) {
          const lots = l.lots.some((x) => x.layerId === scanned) ? l.lots.map((x) => (x.layerId === scanned ? { ...x, qty: x.qty + 1 } : x)) : [...l.lots, { layerId: scanned, qty: 1 }];
          return { ...l, qty: l.qty + 1, lotMode: "CHOSEN", lots };
        }
        return withQty(l, l.qty + 1);
      });
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
    await resolveCode(q);
  };
  // Shared by the Enter key (hardware scanner) and the phone camera scanner.
  const resolveCode = async (raw: string) => {
    const term = raw.trim();
    if (!term) return;
    clearTimeout(timer.current);
    setQ(""); setHits([]);
    // Each scan resolves independently, so back-to-back scans each add their own item.
    const results = await searchProducts(term);
    const t = term.toLowerCase();
    const exact = results.find((h) => h.device) ?? results.find((h) => h.sku.toLowerCase() === t || h.barcode === term) ?? results.find((h) => h.scannedLayerId) ?? (results.length === 1 ? results[0] : null);
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
    setCart([]); setPicker(null); setCustomer(null); setOverride(undefined); setReprice(null); setCustEditing(false); setCustQ(""); setMode("NONE"); setAgentId(""); setInvDisc(""); setChannel("IN_STORE"); setChannelRef("");
    setPays([{ key: "p0", method: "CASH", amount: "", accountId: "", reference: "" }]);
    setError(null); setDone(null); setIdem(crypto.randomUUID()); setDraftId(null); setSaved(null);
  };

  // Park the cart (or give the customer a priced quote). Nothing is posted: no number on the invoice, no stock, no money.
  const saveAs = (kind: "SUSPENDED" | "QUOTE") => {
    setError(null);
    start(async () => {
      const r = await saveDraftAction({
        kind, customerId: customer?.id ?? null, notes: null,
        lines: cart.map((l) => ({ productId: l.product.id, sku: l.product.sku, name: l.product.name, qty: l.qty, unitPrice: n(l.price), discount: round2(n(l.discount) + offerAmt(l)) })),
      });
      if (r.error) return setError(r.error);
      reset();
      setSaved({ id: r.id!, number: r.number!, kind });
    });
  };

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await completeSale({
        idempotencyKey: idem,
        customerId: customer?.id ?? null,
        lines: cart.map((l) => ({ productId: l.product.id, qty: l.qty, unitPrice: l.price, discount: round2(n(l.discount) + offerAmt(l)), deviceIds: l.devices.map((d) => d.id), lots: l.lots.filter((x) => x.layerId && x.qty > 0), discountRuleId: l.product.offer?.ruleId ?? null })),
        ...(override !== undefined ? { tierOverride: override } : {}),
        draftId,
        invoiceDiscount: n(invDisc),
        commissionMode: mode,
        salespersonId: mode === "USER" || mode === "DUAL" ? salespersonId || null : null,
        agentId: mode === "AGENT" || mode === "DUAL" ? agentId || null : null,
        smsReceipt: smsReceipt && !!customer?.phone,
        channel,
        channelRef: channel === "IN_STORE" ? null : channelRef.trim() || null,
        payments: pays.filter((p) => n(p.amount) > 0).map((p) => ({ method: p.method, amount: p.amount, accountId: p.accountId || null, reference: p.reference || null })),
      });
      if (r.error) setError(r.error);
      else if (r.id) { setDone({ id: r.id, number: r.number!, change: r.change ?? "0.00" }); reloadBalance(); }
    });
  };

  if (done) {
    return (
      <div className="panel stack" style={{ maxWidth: 480, margin: "24px auto", textAlign: "center" }}>
        <div className="eyebrow">Sale completed</div>
        <h1>{done.number}</h1>
        {n(done.change) > 0 && <div className="totalrow grand"><span>Give change</span><strong>Rs. {fmt(n(done.change))}</strong></div>}
        {customer && props.debtPerms.view && <div className="totalrow small"><span>{customer.name}&apos;s debt now</span><strong>{balance.status === "ok" ? `Rs. ${fmt(n(balance.ledger.debt))}` : balance.status === "loading" ? "Loading balance…" : "Balance unavailable"}</strong></div>}
        <div className="row" style={{ justifyContent: "center" }}>
          <Link className="btn" href={`/sales/${done.id}?print=1`}>Print receipt</Link>
          {channel === "COD" ? <Link className="btn" href={`/sales/${done.id}`}>Create shipment</Link> : <Link className="btn" href={`/sales/${done.id}`}>View sale</Link>}
          <button className="btn btn-primary" onClick={reset} autoFocus>New sale</button>
        </div>
      </div>
    );
  }

  return (
    <div className="pos">
      <section className="stack" style={{ gap: 12 }}>
        <div className="row"><h1 style={{ fontSize: 20 }}>POS</h1><span className="muted small">{props.locationName}</span></div>
        <div style={{ position: "relative", display: "flex", gap: 6 }}>
          <input style={{ flex: 1 }} ref={searchRef} value={q} onChange={(e) => runSearch(e.target.value)} onKeyDown={onSearchKey}
            placeholder="Scan barcode / search product, SKU or lot" aria-label="Scan or search product" autoComplete="off" enterKeyHint="search" />
          <ScanButton onCode={resolveCode} label="Scan with camera" />
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

        {saved && <p className="note note-ok">{saved.kind === "QUOTE" ? "Quote" : "Sale parked as"} {saved.number}. <Link href={`/sales/drafts/${saved.id}`}>{saved.kind === "QUOTE" ? "Print quote" : "View"}</Link></p>}
        {draftId && props.initialDraft && <p className="note">Resuming {props.initialDraft.number} — prices and stock are as of now.</p>}
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
              const issue = lotIssue(l);
              const manual = n(l.price) !== l.listPrice;
              const spare = (l.lotOptions ?? []).filter((o) => !l.lots.some((x) => x.layerId === o.id));
              return (
                <div className="cart-line" key={l.product.id}>
                  <div className="c-name">
                    <span><strong style={{ fontWeight: 500 }}>{l.product.name}</strong><br />{l.product.offer && <span className="small" style={{ color: "var(--ok)" }}>Offer: {l.product.offer.name} −{fmt(offerAmt(l))}<br /></span>}<span className="small muted">{l.product.sku}</span>
                      <span className="small" style={{ display: "block", color: l.fallback ? "var(--warn)" : "var(--muted)" }}>Price: {l.rule}{manual ? ` · changed by hand from ${fmt(l.listPrice)}` : ""}</span>
                      {needsLot(l) && (
                        <span className="lot-pick">
                          {l.lots.length > 0 && (
                            <span className="lot-sum">
                              <span className="muted">{l.lots.length > 1 ? "Lots" : "Lot"}</span>
                              {l.lots.map((x) => {
                                const o = lotOf(l, x.layerId);
                                return <span key={x.layerId} className="lot-tag" title={o ? `${o.reference ?? ""} · received ${lotDay(o.receivedAt)} · ${n(o.qtyRemaining)} in this lot` : undefined}>{o?.lotCode ?? "(no lot)"}{l.lots.length > 1 ? ` × ${x.qty}` : ""}</span>;
                              })}
                              <span className={l.lotMode === "CHOSEN" ? "lot-chosen" : "muted"}>
                                {l.lotMode === "CHOSEN" ? "chosen by you" : (l.lotOptions?.length ?? 0) > 1 ? "oldest first (FIFO)" : "only lot here"}
                              </span>
                            </span>
                          )}
                          {(l.lotOptions?.length ?? 0) > 1 && (
                            <span>
                              <button type="button" className="btn btn-sm" aria-expanded={l.lotOpen} onClick={() => patchLine(l.product.id, (x) => ({ ...x, lotOpen: !x.lotOpen }))}>
                                {l.lotOpen ? "Done" : `Change lot (${l.lotOptions!.length} lots)`}
                              </button>
                            </span>
                          )}
                          {issue && <span style={{ color: issue.startsWith("Loading") ? "var(--muted)" : "var(--err)" }}>{issue}</span>}
                          {issue?.startsWith("Lot ") && spare.some((o) => n(o.qtyRemaining) > 0) && (
                            <span><button type="button" className="btn btn-sm" onClick={() => fillRest(l.product.id)}>Take the rest from other lots</button></span>
                          )}
                        </span>
                      )}
                      {l.devices.map((d) => (
                        <span key={d.id} className="small" style={{ display: "flex", gap: 6, alignItems: "center", fontVariantNumeric: "tabular-nums" }}>
                          IMEI {deviceLabel(d)}{d.lotCode || d.reference ? <span className="muted"> · lot {d.lotCode ?? "—"} · {d.reference ?? "—"}</span> : null}
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
                    ) : l.lotMode === "CHOSEN" && l.lots.length > 1 ? (
                      <div className="steps"><span className="small muted" style={{ padding: "0 8px" }}>{l.qty} (by lot)</span></div>
                    ) : (
                    <div className="steps">
                      <button type="button" onClick={() => setQty(l.product.id, Math.max(1, l.qty - 1))} aria-label="Decrease">−</button>
                      <input value={l.qty} inputMode="decimal" aria-label="Quantity" onChange={(e) => setQty(l.product.id, Math.max(0, n(e.target.value)))} />
                      <button type="button" onClick={() => setQty(l.product.id, l.qty + 1)} aria-label="Increase">+</button>
                    </div>
                    )}
                  </div>
                  <label className="c-price"><span className="c-label">Price</span><input value={l.price} inputMode="decimal" aria-label="Unit price" onChange={(e) => setLine(l.product.id, { price: e.target.value })} /></label>
                  <label className="c-disc"><span className="c-label">Discount</span><input value={l.discount} inputMode="decimal" placeholder="0" aria-label="Line discount" onChange={(e) => setLine(l.product.id, { discount: e.target.value })} /></label>
                  <div className="c-total num" style={{ fontWeight: 500 }}><span className="c-label">Line total</span>{fmt(lineTotal(l))}</div>
                  <div className="c-remove" />
                  {l.lotOpen && l.lotOptions && l.lotOptions.length > 1 && (
                    <div className="lot-panel" role="group" aria-label={`Lots of ${l.product.name}`}>
                      <div className="lot-panel-head">
                        <span className="small muted">Oldest lot is at the top (FIFO). Tap the lot of the item in your hand, or type how many come from each lot.</span>
                        {l.lotMode === "CHOSEN" && <button type="button" className="btn btn-sm" onClick={() => backToFifo(l.product.id)}>Back to FIFO</button>}
                      </div>
                      {l.lotOptions.map((o, i) => {
                        const pick = l.lots.find((x) => x.layerId === o.id);
                        return (
                          <div key={o.id} className={`lot-opt${pick ? " on" : ""}`}>
                            <button type="button" className="lot-opt-main" aria-pressed={!!pick && l.lots.length === 1} onClick={() => chooseLot(l.product.id, o.id)}>
                              <span><strong>{o.lotCode ?? "(no lot)"}</strong>{i === 0 && <span className="lot-oldest">oldest</span>}</span>
                              <span className="small muted">{o.reference ? `${o.reference} · ` : ""}received {lotDay(o.receivedAt)}</span>
                            </button>
                            <span className="small num lot-left">{n(o.qtyRemaining)} left</span>
                            <input value={pick?.qty ?? ""} placeholder="0" inputMode="decimal" aria-label={`Quantity from lot ${o.lotCode ?? i + 1}`} onChange={(e) => setLotQty(l.product.id, o.id, Math.max(0, n(e.target.value)))} />
                          </div>
                        );
                      })}
                    </div>
                  )}
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

        {reprice && (
          <div className="note stack" role="dialog" aria-label="Price changes" style={{ gap: 8, borderColor: "var(--accent)" }}>
            <strong>Prices change for {reprice.customer?.name ?? "walk-in"} · {(() => { const pl = policyFor(reprice.customer, reprice.override); return pl.tier?.name ?? (pl.adjustmentPct ? `${pl.adjustmentPct}% (${pl.groupName})` : "default price"); })()}</strong>
            <div className="small" style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "4px 10px" }}>
              {reprice.rows.map((r) => (
                <span key={r.id} style={{ display: "contents" }}>
                  <span>{r.name}<br /><span style={{ color: r.fallback ? "var(--warn)" : "var(--muted)" }}>{r.rule}</span></span>
                  <span className="num muted" style={{ textDecoration: r.from !== r.to ? "line-through" : undefined }}>{fmt(r.from)}</span>
                  <span className="num" style={{ fontWeight: 600 }}>{fmt(r.to)}</span>
                </span>
              ))}
            </div>
            <div className="totalrow small"><span>Items subtotal {fmt(reprice.before)} → {fmt(reprice.after)}</span><strong style={{ color: reprice.after > reprice.before ? "var(--err)" : reprice.after < reprice.before ? "var(--ok)" : undefined }}>{reprice.after >= reprice.before ? "+" : "−"}{fmt(Math.abs(round2(reprice.after - reprice.before)))}</strong></div>
            {reprice.rows.some((r) => r.discount > 0 || r.manual) && (
              <span className="small" style={{ color: "var(--warn)" }}>Discounts affected: {reprice.rows.filter((r) => r.discount > 0 || r.manual).map((r) => `${r.name}${r.discount > 0 ? ` (discount ${fmt(r.discount)} kept)` : ""}${r.manual ? " (hand price replaced)" : ""}`).join("; ")}.{n(invDisc) > 0 ? ` Invoice discount ${fmt(n(invDisc))} kept.` : ""}</span>
            )}
            {reprice.clearedTier && <span className="small" style={{ color: "var(--warn)" }}>The tier chosen by hand for the previous customer ({reprice.clearedTier}) is cleared: prices now follow this customer&apos;s own pricing. Choose a tier again after applying if needed.</span>}
            <span className="small muted">Lots, IMEIs and quantities stay as they are. Prices you changed by hand are replaced.</span>
            <div className="row">
              <button className="btn btn-sm" onClick={() => setReprice(null)}>Cancel</button>
              <button className="btn btn-sm btn-primary" onClick={() => applyPricing(reprice.customer, reprice.override)}>Apply repricing</button>
            </div>
          </div>
        )}

        <div className="field">
          <span>Customer</span>
          {customer && !custEditing ? (
            <div className="stack" style={{ gap: 8 }}>
              <div className="row"><strong style={{ color: "var(--ink)", fontWeight: 500 }}>{customer.name}</strong><span className="muted">{customer.phone}</span>{!!customer.storeCredit && !props.debtPerms.view && <span className="badge badge-ok">Store credit {fmt(customer.storeCredit)}</span>}<div className="spacer" /><button className="btn btn-sm" onClick={() => setCustEditing(true)}>Change</button><button className="btn btn-sm" onClick={() => requestPricing(null, override)}>Walk-in</button></div>
              {props.debtPerms.view && <DebtStrip state={balance} perms={props.debtPerms} onReceive={() => setRepayOpen(true)} onHistory={() => setHistoryOpen(true)} onRetry={reloadBalance} />}
            </div>
          ) : newCust ? (
            <div className="stack" style={{ gap: 8 }}>
              <input placeholder="Customer name" value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} />
              <input placeholder="Mobile number" type="tel" inputMode="tel" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} />
              <div className="row">
                <button className="btn btn-sm" onClick={() => setNewCust(null)}>Cancel</button>
                <button className="btn btn-sm btn-primary" onClick={async () => {
                  try { const c = await quickAddCustomer(newCust.name, newCust.phone); setNewCust(null); setCustEditing(false); requestPricing(c, override); } catch (e) { setError((e as Error).message); }
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
                <div className="panel" aria-label="Customer matches" style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 10, padding: 0 }}>
                  {custHits.length > 1 && <div className="small muted" style={{ padding: "6px 10px" }}>{custHits.length} matches — choose the customer</div>}
                  {custHits.map((c) => (
                    <button key={c.id} className="btn-ghost" style={{ width: "100%", justifyContent: "space-between", borderRadius: 0 }} onClick={() => { setCustHits([]); setCustQ(""); setCustEditing(false); requestPricing(c, override); }}>
                      <span>{c.name}{c.pricing?.tier ? <span className="muted small"> · {c.pricing.tier.name}</span> : null}</span><span className="muted small">{c.phoneMasked ?? c.phone} · ID {c.code ?? c.id.slice(-6).toUpperCase()}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <label className="field"><span>Price tier</span>
          <select value={override === undefined ? "__customer" : override ?? "__default"} disabled={!props.canOverrideTier} aria-label="Price tier"
            onChange={(e) => { const v = e.target.value; requestPricing(customer, v === "__customer" ? undefined : v === "__default" ? null : v); }}>
            <option value="__customer">{customer?.pricing?.tier ? `${customer.pricing.tier.name} (customer group ${customer.pricing.groupName})` : customer?.pricing?.adjustmentPct ? `Default ${customer.pricing.adjustmentPct > 0 ? "+" : ""}${customer.pricing.adjustmentPct}% (customer group ${customer.pricing.groupName})` : "Default price"}</option>
            {props.canOverrideTier && (customer?.pricing?.tier || customer?.pricing?.adjustmentPct) && <option value="__default">Default price (override)</option>}
            {props.tiers.filter((t) => t.allowed && t.id !== (override === undefined ? customer?.pricing?.tier?.id : undefined)).map((t) => <option key={t.id} value={t.id}>{t.name} (override)</option>)}
          </select>
          {override !== undefined && <span className="small" style={{ color: "var(--warn)" }}>Tier changed for this sale only.</span>}
        </label>

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
          <div className="totalrow grand"><span>Current sale · to collect</span><strong>Rs. {fmt(total)}</strong></div>
          {customer && balance.status === "ok" && n(balance.ledger.debt) > 0 && (
            <div className="totalrow small muted"><span>Previous debt (separate, not in this sale)</span><strong>{fmt(n(balance.ledger.debt))}</strong></div>
          )}
        </div>

        <div>
          <div className="row" style={{ marginBottom: 8, gap: 6 }} role="group" aria-label="Sale type">
            <strong style={{ fontWeight: 600, fontSize: 13 }}>Sale type</strong><div className="spacer" />
            {SALE_CHANNELS.map((c) => <button key={c} type="button" className={"btn btn-sm" + (c === channel ? " btn-primary" : "")} aria-pressed={c === channel} onClick={() => setChannel(c)}>{CHANNEL_LABEL[c]}</button>)}
          </div>
          {channel !== "IN_STORE" && (
            <input value={channelRef} onChange={(e) => setChannelRef(e.target.value)} maxLength={80} style={{ width: "100%" }}
              placeholder={channel === "FINTREX" ? "Fintrex agreement / ref no. (optional)" : "Online order / waybill no. (optional)"} aria-label={channel === "FINTREX" ? "Fintrex reference" : "COD order reference"} />
          )}
          {channel !== "IN_STORE" && !customer && cart.length > 0 && <p className="small" style={{ margin: "4px 0 0", color: "var(--warn)" }}>Select the customer for a {CHANNEL_LABEL[channel]} sale.</p>}
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
          {due > 0 && cart.length > 0 && <div className="totalrow" style={{ color: "var(--warn)" }}><span>{customer ? "This sale on credit" : "Still to collect"}</span><strong>{fmt(due)}</strong></div>}
          {due > 0 && cart.length > 0 && customer && balance.status === "ok" && <div className="totalrow small muted"><span>Debt after this sale (previous {fmt(n(balance.ledger.debt))} + this sale)</span><strong>{fmt(round2(n(balance.ledger.debt) + due))}</strong></div>}
        </div>

        {customer?.phone && <label className="check small"><input type="checkbox" checked={smsReceipt} onChange={(e) => setSmsReceipt(e.target.checked)} /> SMS receipt to {customer.phone}</label>}
        {error && <p className="note note-err" role="alert">{error}</p>}
        <div className="row">
          <button className="btn" onClick={reset} disabled={pending || cart.length === 0}>Clear</button>
          <button className="btn" disabled={pending || cart.length === 0 || cart.some((l) => l.product.tracked)} title="Park this sale and serve the next customer" onClick={() => saveAs("SUSPENDED")}>Suspend</button>
          <button className="btn" disabled={pending || cart.length === 0} onClick={() => saveAs("QUOTE")}>Quote</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={submit} disabled={pending || cart.length === 0 || (due > 0 && !customer) || (channel !== "IN_STORE" && !customer) || !!reprice || cart.some((l) => lotIssue(l))}>
            {pending ? "Completing…" : due > 0 && customer ? `Complete · ${fmt(due)} on credit` : "Complete sale"}
          </button>
        </div>
        {due > 0 && !customer && cart.length > 0 && <p className="small muted" style={{ margin: 0 }}>Collect the full amount, or select a customer to leave a balance on credit.</p>}
        {cart.some((l) => lotIssue(l) && !lotIssue(l)!.startsWith("Loading")) && <p className="small" style={{ margin: 0, color: "var(--err)" }}>Choose the lot for every item before completing.</p>}
        {reprice && <p className="small muted" style={{ margin: 0 }}>Apply or cancel the price changes first.</p>}
      </section>
      {repayOpen && customer && (
        <RepaymentDialog customerId={customer.id} perms={props.debtPerms} accounts={props.recvAccounts} locationId={props.locationId}
          onClose={() => { setRepayOpen(false); reloadBalance(); }} onRecorded={reloadBalance} />
      )}
      {historyOpen && customer && <HistoryDialog customerId={customer.id} state={balance} onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}
