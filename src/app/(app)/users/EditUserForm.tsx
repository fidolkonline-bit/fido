"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { updateUser } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

type Initial = {
  personId: string; fullName: string; phone: string | null; hasLogin: boolean; allowLogin: boolean; username: string; roleId: string;
  maxDiscountPct: string; locationIds: string[]; commissionKind: string; hasPin: boolean; self: boolean;
};

export function EditUserForm({ initial, roles, locations }: { initial: Initial; roles: { id: string; name: string }[]; locations: { id: string; name: string }[] }) {
  const [state, action] = useActionState(updateUser, undefined);
  const [login, setLogin] = useState(initial.allowLogin);
  return (
    <form action={action} className="panel stack">
      <input type="hidden" name="personId" value={initial.personId} />
      <div className="grid2">
        <label className="field"><span>Full name *</span><input name="fullName" required defaultValue={initial.fullName} /></label>
        <label className="field"><span>Mobile</span><input name="phone" type="tel" inputMode="tel" defaultValue={initial.phone ?? ""} /></label>
      </div>
      <label className="check"><input type="checkbox" name="allowLogin" checked={login} disabled={initial.self} onChange={(e) => setLogin(e.target.checked)} /> Allow login</label>
      {initial.self && <input type="hidden" name="allowLogin" value="on" />}
      {login && (
        <>
          <div className="grid2">
            <label className="field"><span>Username</span><input name="username" autoCapitalize="none" autoComplete="off" defaultValue={initial.username} /></label>
            <label className="field"><span>{initial.hasLogin ? "Reset password (leave empty to keep)" : "Temporary password (min 8)"}</span><input name="password" type="password" autoComplete="new-password" minLength={8} /></label>
            <label className="field"><span>Role</span>
              {initial.self && <input type="hidden" name="roleId" value={initial.roleId} />}
              <select name="roleId" defaultValue={initial.roleId} disabled={initial.self}><option value="">Select role…</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
            </label>
            <label className="field"><span>Maximum sales discount %</span><input name="maxDiscountPct" type="number" min="0" max="100" step="0.01" defaultValue={initial.maxDiscountPct} inputMode="decimal" /></label>
          </div>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <span>Allowed locations</span>
            <div className="row">{locations.map((l) => <label key={l.id} className="check"><input type="checkbox" name="locationIds" value={l.id} defaultChecked={initial.locationIds.includes(l.id)} /> {l.name}</label>)}</div>
          </fieldset>
          {initial.hasPin && <label className="check"><input type="checkbox" name="clearPin" /> Remove this person&apos;s cashier PIN</label>}
          {initial.hasLogin && <p className="small muted" style={{ margin: 0 }}>Resetting the password, changing the role or switching login off signs this person out on every device. A reset also clears their PIN and any login lock.</p>}
        </>
      )}
      <label className="field" style={{ maxWidth: 360 }}><span>Commission profile</span>
        <select name="commissionKind" defaultValue={initial.commissionKind}>
          <option value="NONE">None</option><option value="USER">Salesperson (user commission)</option><option value="AGENT">Referral agent</option><option value="BOTH">Both</option>
        </select>
      </label>
      {state?.error && <p className="note note-err">{state.error}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}><Link className="btn" href="/users">Cancel</Link><SubmitButton>Save changes</SubmitButton></div>
    </form>
  );
}
