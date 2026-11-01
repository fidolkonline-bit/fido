import type { Prisma } from "@prisma/client";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money } from "@/lib/money";
import { PageHead, DataTable, Badge } from "@/components/ui";
import { AccountForm } from "./AccountForm";

export const metadata = { title: "Payment accounts" };

const TYPE_LABEL: Record<string, string> = { CASH: "Cash", BANK: "Bank", CARD: "Card", WALLET: "Wallet", OWNER_COLLECTION: "Owner collection" };

export default async function Accounts() {
  const user = await requirePermission("accounts.view");
  const [accounts, flows, unmapped, locations] = await Promise.all([
    db.account.findMany({ orderBy: { name: "asc" }, include: { location: true } }),
    db.payment.groupBy({ by: ["accountId", "direction"], _sum: { amount: true } }),
    db.payment.aggregate({ where: { accountId: null, method: { not: "STORE_CREDIT" } }, _count: true, _sum: { amount: true } }),
    db.location.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  const bal = (id: string, opening: Prisma.Decimal) =>
    flows.filter((f) => f.accountId === id).reduce((a, f) => (f.direction === "IN" ? a.plus(D(f._sum.amount)) : a.minus(D(f._sum.amount))), opening);

  return (
    <div className="stack">
      <PageHead eyebrow="Payment Accounts" title="Payment accounts" />
      {unmapped._count > 0 && <p className="note">{unmapped._count} payments (Rs. {money(unmapped._sum.amount)}) have no account. Add accounts of each type so payments map automatically.</p>}
      <DataTable rows={accounts} rowKey={(a) => a.id} empty="No accounts yet."
        columns={[
          { label: "Account", primary: true, render: (a) => a.name },
          { label: "Type", render: (a) => TYPE_LABEL[a.type] ?? a.type },
          { label: "Scope", render: (a) => a.location?.name ?? "Business-wide" },
          { label: "Opening", num: true, render: (a) => money(a.openingBalance) },
          { label: "Ledger balance", num: true, render: (a) => money(bal(a.id, D(a.openingBalance))) },
          { label: "State", render: (a) => (a.active ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>) },
        ]} />
      <p className="small muted" style={{ margin: 0 }}>Ledger balance = opening + payments in − payments out recorded against the account.</p>
      {can(user, "accounts.manage") && <AccountForm locations={locations} />}
    </div>
  );
}
