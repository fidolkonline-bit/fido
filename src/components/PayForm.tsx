"use client";

import { useState } from "react";
import { ActionForm } from "./ActionForm";
import { SubmitButton } from "./SubmitButton";

type Res = { error?: string; ok?: string } | undefined;

// Shared "take / make a payment" form; cheque details appear when Cheque is chosen.
export function PayForm({ action, hidden, due, accounts, label, methods = ["CASH", "CARD", "BANK_TRANSFER", "CHEQUE"] }: {
  action: (s: Res, f: FormData) => Promise<Res>; hidden: Record<string, string>; due: string; accounts: { id: string; name: string }[]; label: string; methods?: string[];
}) {
  const [method, setMethod] = useState(methods[0]);
  return (
    <ActionForm action={action} className="stack" style={{ gap: 10 }}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div className="grid3">
        <label className="field"><span>Amount</span><input name="amount" defaultValue={due} inputMode="decimal" required /></label>
        <label className="field"><span>Method</span>
          <select name="method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {methods.map((m) => <option key={m} value={m}>{{ CASH: "Cash (my register)", CARD: "Card", BANK_TRANSFER: "Bank transfer", CHEQUE: "Cheque", OTHER: "Other" }[m]}</option>)}
          </select>
        </label>
        {method !== "CASH" && <label className="field"><span>Account</span><select name="accountId"><option value="">Default</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
        {method === "CHEQUE" ? <>
          <label className="field"><span>Cheque number</span><input name="chequeNumber" required inputMode="numeric" /></label>
          <label className="field"><span>Bank</span><input name="chequeBank" /></label>
          <label className="field"><span>Cheque date</span><input type="date" name="chequeDate" required /></label>
        </> : <label className="field"><span>Reference</span><input name="reference" /></label>}
      </div>
      <div><SubmitButton>{label}</SubmitButton></div>
    </ActionForm>
  );
}
