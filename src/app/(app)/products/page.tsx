import Link from "next/link";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, qty } from "@/lib/money";
import {
  productFilters, isFiltered, filterQuery, categoryTree, listProducts,
  STOCK_OPTIONS, TYPE_OPTIONS, FLAG_OPTIONS, CHECK_OPTIONS, SORT_OPTIONS,
} from "@/lib/product-list";
import { PageHead, DataTable, RowLink, Badge, Pager, PAGE_SIZE, pageOf } from "@/components/ui";

export const metadata = { title: "Products" };

type Params = { q?: string; show?: string; cat?: string; brand?: string; stock?: string; type?: string; flag?: string; check?: string; min?: string; max?: string; sort?: string; page?: string };

export default async function Products({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requirePermission("products.view");
  const sp = await searchParams;
  const f = productFilters(sp);
  const page = pageOf(sp.page);
  const showCost = can(user, "cost.view");
  const locationId = user.location?.id ?? null;

  const [categories, brands] = await Promise.all([
    categoryTree(),
    db.brand.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const selectedCat = categories.find((c) => c.id === f.cat);
  const categoryIds = f.cat && f.cat !== "none" ? (selectedCat?.ids ?? [f.cat]) : null;
  const { products, stock, hasStock, total, hasNext } = await listProducts(f, { locationId, showCost, categoryIds, page, pageSize: PAGE_SIZE });

  const filtered = isFiltered(f);
  const query = filterQuery(f);
  const catHref = (id: string) => "?" + new URLSearchParams(Object.entries({ ...query, cat: id }).filter((e): e is [string, string] => !!e[1])).toString();
  const checks = Object.entries(CHECK_OPTIONS).filter(([v]) => v !== "belowcost" || showCost);
  const sorts = Object.entries(SORT_OPTIONS).filter(([v]) => v !== "stock" || hasStock);
  const stocks = Object.entries(STOCK_OPTIONS).filter(([v]) => v === "unstocked" || hasStock);

  return (
    <div>
      <PageHead
        eyebrow={`Products / ${user.location?.name ?? ""}`}
        title="Products & availability"
        actions={can(user, "products.manage") && <Link className="btn btn-primary" href="/products/new">New product</Link>}
      />
      <form className="toolbar dense" role="search">
        <input name="q" defaultValue={f.q} placeholder="Search name, SKU or barcode" aria-label="Search products" />
        <select name="cat" defaultValue={f.cat} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{"  ".repeat(c.depth)}{c.label}</option>)}
          <option value="none">No category</option>
        </select>
        <select name="brand" defaultValue={f.brand} aria-label="Brand">
          <option value="">All brands</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          <option value="none">No brand</option>
        </select>
        <select name="stock" defaultValue={f.stock} aria-label="Stock">
          <option value="">Any stock</option>
          {stocks.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select name="type" defaultValue={f.type} aria-label="Product type">
          <option value="">Any type</option>
          {Object.entries(TYPE_OPTIONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select name="flag" defaultValue={f.flag} aria-label="Flags">
          <option value="">Any flags</option>
          {Object.entries(FLAG_OPTIONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select name="check" defaultValue={f.check} aria-label="Data checks">
          <option value="">No data check</option>
          {checks.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input name="min" type="number" min="0" step="any" inputMode="decimal" defaultValue={f.min} placeholder="Min price" aria-label="Minimum sale price" />
        <input name="max" type="number" min="0" step="any" inputMode="decimal" defaultValue={f.max} placeholder="Max price" aria-label="Maximum sale price" />
        <select name="show" defaultValue={f.show} aria-label="Status"><option value="active">Active</option><option value="inactive">Inactive</option></select>
        <select name="sort" defaultValue={f.sort} aria-label="Sort">
          {sorts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="btn" type="submit">Filter</button>
        {filtered && <Link className="btn btn-sm" href="/products">Clear</Link>}
      </form>
      {filtered && total !== null && (
        <p className="small" style={{ marginTop: 0 }}>
          {total} {total === 1 ? "product matches" : "products match"}
          {selectedCat ? <> in <strong>{selectedCat.label}</strong></> : f.cat === "none" ? <> with <strong>no category</strong></> : null}.
        </p>
      )}
      <DataTable
        rows={products}
        rowKey={(p) => p.id}
        empty={filtered ? "No products match these filters." : "No products yet."}
        columns={[
          { label: "SKU / item", primary: true, render: (p) => <RowLink href={`/products/${p.id}`}>{p.sku} · {p.name}</RowLink> },
          { label: "Category", render: (p) => (p.category ? <Link href={catHref(p.category.id)} title="Show this category">{p.category.name}</Link> : "—") },
          { label: "Brand", render: (p) => p.brand?.name ?? "—" },
          {
            label: "Available", num: true,
            render: (p) => {
              if (!p.stockManaged) return <span className="muted">Not stocked</span>;
              if (!hasStock) return "—";
              const a = stock.get(p.id)!;
              return <span style={{ color: a.lte(p.alertQty) ? "var(--err)" : undefined }}>{qty(a)}</span>;
            },
          },
          ...(showCost ? [{ label: "Last cost", num: true, render: (p: (typeof products)[number]) => money(p.defaultCost) }] : []),
          { label: "Sale price", num: true, render: (p) => money(p.sellPrice) },
          { label: "Flags", render: (p) => (p.notForSale ? <Badge tone="warn">Not for sale</Badge> : p.trackDevices ? <Badge>IMEI</Badge> : null) },
        ]}
      />
      <Pager page={page} hasNext={hasNext} query={query} shown={products.length} noun="products" />
      <p className="small muted">Available = saleable stock at this location. Low stock = at or below the product’s alert quantity.</p>
    </div>
  );
}
