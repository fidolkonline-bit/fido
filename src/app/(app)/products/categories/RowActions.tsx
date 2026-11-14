"use client";

import { useActionState } from "react";
import { deleteCategory, setCategoryActive } from "./actions";

// Deactivate / reactivate / delete buttons for one category row, each behind a confirm.
export function RowActions({ id, name, active, subs, deletable }: { id: string; name: string; active: boolean; subs: number; deletable: boolean }) {
  const [toggled, toggle, togglePending] = useActionState(setCategoryActive, undefined);
  const [deleted, del, delPending] = useActionState(deleteCategory, undefined);
  const msg = toggled?.error ?? deleted?.error;
  const ask = (text: string) => (e: React.FormEvent) => { if (!window.confirm(text)) e.preventDefault(); };
  return (
    <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
      <form
        action={toggle}
        onSubmit={active ? ask(`Deactivate ${name}?${subs ? ` Its ${subs} active subcategor${subs === 1 ? "y" : "ies"} will be deactivated too.` : ""} It stops showing in pickers; products and history keep it.`) : undefined}
      >
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
