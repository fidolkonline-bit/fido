import { requireUser, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D } from "@/lib/money";
import { PageHead, Tabs } from "@/components/ui";
import { ReloadForm } from "../ReloadForm";

export const metadata = { title: "New reload" };

export default async function NewReload({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const user = await requireUser();
  const canRequest = can(user, "reloads.request");
  const canCounter = can(user, "reloads.process");
  if (!canRequest && !canCounter) throw new Error("You don't have permission for this action (reloads).");
  const { mode: m } = await searchParams;
  const mode = (m === "request" && canRequest) || !canCounter ? "REQUEST" : "COUNTER";
  const [wallets, bal, staff] = await Promise.all([
    db.reloadWallet.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.walletMovement.groupBy({ by: ["walletId"], _sum: { nominal: true } }),
    db.person.findMany({ where: { active: true, login: { role: { permissions: { has: "reloads.process" } } } }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
  ]);
  const balance = new Map(bal.map((b) => [b.walletId, Number(D(b._sum.nominal))]));
  return (
    <div style={{ maxWidth: 860 }}>
      <PageHead eyebrow="Reloads" title={mode === "REQUEST" ? "Send a reload request to the shop" : "Record a counter reload"} />
      {canRequest && canCounter && <Tabs items={[{ label: "Counter reload (done now)", href: "/reloads/new", active: mode === "COUNTER" }, { label: "Remote request to shop", href: "/reloads/new?mode=request", active: mode === "REQUEST" }]} />}
      <ReloadForm mode={mode} defaultLocationId={user.location?.id ?? ""} locations={user.locations.map((l) => ({ id: l.id, name: l.name }))}
        staff={staff.map((s) => ({ id: s.id, name: s.fullName }))}
        wallets={wallets.map((w) => ({ id: w.id, name: w.name, networks: w.networks, balance: balance.get(w.id) ?? 0 }))} />
    </div>
  );
}
