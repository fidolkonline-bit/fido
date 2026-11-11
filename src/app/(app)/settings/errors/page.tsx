import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, Pager, PAGE_SIZE, pageOf } from "@/components/ui";

export const metadata = { title: "Error log" };

export default async function Errors({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requirePermission("settings.manage");
  const page = pageOf((await searchParams).page);
  const found = await db.errorLog.findMany({ orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1 });
  const rows = found.slice(0, PAGE_SIZE);
  return (
    <div className="stack">
      <PageHead eyebrow="Settings" title="Error log" />
      <p className="small muted" style={{ margin: 0 }}>Server errors staff ran into, newest first. The reference shown on an error screen matches the Ref column. Entries older than 90 days are removed.</p>
      <DataTable rows={rows} rowKey={(e) => e.id} empty="No errors recorded."
        columns={[
          { label: "When", render: (e) => fmtDateTime(e.createdAt) },
          { label: "Where", primary: true, render: (e) => <>{e.method} {e.path}<br /><span className="small muted">{e.kind} · {e.route}</span></> },
          { label: "Error", render: (e) => <details><summary>{e.message.slice(0, 160)}</summary><pre className="small" style={{ whiteSpace: "pre-wrap", maxWidth: 640 }}>{e.stack ?? e.message}</pre></details> },
          { label: "Ref", render: (e) => e.digest ?? "—" },
        ]} />
      <Pager page={page} hasNext={found.length > PAGE_SIZE} query={{}} shown={rows.length} noun="errors" />
    </div>
  );
}
