import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead, DataTable, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { addTaxRate, saveTaxSettings, setProductTax, setTaxRate } from "./actions";

export const metadata = { title: "Tax" };

export default async function Tax() {
  await requirePermission("settings.manage");
  const [business, rates, categories, overrides] = await Promise.all([
    db.business.findFirstOrThrow(),
    db.taxRate.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], include: { _count: { select: { products: true } } } }),
    db.category.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.product.count({ where: { taxRateId: { not: null } } }),
  ]);
  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <PageHead eyebrow="Settings" title="Tax" />
      <ActionForm action={saveTaxSettings} className="panel stack">
        <label className="check"><input type="checkbox" name="taxEnabled" defaultChecked={business.taxEnabled} /> The business is tax registered — show tax on sales</label>
        <label className="field" style={{ maxWidth: 320 }}><span>Tax registration number (printed on invoices)</span><input name="taxNumber" defaultValue={business.taxNumber ?? ""} /></label>
        <p className="small muted" style={{ margin: 0 }}>
          Selling prices include tax. Switching this on does not change any price or total: each invoice shows how much of the total is tax, and the
          Tax report adds it up. Sales already made are not changed.
        </p>
        <div className="form-actions" style={{ marginTop: 0 }}><SubmitButton>Save</SubmitButton></div>
      </ActionForm>

      <section className="stack">
        <h2 style={{ margin: 0 }}>Rates</h2>
        <DataTable rows={rates} rowKey={(r) => r.id} cards={false} empty="No rates yet. Add the rate your accountant gives you (for example VAT 18%)."
          columns={[
            { label: "Name", render: (r) => <>{r.name} {r.isDefault && <Badge tone="ok">Default</Badge>}</> },
            { label: "Rate", num: true, render: (r) => `${r.ratePct.toString()}%` },
            { label: "Products set to it", num: true, render: (r) => r._count.products },
            { label: "Status", render: (r) => (r.active ? <Badge tone="ok">Active</Badge> : <Badge>Retired</Badge>) },
            {
              label: "", render: (r) => (
                <span className="row">
                  {!r.isDefault && r.active && <form action={setTaxRate}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="op" value="default" /><button className="btn btn-sm">Make default</button></form>}
                  <form action={setTaxRate}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="op" value="toggle" /><button className="btn btn-sm">{r.active ? "Retire" : "Bring back"}</button></form>
                </span>
              ),
            },
          ]} />
        <ActionForm action={addTaxRate} className="panel row">
          <label className="field"><span>Name</span><input name="name" placeholder="VAT" required /></label>
          <label className="field"><span>Rate %</span><input name="ratePct" type="number" step="0.001" min="0" max="100" inputMode="decimal" required /></label>
          <SubmitButton>Add rate</SubmitButton>
        </ActionForm>
        <p className="small muted" style={{ margin: 0 }}>Every product uses the default rate unless its category is set to another one below (for example a 0% rate for exempt items). {overrides} product{overrides === 1 ? " has" : "s have"} its own rate.</p>
        {rates.length > 0 && (
          <ActionForm action={setProductTax} className="panel row">
            <label className="field"><span>All products in category</span><select name="categoryId" defaultValue=""><option value="">Select…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="field"><span>use rate</span><select name="taxRateId" defaultValue=""><option value="">The default rate</option>{rates.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.name} {r.ratePct.toString()}%</option>)}</select></label>
            <SubmitButton>Apply</SubmitButton>
          </ActionForm>
        )}
      </section>
    </div>
  );
}
