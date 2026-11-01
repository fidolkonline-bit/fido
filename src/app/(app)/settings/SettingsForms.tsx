"use client";

import { useActionState } from "react";
import { saveBusiness, addLocation } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { changeOwnPassword } from "../users/actions";

export function BusinessForm({ name, rounding }: { name: string; rounding: string }) {
  const [state, action] = useActionState(saveBusiness, undefined);
  return (
    <form action={action} className="panel stack">
      <h2 style={{ margin: 0 }}>Business</h2>
      <div className="grid2">
        <label className="field"><span>Business name</span><input name="name" defaultValue={name} required /></label>
        <label className="field"><span>Sale total rounding</span>
          <select name="saleRounding" defaultValue={String(Number(rounding))}>
            <option value="0">No rounding</option><option value="0.5">Nearest 0.50</option><option value="1">Nearest 1.00</option><option value="5">Nearest 5.00</option><option value="10">Nearest 10.00</option>
          </select>
        </label>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Currency LKR · Time zone Asia/Colombo · FIFO stock · Overselling disabled · Financial year starts January.</p>
      {state?.error && <p className="note note-err">{state.error}</p>}
      {state?.ok && <p className="note note-ok">{state.ok}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}><SubmitButton>Save</SubmitButton></div>
    </form>
  );
}

export function LocationForm() {
  const [state, action] = useActionState(addLocation, undefined);
  return (
    <form action={action} className="panel stack">
      <h2 style={{ margin: 0 }}>Add location</h2>
      <div className="grid2">
        <label className="field"><span>Name</span><input name="name" required /></label>
        <label className="field"><span>Code</span><input name="code" required autoCapitalize="characters" placeholder="e.g. BR1" /></label>
        <label className="field"><span>Phone</span><input name="phone" type="tel" /></label>
        <label className="field"><span>Address</span><input name="address" /></label>
      </div>
      {state?.error && <p className="note note-err">{state.error}</p>}
      {state?.ok && <p className="note note-ok">{state.ok}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}><SubmitButton>Add location</SubmitButton></div>
    </form>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState(changeOwnPassword, undefined);
  return (
    <form action={action} className="panel stack" style={{ maxWidth: 520 }}>
      <h2 style={{ margin: 0 }}>Change my password</h2>
      <label className="field"><span>Current password</span><input name="current" type="password" autoComplete="current-password" required /></label>
      <div className="grid2">
        <label className="field"><span>New password</span><input name="next" type="password" autoComplete="new-password" required minLength={8} /></label>
        <label className="field"><span>Confirm new password</span><input name="confirm" type="password" autoComplete="new-password" required minLength={8} /></label>
      </div>
      {state?.error && <p className="note note-err">{state.error}</p>}
      {state?.ok && <p className="note note-ok">{state.ok}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}><SubmitButton>Change password</SubmitButton></div>
    </form>
  );
}
