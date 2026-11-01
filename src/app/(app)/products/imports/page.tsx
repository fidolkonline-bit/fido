import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/money";
import { TEMPLATES } from "@/lib/imports";
import { PageHead, DataTable, RowLink, Badge } from "@/components/ui";
import { ImportUpload } from "./ImportUpload";

export const metadata = { title: "Imports & opening stock" };

export default async function Imports() {
  await requirePermission("imports.run");
  const batches = await db.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { createdBy: true } });
  return (
    <div className="stack">
      <PageHead eyebrow="Products" title="Imports & opening stock" />
      <ImportUpload templates={{ ...TEMPLATES }} />
      <DataTable rows={batches} rowKey={(b) => b.id} empty="No imports yet."
        columns={[
          { label: "File", primary: true, render: (b) => <RowLink href={`/products/imports/${b.id}`}>{b.fileName}</RowLink> },
          { label: "Type", render: (b) => (b.kind === "PRODUCTS" ? "Products" : "Opening stock") },
          { label: "Checked", render: (b) => `${fmtDateTime(b.createdAt)} · ${b.createdBy.fullName}` },
          { label: "Rows", render: (b) => { const s = b.summary as { ok: number; errors: number; skipped: number } | null; return s ? `${s.ok} ok · ${s.errors} errors · ${s.skipped} skipped` : "—"; } },
          { label: "State", render: (b) => <Badge tone={b.status === "COMMITTED" ? "ok" : b.status === "DRY_RUN" ? "warn" : "muted"}>{b.status === "DRY_RUN" ? "Awaiting review" : b.status.toLowerCase()}</Badge> },
        ]} />
    </div>
  );
}
