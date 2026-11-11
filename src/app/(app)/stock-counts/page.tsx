import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { startCount } from "./actions";

export const metadata = { title: "Stock take" };

export default async function StockCounts() {
  const user = await requirePermission("products.view");
  const [counts, categories] = await Promise.all([
    db.stockCount.findMany({ where: user.location ? { locationId: user.location.id } : {}, orderBy: { createdAt: "desc" }, take: 50, include: { createdBy: true, _count: { select: { lines: true } } } }),
    db.category.findMany({ where: { active: true, parentId: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const tone = { OPEN: "warn", POSTED: "ok", CANCELLED: "muted" } as const;
  return (
    <div className="stack">
      <PageHead eyebrow={`Stock / ${user.location?.name ?? ""}`} title="Stock take" />
      {can(user, "stock.count") && (
        <ActionForm action={startCount} className="panel row">
          <label className="field"><span>Count</span><select name="categoryId" defaultValue=""><option value="">Everything at this location</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name} only</option>)}</select></label>
          <label className="field" style={{ flex: 1 }}><span>Note</span><input name="notes" placeholder="Month-end count, showcase 2…" /></label>
          <label className="check"><input type="checkbox" name="includeZero" /> Include items showing zero</label>
          <SubmitButton pendingText="Opening…">Open a count sheet</SubmitButton>
        </ActionForm>
      )}
      <p className="small muted" style={{ margin: 0 }}>
        Opening a sheet freezes what the system expects. Count by scanning (barcode or IMEI) or by typing, review the differences, then post — one stock adjustment is made.
        Best done while the shop is closed. Stock held for inspection or supplier return is not part of a count.
      </p>
      <DataTable rows={counts} rowKey={(c) => c.id} empty="No stock takes yet."
        columns={[
          { label: "Sheet", primary: true, render: (c) => <RowLink href={`/stock-counts/${c.id}`}>{c.number}</RowLink> },
          { label: "Opened", render: (c) => fmtDateTime(c.createdAt) },
          { label: "Scope", render: (c) => c.scope ?? "Everything" },
          { label: "Lines", num: true, render: (c) => c._count.lines },
          { label: "By", render: (c) => c.createdBy.fullName },
          { label: "Status", render: (c) => <Badge tone={tone[c.status as keyof typeof tone] ?? "muted"}>{c.status.toLowerCase()}</Badge> },
        ]} />
    </div>
  );
}
