"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { listLayers, type LayerHit, type ProductHit } from "../../search";
import { ProductSearch } from "@/components/ProductSearch";
import { saveLabelFields } from "../../settings/printing-actions";
import { recordGrnLabelsPrinted } from "./actions";
import { LABEL_FIELDS, fieldsOf, type LabelField, type LabelFields, type LabelFlag } from "@/lib/label-fields";
import { PAD, labelWarnings, layoutLabel, type LabelLayout, type LabelSize } from "./label-layout";

type Template = { id: string; name: string; widthMm: number; heightMm: number; columns: number; gapMm: number; dpi: number } & Record<LabelFlag, boolean>;
// A row opened from a GRN line remembers how many came in, how many are still in stock and how many labels were printed.
export type GrnRow = { lineId: string; lot: string; received: number; inStock: number | null; printed: number; product: ProductHit };
type Row = { key: string; product: ProductHit; layers: LayerHit[]; lot: string; copies: number; override: Partial<LabelFields>; grn?: Omit<GrnRow, "product" | "lot"> };
type Printed = { lineId: string; qty: number; name: string };
type LabelData = { name: string; sku: string; code: string; price: string; lot: string };

const SAMPLE: LabelData = { name: "Sample product name that runs long", sku: "SKU-0001", code: "4792024012345", price: "12500", lot: "L-0425" };
const effective = (job: LabelFields, r: Row): LabelFields => ({ ...job, ...r.override });
const dataOf = (r: Row): LabelData => ({ name: r.product.name, sku: r.product.sku, code: r.product.barcode || r.product.sku, price: r.product.price, lot: r.lot });

