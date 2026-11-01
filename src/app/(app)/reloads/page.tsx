import Link from "next/link";
import { requireUser, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge, Tabs } from "@/components/ui";
import { RELOAD_STATUS } from "./status";

export const metadata = { title: "Reloads" };


export default async function Reloads({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  if (!["reloads.process", "reloads.request", "reloads.wallets"].some((p) => user.permissions.has(p))) throw new Error("You don't have permission for this action (reloads).");
  const { tab = "open" } = await searchParams;
  const [requests, wallets, bal] = await Promise.all([
    db.reloadRequest.findMany({
      where: { locationId: { in: user.locations.map((l) => l.id) }, ...(tab === "open" ? { status: { in: ["REQUESTED", "ACKNOWLEDGED", "PROCESSING", "UNCERTAIN"] } } : {}) },
      orderBy: { createdAt: "desc" }, take: 100, include: { assignedTo: true, wallet: true },
    }),
    db.reloadWallet.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.walletMovement.groupBy({ by: ["walletId"], _sum: { nominal: true } }),
  ]);
  const balance = new Map(bal.map((b) => [b.walletId, D(b._sum.nominal)]));
  return (
    <div className="stack">
      <PageHead eyebrow="Reloads" title="Reloads"
        actions={<>
          {can(user, "reloads.process") && <Link className="btn btn-primary" href="/reloads/new">Counter reload</Link>}
          {can(user, "reloads.request") && <Link className="btn" href="/reloads/new?mode=request">Remote request</Link>}
        </>} />
      <section>
        <h2>Wallets</h2>
        <DataTable rows={wallets} rowKey={(w) => w.id} cards={false} empty="No wallets set up."
          columns={[
            { label: "Wallet", render: (w) => <RowLink href={`/reloads/wallets/${w.id}`}>{w.name}</RowLink> },
            { label: "Networks", render: (w) => w.networks.map((n) => n.toLowerCase()).join(", ") },
            { label: "Cost per 1.00", num: true, render: (w) => D(w.costRate).toFixed(2) },
            { label: "Balance (nominal)", num: true, render: (w) => { const b = balance.get(w.id) ?? D(0); return <span style={{ color: b.lt(1000) ? "var(--err)" : undefined }}>{money(b)}</span>; } },
          ]} />
      </section>
      <section>
        <Tabs items={[{ label: "Open", href: "/reloads?tab=open", active: tab === "open" }, { label: "All", href: "/reloads?tab=all", active: tab !== "open" }]} />
        <DataTable rows={requests} rowKey={(r) => r.id} empty={tab === "open" ? "No reloads waiting." : "No reloads yet."}
          columns={[
            { label: "Reload", primary: true, render: (r) => <RowLink href={`/reloads/${r.id}`}>{r.number}</RowLink> },
            { label: "Number", render: (r) => `${r.mobile} · ${r.network.toLowerCase()}` },
            { label: "Amount", num: true, render: (r) => money(r.amount) },
            { label: "Requested", render: (r) => fmtDateTime(r.createdAt) },
            { label: "Staff", render: (r) => r.assignedTo?.fullName ?? "Anyone" },
            { label: "State", render: (r) => <Badge tone={RELOAD_STATUS[r.status]?.[1] ?? "muted"}>{RELOAD_STATUS[r.status]?.[0] ?? r.status}</Badge> },
          ]} />
      </section>
    </div>
  );
}
