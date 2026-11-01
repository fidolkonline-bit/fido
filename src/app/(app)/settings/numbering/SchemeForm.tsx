"use client";

import { useActionState } from "react";
import { saveScheme } from "../printing-actions";
import { SubmitButton } from "@/components/SubmitButton";

const LABEL: Record<string, string> = {
  SALE: "Sale invoice", CREDIT_NOTE: "Credit note (return)", GRN: "Goods receipt / purchase", PURCHASE_ORDER: "Purchase order", SUPPLIER_CLAIM: "Supplier return",
  PAYMENT_IN: "Payment received", PAYMENT_OUT: "Payment made", ADJUSTMENT: "Stock adjustment", TRANSFER: "Stock transfer", EXPENSE: "Expense",
};
const DEFAULT: Record<string, string> = { SALE: "INV", CREDIT_NOTE: "CN", GRN: "PO", PURCHASE_ORDER: "POR", SUPPLIER_CLAIM: "SR", PAYMENT_IN: "SP", PAYMENT_OUT: "PP", ADJUSTMENT: "SA", TRANSFER: "ST", EXPENSE: "EP" };

export function SchemeForm({ s }: { s: { docType: string; prefix: string | null; nextValue: number; digits: number; includeYear: boolean } }) {
  const [state, action] = useActionState(saveScheme, undefined);
  const prefix = s.prefix ?? DEFAULT[s.docType];
  const example = `${prefix}${s.includeYear ? `${new Date().getFullYear()}/` : ""}${String(s.nextValue).padStart(s.digits, "0")}`;
  return (
    <form action={action} className="panel stack" style={{ gap: 10 }}>
      <input type="hidden" name="docType" value={s.docType} />
      <div className="row"><strong style={{ fontWeight: 600 }}>{LABEL[s.docType]}</strong><div className="spacer" /><span className="small muted">Next: <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>{example}</span></span></div>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="field" style={{ width: 110 }}><span>Prefix</span><input name="prefix" defaultValue={prefix} autoCapitalize="characters" /></label>
        <label className="field" style={{ width: 120 }}><span>Next number</span><input name="nextValue" type="number" min={1} defaultValue={s.nextValue} inputMode="numeric" /></label>
        <label className="field" style={{ width: 90 }}><span>Digits</span><input name="digits" type="number" min={1} max={8} defaultValue={s.digits} inputMode="numeric" /></label>
        <label className="check"><input type="checkbox" name="includeYear" defaultChecked={s.includeYear} /> Year in number</label>
        <SubmitButton className="btn">Save</SubmitButton>
      </div>
      {state?.error && <p className="error-text" style={{ margin: 0 }}>{state.error}</p>}
      {state?.ok && <p className="small" style={{ color: "var(--ok)", margin: 0 }}>{state.ok}</p>}
    </form>
  );
}
