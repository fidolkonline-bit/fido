import { Prisma } from "@prisma/client";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { D } from "@/lib/money";
import { PageHead, DataTable, Badge } from "@/components/ui";
import { CategoryForm } from "./CategoryForm";

export const metadata = { title: "Categories & commission" };

const pct = (v: Prisma.Decimal.Value, scale = 100) => `${D(v).mul(scale).toDecimalPlaces(3).toString()}%`;

export default async function Categories({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  await requirePermission("products.manage");
  const { edit } = await searchParams;
  const cats = await db.category.findMany({ orderBy: [{ name: "asc" }], include: { parent: true, _count: { select: { products: true } } } });
  const editing = cats.find((c) => c.id === edit);
  return (
    <div className="stack">
      <PageHead eyebrow="Products" title="Categories & commission" />
      <CategoryForm
        parents={cats.filter((c) => !c.parentId).map((c) => ({ id: c.id, name: c.name }))}
        edit={editing && {
          id: editing.id, name: editing.name, parentId: editing.parentId,
          poolRate: D(editing.poolRate).mul(100).toString(), userShare: D(editing.userShare).mul(100).toString(), agentShare: D(editing.agentShare).mul(100).toString(),
        }}
      />
      <DataTable
        rows={cats}
        rowKey={(c) => c.id}
        empty="No categories yet."
        columns={[
          { label: "Category", primary: true, render: (c) => (c.parent ? `${c.parent.name} › ${c.name}` : c.name) },
          { label: "Pool", num: true, render: (c) => pct(c.poolRate) },
          { label: "User share", num: true, render: (c) => pct(c.userShare) },
          { label: "Agent share", num: true, render: (c) => pct(c.agentShare) },
          { label: "Effective user / agent", num: true, render: (c) => `${pct(D(c.poolRate).mul(c.userShare))} / ${pct(D(c.poolRate).mul(c.agentShare))}` },
          { label: "Check", render: (c) => { const t = D(c.userShare).plus(c.agentShare); return t.gt(0) && !t.eq(1) ? <Badge tone="warn">Shares {pct(t)}</Badge> : null; } },
          { label: "Products", num: true, render: (c) => c._count.products },
          { label: "", render: (c) => <Link className="small" href={`?edit=${c.id}`}>Edit</Link> },
        ]}
      />
    </div>
  );
}
