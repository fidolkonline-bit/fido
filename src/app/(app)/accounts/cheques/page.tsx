import Link from "next/link";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDate } from "@/lib/money";
import { PageHead, DataTable, Badge, Tabs } from "@/components/ui";
import { chequeForm } from "../../payment-actions";

export const metadata = { title: "Cheques" };
const TONE: Record<string, "ok" | "warn" | "err" | "muted"> = { PENDING: "warn", DEPOSITED: "warn", CLEARED: "ok", BOUNCED: "err", CANCELLED: "muted" };

export default async function Cheques({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePermission("accounts.view");
  const { tab = "open" } = await searchParams;
  const cheques = await db.cheque.findMany({
    where: tab === "open" ? { status: { in: ["PENDING", "DEPOSITED"] } } : {}, orderBy: { realizeDate: "asc" }, take: 200,
    include: { payment: { include: { contact: true, account: true, sale: true, receipt: true, expense: true } } },
  });
  const today = new Date();
  const manage = can(user, "accounts.manage");
  const source = (p: (typeof cheques)[number]["payment"]) =>
    p.sale ? <Link href={`/sales/${p.sale.id}`}>{p.sale.number}</Link> : p.receipt ? <Link href={`/purchases/${p.receipt.id}`}>{p.receipt.number}</Link> : p.expense ? <Link href={`/expenses/${p.expense.id}`}>{p.expense.number}</Link> : p.payslipId ? "Salary" : p.number;
  return (
    <div>
      <PageHead eyebrow="Payment Accounts" title="Cheques" />
      <Tabs items={[{ label: "Not yet cleared", href: "/accounts/cheques", active: tab === "open" }, { label: "All", href: "/accounts/cheques?tab=all", active: tab !== "open" }]} />
      <p className="small muted">Cheque payments count as paid but are not cleared money until the bank clears them. A bounce puts the amount back as owed on the original sale, bill or expense — once.</p>
      <DataTable rows={cheques} rowKey={(c) => c.id} empty="No cheques waiting."
        columns={[
          { label: "Cheque", primary: true, render: (c) => <>{c.direction === "RECEIVED" ? "Received" : "Issued"} · {c.number}{c.bank ? ` · ${c.bank}` : ""}</> },
          { label: "Date", render: (c) => <span style={{ color: c.status === "PENDING" && c.realizeDate < today ? "var(--warn)" : undefined }}>{fmtDate(c.realizeDate)}</span> },
          { label: "From / to", render: (c) => c.payment.contact?.name ?? "—" },
          { label: "For", render: (c) => source(c.payment) },
          { label: "Account", render: (c) => c.payment.account?.name ?? "—" },
          { label: "Amount", num: true, render: (c) => money(c.payment.amount) },
          { label: "Status", render: (c) => <Badge tone={TONE[c.status]}>{c.status.toLowerCase()}</Badge> },
          {
            label: "", render: (c) => manage && ["PENDING", "DEPOSITED"].includes(c.status) ? (
              <form action={chequeForm} className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                <input type="hidden" name="id" value={c.id} />
                {c.status === "PENDING" && c.direction === "RECEIVED" && <button className="btn btn-sm" name="action" value="DEPOSIT">Deposited</button>}
                <button className="btn btn-sm btn-primary" name="action" value="CLEAR">Cleared</button>
                <button className="btn btn-sm btn-danger" name="action" value="BOUNCE">Bounced</button>
                {c.status === "PENDING" && <button className="btn btn-sm btn-ghost" name="action" value="CANCEL">Cancel</button>}
              </form>
            ) : null,
          },
        ]} />
    </div>
  );
}
