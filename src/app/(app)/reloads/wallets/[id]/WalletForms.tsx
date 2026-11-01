"use client";

import { useActionState, useState } from "react";
import { doFund, doWallet } from "../../actions";
import { SubmitButton } from "@/components/SubmitButton";

export function FundForm({ walletId, rate, accounts }: { walletId: string; rate: number; accounts: { id: string; name: string }[] }) {
  const [state, action] = useActionState(doFund, undefined);
  const [money, setMoney] = useState("");
  const [method, setMethod] = useState("BANK_TRANSFER");
  return (
    <form action={action} className="panel stack">
      <input type="hidden" name="walletId" value={walletId} />
      <h2 style={{ margin: 0 }}>Record funding</h2>
      <div className="grid3">
        <label className="field"><span>Money paid (Rs.)</span><input name="money" value={money} onChange={(e) => setMoney(e.target.value)} inputMode="decimal" /></label>
        <label className="field"><span>Nominal credited (blank = at rate {rate})</span><input name="nominal" inputMode="decimal" placeholder={money ? (Number(money) / rate).toFixed(2) : ""} /></label>
        <label className="field"><span>Paid by</span><select name="method" value={method} onChange={(e) => setMethod(e.target.value)}><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash (my register)</option><option value="CARD">Card</option><option value="OTHER">Other</option></select></label>
        {method !== "CASH" && <label className="field"><span>From account</span><select name="accountId"><option value="">Select…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
        <label className="field"><span>Provider reference</span><input name="reference" /></label>
      </div>
      {state?.error && <p className="note note-err">{state.error}</p>}
      {state?.ok && <p className="note note-ok">{state.ok}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}><SubmitButton>Record funding</SubmitButton></div>
    </form>
  );
}

export function WalletEdit({ w, locations }: { w: { id: string; name: string; networks: string[]; costRate: string; locationId: string | null }; locations: { id: string; name: string }[] }) {
  const [state, action] = useActionState(doWallet, undefined);
  return (
    <form action={action} className="panel stack">
      <input type="hidden" name="id" value={w.id} />
      <h2 style={{ margin: 0 }}>Wallet settings</h2>
      <div className="grid3">
        <label className="field"><span>Name</span><input name="name" defaultValue={w.name} /></label>
        <label className="field"><span>Cost per 1.00 nominal</span><input name="costRate" defaultValue={w.costRate} inputMode="decimal" /></label>
        <label className="field"><span>Location</span><select name="locationId" defaultValue={w.locationId ?? ""}><option value="">All</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      </div>
      <div className="row">{["DIALOG", "MOBITEL", "HUTCH", "AIRTEL"].map((n) => <label key={n} className="check"><input type="checkbox" name="networks" value={n} defaultChecked={w.networks.includes(n)} /> {n.toLowerCase()}</label>)}</div>
      {state?.error && <p className="note note-err">{state.error}</p>}
      {state?.ok && <p className="note note-ok">{state.ok}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}><SubmitButton className="btn">Save wallet</SubmitButton></div>
    </form>
  );
}
