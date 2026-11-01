import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { REPORTS } from "@/lib/reports";
import { allowed } from "@/lib/reports/run";
import { PageHead } from "@/components/ui";

export const metadata = { title: "Reports" };
const GROUPS = ["Profit & sales", "Stock & purchasing", "Money & balances", "Operations", "People"] as const;

export default async function Reports({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePermission("reports.view");
  const { q } = await searchParams;
  const term = q?.trim().toLowerCase();
  const list = REPORTS.filter((r) => allowed(user, r) && (!term || `${r.id} ${r.title} ${r.basis}`.toLowerCase().includes(term)));
  return (
    <div className="stack">
      <PageHead eyebrow="Reports" title="Reports" />
      <form className="toolbar" role="search"><input name="q" defaultValue={q} placeholder="What do you want to know? e.g. profit, cheques, late, IMEI…" aria-label="Search reports" autoFocus /><button className="btn">Search</button></form>
      {GROUPS.map((g) => {
        const rs = list.filter((r) => r.group === g);
        if (!rs.length) return null;
        return (
          <section key={g} className="panel" style={{ padding: 0 }}>
            <div className="eyebrow" style={{ padding: "12px 16px 4px" }}>{g}</div>
            {rs.map((r) => (
              <Link key={r.id} href={`/reports/${r.slug}`} className="pos-item" style={{ padding: "11px 16px", textDecoration: "none", color: "var(--ink)" }}>
                <span><strong style={{ fontWeight: 500 }}>{r.title}</strong><small>{r.basis.length > 110 ? r.basis.slice(0, 110) + "…" : r.basis}</small></span>
                <span className="small muted">{r.id}</span>
              </Link>
            ))}
          </section>
        );
      })}
      {list.length === 0 && <p className="muted">No report matches “{q}”.</p>}
    </div>
  );
}
