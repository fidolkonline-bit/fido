import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { reportBySlug } from "@/lib/reports";
import { runReport } from "@/lib/reports/run";
import { PageHead } from "@/components/ui";
import { ReportTable } from "../ReportTable";
import { PrintOnLoad } from "../../sales/[id]/PrintOnLoad";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return { title: reportBySlug((await params).slug)?.title ?? "Report" };
}

const PRESETS: [string, string][] = [["today", "Today"], ["7", "Last 7 days"], ["month", "This month"], ["lastmonth", "Last month"], ["30", "Last 30 days"], ["year", "This year"], ["custom", "Custom dates"]];

export default async function Report({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("reports.view");
  const def = reportBySlug((await params).slug);
  if (!def) notFound();
  const sp = await searchParams;
  const { result, ctx, preset, paramDefs, scope } = await runReport(user, def, sp);
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v != null) as [string, string][]).toString();

  return (
    <div className="stack">
      <div className="no-print">
        <PageHead eyebrow={`Reports / ${def.group} / ${def.id}`} title={def.title}
          actions={<><a className="btn" href={`/api/reports/${def.slug}?${qs}`}>Export CSV</a><PrintOnLoad enabled={false} label="Print" /></>} />
        {/* Keyed by the query so the dropdowns show the filters in force after following a link (defaultValue only applies on mount). */}
        <form className="toolbar" key={qs}>
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
          {paramDefs.map((p) => <select key={p.key} name={p.key} defaultValue={ctx.params[p.key]} aria-label={p.label} style={{ flex: "0 1 190px" }}>{p.options.map(([v, l]) => <option key={v} value={v}>{p.label}: {l}</option>)}</select>)}
          <button className="btn btn-primary">Run</button>
        </form>
      </div>
      <p className="small" style={{ margin: 0 }}>
        <strong>{def.asOf ? `As of now` : `${ctx.fromYmd} to ${ctx.toYmd}`}</strong> · {scope} · <span className="muted">{def.basis}</span>
        <span className="muted"> Generated {new Date().toLocaleString("en-GB", { timeZone: "Asia/Colombo" })} by {user.name}.</span>
      </p>
      <ReportTable result={result} />
    </div>
  );
}
