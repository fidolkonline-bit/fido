import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, Pager, PAGE_SIZE, pageOf, RowLink } from "@/components/ui";

export const metadata = { title: "Audit log" };

// Where an audited record can be opened. Anything not listed shows its id only.
const LINKS: Record<string, (id: string) => string> = {
  Sale: (id) => `/sales/${id}`, Person: (id) => `/users/${id}/edit`, GoodsReceipt: (id) => `/purchases/${id}`, SaleReturn: (id) => `/returns/${id}`,
  StockAdjustment: (id) => `/adjustments/${id}`, StockTransfer: (id) => `/transfers/${id}`, Expense: (id) => `/expenses/${id}`, RepairJob: (id) => `/repairs/${id}`,
  PurchaseOrder: (id) => `/purchases/orders/${id}`, SupplierClaim: (id) => `/purchases/returns/${id}`, DebtCollection: (id) => `/sales/collections/${id}`,
  Contact: (id) => `/contacts/${id}`, Product: (id) => `/products/${id}`, TradeIn: (id) => `/trade-ins/${id}`, StockCount: (id) => `/stock-counts/${id}`,
};
const words = (a: string) => a.charAt(0) + a.slice(1).toLowerCase().replaceAll("_", " ");

export default async function Audit({ searchParams }: { searchParams: Promise<{ page?: string; actor?: string; action?: string; type?: string; from?: string; to?: string; q?: string }> }) {
  await requirePermission("settings.manage");
  const sp = await searchParams;
  const page = pageOf(sp.page);
  const from = sp.from ? new Date(`${sp.from}T00:00:00+05:30`) : undefined;
  const to = sp.to ? new Date(`${sp.to}T23:59:59.999+05:30`) : undefined;
  const where: Prisma.AuditEventWhereInput = {
    ...(sp.actor ? { actorId: sp.actor } : {}),
    ...(sp.action ? { action: sp.action } : {}),
    ...(sp.type ? { subjectType: sp.type } : {}),
    ...(sp.q ? { subjectId: sp.q.trim() } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  const [found, actions, types, people] = await Promise.all([
    db.auditEvent.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1, include: { actor: true } }),
    db.auditEvent.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
    db.auditEvent.findMany({ distinct: ["subjectType"], select: { subjectType: true }, orderBy: { subjectType: "asc" } }),
    db.person.findMany({ where: { login: { isNot: null } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
  ]);
  const rows = found.slice(0, PAGE_SIZE);
  return (
    <div className="stack">
      <PageHead eyebrow="Settings" title="Audit log" />
      <form className="toolbar" role="search">
        <select name="actor" defaultValue={sp.actor ?? ""} aria-label="Person"><option value="">Anyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}</select>
        <select name="action" defaultValue={sp.action ?? ""} aria-label="Action"><option value="">Any action</option>{actions.map((a) => <option key={a.action} value={a.action}>{words(a.action)}</option>)}</select>
        <select name="type" defaultValue={sp.type ?? ""} aria-label="Record type"><option value="">Any record</option>{types.map((t) => <option key={t.subjectType} value={t.subjectType}>{t.subjectType}</option>)}</select>
        <input type="date" name="from" defaultValue={sp.from} aria-label="From date" />
        <input type="date" name="to" defaultValue={sp.to} aria-label="To date" />
        <button className="btn">Filter</button>
      </form>
      <DataTable rows={rows} rowKey={(e) => e.id} empty="No audit events match these filters."
        columns={[
          { label: "When", render: (e) => fmtDateTime(e.createdAt) },
          { label: "Who", render: (e) => e.actor?.fullName ?? "System" },
          { label: "Action", primary: true, render: (e) => words(e.action) },
          { label: "Record", render: (e) => (LINKS[e.subjectType] ? <RowLink href={LINKS[e.subjectType](e.subjectId)}>{e.subjectType}</RowLink> : e.subjectType) },
          { label: "Detail", render: (e) => (e.detail ? <details><summary>Show</summary><pre className="small" style={{ whiteSpace: "pre-wrap", maxWidth: 520 }}>{JSON.stringify(e.detail, null, 1)}</pre></details> : "—") },
        ]} />
      <Pager page={page} hasNext={found.length > PAGE_SIZE} query={{ actor: sp.actor, action: sp.action, type: sp.type, from: sp.from, to: sp.to, q: sp.q }} shown={rows.length} noun="events" />
      <p className="small muted">The audit log is read-only. Nothing here can be edited or deleted from the app.</p>
    </div>
  );
}
