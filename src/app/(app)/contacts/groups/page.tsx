import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead, DataTable } from "@/components/ui";
import { GroupForm } from "./GroupForm";

export const metadata = { title: "Customer groups" };

export default async function Groups() {
  await requirePermission("contacts.manage");
  const groups = await db.customerGroup.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { contacts: true } } } });
  return (
    <div className="stack">
      <PageHead eyebrow="Contacts" title="Customer groups" />
      <GroupForm />
      <DataTable rows={groups} rowKey={(g) => g.id} empty="No groups yet." cards={false}
        columns={[{ label: "Group", render: (g) => g.name }, { label: "Customers", num: true, render: (g) => g._count.contacts }]} />
    </div>
  );
}
