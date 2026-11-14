import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { D } from "@/lib/money";

export const STOCK_OPTIONS: Record<string, string> = { in: "In stock", low: "Low stock", out: "Out of stock", unstocked: "Not stock-managed" };
export const TYPE_OPTIONS: Record<string, string> = { SINGLE: "Single", VARIABLE: "Variable", COMBO: "Combo" };
export const FLAG_OPTIONS: Record<string, string> = { imei: "IMEI-tracked", nfs: "Not for sale" };
export const CHECK_OPTIONS: Record<string, string> = { nobarcode: "No barcode", noprice: "Sale price is 0", belowcost: "Sale price below cost" };
export const SORT_OPTIONS: Record<string, string> = { name: "Name A–Z", sku: "SKU", price: "Price low–high", "-price": "Price high–low", stock: "Most stock first", newest: "Newest added" };

export type ProductFilters = {
  q: string; show: string; cat: string; brand: string; stock: string; type: string; flag: string; check: string; min: string; max: string; sort: string;
};

const pick = (v: string | undefined, allowed: Record<string, string>) => (v && v in allowed ? v : "");
const num = (v: string | undefined) => (v && v.trim() && Number.isFinite(Number(v)) && Number(v) >= 0 ? String(Number(v)) : "");

export function productFilters(sp: Record<string, string | undefined>): ProductFilters {
  return {
    q: (sp.q ?? "").trim(),
    show: sp.show === "inactive" ? "inactive" : "active",
    cat: sp.cat ?? "",
    brand: sp.brand ?? "",
    stock: pick(sp.stock, STOCK_OPTIONS),
    type: pick(sp.type, TYPE_OPTIONS),
    flag: pick(sp.flag, FLAG_OPTIONS),
    check: pick(sp.check, CHECK_OPTIONS),
    min: num(sp.min),
    max: num(sp.max),
    sort: pick(sp.sort, SORT_OPTIONS) || "name",
  };
}

export const isFiltered = (f: ProductFilters) =>
  Boolean(f.q || f.show !== "active" || f.cat || f.brand || f.stock || f.type || f.flag || f.check || f.min || f.max || f.sort !== "name");

export const filterQuery = (f: ProductFilters) => ({ ...f, show: f.show === "active" ? undefined : f.show, sort: f.sort === "name" ? undefined : f.sort });

// Categories as an indented tree ("Phones › Apple"), with each category's own id plus every descendant's.
export async function categoryTree() {
  const all = await db.category.findMany({ where: { active: true }, select: { id: true, name: true, parentId: true }, orderBy: { name: "asc" } });
  const byParent = new Map<string | null, typeof all>();
  for (const c of all) {
    const key = c.parentId && all.some((p) => p.id === c.parentId) ? c.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), c]);
  }
  const out: { id: string; label: string; depth: number; ids: string[] }[] = [];
  const walk = (parent: string | null, path: string[], depth: number, seen: Set<string>): string[] => {
    const ids: string[] = [];
    for (const c of byParent.get(parent) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const entry = { id: c.id, label: [...path, c.name].join(" › "), depth, ids: [c.id] };
      out.push(entry);
      entry.ids.push(...walk(c.id, [...path, c.name], depth + 1, seen));
      ids.push(...entry.ids);
    }
    return ids;
  };
  walk(null, [], 0, new Set());
  return out;
}

const productInclude = { category: true, brand: true } satisfies Prisma.ProductInclude;
export type ListedProduct = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

