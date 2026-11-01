import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, fmtDateTime } from "@/lib/money";
import { SHIP_FLOW } from "@/lib/shipments";
import { PageHead, DataTable, Badge, Tabs } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { shipmentStatusForm, codForm } from "../../payment-actions";

export const metadata = { title: "Shipments" };

export default async function Shipments({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePermission("sales.view");
  const { tab = "open" } = await searchParams;
  const [ships, accounts] = await Promise.all([
    db.shipment.findMany({ where: tab === "open" ? { status: { in: ["PENDING", "PACKED", "DISPATCHED"] } } : tab === "cod" ? { status: "DELIVERED" } : {}, orderBy: { createdAt: "desc" }, take: 150, include: { sale: { include: { customer: true } } } }),
    db.account.findMany({ where: { active: true, type: { in: ["BANK", "CASH"] } }, select: { id: true, name: true } }),
  ]);
  const rows = tab === "cod" ? ships.filter((s) => D(s.codAmount).gt(s.codRemitted)) : ships;
  return (
    <div>
      <PageHead eyebrow="Sell" title="Shipments" />
      <Tabs items={[{ label: "To deliver", href: "/sales/shipments", active: tab === "open" }, { label: "COD not yet received", href: "/sales/shipments?tab=cod", active: tab === "cod" }, { label: "All", href: "/sales/shipments?tab=all", active: tab === "all" }]} />
      <p className="small muted">Create a shipment from the sale page. Delivering a parcel does not mark it paid — record the courier&apos;s COD remittance when the money arrives.</p>
      <DataTable rows={rows} rowKey={(s) => s.id} empty="Nothing here."
        columns={[
          { label: "Sale", primary: true, render: (s) => <Link href={`/sales/${s.saleId}`}>{s.sale.number}</Link> },
          { label: "To", render: (s) => <>{s.contactName ?? s.sale.customer?.name ?? ""}<br /><span className="small muted">{s.address}</span></> },
          { label: "Courier", render: (s) => [s.carrier, s.trackingRef].filter(Boolean).join(" · ") || "—" },
          { label: "COD", num: true, render: (s) => (D(s.codAmount).gt(0) ? `${money(s.codRemitted)} / ${money(s.codAmount)}` : "—") },
          { label: "Status", render: (s) => <><Badge tone={s.status === "DELIVERED" ? "ok" : ["RETURNED", "CANCELLED"].includes(s.status) ? "muted" : "warn"}>{s.status.toLowerCase()}</Badge><div className="small muted">{fmtDateTime(s.updatedAt)}</div></> },
          {
            label: "", render: (s) => (
              <div className="stack" style={{ gap: 6 }}>
                {SHIP_FLOW[s.status].length > 0 && (
                  <form action={shipmentStatusForm} className="row" style={{ gap: 4 }}>
                    <input type="hidden" name="id" value={s.id} /><input type="hidden" name="saleId" value={s.saleId} />
                    {SHIP_FLOW[s.status].includes("DELIVERED") && <input name="deliveredTo" placeholder="Received by" style={{ width: 120, minHeight: 32 }} />}
                    {SHIP_FLOW[s.status].map((n) => <button key={n} className={"btn btn-sm" + (n === "DELIVERED" || n === "DISPATCHED" ? " btn-primary" : "")} name="status" value={n}>{n.toLowerCase()}</button>)}
                  </form>
                )}
                {s.status === "DELIVERED" && D(s.codAmount).gt(s.codRemitted) && (
                  <ActionForm action={codForm} className="row" style={{ gap: 4 }}>
                    <input type="hidden" name="id" value={s.id} />
                    <input name="amount" defaultValue={D(s.codAmount).minus(s.codRemitted).toFixed(2)} style={{ width: 100, minHeight: 32 }} inputMode="decimal" aria-label="COD amount" />
                    <select name="method" style={{ width: 110, minHeight: 32 }}><option value="BANK_TRANSFER">Bank</option><option value="CASH">Cash</option></select>
                    <select name="accountId" style={{ width: 130, minHeight: 32 }}><option value="">Default</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                    <SubmitButton className="btn btn-sm">COD received</SubmitButton>
                  </ActionForm>
                )}
              </div>
            ),
          },
        ]} />
    </div>
  );
}
