import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, Badge } from "@/components/ui";
import { EditUserForm } from "../../EditUserForm";

export const metadata = { title: "Edit user" };

export default async function EditUser({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requirePermission("users.manage");
  const person = await db.person.findUnique({ where: { id: (await params).id }, include: { login: { include: { locations: true } }, commissionProfile: true } });
  if (!person) notFound();
  const [roles, locations, attempts] = await Promise.all([
    db.role.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.location.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    person.login ? db.loginAttempt.findMany({ where: { username: person.login.username }, orderBy: { createdAt: "desc" }, take: 15 }) : [],
  ]);
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <PageHead eyebrow="User Management" title={`Edit ${person.fullName}`} />
      <EditUserForm roles={roles} locations={locations}
        initial={{
          personId: person.id, fullName: person.fullName, phone: person.phone, hasLogin: !!person.login, allowLogin: person.login?.allowLogin ?? false,
          username: person.login?.username ?? "", roleId: person.login?.roleId ?? "", maxDiscountPct: person.login?.maxDiscountPct.toString() ?? "0",
          locationIds: person.login?.locations.map((l) => l.locationId) ?? [], commissionKind: person.commissionProfile?.active ? person.commissionProfile.kind : "NONE",
          hasPin: !!person.login?.pinHash, self: person.id === admin.personId,
        }} />
      {person.login && (
        <section className="stack">
          <h2 style={{ margin: 0 }}>Recent sign-in tries</h2>
          <DataTable rows={attempts} rowKey={(a) => a.id} cards={false} empty="No sign-in tries recorded yet."
            columns={[
              { label: "When", render: (a) => fmtDateTime(a.createdAt) },
              { label: "How", render: (a) => (a.kind === "PIN" ? "PIN switch" : "Password") },
              { label: "Result", render: (a) => (a.ok ? <Badge tone="ok">Signed in</Badge> : <Badge tone="err">Wrong</Badge>) },
              { label: "Address", render: (a) => a.ip ?? "—" },
            ]} />
        </section>
      )}
    </div>
  );
}
