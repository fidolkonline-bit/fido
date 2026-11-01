"use client";

import { useActionState } from "react";
import { addAccount } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

export function AccountForm({ locations }: { locations: { id: string; name: string }[] }) {
  const [state, action] = useActionState(addAccount, undefined);
  return (
    <form action={action} className="panel stack">
      <h2 style={{ margin: 0 }}>New payment account</h2>
      <div className="grid2">
        <label className="field"><span>Name</span><input name="name" required placeholder="e.g. Commercial Bank current" /></label>
        <label className="field"><span>Type</span>
          <select name="type" defaultValue="BANK">
            <option value="CASH">Cash (till)</option><option value="BANK">Bank</option><option value="CARD">Card settlement</option>
            <option value="WALLET">Wallet</option><option value="OWNER_COLLECTION">Owner collection (remote)</option>
          </select>
        </label>
        <label className="field"><span>Location</span>
          <select name="locationId" defaultValue=""><option value="">Business-wide</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        </label>
        <label className="field"><span>Opening balance</span><input name="openingBalance" type="number" step="0.01" inputMode="decimal" defaultValue="0" /></label>
      </div>
      {state?.error && <p className="note note-err">{state.error}</p>}
      {state?.ok && <p className="note note-ok">{state.ok}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}><SubmitButton>Add account</SubmitButton></div>
    </form>
  );
}
