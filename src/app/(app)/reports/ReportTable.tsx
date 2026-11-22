import Link from "next/link";
import { fmtCell } from "@/lib/reports/run";
import type { Result, Row, Sheet, SheetItem } from "@/lib/reports/types";
import { Stat } from "@/components/ui";

const PAGE = 200; // rows on screen; totals cover every row and the CSV has them all

const toneColor = (r: Row) => (r._tone === "err" ? "var(--err)" : r._tone === "warn" ? "var(--warn)" : r._tone === "ok" ? "var(--ok)" : undefined);

const rs = (v: SheetItem["value"]) => `Rs ${fmtCell(v, "money") || "0.00"}`;

function SheetBox({ items }: { items: SheetItem[] }) {
  return (
    <div className="sheet-box">
      <table><tbody>{items.map((i, n) => <tr key={n}><th>{i.label}{i.sub && <small>{i.sub}</small>}</th><td>{rs(i.value)}</td></tr>)}</tbody></table>
    </div>
  );
}

// The statement layout of the old Clicky Profit / Loss page: two boxes side by side, the results underneath.
function SheetView({ sheet }: { sheet: Sheet }) {
  return (
    <div className="sheet">
      <SheetBox items={sheet.left} />
      <SheetBox items={sheet.right} />
      {sheet.results.length > 0 && (
        <div className="sheet-box sheet-results">
          {sheet.results.map((r) => <div key={r.label}><p className="sheet-result">{r.label}: {rs(r.value)}</p><p>{r.note}</p></div>)}
        </div>
      )}
    </div>
  );
}

// Summary tiles, the table with its totals row, and the notes of a report result. Shared by Reports and "My commission".
export function ReportTable({ result }: { result: Result }) {
  if (result.sheet) return <><SheetView sheet={result.sheet} />{result.notes?.map((n) => <p key={n} className="small muted" style={{ margin: 0 }}>{n}</p>)}</>;
  return (
    <>
      {result.summary && <div className="stats">{result.summary.map((s) => <Stat key={s.label} label={s.label} value={fmtCell(s.value, s.kind) || "—"} basis={s.note} />)}</div>}
      <div className={"tablewrap" + (result.columns.length <= 6 ? " cards" : "")}>
        {result.rows.length === 0 ? <div className="empty">No data for these filters.</div> : (
          <table className="dt">
            <thead><tr>{result.columns.map((c) => <th key={c.key} className={c.kind && c.kind !== "text" && c.kind !== "date" && c.kind !== "datetime" ? "num" : undefined}>{c.label}</th>)}</tr></thead>
            <tbody>
              {result.rows.slice(0, PAGE).map((r, i) => (
                <tr key={i} style={{ color: toneColor(r) }}>
                  {result.columns.map((c, j) => {
                    const v = fmtCell(r[c.key], c.kind);
                    const num = c.kind && c.kind !== "text" && c.kind !== "date" && c.kind !== "datetime";
                    const lead = c.lead && r[c.lead.key] ? <span className="muted" style={{ display: "block", whiteSpace: "nowrap" }}>{fmtCell(r[c.lead.key])}</span> : null;
                    return <td key={c.key} data-label={c.label} className={[num ? "num" : "", j === 0 ? "primary" : ""].join(" ").trim() || undefined}>{lead}{j === 0 && r._href ? <Link className="rowlink" href={r._href}>{v}</Link> : v}</td>;
                  })}
                </tr>
              ))}
            </tbody>
            {result.totals && (
              <tfoot><tr>{result.columns.map((c, i) => <td key={c.key} data-label={c.label} className={i > 0 ? "num" : undefined}>{i === 0 ? `Total · all ${result.rows.length} rows` : c.key in result.totals! ? fmtCell(result.totals![c.key], c.kind) : ""}</td>)}</tr></tfoot>
            )}
          </table>
        )}
      </div>
      {result.rows.length > PAGE && <p className="small muted">Showing the first {PAGE} of {result.rows.length} rows on screen. Totals and the CSV export include all rows.</p>}
      {result.notes?.map((n) => <p key={n} className="small muted" style={{ margin: 0 }}>{n}</p>)}
    </>
  );
}