export function LabelPrinter({ templates, business, canManage, grnRows = [] }: { templates: Template[]; business: string; canManage: boolean; grnRows?: GrnRow[] }) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const t = templates.find((x) => x.id === templateId) ?? templates[0];
  const [job, setJob] = useState<LabelFields>(() => fieldsOf(t));
  const [rows, setRows] = useState<Row[]>(() => grnRows.map(({ product, lot, ...grn }) => ({
    key: grn.lineId, product, layers: [], lot, copies: Math.max(0, grn.received - grn.printed), override: {}, grn,
  })));
  // After a full print of GRN rows, staff confirm the labels came out before they are counted as printed.
  const [toConfirm, setToConfirm] = useState<Printed[] | null>(null);
  const [confirmMsg, setConfirmMsg] = useState<{ error?: string; ok?: string }>();
  const [confirming, startConfirming] = useTransition();
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [mode, setMode] = useState<"all" | "test" | null>(null);
  const [saved, setSaved] = useState<{ error?: string; ok?: string }>();
  const [saving, startSaving] = useTransition();

  const pickTemplate = (id: string) => {
    setTemplateId(id);
    const next = templates.find((x) => x.id === id);
    if (next) setJob(fieldsOf(next));
    setSaved(undefined);
  };
  const update = (k: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const add = async (p: ProductHit) => {
    const key = crypto.randomUUID();
    const available = Math.max(1, Math.min(100, Math.floor(Number(p.available ?? 1)) || 1));
    setRows((rs) => [...rs, { key, product: p, layers: [], lot: "", copies: available, override: {} }]);
    setPreviewKey(key);
    const layers = await listLayers(p.id);
    update(key, { layers, lot: layers[0]?.lotCode ?? "" });
  };
  // GRN rows arrive without their lot list; load it so the lot can still be changed.
  useEffect(() => {
    let live = true;
    for (const { lineId, product } of grnRows) listLayers(product.id).then((layers) => { if (live) update(lineId, { layers }); });
    return () => { live = false; };
  }, [grnRows]);
  const printAll = () => {
    const grnPrinted = rows.filter((r) => r.grn && r.copies > 0).map((r) => ({ lineId: r.grn!.lineId, qty: Math.min(500, r.copies), name: r.product.name }));
    setToConfirm(grnPrinted.length ? grnPrinted : null);
    setConfirmMsg(undefined);
    setMode("all");
  };
  const confirmPrinted = () => startConfirming(async () => {
    if (!toConfirm) return;
    const res = await recordGrnLabelsPrinted(toConfirm.map(({ lineId, qty }) => ({ lineId, qty })));
    if (res.error) return setConfirmMsg({ error: res.error });
    setRows((rs) => rs.map((r) => {
      const done = toConfirm.find((x) => x.lineId === r.grn?.lineId);
      return done && r.grn ? { ...r, grn: { ...r.grn, printed: r.grn.printed + done.qty }, copies: 0 } : r;
    }));
    setConfirmMsg({ ok: `${toConfirm.reduce((a, x) => a + x.qty, 0)} label(s) marked as printed.` });
    setToConfirm(null);
  });
  const toggleRow = (r: Row, k: LabelField) => {
    const on = !effective(job, r)[k];
    const override = { ...r.override, [k]: on };
    if (on === job[k]) delete override[k];
    update(r.key, { override });
    setPreviewKey(r.key);
  };

  // Print only once the sheet shows exactly what was asked for (all labels, or one test label).
  useEffect(() => {
    if (!mode) return;
    const done = () => setMode(null);
    window.addEventListener("afterprint", done, { once: true });
    window.print();
    return () => window.removeEventListener("afterprint", done);
  }, [mode]);

  const labels = useMemo(
    () => rows.flatMap((r) => Array.from({ length: Math.max(0, Math.min(500, r.copies)) }, (_, i) => ({ r, i, fields: effective(job, r) }))),
    [rows, job],
  );
  const printed = mode === "test" ? labels.slice(0, 1) : labels;
  const previewRow = rows.find((r) => r.key === previewKey) ?? rows[0];
  const previewFields = previewRow ? effective(job, previewRow) : job;
  const previewData = previewRow ? dataOf(previewRow) : SAMPLE;
  const jobChanged = t && LABEL_FIELDS.some((f) => job[f.key] !== t[f.flag]);

  if (!t) return <p className="muted">No label sizes yet. Add one in Settings → Label sizes.</p>;

  return (
    <div className="stack">
      <section className="panel stack label-controls">
        <div className="grid2">
          <label className="field"><span>Label size</span>
            <select value={templateId} onChange={(e) => pickTemplate(e.target.value)}>{templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </label>
          <div className="field"><span>Add products</span><ProductSearch onPick={add} /></div>
        </div>

        <div className="label-setup">
          <div className="stack" style={{ gap: 8, minWidth: 0 }}>
            <div className="small muted">Print on every label</div>
            <FieldChips fields={job} onToggle={(k) => { setJob((j) => ({ ...j, [k]: !j[k] })); setSaved(undefined); }} />
            {canManage && (jobChanged || saved) && (
              <div className="row" style={{ gap: 8 }}>
                {jobChanged && (
                  <button type="button" className="btn btn-sm" disabled={saving}
                    onClick={() => startSaving(async () => setSaved(await saveLabelFields(t.id, job)))}>
                    {saving ? "Saving…" : `Save as default for ${t.name}`}
                  </button>
                )}
                {saved?.ok && <span className="small" style={{ color: "var(--ok)" }}>{saved.ok}</span>}
                {saved?.error && <span className="small error-text">{saved.error}</span>}
              </div>
            )}
            <p className="small muted" style={{ margin: 0 }}>Each product below can also turn fields on or off just for itself. Barcode = product barcode, or SKU if it has none.</p>
          </div>
          <figure className="label-preview">
            <div style={{ zoom: previewZoom(t) }}><Label t={t} fields={previewFields} data={previewData} business={business} /></div>
            <figcaption className="small muted">{previewRow ? `Preview: ${previewRow.product.name}` : "Preview with sample text"} · {t.widthMm} × {t.heightMm} mm</figcaption>
          </figure>
        </div>

        {rows.map((r) => {
          const f = effective(job, r);
          const warnings = labelWarnings(layoutLabel(t, f, dataOf(r).code));
          return (
            <div key={r.key} className={`label-row${previewRow?.key === r.key ? " is-preview" : ""}`}>
              <div className="row">
                <button type="button" className="label-row-name" onClick={() => setPreviewKey(r.key)} title="Show in preview">{r.product.sku} · {r.product.name}</button>
                {f.lot && (
                  <select style={{ width: 170 }} value={r.lot} onChange={(e) => update(r.key, { lot: e.target.value })} aria-label="Lot">
                    <option value="">No lot</option>
                    {r.lot && !r.layers.some((l) => l.lotCode === r.lot) && <option value={r.lot}>{r.lot}</option>}
                    {r.layers.map((l) => <option key={l.id} value={l.lotCode ?? ""}>{l.lotCode ?? "No lot"} · {Number(l.qtyRemaining)}</option>)}
                  </select>
                )}
                <label className="row" style={{ gap: 4 }}><span className="small muted">Copies</span>
                  <input style={{ width: 80 }} type="number" min={0} max={500} value={r.copies} onChange={(e) => update(r.key, { copies: Number(e.target.value) || 0 })} />
                </label>
                <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>Remove</button>
              </div>
              {r.grn && (
                <div className="small muted">
                  Received {r.grn.received}{r.grn.inStock != null && <> · in stock {r.grn.inStock}</>} · labels printed {r.grn.printed}
                  {r.grn.printed >= r.grn.received && <span className="badge badge-muted" style={{ marginLeft: 8 }}>All printed</span>}
                </div>
              )}
              <div className="row" style={{ gap: 8 }}>
                <FieldChips fields={f} changed={r.override} onToggle={(k) => toggleRow(r, k)} small />
                {Object.keys(r.override).length > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => update(r.key, { override: {} })}>Same as all</button>}
              </div>
              {warnings.map((w) => <div key={w} className="small" style={{ color: "var(--warn)" }}>{w}</div>)}
            </div>
          );
        })}

        <div className="row">
          <span className="small muted">{labels.length} label(s). Try one test label first on a new printer or roll.</span>
          <div className="spacer" />
          <button className="btn" disabled={!labels.length || !!mode} onClick={() => setMode("test")}>Print 1 test label</button>
          <button className="btn btn-primary" disabled={!labels.length || !!mode} onClick={printAll}>Print labels</button>
        </div>
        {toConfirm && !mode && (
          <div className="note row" style={{ gap: 8 }}>
            <span>Did all {toConfirm.reduce((a, x) => a + x.qty, 0)} label(s) print correctly? Only then are they counted on the GRN.</span>
            <div className="spacer" />
            <button type="button" className="btn btn-sm" onClick={() => setToConfirm(null)}>No, don&apos;t count</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={confirming} onClick={confirmPrinted}>{confirming ? "Saving…" : "Yes, mark printed"}</button>
          </div>
        )}
        {confirmMsg?.ok && <p className="small" style={{ color: "var(--ok)", margin: 0 }}>{confirmMsg.ok}</p>}
        {confirmMsg?.error && <p className="small error-text" style={{ margin: 0 }}>{confirmMsg.error}</p>}
      </section>

      {printed.length > 0 && (
        <>
          <style>{`@page { size: ${t.columns === 1 ? `${t.widthMm}mm ${t.heightMm}mm` : "A4"}; margin: ${t.columns === 1 ? 0 : "8mm"}; }`}</style>
          <div className="label-sheet" style={{ gridTemplateColumns: `repeat(${t.columns}, ${t.widthMm}mm)`, gap: `${t.gapMm}mm` }}>
            {printed.map(({ r, i, fields }) => <Label key={`${r.key}-${i}`} t={t} fields={fields} data={dataOf(r)} business={business} />)}
          </div>
        </>
      )}
    </div>
  );
}

