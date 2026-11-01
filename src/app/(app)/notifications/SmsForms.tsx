"use client";

import { useActionState, useState } from "react";
import { sendQueued, saveTemplate } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

export function SendQueued() {
  const [state, action] = useActionState(sendQueued, undefined);
  return (
    <form action={action} className="row">
      <SubmitButton className="btn">Send waiting messages now</SubmitButton>
      {state?.error && <span className="error-text">{state.error}</span>}
      {state?.ok && <span className="small" style={{ color: "var(--ok)" }}>{state.ok}</span>}
    </form>
  );
}

export function TemplateForm({ event, label, vars, body, active }: { event: string; label: string; vars: readonly string[]; body: string; active: boolean }) {
  const [state, action] = useActionState(saveTemplate, undefined);
  const [text, setText] = useState(body);
  const sample = text.replace(/\{(\w+)\}/g, (_, k) => ({ shop: "Fido", invoice: "INV2026/0042", total: "2,500.00", paid: "2,500.00", due: "", job: "JOB2026/0007", device: "Galaxy A15", promised: "05 Nov", estimate: "3,500.00", mobile: "0771234567", amount: "500.00", ref: "MT123", task: "Collect bus parcel BP2026/0003" } as Record<string, string>)[k] ?? `{${k}}`);
  return (
    <form action={action} className="panel stack" style={{ gap: 8 }}>
      <input type="hidden" name="event" value={event} />
      <div className="row"><strong style={{ fontWeight: 600 }}>{label}</strong><div className="spacer" /><label className="check small"><input type="checkbox" name="active" defaultChecked={active} /> Send automatically</label></div>
      <textarea name="body" value={text} onChange={(e) => setText(e.target.value)} rows={2} />
      <p className="small muted" style={{ margin: 0 }}>Placeholders: {vars.map((v) => `{${v}}`).join(" ")} · {sample.length} characters ({Math.ceil(sample.length / 160)} SMS)</p>
      <p className="small" style={{ margin: 0 }}>Preview: {sample}</p>
      <div className="row"><SubmitButton className="btn btn-sm">Save</SubmitButton>{state?.error && <span className="error-text">{state.error}</span>}{state?.ok && <span className="small" style={{ color: "var(--ok)" }}>{state.ok}</span>}</div>
    </form>
  );
}