// Stock is not stored on the product: it is the saleable quantity at the viewer's location, so filters and sorting
// run in one SQL query that joins that location's cost layers. Only the page's ids come back, then full rows.
export async function listProducts(
  f: ProductFilters,
  opts: { locationId: string | null; showCost: boolean; categoryIds: string[] | null; page: number; pageSize: number },
) {
  const { locationId, showCost, categoryIds, page, pageSize } = opts;
  const hasStock = Boolean(locationId);
  const conds: Prisma.Sql[] = [Prisma.sql`p.active = ${f.show !== "inactive"}`];

  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, "\\$&")}%`;
    conds.push(Prisma.sql`(p.name ILIKE ${like} OR p.sku ILIKE ${like} OR p.barcode = ${f.q})`);
  }
  if (f.cat === "none") conds.push(Prisma.sql`p."categoryId" IS NULL`);
  else if (categoryIds) conds.push(Prisma.sql`p."categoryId" = ANY(${categoryIds})`);
  if (f.brand === "none") conds.push(Prisma.sql`p."brandId" IS NULL`);
  else if (f.brand) conds.push(Prisma.sql`p."brandId" = ${f.brand}`);
  if (f.type) conds.push(Prisma.sql`p.type = ${f.type}`);
  if (f.flag === "imei") conds.push(Prisma.sql`p."trackDevices"`);
  if (f.flag === "nfs") conds.push(Prisma.sql`p."notForSale"`);
  if (f.check === "nobarcode") conds.push(Prisma.sql`(p.barcode IS NULL OR p.barcode = '')`);
  if (f.check === "noprice") conds.push(Prisma.sql`p."sellPrice" = 0`);
  if (f.check === "belowcost" && showCost) conds.push(Prisma.sql`p."defaultCost" > 0 AND p."sellPrice" < p."defaultCost"`);
  if (f.min) conds.push(Prisma.sql`p."sellPrice" >= ${f.min}::numeric`);
  if (f.max) conds.push(Prisma.sql`p."sellPrice" <= ${f.max}::numeric`);
  if (f.stock === "unstocked") conds.push(Prisma.sql`NOT p."stockManaged"`);
  else if (f.stock && hasStock) {
    const qty = Prisma.sql`COALESCE(s.q, 0)`;
    conds.push(Prisma.sql`p."stockManaged"`);
    if (f.stock === "in") conds.push(Prisma.sql`${qty} > 0`);
    if (f.stock === "low") conds.push(Prisma.sql`${qty} > 0 AND ${qty} <= p."alertQty"`);
    if (f.stock === "out") conds.push(Prisma.sql`${qty} <= 0`);
  }

  const order: Record<string, Prisma.Sql> = {
    name: Prisma.sql`p.name ASC`,
    sku: Prisma.sql`p.sku ASC`,
    price: Prisma.sql`p."sellPrice" ASC, p.name ASC`,
    "-price": Prisma.sql`p."sellPrice" DESC, p.name ASC`,
    stock: hasStock ? Prisma.sql`p."stockManaged" DESC, COALESCE(s.q, 0) DESC, p.name ASC` : Prisma.sql`p.name ASC`,
    newest: Prisma.sql`p."createdAt" DESC`,
  };

  const stockJoin = hasStock
    ? Prisma.sql`LEFT JOIN (
        SELECT "productId", SUM("qtyRemaining") AS q FROM "CostLayer"
        WHERE "locationId" = ${locationId} AND bucket = 'SALEABLE' AND "qtyRemaining" > 0
        GROUP BY "productId"
      ) s ON s."productId" = p.id`
    : Prisma.sql`LEFT JOIN (SELECT NULL::text AS "productId", NULL::numeric AS q) s ON false`;

  const rows = await db.$queryRaw<{ id: string; q: Prisma.Decimal | null; total: bigint }[]>`
    SELECT p.id, s.q, COUNT(*) OVER() AS total
    FROM "Product" p ${stockJoin}
    WHERE ${Prisma.join(conds, " AND ")}
    ORDER BY ${order[f.sort]}, p.id ASC
    LIMIT ${pageSize + 1} OFFSET ${(page - 1) * pageSize}`;

  const pageRows = rows.slice(0, pageSize);
  const found = await db.product.findMany({ where: { id: { in: pageRows.map((r) => r.id) } }, include: productInclude });
  const byId = new Map(found.map((p) => [p.id, p]));
  return {
    products: pageRows.map((r) => byId.get(r.id)).filter((p): p is ListedProduct => !!p),
    stock: new Map(pageRows.map((r) => [r.id, D(r.q ?? 0)])),
    hasStock,
    total: rows.length ? Number(rows[0].total) : page === 1 ? 0 : null,
    hasNext: rows.length > pageSize,
  };
}
