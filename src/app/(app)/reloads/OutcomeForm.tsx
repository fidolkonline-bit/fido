"use client";

import { useActionState, useState } from "react";
import { doOutcome } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

export function OutcomeForm({ id, uncertain }: { id: string; uncertain: boolean }) {
  const [state, action] = useActionState(doOutcome, undefined);
  const [result, setResult] = useState("SUCCESSFUL");
  return (
    <form action={action} className="panel stack">
      <input type="hidden" name="id" value={id} />
      <h2 style={{ margin: 0 }}>{uncertain ? "Reconcile the uncertain result" : "Record the provider result"}</h2>
      {uncertain && <p className="note">Check the provider app / statement before choosing. Do not reload the number again until this is settled.</p>}
      <div className="row">
        {[["SUCCESSFUL", "Successful"], ["FAILED", "Failed"], ...(uncertain ? [] : [["UNCERTAIN", "Not sure yet"]])].map(([v, l]) => (
          <label key={v} className="check"><input type="radio" name="result" value={v} checked={result === v} onChange={() => setResult(v)} /> {l}</label>
        ))}
      </div>
      <div className="grid2">
        <label className="field"><span>Provider reference / SMS code</span><input name="providerRef" /></label>
        <label className="field"><span>Note</span><input name="note" /></label>
      </div>
      {state?.error && <p className="note note-err">{state.error}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}><SubmitButton>Save result</SubmitButton></div>
    </form>
  );
}
