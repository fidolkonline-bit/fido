import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, Stat } from "@/components/ui";
import { FundForm, WalletEdit } from "./WalletForms";

export const metadata = { title: "Reload wallet" };

export default async function Wallet({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("reloads.wallets");
  const w = await db.reloadWallet.findUnique({ where: { id: (await params).id } });
  if (!w) notFound();
  const [moves, agg, accounts, locations] = await Promise.all([
    db.walletMovement.findMany({ where: { walletId: w.id }, orderBy: { createdAt: "desc" }, take: 200, include: { createdBy: true } }),
    db.walletMovement.groupBy({ by: ["kind"], where: { walletId: w.id }, _sum: { nominal: true, money: true } }),
    db.account.findMany({ where: { active: true, type: { in: ["BANK", "CASH"] } }, select: { id: true, name: true } }),
    db.location.findMany({ where: { active: true }, select: { id: true, name: true } }),
  ]);
  const sum = (k: string, f: "nominal" | "money") => D(agg.find((a) => a.kind === k)?._sum[f]);
  const balance = agg.reduce((a, x) => a.plus(D(x._sum.nominal)), D(0));
  const funded = sum("FUNDING", "nominal");
  const paid = sum("FUNDING", "money");
  return (
    <div className="stack">
      <PageHead eyebrow="Reloads / Wallets" title={w.name} />
      <div className="stats">
        <Stat label="Balance (nominal)" value={`Rs. ${money(balance)}`} basis="Funding − successful reloads" />
        <Stat label="Funded" value={`Rs. ${money(funded)}`} basis={`for Rs. ${money(paid)} paid`} />
        <Stat label="Funding benefit" value={`Rs. ${money(funded.minus(paid))}`} basis="Nominal received − money paid" />
        <Stat label="Reloaded" value={`Rs. ${money(sum("RELOAD", "nominal").neg())}`} basis="Successful reloads" />
      </div>
      <p className="small muted" style={{ margin: 0 }}>The discount is recognised once — as cost on each reload sale (amount × {D(w.costRate).toFixed(2)}) — never again as funding income.</p>
      <FundForm walletId={w.id} rate={Number(w.costRate)} accounts={accounts} />
      <DataTable rows={moves} rowKey={(m) => m.id} empty="No movements yet."
        columns={[
          { label: "When", primary: true, render: (m) => fmtDateTime(m.createdAt) },
          { label: "Type", render: (m) => m.kind.toLowerCase() },
          { label: "Nominal", num: true, render: (m) => <span style={{ color: D(m.nominal).lt(0) ? "var(--err)" : "var(--ok)" }}>{money(m.nominal)}</span> },
          { label: "Money paid", num: true, render: (m) => (D(m.money).gt(0) ? money(m.money) : "—") },
          { label: "Reference", render: (m) => m.reference ?? "—" },
          { label: "By", render: (m) => m.createdBy.fullName },
        ]} />
      <WalletEdit w={{ id: w.id, name: w.name, networks: w.networks, costRate: w.costRate.toString(), locationId: w.locationId }} locations={locations} />
    </div>
  );
}
