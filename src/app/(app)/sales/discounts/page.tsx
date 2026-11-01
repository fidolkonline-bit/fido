import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDate } from "@/lib/money";
import { PageHead, DataTable, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { discountRuleForm, toggleRule } from "../../payment-actions";

export const metadata = { title: "Discount rules" };

export default async function Discounts() {
  await requirePermission("products.manage");
  const [rules, categories, brands, products, locations] = await Promise.all([
    db.discountRule.findMany({ orderBy: [{ active: "desc" }, { priority: "asc" }] }),
    db.category.findMany({ where: { active: true }, orderBy: { name: "asc" } }), db.brand.findMany({ orderBy: { name: "asc" } }),
    db.product.findMany({ where: { active: true, notForSale: false }, orderBy: { name: "asc" }, select: { id: true, name: true, sku: true }, take: 500 }),
    db.location.findMany({ where: { active: true } }),
  ]);
  const names = new Map<string, string>([...categories.map((c) => [c.id, c.name] as const), ...brands.map((b) => [b.id, b.name] as const), ...products.map((p) => [p.id, `${p.sku} ${p.name}`] as const)]);
  const now = new Date();
  return (
    <div className="stack">
      <PageHead eyebrow="Sell" title="Discount rules (offers)" />
      <p className="small muted" style={{ margin: 0 }}>The POS applies the one matching offer with the lowest priority number — offers never stack. Offer discounts are allowed on top of a cashier&apos;s own discount limit, but only for the offer amount.</p>
      <DataTable rows={rules} rowKey={(r) => r.id} empty="No offers yet."
        columns={[
          { label: "Offer", primary: true, render: (r) => r.name },
          { label: "Applies to", render: (r) => (r.scope === "ALL" ? "Everything" : `${r.scope.toLowerCase()}: ${r.targetIds.map((id) => names.get(id) ?? "?").join(", ")}`) },
          { label: "Discount", render: (r) => (r.percent ? `${r.percent}%` : `Rs. ${money(r.amount)} per item`) },
          { label: "Dates", render: (r) => `${r.startsAt ? fmtDate(r.startsAt) : "now"} – ${r.endsAt ? fmtDate(r.endsAt) : "no end"}` },
          { label: "Priority", num: true, render: (r) => r.priority },
          { label: "", render: (r) => <form action={toggleRule} className="row" style={{ gap: 6 }}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="active" value={String(!r.active)} />
            {r.active ? <Badge tone={(!r.startsAt || r.startsAt <= now) && (!r.endsAt || r.endsAt >= now) ? "ok" : "warn"}>{(!r.endsAt || r.endsAt >= now) ? "Active" : "Ended"}</Badge> : <Badge>Off</Badge>}
            <button className="btn btn-sm">{r.active ? "Turn off" : "Turn on"}</button></form> },
        ]} />
      <ActionForm action={discountRuleForm} className="panel stack">
        <h2 style={{ margin: 0 }}>New offer</h2>
        <div className="grid3">
          <label className="field"><span>Name</span><input name="name" required placeholder="Avurudu back cover offer" /></label>
          <label className="field"><span>Applies to</span><select name="scope"><option value="ALL">Everything</option><option value="CATEGORY">Categories</option><option value="BRAND">Brands</option><option value="PRODUCT">Products</option></select></label>
          <label className="field"><span>Location</span><select name="locationId"><option value="">All shops</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <label className="field"><span>Percent off</span><input name="percent" inputMode="decimal" placeholder="10" /></label>
          <label className="field"><span>…or Rs. off per item</span><input name="amount" inputMode="decimal" /></label>
          <label className="field"><span>Priority (1 = first)</span><input name="priority" defaultValue="1" inputMode="numeric" /></label>
          <label className="field"><span>From</span><input type="date" name="startsAt" /></label>
          <label className="field"><span>To</span><input type="date" name="endsAt" /></label>
        </div>
        <label className="field"><span>Which categories / brands / products (hold Ctrl/⌘ to pick several)</span>
          <select name="targetIds" multiple size={8}>
            <optgroup label="Categories">{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
            <optgroup label="Brands">{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>
            <optgroup label="Products">{products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</optgroup>
          </select>
        </label>
        <div><SubmitButton>Create offer</SubmitButton></div>
      </ActionForm>
    </div>
  );
}
