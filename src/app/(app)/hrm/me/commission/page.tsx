import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dayStart } from "@/lib/hr";
import { resolvePeriod } from "@/lib/reports/run";
import { commissionStatement } from "@/lib/commission-statement";
import { PageHead } from "@/components/ui";
import { PrintOnLoad } from "../../../sales/[id]/PrintOnLoad";
import { ReportTable } from "../../../reports/ReportTable";

export const metadata = { title: "My commission" };

const PRESETS: [string, string][] = [["month", "This month"], ["lastmonth", "Last month"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["year", "This year"], ["custom", "Custom dates"]];

// Own commission statement (spec §4: salespeople and agents see their own statement only). No extra permission needed,
// and it always shows the signed-in person, whatever is in the address bar.
export default async function MyCommission({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const { preset, from, to } = resolvePeriod(sp);
  const [profile, any] = await Promise.all([
    db.commissionProfile.findUnique({ where: { personId: user.personId }, select: { id: true } }),
    db.commissionAccrual.findFirst({ where: { recipientId: user.personId }, select: { id: true } }),
  ]);
  if (!profile && !any) {
    return (
      <div className="stack" style={{ maxWidth: 600 }}>
        <PageHead eyebrow="HRM" title="My commission" />
        <p className="note">You don&apos;t earn commission yet. Ask the owner to set your commission under User Management → Users.</p>
      </div>
    );
  }
  const result = await commissionStatement({ from: dayStart(from), to: new Date(dayStart(to).getTime() + 86_400_000), personId: user.personId });
  // Sale, return and repair pages need their own permissions, so the statement doesn't link to them here.
  result.rows = result.rows.map(({ _href: _, ...r }) => r);
  return (
    <div className="stack">
      <div className="no-print">
        <PageHead eyebrow="HRM" title="My commission" actions={<PrintOnLoad enabled={false} label="Print" />} />
        <form className="toolbar" key={`${preset}|${from}|${to}`}>
          <select name="period" defaultValue={preset} aria-label="Period" style={{ flex: "0 1 170px" }}>{PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <input type="date" name="from" defaultValue={from} aria-label="From" style={{ flex: "0 1 160px" }} />
          <input type="date" name="to" defaultValue={to} aria-label="To" style={{ flex: "0 1 160px" }} />
          <button className="btn btn-primary">Show</button>
        </form>
      </div>
      <p className="small" style={{ margin: 0 }}>
        <strong>Commission statement · {user.name} · {from} to {to}</strong>
        <span className="muted"> Generated {new Date().toLocaleString("en-GB", { timeZone: "Asia/Colombo" })}.</span>
      </p>
      <ReportTable result={result} />
    </div>
  );
}
