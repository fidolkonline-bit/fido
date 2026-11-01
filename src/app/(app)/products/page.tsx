import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, qty } from "@/lib/money";
import { availability } from "@/lib/stock";
import { PageHead, DataTable, RowLink, Badge, Pager, PAGE_SIZE, pageOf } from "@/components/ui";

export const metadata = { title: "Products" };

export default async function Products({ searchParams }: { searchParams: Promise<{ q?: string; show?: string; page?: string }> }) {
  const user = await requirePermission("products.view");
  const { q, show, page: pageParam } = await searchParams;
  const page = pageOf(pageParam);
  const where: Prisma.ProductWhereInput = {
    active: show === "inactive" ? false : true,
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }, { barcode: q }] } : {}),
  };
  const found = await db.product.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1, include: { category: true, brand: true } });
  const products = found.slice(0, PAGE_SIZE);
  const stock = user.location ? await availability(user.location.id, products.map((p) => p.id)) : new Map();
  const showCost = can(user, "cost.view");

  return (
    <div>
      <PageHead
        eyebrow={`Products / ${user.location?.name ?? ""}`}
        title="Products & availability"
        actions={can(user, "products.manage") && <Link className="btn btn-primary" href="/products/new">New product</Link>}
      />
      <form className="toolbar" role="search">
        <input name="q" defaultValue={q} placeholder="Search name, SKU or barcode" aria-label="Search products" />
        <select name="show" defaultValue={show ?? "active"} aria-label="Status"><option value="active">Active</option><option value="inactive">Inactive</option></select>
        <button className="btn" type="submit">Search</button>
      </form>
      <DataTable
        rows={products}
        rowKey={(p) => p.id}
        empty={q ? `No products match “${q}”.` : "No products yet."}
        columns={[
          { label: "SKU / item", primary: true, render: (p) => <RowLink href={`/products/${p.id}`}>{p.sku} · {p.name}</RowLink> },
          { label: "Category", render: (p) => p.category?.name ?? "—" },
          { label: "Brand", render: (p) => p.brand?.name ?? "—" },
          {
            label: "Available", num: true,
            render: (p) => {
              if (!p.stockManaged) return <span className="muted">Not stocked</span>;
              const a = stock.get(p.id) ?? D(0);
              return <span style={{ color: a.lte(p.alertQty) ? "var(--err)" : undefined }}>{qty(a)}</span>;
            },
          },
          ...(showCost ? [{ label: "Last cost", num: true, render: (p: (typeof products)[number]) => money(p.defaultCost) }] : []),
          { label: "Sale price", num: true, render: (p) => money(p.sellPrice) },
          { label: "Flags", render: (p) => (p.notForSale ? <Badge tone="warn">Not for sale</Badge> : p.trackDevices ? <Badge>IMEI</Badge> : null) },
        ]}
      />
      <Pager page={page} hasNext={found.length > PAGE_SIZE} query={{ q, show }} shown={products.length} noun="products" />
      <p className="small muted">Available = saleable stock at this location.</p>
    </div>
  );
}
