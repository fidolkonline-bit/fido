import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { IntakeForm } from "../IntakeForm";

export const metadata = { title: "Repair intake" };

export default async function NewRepair() {
  const user = await requirePermission("repairs.manage");
  const technicians = await db.person.findMany({
    where: { active: true, login: { role: { permissions: { has: "repairs.manage" } } } }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true },
  });
  return (
    <div style={{ maxWidth: 900 }}>
      <PageHead eyebrow={`Repair / ${user.location?.name ?? ""}`} title="Repair intake" />
      <IntakeForm technicians={technicians.map((t) => ({ id: t.id, name: t.fullName }))} />
    </div>
  );
}
