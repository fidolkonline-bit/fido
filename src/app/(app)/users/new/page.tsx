import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { UserForm } from "../UserForm";

export const metadata = { title: "New user" };

export default async function NewUser() {
  await requirePermission("users.manage");
  const [roles, locations] = await Promise.all([
    db.role.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.location.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <div style={{ maxWidth: 820 }}>
      <PageHead eyebrow="User Management" title="New user / agent" />
      <UserForm roles={roles} locations={locations} />
    </div>
  );
}
