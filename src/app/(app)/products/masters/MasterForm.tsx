"use client";

import Link from "next/link";
import { useActionState } from "react";
import { addMaster } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

// Add form for brands, units and warranties. Passing `edit` turns the brand form into a rename form.
export function MasterForm({ kind, edit }: { kind: "brand" | "unit" | "warranty"; edit?: { id: string; name: string } }) {
  const [state, action] = useActionState(addMaster, undefined);
  return (
    <form action={action} className="stack" style={{ gap: 10 }} key={edit?.id ?? "new"}>
      <input type="hidden" name="kind" value={kind} />
      {edit && <input type="hidden" name="id" value={edit.id} />}
      {edit && <p className="small muted" style={{ margin: 0 }}>Editing {edit.name} · <Link href="?">Cancel</Link></p>}
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="field" style={{ flex: "2 1 160px" }}><span>Name</span><input name="name" defaultValue={edit?.name} required /></label>
        {kind === "unit" && <label className="field" style={{ flex: "1 1 80px" }}><span>Short name</span><input name="shortName" required /></label>}
        {kind === "unit" && <label className="check"><input type="checkbox" name="allowDecimal" /> Decimals</label>}
        {kind === "warranty" && <label className="field" style={{ flex: "1 1 100px" }}><span>Days</span><input name="durationDays" type="number" min="1" inputMode="numeric" required /></label>}
        {kind === "warranty" && <label className="field" style={{ flex: "3 1 220px" }}><span>Note (optional)</span><input name="description" maxLength={200} placeholder="e.g. Covers manufacturing defects only" /></label>}
        <SubmitButton pendingText={edit ? "Saving…" : "Adding…"}>{edit ? "Save" : "Add"}</SubmitButton>
      </div>
      {state?.error && <p className="error-text">{state.error}</p>}
      {state?.ok && <p className="small" style={{ color: "var(--ok)", margin: 0 }}>{state.ok}</p>}
    </form>
  );
}
