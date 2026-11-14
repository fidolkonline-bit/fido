"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitTradeIn } from "./actions";
import { CustomerPicker, type PickedCustomer } from "@/components/CustomerPicker";
import { ScanButton } from "@/components/CameraScan";

type Opt = { id: string; name: string };

export function TradeInForm({ products, accounts, registerOpen }: { products: Opt[]; accounts: Opt[]; registerOpen: boolean }) {
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [f, setF] = useState({
    sellerIdType: "NIC", sellerIdNumber: "", sellerAddress: "", productId: "", imei1: "", imei2: "", serial: "", grade: "B", batteryHealth: "",
    conditionNotes: "", accessories: "", value: "", settlement: "STORE_CREDIT", accountId: "", reference: "",
  });
  const [checks, setChecks] = useState({ ownershipDeclared: false, accountsRemoved: false, readyToSell: false });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const submit = () => start(async () => {
    setError(null);
    const r = await submitTradeIn({
      idempotencyKey: key, customerId: customer?.id ?? "", ...f, ...checks,
      sellerAddress: f.sellerAddress || null, imei1: f.imei1 || null, imei2: f.imei2 || null, serial: f.serial || null,
      batteryHealth: f.batteryHealth === "" ? null : Number(f.batteryHealth), conditionNotes: f.conditionNotes || null, accessories: f.accessories || null,
      accountId: f.accountId || null, reference: f.reference || null,
    });
    if (r.error) setError(r.error);
    else if (r.id) router.push(`/trade-ins/${r.id}?print=1`);
  });

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>1 · Seller</h2>
        <CustomerPicker value={customer} onChange={setCustomer} addLabel="New seller" />
        <div className="grid3">
          <label className="field"><span>ID type</span>
            <select value={f.sellerIdType} onChange={(e) => set("sellerIdType", e.target.value)}><option value="NIC">National ID (NIC)</option><option value="PASSPORT">Passport</option><option value="DRIVING_LICENCE">Driving licence</option></select>
          </label>
          <label className="field"><span>ID number *</span><input value={f.sellerIdNumber} onChange={(e) => set("sellerIdNumber", e.target.value)} autoCapitalize="characters" /></label>
          <label className="field"><span>Address</span><input value={f.sellerAddress} onChange={(e) => set("sellerAddress", e.target.value)} /></label>
        </div>
        <p className="small muted" style={{ margin: 0 }}>Check the ID against the person in front of you. It is printed on the purchase receipt they sign.</p>
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>2 · Phone</h2>
        <label className="field"><span>Goes into stock as *</span>
          <select value={f.productId} onChange={(e) => set("productId", e.target.value)}><option value="">Select the used-phone product…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </label>
        {!products.length && <p className="note note-err">No IMEI-tracked products yet. Create one (for example “Used iPhone 12 64GB”) with IMEI tracking on, then come back.</p>}
        <div className="grid3">
          <label className="field"><span>IMEI (dial *#06#)</span>
            <span className="row" style={{ flexWrap: "nowrap" }}><input value={f.imei1} onChange={(e) => set("imei1", e.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={17} /><ScanButton onCode={(c) => set("imei1", c.replace(/\D/g, ""))} label="Scan IMEI" /></span>
          </label>
          <label className="field"><span>IMEI 2</span><input value={f.imei2} onChange={(e) => set("imei2", e.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={17} /></label>
          <label className="field"><span>Serial</span><input value={f.serial} onChange={(e) => set("serial", e.target.value)} autoCapitalize="characters" /></label>
          <label className="field"><span>Grade</span>
            <select value={f.grade} onChange={(e) => set("grade", e.target.value)}><option value="A">A — like new</option><option value="B">B — light wear</option><option value="C">C — visible wear</option><option value="D">D — faulty / for parts</option></select>
          </label>
          <label className="field"><span>Battery health %</span><input value={f.batteryHealth} onChange={(e) => set("batteryHealth", e.target.value)} inputMode="numeric" /></label>
          <label className="field"><span>Accessories with it</span><input value={f.accessories} onChange={(e) => set("accessories", e.target.value)} placeholder="Box, charger…" /></label>
        </div>
        <label className="field"><span>Condition notes</span><textarea rows={2} value={f.conditionNotes} onChange={(e) => set("conditionNotes", e.target.value)} placeholder="Scratches, screen, cameras, Face ID / fingerprint, repairs done before…" /></label>
        <label className="check"><input type="checkbox" checked={checks.accountsRemoved} onChange={(e) => setChecks({ ...checks, accountsRemoved: e.target.checked })} /> iCloud / Google account signed out and the phone reset (checked on the phone)</label>
        <label className="check"><input type="checkbox" checked={checks.ownershipDeclared} onChange={(e) => setChecks({ ...checks, ownershipDeclared: e.target.checked })} /> Seller confirms the phone is theirs to sell, is not stolen and has no finance owing *</label>
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>3 · Value and payment</h2>
        <div className="grid3">
          <label className="field"><span>Agreed value (Rs.) *</span><input value={f.value} onChange={(e) => set("value", e.target.value)} inputMode="decimal" /></label>
          <label className="field"><span>Pay the seller by</span>
            <select value={f.settlement} onChange={(e) => set("settlement", e.target.value)}>
              <option value="STORE_CREDIT">Store credit (trade-in against a sale)</option><option value="CASH">Cash from my register</option><option value="BANK_TRANSFER">Bank transfer</option>
            </select>
          </label>
          {f.settlement === "BANK_TRANSFER" && (
            <label className="field"><span>Paid from account</span>
              <select value={f.accountId} onChange={(e) => set("accountId", e.target.value)}><option value="">Select account…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            </label>
          )}
          {f.settlement !== "STORE_CREDIT" && <label className="field"><span>Reference</span><input value={f.reference} onChange={(e) => set("reference", e.target.value)} /></label>}
        </div>
        {f.settlement === "STORE_CREDIT" && <p className="small muted" style={{ margin: 0 }}>The value becomes store credit for this customer. At the POS choose the same customer and pay with Store credit; they pay only the difference.</p>}
        {f.settlement === "CASH" && !registerOpen && <p className="note note-err">The cash register is not open. Open it first, or pay by another method.</p>}
        <label className="check"><input type="checkbox" checked={checks.readyToSell} onChange={(e) => setChecks({ ...checks, readyToSell: e.target.checked })} /> Already checked and cleaned — put it straight on sale</label>
        {!checks.readyToSell && <p className="small muted" style={{ margin: 0 }}>Otherwise the phone is held for checking and is released under Stock adjustments › Release held stock.</p>}
      </section>

      {error && <p className="note note-err" role="alert">{error}</p>}
      <div className="form-actions"><button className="btn btn-primary" disabled={pending} onClick={submit}>{pending ? "Saving…" : "Buy phone and print receipt"}</button></div>
    </div>
  );
}
