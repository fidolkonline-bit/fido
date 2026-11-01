import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { ContactForm } from "../../ContactForm";

export const metadata = { title: "Edit contact" };

export default async function EditContact({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("contacts.manage");
  const c = await db.contact.findUnique({ where: { id: (await params).id } });
  if (!c) notFound();
  const groups = await db.customerGroup.findMany({ orderBy: { name: "asc" } });
  return (
    <div style={{ maxWidth: 820 }}>
      <PageHead eyebrow="Contacts" title={`Edit ${c.name}`} />
      <ContactForm groups={groups} contact={{ ...c, creditLimit: c.creditLimit?.toString() ?? null, openingBalance: c.openingBalance.toString() }} />
    </div>
  );
}
