import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, Badge } from "@/components/ui";
import { setPersonActive } from "./actions";

export const metadata = { title: "Users" };

export default async function Users() {
  const admin = await requirePermission("users.manage");
  const people = await db.person.findMany({
    orderBy: [{ active: "desc" }, { fullName: "asc" }],
    include: { login: { include: { role: true, locations: { include: { location: true } } } }, commissionProfile: true },
  });
  return (
    <div>
      <PageHead eyebrow="User Management" title="Users" actions={<Link className="btn btn-primary" href="/users/new">New user</Link>} />
      <DataTable rows={people} rowKey={(p) => p.id}
        columns={[
          { label: "Person", primary: true, render: (p) => <>{p.fullName}{p.login && <span className="muted small"> · {p.login.username}</span>}</> },
          { label: "Role", render: (p) => p.login?.role.name ?? "—" },
          { label: "Login", render: (p) => (p.login?.allowLogin ? <Badge tone="ok">Enabled</Badge> : <Badge>No login</Badge>) },
          { label: "Commission", render: (p) => p.commissionProfile ? ({ USER: "User", AGENT: "Agent", BOTH: "User + agent" } as Record<string, string>)[p.commissionProfile.kind] : "—" },
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
      <p className="small muted">People are never deleted, so their sales and history stay attached. Deactivating signs them out everywhere.</p>
    </div>
  );
}
