"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createUser } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

export function UserForm({ roles, locations }: { roles: { id: string; name: string }[]; locations: { id: string; name: string }[] }) {
  const [state, action] = useActionState(createUser, undefined);
  const [login, setLogin] = useState(true);
  return (
    <form action={action} className="panel stack">
      <div className="grid2">
        <label className="field"><span>Full name *</span><input name="fullName" required /></label>
        <label className="field"><span>Mobile</span><input name="phone" type="tel" inputMode="tel" /></label>
      </div>
      <label className="check"><input type="checkbox" name="allowLogin" checked={login} onChange={(e) => setLogin(e.target.checked)} /> Allow login</label>
      {login && (
        <>
          <div className="grid2">
            <label className="field"><span>Username</span><input name="username" autoCapitalize="none" autoComplete="off" /></label>
            <label className="field"><span>Temporary password (min 8)</span><input name="password" type="password" autoComplete="new-password" /></label>
            <label className="field"><span>Role</span>
              <select name="roleId" defaultValue=""><option value="">Select role…</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
            </label>
            <label className="field"><span>Maximum sales discount %</span><input name="maxDiscountPct" type="number" min="0" max="100" step="0.01" defaultValue="0" inputMode="decimal" /></label>
          </div>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <span>Allowed locations</span>
            <div className="row">{locations.map((l) => <label key={l.id} className="check"><input type="checkbox" name="locationIds" value={l.id} defaultChecked={locations.length === 1} /> {l.name}</label>)}</div>
          </fieldset>
        </>
      )}
      <label className="field" style={{ maxWidth: 360 }}><span>Commission profile</span>
        <select name="commissionKind" defaultValue="NONE">
          <option value="NONE">None</option><option value="USER">Salesperson (user commission)</option><option value="AGENT">Referral agent</option><option value="BOTH">Both</option>
        </select>
      </label>
      <p className="small muted" style={{ margin: 0 }}>A referral agent does not need a login. Commission eligibility does not add anyone to payroll.</p>
      {state?.error && <p className="note note-err">{state.error}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}><Link className="btn" href="/users">Cancel</Link><SubmitButton>Create</SubmitButton></div>
    </form>
  );
}
