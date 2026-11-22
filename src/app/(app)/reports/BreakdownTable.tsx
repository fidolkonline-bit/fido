"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export type PlainCol = { key: string; label: string; kind?: string };
export type PlainRow = Record<string, string | number | null> & { _href?: string | null };

const SIZES: [number, string][] = [[25, "25"], [50, "50"], [100, "100"], [200, "200"], [500, "500"], [1000, "1,000"], [0, "All"]];
const NUMERIC = new Set(["money", "qty", "pct"]);
// What shows first, as on the old Clicky tabs (name and Gross Profit); the rest are switched on under Column visibility.
const DEFAULT_SHOWN = ["profit"];
const STORE = "fido.breakdown.cols";

function fmt(v: string | number | null | undefined, kind?: string) {
  if (v == null || v === "") return "";
  if (typeof v !== "number") return kind === "date" ? v.split("-").reverse().join("/") : String(v);
  if (kind === "money") { const s = Math.abs(v).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return `${v < 0 ? "-" : ""}Rs ${s}`; }
  if (kind === "pct") return `${v.toFixed(1)}%`;
  return v.toLocaleString("en-LK", { maximumFractionDigits: 2 });
}

// Profit by product / category / … tabs under the Profit / Loss statement: search, page size, sorting, column
// visibility, and CSV / Excel / PDF / print of the open tab with the columns shown.
export function BreakdownTable({ tabs, active, query, exportUrl, columns, rows, notes }: {
  tabs: [string, string][]; active: string; query: string; exportUrl: string; columns: PlainCol[]; rows: PlainRow[]; notes?: string[];
}) {
  const [size, setSize] = useState(25);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [shown, setShown] = useState<string[]>(DEFAULT_SHOWN);
  const [menu, setMenu] = useState(false);
  const [printing, setPrinting] = useState(false);

  useEffect(() => { try { const s = localStorage.getItem(STORE); if (s) setShown(JSON.parse(s)); } catch { /* private window: keep the default */ } }, []);
  useEffect(() => { setPage(0); setQ(""); setSort(null); }, [active]);
  // Close the column menu on a click anywhere else.
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!(e.target as Element).closest?.(".colmenu")) setMenu(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menu]);
  useEffect(() => {
    if (!printing) return;
    const done = () => { document.body.classList.remove("print-breakdown"); setPrinting(false); };
    document.body.classList.add("print-breakdown");
    window.addEventListener("afterprint", done, { once: true });
    window.print();
    return () => window.removeEventListener("afterprint", done);
  }, [printing]);

  const cols = columns.filter((c, i) => i === 0 || shown.includes(c.key));
  const toggle = (key: string) => {
    const next = shown.includes(key) ? shown.filter((k) => k !== key) : [...shown, key];
    setShown(next);
    try { localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* not remembered */ }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? rows.filter((r) => columns.some((c) => fmt(r[c.key], c.kind).toLowerCase().includes(needle))) : rows.slice();
    if (sort) {
      list.sort((a, b) => {
        const x = a[sort.key], y = b[sort.key];
        if (typeof x === "number" && typeof y === "number") return (x - y) * sort.dir;
        return String(x ?? "").localeCompare(String(y ?? ""), undefined, { numeric: true }) * sort.dir;
      });
    }
    return list;
  }, [rows, columns, q, sort]);

  const pages = size ? Math.max(1, Math.ceil(filtered.length / size)) : 1;
  const at = Math.min(page, pages - 1);
  const visible = printing || !size ? filtered : filtered.slice(at * size, at * size + size);
  const total = (key: string) => filtered.reduce((a, r) => a + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);
  const href = (format: string) => `${exportUrl}${exportUrl.includes("?") ? "&" : "?"}part=breakdown&by=${active}&cols=${cols.slice(1).map((c) => c.key).join(",")}&format=${format}`;

  return (
    <section className="breakdown" id="breakdown">
      <nav className="tabs no-print" aria-label="Profit by">
        {tabs.map(([k, label]) => <Link key={k} href={`?${query}${query ? "&" : ""}by=${k}#breakdown`} scroll={false} aria-current={k === active ? "page" : undefined}>{label}</Link>)}
      </nav>
      <h2 className="print-only" style={{ margin: "0 0 8px", fontSize: 18 }}>{tabs.find(([k]) => k === active)?.[1]}</h2>
      <div className="toolbar no-print">
        <label className="small">Show <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }} style={{ width: "auto", flex: "0 0 auto" }}>{SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select> entries</label>
        <div className="btn-group">
          <a className="btn btn-sm" href={href("csv")}>Export to CSV</a>
          <a className="btn btn-sm" href={href("xlsx")}>Export to Excel</a>
          <button type="button" className="btn btn-sm" onClick={() => setPrinting(true)}>Print</button>
          <span className="colmenu">
            <button type="button" className="btn btn-sm" aria-expanded={menu} onClick={() => setMenu(!menu)}>Column visibility</button>
            {menu && (
              <span className="colmenu-list" role="menu">
                {columns.slice(1).map((c) => (
                  <label key={c.key}><input type="checkbox" checked={shown.includes(c.key)} onChange={() => toggle(c.key)} /> {c.label}</label>
                ))}
              </span>
            )}
          </span>
          <a className="btn btn-sm" href={href("pdf")}>Export to PDF</a>
        </div>
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search …" aria-label="Search" style={{ flex: "0 1 220px", marginLeft: "auto" }} />
      </div>
      <div className="tablewrap">
        <table className="dt">
          <thead>
            <tr>{cols.map((c) => {
              const dir = sort?.key === c.key ? sort.dir : 0;
              return (
                <th key={c.key} className={NUMERIC.has(c.kind ?? "") ? "num" : undefined} aria-sort={dir === 1 ? "ascending" : dir === -1 ? "descending" : "none"}>
                  <button type="button" className="sortbtn" onClick={() => setSort({ key: c.key, dir: dir === 1 ? -1 : 1 })}>{c.label} <span aria-hidden>{dir === 1 ? "▲" : dir === -1 ? "▼" : "↕"}</span></button>
                </th>
              );
            })}</tr>
          </thead>
          <tbody>
            {visible.length === 0 ? <tr><td colSpan={cols.length} className="muted">No data for these filters.</td></tr> : visible.map((r, i) => (
              <tr key={i}>{cols.map((c, j) => (
                <td key={c.key} data-label={c.label} className={NUMERIC.has(c.kind ?? "") ? "num" : j === 0 ? "primary" : undefined} style={NUMERIC.has(c.kind ?? "") && typeof r[c.key] === "number" && (r[c.key] as number) < 0 ? { color: "var(--err)" } : undefined}>
                  {j === 0 && r._href ? <Link className="rowlink" href={r._href}>{fmt(r[c.key], c.kind)}</Link> : fmt(r[c.key], c.kind)}
                </td>
              ))}</tr>
            ))}
          </tbody>
          <tfoot>
            <tr>{cols.map((c, j) => <td key={c.key} data-label={c.label} className={j > 0 ? "num" : undefined}>{j === 0 ? "Total:" : c.kind === "money" || c.kind === "qty" ? fmt(total(c.key), c.kind) : ""}</td>)}</tr>
          </tfoot>
        </table>
      </div>
      <div className="pager no-print">
        <span className="small muted">Showing {filtered.length ? (size ? at * size + 1 : 1) : 0} to {size ? Math.min(filtered.length, at * size + size) : filtered.length} of {filtered.length} entries{q && ` (filtered from ${rows.length})`}</span>
        {size > 0 && pages > 1 && (
          <span className="btn-group">
            <button type="button" className="btn btn-sm" disabled={at === 0} onClick={() => setPage(at - 1)}>Previous</button>
            <span className="small" style={{ padding: "0 8px", alignSelf: "center" }}>Page {at + 1} of {pages}</span>
            <button type="button" className="btn btn-sm" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>Next</button>
          </span>
        )}
      </div>
      {notes?.map((n) => <p key={n} className="small muted" style={{ margin: "6px 0 0" }}>{n}</p>)}
    </section>
  );
}
