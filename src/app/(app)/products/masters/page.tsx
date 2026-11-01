import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead, DataTable } from "@/components/ui";
import { MasterForm } from "./MasterForm";

export const metadata = { title: "Brands, units, warranties" };

export default async function Masters() {
  await requirePermission("products.manage");
  const [brands, units, warranties] = await Promise.all([
    db.brand.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { products: true } } } }),
    db.unit.findMany({ orderBy: { name: "asc" } }),
    db.warranty.findMany({ orderBy: { durationDays: "asc" } }),
  ]);
  return (
    <div className="stack">
      <PageHead eyebrow="Products" title="Brands, units & warranties" />
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Brands</h2>
        <MasterForm kind="brand" />
        <DataTable rows={brands} rowKey={(b) => b.id} empty="No brands yet." cards={false}
          columns={[{ label: "Brand", render: (b) => b.name }, { label: "Products", num: true, render: (b) => b._count.products }]} />
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
          columns={[{ label: "Warranty", render: (w) => w.name }, { label: "Duration", num: true, render: (w) => `${w.durationDays} days` }]} />
      </section>
    </div>
  );
}
