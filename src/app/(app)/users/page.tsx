import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, Badge } from "@/components/ui";
import { setPersonActive } from "./actions";

export const metadata = { title: "Users" };

const KIND_LABEL: Record<string, string> = { USER: "User", AGENT: "Agent", BOTH: "User + agent" };

type Filters = { q?: string; role?: string; kind?: string; status?: string; owed?: string };

export default async function Users({ searchParams }: { searchParams: Promise<Filters> }) {
  const admin = await requirePermission("users.manage");
  const { q = "", role = "", kind = "", status = "all", owed = "" } = await searchParams;
  const term = q.trim();

  const where: Prisma.PersonWhereInput = {
    ...(status === "active" ? { active: true } : status === "inactive" ? { active: false } : {}),
    ...(role === "none" ? { login: null } : role ? { login: { roleId: role } } : {}),
    ...(kind === "none" ? { commissionProfile: null } : kind ? { commissionProfile: { kind } } : {}),
    ...(term
      ? {
          OR: [
            { fullName: { contains: term, mode: "insensitive" } },
            { phone: { contains: term } },
            { login: { username: { contains: term, mode: "insensitive" } } },
            { login: { role: { name: { contains: term, mode: "insensitive" } } } },
            { commissionProfile: { code: { contains: term, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [found, roles, earnedAgg, owedAgg, paidAgg] = await Promise.all([
    db.person.findMany({
      where,
      orderBy: [{ active: "desc" }, { fullName: "asc" }],
      include: { login: { include: { role: true, locations: { include: { location: true } } } }, commissionProfile: true },
    }),
    db.role.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    // Same totals the old system showed per user: total commission, total paid, remaining.
    db.commissionAccrual.groupBy({ by: ["recipientId"], _sum: { amount: true } }),
    db.commissionAccrual.groupBy({ by: ["recipientId"], where: { settlementId: null }, _sum: { amount: true } }),
    db.commissionSettlement.groupBy({ by: ["recipientId"], _sum: { amount: true } }),
  ]);
  const earned = new Map(earnedAgg.map((r) => [r.recipientId, D(r._sum.amount)]));
  const owing = new Map(owedAgg.map((r) => [r.recipientId, D(r._sum.amount)]));
  const paid = new Map(paidAgg.map((r) => [r.recipientId, D(r._sum.amount)]));
  const owedOf = (id: string) => owing.get(id) ?? D(0);

  const people = owed === "1" ? found.filter((p) => owedOf(p.id).gte(0.005)) : found;
  const totalOwed = people.reduce((a, p) => (owedOf(p.id).gt(0) ? a.plus(owedOf(p.id)) : a), D(0));
  const filtered = Boolean(term || role || kind || owed || status !== "all");
  const canPay = can(admin, "commissions.manage");

  return (
    <div>
      <PageHead eyebrow="User Management" title="Users" actions={<Link className="btn btn-primary" href="/users/new">New user</Link>} />
      <form className="toolbar" role="search">
        <input name="q" defaultValue={term} placeholder="Search name, username, phone, role or agent ID" aria-label="Search users" />
        <select name="role" defaultValue={role} aria-label="Role">
          <option value="">All roles</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          <option value="none">No login</option>
        </select>
        <select name="kind" defaultValue={kind} aria-label="Commission type">
          <option value="">Any commission type</option>
          <option value="USER">User commission</option>
          <option value="AGENT">Agent commission</option>
          <option value="BOTH">User + agent</option>
          <option value="none">No commission</option>
        </select>
        <select name="status" defaultValue={status} aria-label="Status">
          <option value="all">Active and inactive</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
        <label className="row small" style={{ gap: 6, flex: "0 0 auto" }}>
          <input type="checkbox" name="owed" value="1" defaultChecked={owed === "1"} style={{ flex: "0 0 auto", width: "auto" }} />
          Commission owed only
        </label>
        <button className="btn">Filter</button>
        {filtered && <Link className="btn btn-sm" href="/users">Clear</Link>}
      </form>
      {owed === "1" && people.length > 0 && (
        <p className="small" style={{ marginTop: 0 }}>
          We owe <strong>{money(totalOwed)}</strong> in commission to {people.length} {people.length === 1 ? "person" : "people"}.
          {canPay && <> <Link href="/hrm/commissions">Approve and pay →</Link></>}
        </p>
      )}
      <DataTable rows={people} rowKey={(p) => p.id}
        empty={owed === "1" ? "No commission is owed to anyone matching these filters." : filtered ? "No users match these filters." : "No users yet."}
        columns={[
          { label: "Person", primary: true, render: (p) => <><Link className="rowlink" href={`/users/${p.id}/edit`}>{p.fullName}</Link>{p.login && <span className="muted small"> · {p.login.username}</span>}</> },
          { label: "Role", render: (p) => p.login?.role.name ?? "—" },
          { label: "Login", render: (p) => (p.login?.allowLogin ? <Badge tone="ok">Enabled</Badge> : <Badge>No login</Badge>) },
          { label: "Commission", render: (p) => p.commissionProfile ? <>{KIND_LABEL[p.commissionProfile.kind]}{p.commissionProfile.code && <span className="muted small"> · {p.commissionProfile.code}</span>}</> : "—" },
          {
            label: "Commission payment", num: true,
            render: (p) => {
              const e = earned.get(p.id), pd = paid.get(p.id), o = owedOf(p.id);
              if (!e && !pd) return "—";
              return (
                <span className="small" style={{ display: "inline-block", textAlign: "right", lineHeight: 1.5 }}>
                  <span className="muted">Earned</span> {money(e ?? 0)}<br />
                  <span className="muted">Paid</span> {money(pd ?? 0)}<br />
                  <strong style={{ color: o.gt(0) ? "var(--err)" : undefined }}>Owed {money(o)}</strong>
                </span>
              );
            },
          },
          { label: "Locations", render: (p) => p.login?.locations.map((l) => l.location.name).join(", ") || "—" },
          { label: "Last login", render: (p) => fmtDateTime(p.login?.lastLoginAt) },
          { label: "Status", render: (p) => (p.active ? <Badge tone="ok">Active</Badge> : <Badge tone="err">Inactive</Badge>) },
          {
            label: "", render: (p) => p.id === admin.personId ? <span className="small muted">You</span> : (
              <form action={setPersonActive}>
                <input type="hidden" name="personId" value={p.id} /><input type="hidden" name="active" value={String(!p.active)} />
                <button className="btn btn-sm">{p.active ? "Deactivate" : "Reactivate"}</button>
              </form>
            ),
          },
        ]} />
      <p className="small muted">People are never deleted, so their sales and history stay attached. Deactivating signs them out everywhere. “Owed” is commission earned but not yet paid (returns reduce it).</p>
    </div>
  );
}
