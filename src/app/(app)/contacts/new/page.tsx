import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { ContactForm } from "../ContactForm";

export const metadata = { title: "New contact" };

export default async function NewContact({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  await requirePermission("contacts.manage");
  const { type } = await searchParams;
  const groups = await db.customerGroup.findMany({ orderBy: { name: "asc" } });
  return (
    <div style={{ maxWidth: 820 }}>
      <PageHead eyebrow="Contacts" title={type === "supplier" ? "New supplier" : "New customer"} />
      <ContactForm groups={groups} defaultType={type} />
    </div>
  );
}
