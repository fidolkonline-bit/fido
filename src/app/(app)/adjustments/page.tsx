import Link from "next/link";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, fmtDateTime } from "@/lib/money";
import { ADJUST_REASONS } from "@/lib/adjustments";
import { PageHead, DataTable, RowLink, Badge } from "@/components/ui";

export const metadata = { title: "Stock adjustments" };

export default async function Adjustments() {
  const user = await requirePermission("products.view");
  const rows = await db.stockAdjustment.findMany({
    where: user.location ? { locationId: user.location.id } : {},
    orderBy: { createdAt: "desc" }, take: 100, include: { lines: true, createdBy: true },
  });
  const showCost = can(user, "cost.view");
  return (
    <div>
      <PageHead eyebrow={`Stock Adjustment / ${user.location?.name ?? ""}`} title="Stock adjustments" actions={can(user, "stock.adjust") && <Link className="btn btn-primary" href="/adjustments/new">New adjustment</Link>} />
      <DataTable rows={rows} rowKey={(r) => r.id} empty="No stock adjustments yet."
        columns={[
          { label: "Reference", primary: true, render: (r) => <RowLink href={`/adjustments/${r.id}`}>{r.number}</RowLink> },
          { label: "Date", render: (r) => fmtDateTime(r.createdAt) },
          { label: "Reason", render: (r) => ADJUST_REASONS[r.reason as keyof typeof ADJUST_REASONS] ?? r.reason },
          { label: "Type", render: (r) => <Badge tone={r.kind === "ABNORMAL" ? "warn" : "muted"}>{r.kind.toLowerCase()}</Badge> },
          { label: "Lines", num: true, render: (r) => r.lines.length },
          ...(showCost ? [{ label: "Stock value change", num: true, render: (r: (typeof rows)[number]) => {
            const v = r.lines.filter((l) => !l.toBucket || l.toBucket === "WRITTEN_OFF" || !l.fromBucket).reduce((a, l) => a.plus(D(l.qty).mul(l.unitCost)), D(0));
            return <span style={{ color: v.lt(0) ? "var(--err)" : undefined }}>{money(v)}</span>;
          } }] : []),
          { label: "Recovered", num: true, render: (r) => money(r.recoveredAmount) },
          { label: "By", render: (r) => r.createdBy.fullName },
        ]} />
    </div>
  );
}
