"use client";

import { useActionState, useState } from "react";
import { saveCategory } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

type Cat = { id: string; name: string; parentId: string | null; poolRate: string; userShare: string; agentShare: string };

export function CategoryForm({ parents, edit }: { parents: { id: string; name: string }[]; edit?: Cat }) {
  const [state, action] = useActionState(saveCategory, undefined);
  const [pool, setPool] = useState(Number(edit?.poolRate ?? 0));
  const [u, setU] = useState(Number(edit?.userShare ?? 0));
  const [a, setA] = useState(Number(edit?.agentShare ?? 0));
  return (
    <form action={action} className="panel stack" key={edit?.id ?? "new"}>
      <h2 style={{ margin: 0 }}>{edit ? `Edit ${edit.name}` : "New category"}</h2>
      {edit && <input type="hidden" name="id" value={edit.id} />}
      <div className="grid2">
        <label className="field"><span>Name</span><input name="name" defaultValue={edit?.name} required /></label>
        <label className="field"><span>Parent category</span>
          <select name="parentId" defaultValue={edit?.parentId ?? ""}><option value="">— Top level —</option>{parents.filter((p) => p.id !== edit?.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </label>
      </div>
      <div className="grid3">
        <label className="field"><span>Commission pool %</span><input name="poolRate" type="number" step="0.0001" min="0" max="100" inputMode="decimal" value={pool} onChange={(e) => setPool(Number(e.target.value))} /></label>
        <label className="field"><span>User share of pool %</span><input name="userShare" type="number" step="0.01" min="0" max="100" inputMode="decimal" value={u} onChange={(e) => setU(Number(e.target.value))} /></label>
        <label className="field"><span>Agent share of pool %</span><input name="agentShare" type="number" step="0.01" min="0" max="100" inputMode="decimal" value={a} onChange={(e) => setA(Number(e.target.value))} /></label>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Effective: user {(pool * u / 100).toFixed(3)}% · agent {(pool * a / 100).toFixed(3)}% of eligible net line value.
        {u + a !== 100 && u + a > 0 && <span style={{ color: "var(--warn)" }}> Shares total {u + a}% — the remainder is not paid to anyone.</span>}
      </p>
      {state?.error && <p className="note note-err">{state.error}</p>}
      {state?.ok && <p className="note note-ok">{state.ok}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}><SubmitButton>Save category</SubmitButton></div>
    </form>
  );
}
