"use client";

import { useActionState } from "react";
import { deleteBrand, setBrandActive } from "./actions";

// Deactivate / reactivate / delete buttons for one brand row, each behind a confirm.
export function BrandActions({ id, name, active, deletable }: { id: string; name: string; active: boolean; deletable: boolean }) {
  const [toggled, toggle, togglePending] = useActionState(setBrandActive, undefined);
  const [deleted, del, delPending] = useActionState(deleteBrand, undefined);
  const msg = toggled?.error ?? deleted?.error;
  const ask = (text: string) => (e: React.FormEvent) => { if (!window.confirm(text)) e.preventDefault(); };
  return (
    <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
      <form action={toggle} onSubmit={active ? ask(`Deactivate ${name}? It stops showing in pickers; products already on it keep it.`) : undefined}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="active" value={active ? "0" : "1"} />
        <button className="btn btn-sm" disabled={togglePending}>{active ? "Deactivate" : "Reactivate"}</button>
      </form>
      {deletable && (
        <form action={del} onSubmit={ask(`Delete ${name} permanently? This cannot be undone.`)}>
          <input type="hidden" name="id" value={id} />
          <button className="btn btn-sm btn-danger" disabled={delPending}>Delete</button>
        </form>
      )}
      {msg && <p className="error-text small" role="alert" style={{ margin: 0, width: "100%" }}>{msg}</p>}
    </div>
  );
}
