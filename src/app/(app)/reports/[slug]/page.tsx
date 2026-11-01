import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { reportBySlug } from "@/lib/reports";
import { runReport, fmtCell } from "@/lib/reports/run";
import type { Row } from "@/lib/reports/types";
import { PageHead, Stat } from "@/components/ui";
import { PrintOnLoad } from "../../sales/[id]/PrintOnLoad";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return { title: reportBySlug((await params).slug)?.title ?? "Report" };
}

const PRESETS: [string, string][] = [["today", "Today"], ["7", "Last 7 days"], ["month", "This month"], ["lastmonth", "Last month"], ["30", "Last 30 days"], ["year", "This year"], ["custom", "Custom dates"]];
const PAGE = 500;

export default async function Report({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("reports.view");
  const def = reportBySlug((await params).slug);
  if (!def) notFound();
  const sp = await searchParams;
  const { result, ctx, preset, scope } = await runReport(user, def, sp);
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v != null) as [string, string][]).toString();
  const toneColor = (r: Row) => (r._tone === "err" ? "var(--err)" : r._tone === "warn" ? "var(--warn)" : r._tone === "ok" ? "var(--ok)" : undefined);

  return (
    <div className="stack">
      <div className="no-print">
        <PageHead eyebrow={`Reports / ${def.group} / ${def.id}`} title={def.title}
          actions={<><a className="btn" href={`/api/reports/${def.slug}?${qs}`}>Export CSV</a><PrintOnLoad enabled={false} label="Print" /></>} />
        <form className="toolbar">
          {!def.asOf && (
            <>
              <select name="period" defaultValue={preset} aria-label="Period" style={{ flex: "0 1 170px" }}>{PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <input type="date" name="from" defaultValue={ctx.fromYmd} aria-label="From" style={{ flex: "0 1 160px" }} />
              <input type="date" name="to" defaultValue={ctx.toYmd} aria-label="To" style={{ flex: "0 1 160px" }} />
            </>
          )}
          {user.locations.length > 1 && (
            <select name="loc" defaultValue={sp.loc ?? user.location?.id ?? ""} aria-label="Location" style={{ flex: "0 1 190px" }}>
              {user.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}<option value="all">All my locations</option>
            </select>
          )}
          {def.params?.map((p) => <select key={p.key} name={p.key} defaultValue={ctx.params[p.key]} aria-label={p.label} style={{ flex: "0 1 190px" }}>{p.options.map(([v, l]) => <option key={v} value={v}>{p.label}: {l}</option>)}</select>)}
          <button className="btn btn-primary">Run</button>
        </form>
      </div>
      <p className="small" style={{ margin: 0 }}>
        <strong>{def.asOf ? `As of now` : `${ctx.fromYmd} to ${ctx.toYmd}`}</strong> · {scope} · <span className="muted">{def.basis}</span>
        <span className="muted"> Generated {new Date().toLocaleString("en-GB", { timeZone: "Asia/Colombo" })} by {user.name}.</span>
      </p>
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
                    return <td key={c.key} data-label={c.label} className={[num ? "num" : "", j === 0 ? "primary" : ""].join(" ").trim() || undefined}>{j === 0 && r._href ? <Link className="rowlink" href={r._href}>{v}</Link> : v}</td>;
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
    </div>
  );
}
