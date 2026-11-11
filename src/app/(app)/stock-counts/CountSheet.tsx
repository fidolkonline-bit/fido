"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { CameraScanner } from "@/components/CameraScan";
import { saveCountLines, scanCount } from "./actions";

export type SheetLine = { id: string; sku: string; name: string; tracked: boolean; expected: number; counted: number | null; cost: number | null; devices: { id: string; label: string; seen: boolean }[]; extra: number };

export function CountSheet({ countId, lines, showCost }: { countId: string; lines: SheetLine[]; showCost: boolean }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(lines.filter((l) => !l.tracked).map((l) => [l.id, l.counted == null ? "" : String(l.counted)])));
  const [filter, setFilter] = useState("");
  const [only, setOnly] = useState<"all" | "todo" | "diff">("all");
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [camera, setCamera] = useState(false);
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();
  const dirty = useRef(new Set<string>());

  const counted = (l: SheetLine) => (l.tracked ? l.counted : vals[l.id] === "" ? null : Number(vals[l.id]));
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return lines.filter((l) => {
      const c = l.tracked ? l.counted : vals[l.id] === "" ? null : Number(vals[l.id]);
      if (only === "todo" && c != null) return false;
      if (only === "diff" && (c == null || c === l.expected)) return false;
      return !f || l.name.toLowerCase().includes(f) || l.sku.toLowerCase().includes(f);
    });
  }, [lines, filter, only, vals]);

  const save = () => start(async () => {
    const entries = [...dirty.current].map((lineId) => ({ lineId, counted: vals[lineId] === "" ? null : Number(vals[lineId]) }));
    if (!entries.length) { setMsg({ ok: "Nothing to save." }); return; }
    const r = await saveCountLines(countId, entries);
    if (!r.error) dirty.current.clear();
    setMsg(r);
  });
  const scan = (c: string) => start(async () => {
    // Typed counts not yet saved would be overwritten by the refresh a scan triggers: save them first.
    if (dirty.current.size) { await saveCountLines(countId, [...dirty.current].map((lineId) => ({ lineId, counted: vals[lineId] === "" ? null : Number(vals[lineId]) }))); dirty.current.clear(); }
    const r = await scanCount(countId, c);
    setMsg(r);
    setCode("");
  });

  const done = lines.filter((l) => counted(l) != null).length;
  return (
    <div className="stack">
      <div className="panel stack no-print">
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (code.trim()) scan(code); }}>
          <input style={{ flex: 1 }} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Scan a barcode or IMEI (each scan counts 1)" aria-label="Scan code" autoComplete="off" />
          <button className="btn" disabled={pending}>Count</button>
          <button type="button" className="btn btn-primary" onClick={() => setCamera(true)}>Use camera</button>
        </form>
        {msg?.error && <p className="note note-err" role="alert" style={{ margin: 0 }}>{msg.error}</p>}
        {msg?.ok && <p className="note note-ok" style={{ margin: 0 }}>{msg.ok}</p>}
        <div className="row">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or SKU" aria-label="Filter lines" />
          <select value={only} onChange={(e) => setOnly(e.target.value as typeof only)} aria-label="Show"><option value="all">All lines</option><option value="todo">Not counted yet</option><option value="diff">Differences only</option></select>
          <span className="small muted">{done} of {lines.length} counted</span>
          <div className="spacer" />
          <button type="button" className="btn" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save typed counts"}</button>
        </div>
      </div>
      {camera && <CameraScanner keepOpen onClose={() => setCamera(false)} onCode={scan} />}

      <div className="tablewrap cards">
        <table className="dt">
          <thead><tr><th>Product</th><th className="num">Expected</th><th className="num">Counted</th><th className="num">Difference</th>{showCost && <th className="num">Value</th>}</tr></thead>
          <tbody>
            {shown.map((l) => {
              const c = counted(l);
              const diff = c == null ? null : c - l.expected;
              return (
                <tr key={l.id}>
                  <td className="primary" data-label="Product">
                    {l.sku} · {l.name}
                    {l.tracked && (
                      <details><summary className="small muted">{l.devices.filter((d) => d.seen).length} of {l.devices.length} phones scanned{l.extra ? ` · ${l.extra} unexpected` : ""}</summary>
                        <div className="small" style={{ fontVariantNumeric: "tabular-nums" }}>{l.devices.map((d) => <div key={d.id} style={{ color: d.seen ? "var(--ok)" : "var(--err)" }}>{d.seen ? "✓" : "✗ not scanned"} {d.label}</div>)}</div>
                      </details>
                    )}
                  </td>
                  <td className="num" data-label="Expected">{l.expected}</td>
                  <td className="num" data-label="Counted">
                    {l.tracked ? (c ?? "—") : (
                      <input value={vals[l.id] ?? ""} inputMode="decimal" aria-label={`Counted ${l.name}`} style={{ width: 90, textAlign: "right" }}
                        onChange={(e) => { dirty.current.add(l.id); setVals((v) => ({ ...v, [l.id]: e.target.value.replace(/[^\d.]/g, "") })); }} />
                    )}
                  </td>
                  <td className="num" data-label="Difference" style={{ color: diff == null || diff === 0 ? undefined : diff < 0 ? "var(--err)" : "var(--warn)" }}>{diff == null ? "—" : diff > 0 ? `+${diff}` : diff}</td>
                  {showCost && <td className="num" data-label="Value">{diff == null || l.cost == null ? "—" : (diff * l.cost).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
