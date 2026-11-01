import { requireUser, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead, DataTable, Badge } from "@/components/ui";
import { BusinessForm, LocationForm, PasswordForm } from "./SettingsForms";

export const metadata = { title: "Settings" };

export default async function Settings() {
  const user = await requireUser();
  const admin = can(user, "settings.manage");
  const [business, locations] = admin
    ? await Promise.all([db.business.findFirstOrThrow(), db.location.findMany({ orderBy: { name: "asc" } })])
    : [null, []];
  return (
    <div className="stack">
      <PageHead eyebrow="Settings" title={admin ? "Business & locations" : "My account"} />
      {business && <BusinessForm name={business.name} rounding={business.saleRounding.toString()} />}
      {admin && (
        <section className="stack">
          <h2 style={{ margin: 0 }}>Locations</h2>
          <DataTable rows={locations} rowKey={(l) => l.id} cards={false}
            columns={[
              { label: "Location", render: (l) => l.name },
              { label: "Code", render: (l) => l.code },
              { label: "Phone", render: (l) => l.phone ?? "—" },
              { label: "Status", render: (l) => (l.active ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>) },
            ]} />
          <LocationForm />
        </section>
      )}
      <PasswordForm />
    </div>
  );
}
