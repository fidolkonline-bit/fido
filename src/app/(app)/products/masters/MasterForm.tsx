"use client";

import { useActionState } from "react";
import { addMaster } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

export function MasterForm({ kind }: { kind: "brand" | "unit" | "warranty" }) {
  const [state, action] = useActionState(addMaster, undefined);
  return (
    <form action={action} className="stack" style={{ gap: 10 }}>
      <input type="hidden" name="kind" value={kind} />
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="field" style={{ flex: "2 1 160px" }}><span>Name</span><input name="name" required /></label>
        {kind === "unit" && <label className="field" style={{ flex: "1 1 80px" }}><span>Short name</span><input name="shortName" required /></label>}
        {kind === "unit" && <label className="check"><input type="checkbox" name="allowDecimal" /> Decimals</label>}
        {kind === "warranty" && <label className="field" style={{ flex: "1 1 100px" }}><span>Days</span><input name="durationDays" type="number" min="1" inputMode="numeric" required /></label>}
        <SubmitButton pendingText="Adding…">Add</SubmitButton>
      </div>
      {state?.error && <p className="error-text">{state.error}</p>}
      {state?.ok && <p className="small" style={{ color: "var(--ok)", margin: 0 }}>{state.ok}</p>}
    </form>
  );
}
