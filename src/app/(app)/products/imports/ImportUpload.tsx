"use client";

import { useState, useTransition } from "react";
import { startImport } from "./actions";
import { fromClicky, type Converted } from "@/lib/clicky";

type Kind = "PRODUCTS" | "OPENING_STOCK" | "CONTACTS" | "CATEGORIES" | "PEOPLE";
const FILE: Record<Kind, string> = { PRODUCTS: "products", OPENING_STOCK: "opening-stock", CONTACTS: "contacts", CATEGORIES: "categories", PEOPLE: "people" };
const LABEL: Record<Kind, string> = { PRODUCTS: "products", OPENING_STOCK: "opening stock", CONTACTS: "customers & suppliers", CATEGORIES: "categories", PEOPLE: "people & agents" };

export function ImportUpload({ templates }: { templates: Record<Kind, string> }) {
  const [kind, setKind] = useState<Kind>("PRODUCTS");
  const [existing, setExisting] = useState<"UPDATE" | "SKIP">("SKIP");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(templates[kind])}`;

  // A Clicky export is converted here, so only the slim Fido rows are uploaded.
  let clicky: Converted | null = null;
  let clickyError: string | null = null;
  try { clicky = file ? fromClicky(file.text, kind === "OPENING_STOCK" ? "OPENING_STOCK" : "PRODUCTS") : null; } catch (e) { clickyError = (e as Error).message; }
  const effective: Kind = clicky?.kind ?? kind;

  return (
    <section className="panel stack">
      <h2 style={{ margin: 0 }}>New import</h2>
      <div className="grid3">
        <label className="field"><span>What are you importing?</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="PRODUCTS">Products (catalog)</option><option value="OPENING_STOCK">Opening stock by lot / IMEI</option>
            <option value="CONTACTS">Customers & suppliers (with opening balances)</option><option value="CATEGORIES">Categories & commission rates</option>
            <option value="PEOPLE">People & agents (commission IDs)</option>
          </select>
        </label>
        {(effective === "PRODUCTS" || effective === "CONTACTS" || effective === "PEOPLE") && (
          <label className="field"><span>If the {effective === "PRODUCTS" ? "SKU" : "code"} already exists</span>
            <select value={existing} onChange={(e) => setExisting(e.target.value as typeof existing)}><option value="SKIP">Skip that row</option><option value="UPDATE">Update it</option></select>
          </label>
        )}
        <label className="field"><span>CSV file</span><input type="file" accept=".csv,text/csv" onChange={async (e) => {
          const f = e.target.files?.[0];
          setError(null);
          setFile(f ? { name: f.name, text: await f.text() } : null);
        }} /></label>
      </div>
      {clicky && (
        <div className="note note-ok">
          <strong>{clicky.source} recognised</strong> — {clicky.rows.toLocaleString()} rows will be checked as {LABEL[clicky.kind]}.
          {clicky.kind === "PRODUCTS" && " Choose “Opening stock” above to load the stock on hand from this same file (import the products first)."}
          {clicky.notes.length > 0 && <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>{clicky.notes.map((n) => <li key={n.slice(0, 60)}>{n.length > 400 ? `${n.slice(0, 400)}…` : n}</li>)}</ul>}
        </div>
      )}
      {clickyError && <p className="note note-err" role="alert">{clickyError}</p>}
      {!clicky && !clickyError && (
        <p className="small muted" style={{ margin: 0 }}>
          <a href={templateHref} download={`fido-${FILE[kind]}-template.csv`}>Download the template</a>, or upload a Clicky export (products, customers, suppliers or users) as it is.
          {" "}Save from Excel as “CSV UTF-8”. Keep IMEI and SKU columns as text so leading zeros survive.
          {kind === "OPENING_STOCK" && " Stock goes to the location named in the location column, or your current location. IMEI products need one row per phone."}
          {kind === "CONTACTS" && " Opening balance: what a customer owes us, or what we owe a supplier, on the cut-over date. Keep the old system's code in the code column."}
          {kind === "CATEGORIES" && " Rates are percents: pool rate of the line value; user and agent shares of the pool. Totals other than 100% are kept and flagged, never adjusted."}
          {kind === "PEOPLE" && " Creates people with commission IDs. No logins or passwords — add logins in Users."}
        </p>
      )}
      {error && <p className="note note-err" role="alert">{error}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}>
        <button className="btn btn-primary" disabled={!file || pending || !!clickyError} onClick={() => start(async () => {
          setError(null);
          const r = await startImport(clicky
            ? { kind: clicky.kind, fileName: file!.name, text: clicky.csv, existing, notes: clicky.notes }
            : { kind, fileName: file!.name, text: file!.text, existing });
          if (r?.error) setError(r.error);
        })}>{pending ? "Checking…" : "Check file (dry run)"}</button>
      </div>
    </section>
  );
}
