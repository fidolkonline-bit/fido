import { Prisma } from "@prisma/client";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { D } from "@/lib/money";
import { PageHead, DataTable, Badge } from "@/components/ui";
import { CategoryForm } from "./CategoryForm";
import { RowActions } from "./RowActions";

export const metadata = { title: "Categories & commission" };

const pct = (v: Prisma.Decimal.Value, scale = 100) => `${D(v).mul(scale).toDecimalPlaces(3).toString()}%`;

type Search = { edit?: string; q?: string; status?: string; setup?: string; level?: string; parent?: string; products?: string; sort?: string };

export default async function Categories({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePermission("products.manage");
  const { edit, q = "", status = "active", setup = "", level = "", parent = "", products = "", sort = "name" } = await searchParams;
  const all = await db.category.findMany({
    orderBy: [{ name: "asc" }],
    include: { parent: true, _count: { select: { products: true, children: true } }, children: { where: { active: true }, select: { id: true } } },
  });
  const editing = all.find((c) => c.id === edit);
  const label = (c: (typeof all)[number]) => (c.parent ? `${c.parent.name} › ${c.name}` : c.name);
  const sharesTotal = (c: (typeof all)[number]) => D(c.userShare).plus(c.agentShare);
  const setupMatch: Record<string, (c: (typeof all)[number]) => boolean> = {
    mismatch: (c) => { const t = sharesTotal(c); return t.gt(0) && !t.eq(1); },
    none: (c) => D(c.poolRate).lte(0) || sharesTotal(c).lte(0),
    user: (c) => D(c.poolRate).gt(0) && D(c.userShare).gt(0) && D(c.agentShare).lte(0),
    agent: (c) => D(c.poolRate).gt(0) && D(c.agentShare).gt(0) && D(c.userShare).lte(0),
    both: (c) => D(c.poolRate).gt(0) && D(c.userShare).gt(0) && D(c.agentShare).gt(0),
  };
  // Every word must appear in "Parent › Child", so "phone case" finds "Phones › Cases" and searching a parent lists its subcategories.
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const cats = all
    .filter((c) => (status === "all" ? true : status === "inactive" ? !c.active : c.active))
    .filter((c) => words.every((w) => label(c).toLowerCase().includes(w)))
    .filter((c) => !setupMatch[setup] || setupMatch[setup](c))
    .filter((c) => (level === "top" ? !c.parentId : level === "sub" ? !!c.parentId : true))
    // A chosen parent shows the parent itself plus its subcategories.
    .filter((c) => !parent || c.id === parent || c.parentId === parent)
    .filter((c) => (products === "has" ? c._count.products > 0 : products === "empty" ? c._count.products === 0 : true))
    .sort((a, b) =>
      sort === "pool" ? D(b.poolRate).comparedTo(a.poolRate) || label(a).localeCompare(label(b))
      : sort === "products" ? b._count.products - a._count.products || label(a).localeCompare(label(b))
      : label(a).localeCompare(label(b)));
  const parents = all.filter((c) => !c.parentId && c.id !== editing?.id && (c.active || c.id === editing?.parentId));
  const topLevel = all.filter((c) => !c.parentId);
  const filters = { q, status: status !== "active" ? status : "", setup, level, parent, products, sort: sort !== "name" ? sort : "" };
  const keep = Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as Record<string, string>;
  const filtered = Object.keys(keep).some((k) => k !== "sort");
  return (
    <div className="stack">
      <PageHead eyebrow="Products" title="Categories & commission" />
      <CategoryForm
        parents={parents.map((c) => ({ id: c.id, name: c.active ? c.name : `${c.name} (inactive)` }))}
        edit={editing && {
          id: editing.id, name: editing.name, parentId: editing.parentId,
          poolRate: D(editing.poolRate).mul(100).toString(), userShare: D(editing.userShare).mul(100).toString(), agentShare: D(editing.agentShare).mul(100).toString(),
        }}
      />
      <form className="toolbar dense" role="search">
        <input name="q" defaultValue={q} placeholder="Search categories" aria-label="Search categories" />
        <select name="status" defaultValue={status} aria-label="Status">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All statuses</option>
        </select>
        <select name="setup" defaultValue={setup} aria-label="Commission setup">
          <option value="">Any commission</option>
          <option value="mismatch">Shares don&apos;t add up</option>
          <option value="none">No commission</option>
          <option value="user">User only</option>
          <option value="agent">Agent only</option>
          <option value="both">User and agent</option>
        </select>
        <select name="level" defaultValue={level} aria-label="Level">
          <option value="">All levels</option>
          <option value="top">Top-level only</option>
          <option value="sub">Subcategories only</option>
        </select>
        <select name="parent" defaultValue={parent} aria-label="Parent category">
          <option value="">Any parent</option>
          {topLevel.map((c) => <option key={c.id} value={c.id}>{c.active ? c.name : `${c.name} (inactive)`}</option>)}
        </select>
        <select name="products" defaultValue={products} aria-label="Products">
          <option value="">Any products</option>
          <option value="has">Has products</option>
          <option value="empty">No products</option>
        </select>
        <select name="sort" defaultValue={sort} aria-label="Sort">
          <option value="name">Sort: name</option>
          <option value="pool">Sort: pool rate (high first)</option>
          <option value="products">Sort: product count</option>
        </select>
        <button className="btn">Filter</button>
        {filtered && <Link className="small" href="?">Clear</Link>}
        <span className="small muted">{cats.length} of {all.length}</span>
      </form>
      <DataTable
        rows={cats}
        rowKey={(c) => c.id}
        empty={all.length ? "No categories match these filters." : "No categories yet."}
        columns={[
          { label: "Category", primary: true, render: (c) => <>{label(c)}{!c.active && <> <Badge tone="muted">Inactive</Badge></>}</> },
          { label: "Pool", num: true, render: (c) => pct(c.poolRate) },
          { label: "User share", num: true, render: (c) => pct(c.userShare) },
          { label: "Agent share", num: true, render: (c) => pct(c.agentShare) },
          { label: "Effective user / agent", num: true, render: (c) => `${pct(D(c.poolRate).mul(c.userShare))} / ${pct(D(c.poolRate).mul(c.agentShare))}` },
          { label: "Check", render: (c) => { const t = sharesTotal(c); return t.gt(0) && !t.eq(1) ? <Badge tone="warn">Shares {pct(t)}</Badge> : null; } },
          { label: "Products", num: true, render: (c) => c._count.products },
          { label: "", render: (c) => (
            <div className="row" style={{ gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
              <Link className="small" href={`?${new URLSearchParams({ ...keep, edit: c.id })}`}>Edit</Link>
              <RowActions id={c.id} name={label(c)} active={c.active} subs={c.children.length} deletable={!c._count.products && !c._count.children} />
            </div>
          ) },
        ]}
      />
    </div>
  );
}
