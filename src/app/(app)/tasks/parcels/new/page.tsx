import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { ParcelForm } from "../../TaskForms";

export const metadata = { title: "New bus parcel" };

export default async function NewParcel() {
  const user = await requirePermission("tasks.manage");
  const staff = await db.person.findMany({ where: { active: true, login: { isNot: null } }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } });
  return (
    <div style={{ maxWidth: 900 }}>
      <PageHead eyebrow="Staff Tasks" title="New bus parcel" />
      <ParcelForm staff={staff.map((s) => ({ id: s.id, name: s.fullName }))} locations={user.locations.map((l) => ({ id: l.id, name: l.name }))} defaultLocationId={user.location?.id ?? ""} />
    </div>
  );
}