// About 340px wide on screen, never more than 4× actual size.
const previewZoom = (t: LabelSize) => Math.min(4, 340 / (t.widthMm * 3.78));

function FieldChips({ fields, onToggle, changed, small }: { fields: LabelFields; onToggle: (k: LabelField) => void; changed?: Partial<LabelFields>; small?: boolean }) {
  return (
    <div className={`chips${small ? " chips-sm" : ""}`} role="group" aria-label="Fields on the label">
      {LABEL_FIELDS.map((x) => {
        const disabled = x.key === "barcodeText" && !fields.barcode;
        return (
          <button key={x.key} type="button" className={`chip${changed && x.key in changed ? " chip-changed" : ""}`} aria-pressed={fields[x.key] && !disabled} disabled={disabled} onClick={() => onToggle(x.key)}>
            {x.label}
          </button>
        );
      })}
    </div>
  );
}

function Label({ t, fields: f, data, business }: { t: LabelSize & { columns?: number }; fields: LabelFields; data: LabelData; business: string }) {
  const l: LabelLayout = layoutLabel(t, f, data.code);
  const top = [f.business && business, f.sku && data.sku].filter(Boolean) as string[];
  const bottom = f.price || (f.lot && data.lot);
  return (
    <div className="label stock" style={{ width: `${t.widthMm}mm`, height: `${t.heightMm}mm`, padding: `${PAD}mm`, breakInside: "avoid" }}>
      {top.length > 0 && <div className="l-top" style={{ justifyContent: top.length > 1 ? "space-between" : "center" }}>{top.map((s, i) => <span key={i}>{s}</span>)}</div>}
      {l.nameLines > 0 && (
        <div className="l-name" style={{ fontSize: `${l.nameFontPt}pt`, lineHeight: `${l.nameLineMm}mm`, WebkitLineClamp: l.nameLines, maxHeight: `${l.nameLineMm * l.nameLines}mm`, flex: l.barcode ? "0 0 auto" : "1 1 auto" }}>{data.name}</div>
      )}
      {l.barcode && (
        <div className="l-barcode">
          <svg viewBox={`0 0 ${l.barcode.modules} 1`} preserveAspectRatio="none" shapeRendering="crispEdges" style={{ width: `${l.barcode.widthMm}mm` }} role="img" aria-label={`Barcode ${data.code}`}>
            <path d={l.barcode.path} fill="#000" />
          </svg>
          {f.barcodeText && <span className="l-small l-digits">{data.code}</span>}
        </div>
      )}
      {l.barcodeError && f.barcodeText && <span className="l-small">{data.code}</span>}
      {bottom && (
        <div className="l-bottom">
          {f.price && <span className="l-price">Rs. {Number(data.price).toLocaleString("en-LK")}</span>}
          {f.lot && data.lot && <span className="l-small">Lot {data.lot}</span>}
        </div>
      )}
    </div>
  );
}
