import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, qty, fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge } from "@/components/ui";
import { ReceiveTransferForm } from "../ReceiveTransferForm";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const r = await db.stockTransfer.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: r?.number ?? "Not found" };
}

export default async function TransferDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("products.view");
  const t = await db.stockTransfer.findUnique({
    where: { id: (await params).id },
    include: { fromLocation: true, toLocation: true, createdBy: true, receivedBy: true, lines: { include: { product: true } } },
  });
  if (!t) notFound();
  const devices = await db.deviceIdentity.findMany({ where: { id: { in: t.lines.map((l) => l.deviceId).filter((x): x is string => !!x) } } });
  const label = (id: string | null) => { const d = devices.find((x) => x.id === id); return d ? ` · IMEI ${d.imei1 ?? d.serial}` : ""; };
  const showCost = can(user, "cost.view");
  const canReceive = t.status === "IN_TRANSIT" && can(user, "stock.transfer") && user.location?.id === t.toLocationId;

  return (
    <div className="stack">
      <PageHead eyebrow="Stock Transfers" title={t.number} actions={t.status === "IN_TRANSIT" ? <Badge tone="warn">In transit</Badge> : <Badge tone="ok">Received</Badge>} />
      <div className="grid3 small">
        <div><span className="muted">From → to</span><br />{t.fromLocation.name} → {t.toLocation.name}</div>
        <div><span className="muted">Sent</span><br />{fmtDateTime(t.dispatchedAt)} · {t.createdBy.fullName}</div>
        <div><span className="muted">Received</span><br />{t.receivedAt ? `${fmtDateTime(t.receivedAt)} · ${t.receivedBy?.fullName}` : "Not yet"}</div>
      </div>
      {t.notes && <p className="note">{t.notes}</p>}
      <DataTable rows={t.lines} rowKey={(l) => l.id}
        columns={[
          { label: "Product", primary: true, render: (l) => <RowLink href={`/products/${l.productId}`}>{l.product.name}{label(l.deviceId)}</RowLink> },
          { label: "Lot", render: (l) => l.lotCode ?? "—" },
          { label: "Sent", num: true, render: (l) => qty(l.qtySent) },
          { label: "Received", num: true, render: (l) => (l.qtyReceived == null ? "—" : <span style={{ color: D(l.qtyReceived).lt(l.qtySent) ? "var(--err)" : undefined }}>{qty(l.qtyReceived)}</span>) },
          ...(showCost ? [{ label: "Unit cost", num: true, render: (l: (typeof t.lines)[number]) => money(l.unitCost) }] : []),
        ]} />
      {canReceive && <ReceiveTransferForm transferId={t.id} lines={t.lines.map((l) => ({ id: l.id, name: l.product.name + label(l.deviceId), lot: l.lotCode, sent: Number(l.qtySent), tracked: !!l.deviceId }))} />}
      {t.status === "IN_TRANSIT" && !canReceive && <p className="small muted">Switch to {t.toLocation.name} to receive this transfer.</p>}
    </div>
  );
}
