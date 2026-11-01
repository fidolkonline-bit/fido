import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead, DataTable } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { GroupForm } from "./GroupForm";
import { setCustomerGroupPricing } from "../../settings/price-groups/actions";

export const metadata = { title: "Customer groups" };

export default async function Groups() {
  const user = await requirePermission("contacts.manage");
  const [groups, tiers] = await Promise.all([
    db.customerGroup.findMany({ orderBy: { name: "asc" }, include: { priceGroup: true, _count: { select: { contacts: true } } } }),
    db.priceGroup.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  const manage = can(user, "pricing.manage");
  return (
    <div className="stack">
      <PageHead eyebrow="Contacts" title="Customer groups" />
      <GroupForm />
      <DataTable rows={groups} rowKey={(g) => g.id} empty="No groups yet."
        columns={[
          { label: "Group", primary: true, render: (g) => g.name },
          { label: "Customers", num: true, render: (g) => g._count.contacts },
          {
            label: "Pricing", render: (g) => manage ? (
              // A tier, or else a % on the default price. Setting a tier clears the %.
              <ActionForm action={setCustomerGroupPricing} className="row" style={{ gap: 6 }}>
                <input type="hidden" name="id" value={g.id} />
                <select name="priceGroupId" defaultValue={g.priceGroupId ?? ""} aria-label={`Price tier for ${g.name}`}>
                  <option value="">Default price</option>
                  {g.priceGroup && !g.priceGroup.active && <option value={g.priceGroup.id}>{g.priceGroup.name} (inactive)</option>}
                  {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <input name="adjustmentPct" defaultValue={g.adjustmentPct?.toString() ?? ""} placeholder="± %" inputMode="decimal" style={{ width: 80 }} aria-label="Percent adjustment when no tier" />
                <SubmitButton className="btn btn-sm">Save</SubmitButton>
              </ActionForm>
            ) : g.priceGroup ? `${g.priceGroup.name}${g.priceGroup.active ? "" : " (inactive — default price)"}` : g.adjustmentPct ? `Default price ${Number(g.adjustmentPct) > 0 ? "+" : ""}${g.adjustmentPct}%` : "Default price",
          },
        ]} />
      {manage && <p className="small muted">Pick a tier, or leave “Default price” and enter a percent (−10 = 10% below the default price). A tier takes precedence.</p>}
    </div>
  );
}
