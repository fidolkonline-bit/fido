"use client";

import { useActionState, useState } from "react";
import { switchCashier } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

export function SwitchForm({ people }: { people: { accountId: string; name: string; role: string }[] }) {
  const [state, action] = useActionState(switchCashier, undefined);
  const [who, setWho] = useState("");
  return (
    <form action={action} className="panel stack" style={{ maxWidth: 520 }}>
      <input type="hidden" name="accountId" value={who} />
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        {people.map((p) => (
          <button key={p.accountId} type="button" className={"btn" + (who === p.accountId ? " btn-primary" : "")} onClick={() => setWho(p.accountId)} aria-pressed={who === p.accountId}>
            {p.name} <span className="small muted">· {p.role}</span>
          </button>
        ))}
      </div>
      {who && (
        <label className="field" style={{ maxWidth: 220 }}>
          <span>PIN</span>
          <input name="pin" type="password" inputMode="numeric" pattern="\d{4,6}" maxLength={6} autoComplete="off" autoFocus required />
        </label>
      )}
      {state?.error && <p className="note note-err" role="alert">{state.error}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}><SubmitButton pendingText="Switching…">Switch</SubmitButton></div>
    </form>
  );
}
