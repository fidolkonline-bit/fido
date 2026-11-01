import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDate, fmtDateTime } from "@/lib/money";
import { generateSubscriptions } from "@/lib/drafts";
import { PageHead, DataTable, RowLink, Badge, Tabs } from "@/components/ui";
import { cancelDraftForm } from "./actions";

export const metadata = { title: "Quotes & drafts" };
const KIND: Record<string, string> = { QUOTE: "Quote", SUSPENDED: "Suspended sale", SUBSCRIPTION: "Subscription invoice" };

export default async function Drafts({ searchParams }: { searchParams: Promise<{ kind?: string; all?: string }> }) {
  const user = await requirePermission("sales.view");
  await generateSubscriptions(); // also run by the server job; idempotent per period
  const { kind = "SUSPENDED", all } = await searchParams;
  const drafts = await db.saleDraft.findMany({
    where: { kind, ...(user.location ? { locationId: user.location.id } : {}), ...(all ? {} : { status: "OPEN" }) },
    orderBy: { createdAt: "desc" }, take: 100, include: { customer: true, createdBy: true },
  });
  const today = new Date();
  return (
    <div>
      <PageHead eyebrow="Sell" title="Quotes, suspended sales & subscription invoices" actions={<Link className="btn btn-primary" href="/pos">POS</Link>} />
      <Tabs items={["SUSPENDED", "QUOTE", "SUBSCRIPTION"].map((k) => ({ label: KIND[k] + "s", href: `/sales/drafts?kind=${k}`, active: kind === k }))} />
      <div className="toolbar"><a className="small" href={`?kind=${kind}${all ? "" : "&all=1"}`}>{all ? "Show open only" : "Include converted / cancelled"}</a></div>
      <DataTable rows={drafts} rowKey={(d) => d.id} empty="Nothing here."
        columns={[
          { label: "Number", primary: true, render: (d) => <RowLink href={`/sales/drafts/${d.id}`}>{d.number}</RowLink> },
          { label: "Customer", render: (d) => d.customer?.name ?? "Walk-in" },
          { label: "Created", render: (d) => `${fmtDateTime(d.createdAt)} · ${d.createdBy.fullName}` },
          ...(kind === "QUOTE" ? [{ label: "Valid until", render: (d: (typeof drafts)[number]) => <span style={{ color: d.validUntil && d.validUntil < today ? "var(--err)" : undefined }}>{fmtDate(d.validUntil)}</span> }] : []),
          { label: "Total", num: true, render: (d) => money(d.total) },
          { label: "", render: (d) => d.status === "OPEN" ? (
            <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
              <Link className="btn btn-sm btn-primary" href={`/pos?draft=${d.id}`}>{d.kind === "SUSPENDED" ? "Resume" : "Sell"}</Link>
              <form action={cancelDraftForm}><input type="hidden" name="id" value={d.id} /><button className="btn btn-sm">Cancel</button></form>
            </div>
          ) : <Badge tone={d.status === "CONVERTED" ? "ok" : "muted"}>{d.status.toLowerCase()}</Badge> },
        ]} />
    </div>
  );
}
