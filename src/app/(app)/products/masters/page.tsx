import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead, DataTable, Badge } from "@/components/ui";
import { MasterForm } from "./MasterForm";
import { BrandActions } from "./BrandActions";

export const metadata = { title: "Brands, units, warranties" };

export default async function Masters({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  await requirePermission("products.manage");
  const { brand: editId } = await searchParams;
  const [brands, units, warranties, brandRules] = await Promise.all([
    db.brand.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], include: { _count: { select: { products: true } } } }),
    db.unit.findMany({ orderBy: { name: "asc" } }),
    db.warranty.findMany({ orderBy: { durationDays: "asc" } }),
    db.discountRule.findMany({ where: { scope: "BRAND" }, select: { targetIds: true } }),
  ]);
  const inRules = new Set(brandRules.flatMap((r) => r.targetIds));
  const editing = brands.find((b) => b.id === editId);
  return (
    <div className="stack">
      <PageHead eyebrow="Products" title="Brands, units & warranties" />
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Brands</h2>
        <MasterForm kind="brand" edit={editing && { id: editing.id, name: editing.name }} />
        <DataTable rows={brands} rowKey={(b) => b.id} empty="No brands yet." cards={false}
          columns={[
            { label: "Brand", render: (b) => <>{b.name}{!b.active && <> <Badge tone="muted">Inactive</Badge></>}</> },
            { label: "Products", num: true, render: (b) => b._count.products },
            { label: "", render: (b) => (
              <div className="row" style={{ gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                <Link className="small" href={`?brand=${b.id}`}>Edit</Link>
                <BrandActions id={b.id} name={b.name} active={b.active} deletable={!b._count.products && !inRules.has(b.id)} />
              </div>
            ) },
          ]} />
      </section>
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Units</h2>
        <MasterForm kind="unit" />
        <DataTable rows={units} rowKey={(u) => u.id} empty="No units yet." cards={false}
          columns={[{ label: "Unit", render: (u) => u.name }, { label: "Short", render: (u) => u.shortName }, { label: "Decimals", render: (u) => (u.allowDecimal ? "Allowed" : "Whole only") }]} />
      </section>
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Warranties</h2>
        <MasterForm kind="warranty" />
        <DataTable rows={warranties} rowKey={(w) => w.id} empty="No warranties yet." cards={false}
          columns={[
            { label: "Warranty", render: (w) => w.name },
            { label: "Duration", num: true, render: (w) => `${w.durationDays} days` },
            { label: "Note", render: (w) => w.description ? <span className="small">{w.description}</span> : <span className="muted">—</span> },
          ]} />
      </section>
    </div>
  );
}
