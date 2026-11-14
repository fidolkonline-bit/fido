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

export default async function Categories({ searchParams }: { searchParams: Promise<{ edit?: string; q?: string; status?: string }> }) {
  await requirePermission("products.manage");
  const { edit, q = "", status = "active" } = await searchParams;
  const all = await db.category.findMany({
    orderBy: [{ name: "asc" }],
    include: { parent: true, _count: { select: { products: true, children: true } }, children: { where: { active: true }, select: { id: true } } },
  });
  const editing = all.find((c) => c.id === edit);
  const label = (c: (typeof all)[number]) => (c.parent ? `${c.parent.name} › ${c.name}` : c.name);
  // Every word must appear in "Parent › Child", so "phone case" finds "Phones › Cases" and searching a parent lists its subcategories.
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const cats = all
    .filter((c) => (status === "all" ? true : status === "inactive" ? !c.active : c.active))
    .filter((c) => words.every((w) => label(c).toLowerCase().includes(w)))
    .sort((a, b) => label(a).localeCompare(label(b)));
  const parents = all.filter((c) => !c.parentId && c.id !== editing?.id && (c.active || c.id === editing?.parentId));
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
      <form className="toolbar" role="search">
        <input name="q" defaultValue={q} placeholder="Search categories" aria-label="Search categories" />
        <select name="status" defaultValue={status} aria-label="Status">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
        <button className="btn">Filter</button>
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
          { label: "Check", render: (c) => { const t = D(c.userShare).plus(c.agentShare); return t.gt(0) && !t.eq(1) ? <Badge tone="warn">Shares {pct(t)}</Badge> : null; } },
          { label: "Products", num: true, render: (c) => c._count.products },
          { label: "", render: (c) => (
            <div className="row" style={{ gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
              <Link className="small" href={`?${new URLSearchParams({ ...(q && { q }), ...(status !== "active" && { status }), edit: c.id })}`}>Edit</Link>
              <RowActions id={c.id} name={label(c)} active={c.active} subs={c.children.length} deletable={!c._count.products && !c._count.children} />
            </div>
          ) },
        ]}
      />
    </div>
  );
}
