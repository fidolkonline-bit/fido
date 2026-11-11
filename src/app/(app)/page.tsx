import Link from "next/link";
import { requireUser, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, qty, colomboDayStart, fmtDateTime } from "@/lib/money";
import { availability } from "@/lib/stock";
import { unstable_cache } from "next/cache";
import { latestBackup, storageConfigured } from "@/lib/storage";

const backupHealth = unstable_cache(async () => {
  if (!storageConfigured()) return "Automatic backups are not set up yet.";
  try {
    const b = await latestBackup();
    if (!b?.at) return "No database backup has been made yet.";
    return Date.now() - new Date(b.at).getTime() > 36 * 3_600_000 ? "The last database backup is more than 36 hours old." : null;
  } catch {
    return "Backups could not be checked.";
  }
}, ["backup-health"], { revalidate: 3600 });
import { PageHead, DataTable, Stat, Badge, RowLink } from "@/components/ui";

export const metadata = { title: "Home" };

export default async function Home() {
  const user = await requireUser();
  const loc = user.location;
  const since = colomboDayStart();
  const scope = loc ? { locationId: loc.id } : {};

  const [salesToday, collectedToday, dueAgg, recent, register, products] = await Promise.all([
    db.sale.aggregate({ where: { ...scope, stage: "FINAL", soldAt: { gte: since } }, _sum: { total: true }, _count: true }),
    db.payment.aggregate({ where: { direction: "IN", method: { not: "STORE_CREDIT" }, paidAt: { gte: since }, sale: loc ? { locationId: loc.id } : undefined }, _sum: { amount: true } }),
    db.sale.aggregate({ where: { ...scope, stage: "FINAL", paymentState: { not: "PAID" } }, _sum: { total: true, paid: true, credited: true }, _count: true }),
    can(user, "sales.view")
      ? db.sale.findMany({ where: scope, orderBy: { soldAt: "desc" }, take: 8, include: { customer: true } })
      : Promise.resolve([]),
    loc ? db.registerSession.findFirst({ where: { locationId: loc.id, userId: user.personId, closedAt: null } }) : null,
    db.product.findMany({ where: { active: true, stockManaged: true, alertQty: { gt: 0 } }, select: { id: true, sku: true, name: true, alertQty: true } }),
  ]);

  const stock = loc ? await availability(loc.id, products.map((p) => p.id)) : new Map();
  const [repairsOpen, repairsReady, reloadsWaiting, parcelsOpen] = await Promise.all([
    can(user, "repairs.view") ? db.repairJob.count({ where: { ...scope, status: { in: ["RECEIVED", "DIAGNOSIS", "AWAITING_APPROVAL", "AWAITING_PARTS", "IN_PROGRESS", "TESTING"] } } }) : 0,
    can(user, "repairs.view") ? db.repairJob.count({ where: { ...scope, status: "READY" } }) : 0,
    db.reloadRequest.count({ where: { ...scope, status: { in: ["REQUESTED", "ACKNOWLEDGED", "PROCESSING", "UNCERTAIN"] } } }),
    db.busParcel.count({ where: { ...scope, status: { in: ["DISPATCHED", "ACKNOWLEDGED", "COLLECTED"] } } }),
  ]);
  const low = products
    .map((p) => ({ ...p, available: stock.get(p.id) ?? D(0) }))
    .filter((p) => p.available.lte(p.alertQty))
    .slice(0, 10);
  // Owner only: say so on the home screen when the nightly backup is missing or late (checked at most hourly).
  const backupWarning = can(user, "settings.manage") ? await backupHealth() : null;
  const dues = D(dueAgg._sum.total).minus(D(dueAgg._sum.paid)).minus(D(dueAgg._sum.credited));

  return (
    <div className="stack">
      <PageHead
        eyebrow={`Home / ${loc?.name ?? "No location"}`}
        title="Shop desk"
        actions={
          <>
            {can(user, "register.operate") && !register && <Link className="btn" href="/register">Open register</Link>}
            {can(user, "sales.create") && <Link className="btn btn-primary" href="/pos">New sale</Link>}
          </>
        }
      />
      {backupWarning && <p className="note note-err">{backupWarning} <Link href="/settings/backups">Open Backups</Link></p>}
      <div className="stats">
        <Stat label="Sales today" value={`Rs. ${money(salesToday._sum.total)}`} basis={`${salesToday._count} invoices · invoice basis`} />
        <Stat label="Money collected today" value={`Rs. ${money(collectedToday._sum.amount)}`} basis="Payment-date basis" />
        <Stat label="Customer dues" value={`Rs. ${money(dues)}`} basis={`${dueAgg._count} unpaid / part-paid invoices`} />
        <Stat label="Low stock" value={`${low.length} items`} basis="At or below alert level" />
      </div>

      <div className="stats">
        {can(user, "repairs.view") && <Link href="/repairs" style={{ textDecoration: "none" }}><Stat label="Repairs in progress" value={repairsOpen} basis="Open jobs" /></Link>}
        {can(user, "repairs.view") && <Link href="/repairs?tab=ready" style={{ textDecoration: "none" }}><Stat label="Ready to collect" value={repairsReady} basis="Customers to call" /></Link>}
        <Link href="/reloads" style={{ textDecoration: "none" }}><Stat label="Reloads waiting" value={<span style={{ color: reloadsWaiting ? "var(--err)" : undefined }}>{reloadsWaiting}</span>} basis="Requested / uncertain" /></Link>
        <Link href="/tasks?tab=parcels" style={{ textDecoration: "none" }}><Stat label="Bus parcels open" value={parcelsOpen} basis="Not yet checked" /></Link>
      </div>

      {can(user, "sales.view") && (
        <section>
          <div className="row" style={{ marginBottom: 10 }}><h2 style={{ margin: 0 }}>Recent sales</h2><div className="spacer" /><Link href="/sales" className="small">All sales</Link></div>
          <DataTable
            rows={recent}
            rowKey={(s) => s.id}
            empty="No sales yet. Open the register and make the first sale from POS."
            columns={[
              { label: "Invoice", primary: true, render: (s) => <RowLink href={`/sales/${s.id}`}>{s.number}</RowLink> },
              { label: "Time", render: (s) => fmtDateTime(s.soldAt) },
              { label: "Customer", render: (s) => s.customer?.name ?? "Walk-in" },
              { label: "Total", num: true, render: (s) => money(s.total) },
              { label: "Payment", render: (s) => <Badge tone={s.paymentState === "PAID" ? "ok" : "warn"}>{s.paymentState === "PAID" ? "Paid" : s.paymentState === "PARTIAL" ? "Part paid" : "Due"}</Badge> },
            ]}
          />
        </section>
      )}

      <section>
        <h2>Stock alerts</h2>
        <DataTable
          rows={low}
          rowKey={(p) => p.id}
          empty="No products are at or below their alert level."
          columns={[
            { label: "Product", primary: true, render: (p) => <RowLink href={`/products/${p.id}`}>{p.sku} · {p.name}</RowLink> },
            { label: "Available", num: true, render: (p) => qty(p.available) },
            { label: "Alert level", num: true, render: (p) => qty(p.alertQty) },
          ]}
        />
      </section>
    </div>
  );
}
