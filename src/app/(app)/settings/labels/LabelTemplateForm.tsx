"use client";

import { useActionState } from "react";
import { saveLabelTemplate } from "../printing-actions";
import { SubmitButton } from "@/components/SubmitButton";
import { LABEL_FIELDS, type LabelFlag } from "@/lib/label-fields";

type T = { id: string; name: string; widthMm: number; heightMm: number; columns: number; gapMm: number; dpi: number } & Record<LabelFlag, boolean>;

const NEW_DEFAULTS: Record<LabelFlag, boolean> = { showBusiness: false, showName: true, showSku: false, showBarcode: true, showBarcodeText: true, showPrice: true, showLot: false };

export function LabelTemplateForm({ t }: { t?: T }) {
  const [state, action] = useActionState(saveLabelTemplate, undefined);
  return (
    <form action={action} className="panel stack" style={{ gap: 10 }}>
      {t && <input type="hidden" name="id" value={t.id} />}
      <strong style={{ fontWeight: 600 }}>{t ? t.name : "New label size"}</strong>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="field" style={{ flex: "2 1 160px" }}><span>Name</span><input name="name" defaultValue={t?.name} required /></label>
        <label className="field" style={{ width: 90 }}><span>Width mm</span><input name="widthMm" type="number" step="0.5" defaultValue={t?.widthMm ?? 50} /></label>
        <label className="field" style={{ width: 90 }}><span>Height mm</span><input name="heightMm" type="number" step="0.5" defaultValue={t?.heightMm ?? 25} /></label>
        <label className="field" style={{ width: 90 }}><span>Columns</span><input name="columns" type="number" min={1} max={6} defaultValue={t?.columns ?? 1} /></label>
        <label className="field" style={{ width: 90 }}><span>Gap mm</span><input name="gapMm" type="number" step="0.5" defaultValue={t?.gapMm ?? 2} /></label>
        <label className="field" style={{ width: 110 }}><span>Printer dpi</span>
          <select name="dpi" defaultValue={t?.dpi ?? 203}><option value={203}>203 dpi</option><option value={300}>300 dpi</option></select>
        </label>
      </div>
      <div className="small muted">Prints by default (staff can still change it for each print job):</div>
      <div className="row" style={{ gap: 14 }}>
        {LABEL_FIELDS.map((f) => (
          <label key={f.flag} className="check"><input type="checkbox" name={f.flag} defaultChecked={t?.[f.flag] ?? NEW_DEFAULTS[f.flag]} /> {f.label}</label>
        ))}
        <div className="spacer" />
        <SubmitButton className="btn">Save</SubmitButton>
      </div>
      {state?.error && <p className="error-text" style={{ margin: 0 }}>{state.error}</p>}
      {state?.ok && <p className="small" style={{ color: "var(--ok)", margin: 0 }}>{state.ok}</p>}
    </form>
  );
}
