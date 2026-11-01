"use client";

import { useActionState } from "react";
import Link from "next/link";
import { saveContact } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

type C = {
  id: string; name: string; company: string | null; phone: string | null; email: string | null; address: string | null;
  taxNumber: string | null; groupId: string | null; creditLimit: string | null; payTermDays: number | null;
  openingBalance: string; isCustomer: boolean; isSupplier: boolean;
};

export function ContactForm({ contact, groups, defaultType }: { contact?: C; groups: { id: string; name: string }[]; defaultType?: string }) {
  const [state, action] = useActionState(saveContact, undefined);
  const c = contact;
  return (
    <form action={action} className="panel stack">
      {c && <input type="hidden" name="id" value={c.id} />}
      <div className="row" style={{ gap: 18 }}>
        <label className="check"><input type="checkbox" name="isCustomer" defaultChecked={c ? c.isCustomer : defaultType !== "supplier"} /> Customer</label>
        <label className="check"><input type="checkbox" name="isSupplier" defaultChecked={c ? c.isSupplier : defaultType === "supplier"} /> Supplier</label>
      </div>
      <div className="grid2">
        <label className="field"><span>Name *</span><input name="name" defaultValue={c?.name} required /></label>
        <label className="field"><span>Mobile</span><input name="phone" type="tel" inputMode="tel" defaultValue={c?.phone ?? ""} /></label>
        <label className="field"><span>Company</span><input name="company" defaultValue={c?.company ?? ""} /></label>
        <label className="field"><span>Email</span><input name="email" type="email" defaultValue={c?.email ?? ""} /></label>
        <label className="field"><span>Customer group</span>
          <select name="groupId" defaultValue={c?.groupId ?? ""}><option value="">— None —</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        </label>
        <label className="field"><span>Tax number</span><input name="taxNumber" defaultValue={c?.taxNumber ?? ""} /></label>
      </div>
      <label className="field"><span>Address</span><textarea name="address" defaultValue={c?.address ?? ""} /></label>
      <div className="grid3">
        <label className="field"><span>Credit limit (blank = no limit)</span><input name="creditLimit" type="number" step="0.01" min="0" inputMode="decimal" defaultValue={c?.creditLimit ?? ""} /></label>
        <label className="field"><span>Payment terms (days)</span><input name="payTermDays" type="number" min="0" inputMode="numeric" defaultValue={c?.payTermDays ?? ""} /></label>
        <label className="field"><span>Opening balance due</span><input name="openingBalance" type="number" step="0.01" inputMode="decimal" defaultValue={c?.openingBalance ?? "0"} /></label>
      </div>
      {state?.error && <p className="note note-err">{state.error}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}>
        <Link className="btn" href={c ? `/contacts/${c.id}` : "/contacts"}>Cancel</Link>
        <SubmitButton>{c ? "Save changes" : "Create contact"}</SubmitButton>
      </div>
    </form>
  );
}
