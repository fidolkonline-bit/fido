import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { createPriceGroup, updatePriceGroup, deletePriceGroup } from "./actions";

export const metadata = { title: "Price tiers" };

export default async function PriceGroups() {
  await requirePermission("pricing.manage");
  const [groups, roles] = await Promise.all([
    db.priceGroup.findMany({
      orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
      include: { access: true, _count: { select: { prices: true, customerGroups: true, sales: true } } },
    }),
    db.role.findMany({ orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <PageHead eyebrow="Settings" title="Selling price tiers" />
      <p className="small muted" style={{ margin: 0 }}>
        A tier gives products their own price (set on each product, or by import). Customers get a tier through their customer group.
        Staff with “choose a different price tier” may switch tiers for one sale — only to the tiers their role is ticked for below.
        Products without a price in a tier sell at their default price, and the POS says so.
      </p>

      <ActionForm action={createPriceGroup} className="panel row" style={{ alignItems: "flex-end" }}>
        <label className="field" style={{ flex: "1 1 200px" }}><span>New tier name</span><input name="name" required /></label>
        <label className="field" style={{ flex: "2 1 260px" }}><span>Description</span><input name="description" /></label>
        <SubmitButton pendingText="Adding…">Add tier</SubmitButton>
      </ActionForm>

      {groups.map((g) => (
        <section key={g.id} className="panel stack" style={{ gap: 10, opacity: g.active ? 1 : 0.75 }}>
          <div className="row">
            <strong>{g.name}</strong>
            <Badge tone={g.active ? "ok" : "muted"}>{g.active ? "Active" : "Inactive"}</Badge>
            <span className="small muted">{g._count.prices} product prices · {g._count.customerGroups} customer groups · {g._count.sales} sales</span>
          </div>
          <ActionForm action={updatePriceGroup}>
            <input type="hidden" name="id" value={g.id} />
            <div className="grid3">
              <label className="field"><span>Name</span><input name="name" defaultValue={g.name} required /></label>
              <label className="field" style={{ gridColumn: "span 2" }}><span>Description</span><input name="description" defaultValue={g.description ?? ""} /></label>
              <label className="field"><span>Order in lists</span><input name="sortOrder" type="number" defaultValue={g.sortOrder} inputMode="numeric" /></label>
            </div>
            <fieldset className="row" style={{ border: 0, padding: 0, margin: 0, gap: 14 }}>
              <legend className="small muted" style={{ marginBottom: 4 }}>Roles that may choose this tier at the POS</legend>
              {roles.map((r) => <label key={r.id} className="check small"><input type="checkbox" name="roleIds" value={r.id} defaultChecked={g.access.some((a) => a.roleId === r.id)} /> {r.name}</label>)}
            </fieldset>
            <div className="row">
              <label className="check"><input type="checkbox" name="active" defaultChecked={g.active} /> Active</label>
              <div className="spacer" />
              <SubmitButton className="btn">Save</SubmitButton>
            </div>
          </ActionForm>
          <ActionForm action={deletePriceGroup} className="row">
            <input type="hidden" name="id" value={g.id} />
            {!g._count.sales && <label className="check small"><input type="checkbox" name="confirm" required /> Also delete its {g._count.prices} product prices</label>}
            {(g.active || !g._count.sales) && <button className="btn btn-sm btn-ghost btn-danger" type="submit">{g._count.sales ? "Deactivate (used by past sales)" : "Delete tier"}</button>}
          </ActionForm>
        </section>
      ))}
    </div>
  );
}
