import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, Badge, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { commitImport, discardImport } from "../actions";

export const metadata = { title: "Import review" };

type Row = { line: number; status: string; action?: string; message?: string; data?: Record<string, unknown> };

export default async function ImportReview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ show?: string }> }) {
  await requirePermission("imports.run");
  const b = await db.importBatch.findUnique({ where: { id: (await params).id }, include: { createdBy: true } });
  if (!b) notFound();
  const { show = "problems" } = await searchParams;
  const rows = b.rows as unknown as Row[];
  const s = b.summary as { total: number; ok: number; errors: number; skipped: number; notes?: string[] };
  const shown = show === "all" ? rows : rows.filter((r) => r.status !== "OK" || r.message);
  const label = (r: Row) => String(r.data?.sku ?? r.data?.code ?? r.data?.legacy_id ?? "") + (r.data?.name ? ` · ${r.data.name}` : "") + (r.data?.imei ? ` · IMEI ${r.data.imei}` : "") + (r.data?.qty ? ` · qty ${r.data.qty}` : "") + (r.data?.location ? ` · ${r.data.location}` : "") + (r.data?.opening_balance && Number(r.data.opening_balance) ? ` · balance ${r.data.opening_balance}` : "");

  return (
    <div className="stack">
      <PageHead eyebrow={`Products / Imports / ${({ PRODUCTS: "Products", OPENING_STOCK: "Opening stock", CONTACTS: "Contacts", CATEGORIES: "Categories", PEOPLE: "People" } as Record<string, string>)[b.kind]}`} title={b.fileName}
        actions={<Badge tone={b.status === "COMMITTED" ? "ok" : b.status === "DRY_RUN" ? "warn" : "muted"}>{b.status === "DRY_RUN" ? "Dry run — nothing saved yet" : b.status.toLowerCase()}</Badge>} />
      <div className="stats">
        <Stat label="Rows in file" value={s.total} basis={`Checked ${fmtDateTime(b.createdAt)}`} />
        <Stat label="Will import" value={s.ok} basis={b.kind === "OPENING_STOCK" ? "Added at cost per lot" : `Existing ${b.kind === "PRODUCTS" ? "SKUs" : "codes"}: ${(b.summary as { existing: string }).existing === "UPDATE" ? "update" : "skip"}`} />
        <Stat label="Errors" value={<span style={{ color: s.errors ? "var(--err)" : undefined }}>{s.errors}</span>} basis="Not imported — fix and re-upload" />
        <Stat label="Skipped" value={s.skipped} basis="Already exist" />
      </div>
      {!!s.notes?.length && (
        <section className="panel stack"><h2 style={{ margin: 0 }}>Findings in the file</h2>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{s.notes.map((n, i) => <li key={i} style={{ overflowWrap: "anywhere" }}>{n}</li>)}</ul>
        </section>
      )}
      {b.status === "DRY_RUN" && (
        <div className="row">
          <form action={commitImport}><input type="hidden" name="batchId" value={b.id} /><SubmitButton pendingText="Importing…">{`Import ${s.ok} valid row${s.ok === 1 ? "" : "s"}`}</SubmitButton></form>
          <form action={discardImport}><input type="hidden" name="batchId" value={b.id} /><button className="btn">Discard</button></form>
          {s.errors > 0 && <span className="small muted">Rows with errors are left out. You can fix them and upload just those rows again.</span>}
        </div>
      )}
      {b.status === "COMMITTED" && <p className="note note-ok">Imported {fmtDateTime(b.committedAt)}. Opening stock appears in lots and the stock ledger with this file as its source.</p>}
      <div className="tabs">
        <a href="?show=problems" aria-current={show !== "all" ? "page" : undefined}>To review ({rows.filter((r) => r.status !== "OK" || r.message).length})</a>
        <a href="?show=all" aria-current={show === "all" ? "page" : undefined}>All rows ({s.total})</a>
      </div>
      <DataTable rows={shown.slice(0, 500)} rowKey={(r) => String(r.line)} empty="Nothing to review — every row is valid."
        columns={[
          { label: "Line", primary: true, render: (r) => `Row ${r.line}` },
          { label: "Result", render: (r) => <Badge tone={r.status === "OK" ? (r.message ? "warn" : "ok") : r.status === "ERROR" ? "err" : "muted"}>{r.status === "OK" ? r.action : r.status.toLowerCase()}</Badge> },
          { label: "Row", render: (r) => label(r) || "—" },
          { label: "Problem", render: (r) => r.message ?? "" },
        ]} />
      {shown.length > 500 && <p className="small muted">Showing the first 500 rows.</p>}
    </div>
  );
}
