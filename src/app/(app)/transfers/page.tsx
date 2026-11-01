import Link from "next/link";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge } from "@/components/ui";

export const metadata = { title: "Stock transfers" };

export default async function Transfers() {
  const user = await requirePermission("products.view");
  const locIds = user.locations.map((l) => l.id);
  const rows = await db.stockTransfer.findMany({
    where: { OR: [{ fromLocationId: { in: locIds } }, { toLocationId: { in: locIds } }] },
    orderBy: { dispatchedAt: "desc" }, take: 100, include: { fromLocation: true, toLocation: true, lines: true },
  });
  return (
    <div>
      <PageHead eyebrow="Stock Transfers" title="Stock transfers" actions={can(user, "stock.transfer") && <Link className="btn btn-primary" href="/transfers/new">New transfer</Link>} />
      <DataTable rows={rows} rowKey={(r) => r.id} empty="No transfers yet."
        columns={[
          { label: "Transfer", primary: true, render: (r) => <RowLink href={`/transfers/${r.id}`}>{r.number}</RowLink> },
          { label: "From → to", render: (r) => `${r.fromLocation.name} → ${r.toLocation.name}` },
          { label: "Sent", render: (r) => fmtDateTime(r.dispatchedAt) },
          { label: "Units", num: true, render: (r) => r.lines.reduce((a, l) => a.plus(l.qtySent), D(0)).toString() },
          {
            label: "State", render: (r) => {
              if (r.status === "IN_TRANSIT") return <Badge tone="warn">{r.toLocationId === user.location?.id ? "Awaiting your receipt" : "In transit"}</Badge>;
              const short = r.lines.some((l) => D(l.qtyReceived).lt(l.qtySent));
              return short ? <Badge tone="err">Received with shortfall</Badge> : <Badge tone="ok">Received</Badge>;
            },
          },
        ]} />
    </div>
  );
}
