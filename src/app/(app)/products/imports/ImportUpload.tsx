"use client";

import { useState, useTransition } from "react";
import { startImport } from "./actions";

export function ImportUpload({ templates }: { templates: Record<"PRODUCTS" | "OPENING_STOCK", string> }) {
  const [kind, setKind] = useState<"PRODUCTS" | "OPENING_STOCK">("PRODUCTS");
  const [existing, setExisting] = useState<"UPDATE" | "SKIP">("SKIP");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(templates[kind])}`;

  return (
    <section className="panel stack">
      <h2 style={{ margin: 0 }}>New import</h2>
      <div className="grid3">
        <label className="field"><span>What are you importing?</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="PRODUCTS">Products (catalog)</option><option value="OPENING_STOCK">Opening stock by lot / IMEI</option>
          </select>
        </label>
        {kind === "PRODUCTS" && (
          <label className="field"><span>If the SKU already exists</span>
            <select value={existing} onChange={(e) => setExisting(e.target.value as typeof existing)}><option value="SKIP">Skip that row</option><option value="UPDATE">Update the product</option></select>
          </label>
        )}
        <label className="field"><span>CSV file</span><input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        <a href={templateHref} download={kind === "PRODUCTS" ? "fido-products-template.csv" : "fido-opening-stock-template.csv"}>Download the template</a>.
        {" "}Save from Excel as “CSV UTF-8”. Keep IMEI and SKU columns as text so leading zeros survive.
        {kind === "OPENING_STOCK" && " Opening stock is added at your current location. IMEI products need one row per phone."}
      </p>
      {error && <p className="note note-err" role="alert">{error}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}>
        <button className="btn btn-primary" disabled={!file || pending} onClick={() => start(async () => {
          setError(null);
          const text = await file!.text();
          const r = await startImport({ kind, fileName: file!.name, text, existing });
          if (r?.error) setError(r.error);
        })}>{pending ? "Checking…" : "Check file (dry run)"}</button>
      </div>
    </section>
  );
}
