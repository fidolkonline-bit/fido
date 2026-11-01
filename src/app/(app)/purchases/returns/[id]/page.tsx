import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, qty, fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge } from "@/components/ui";
import { SettleForm } from "../SettleForm";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const c = await db.supplierClaim.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: c?.number ?? "Not found" };
}

export default async function ClaimDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("purchases.view");
  const c = await db.supplierClaim.findUnique({
    where: { id: (await params).id },
    include: { supplier: true, location: true, createdBy: true, lines: { include: { product: true } }, payments: true },
  });
  if (!c) notFound();
  const devices = await db.deviceIdentity.findMany({ where: { id: { in: c.lines.map((l) => l.deviceId).filter((x): x is string => !!x) } } });
  const dev = (id: string | null) => devices.find((d) => d.id === id);
  const accounts = c.status === "SENT" ? await db.account.findMany({ where: { active: true, type: { in: ["BANK", "CASH"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];

  return (
    <div className="stack">
      <PageHead eyebrow={`Purchases / Supplier returns / ${c.location.name}`} title={c.number} actions={<Badge tone={c.status === "SETTLED" ? "ok" : "warn"}>{c.status === "SENT" ? "Awaiting supplier" : "Settled"}</Badge>} />
      <div className="grid3 small">
        <div><span className="muted">Supplier</span><br /><RowLink href={`/contacts/${c.supplierId}`}>{c.supplier.name}</RowLink></div>
        <div><span className="muted">Sent</span><br />{fmtDateTime(c.sentAt)} · {c.createdBy.fullName}</div>
        <div><span className="muted">Reason</span><br />{c.reason ?? "—"}</div>
      </div>
      {c.notes && <p className="note">{c.notes}</p>}
      <DataTable rows={c.lines} rowKey={(l) => l.id}
        columns={[
          { label: "Product", primary: true, render: (l) => <RowLink href={`/products/${l.productId}`}>{l.product.name}{l.deviceId ? ` · IMEI ${dev(l.deviceId)?.imei1 ?? dev(l.deviceId)?.serial}` : ""}</RowLink> },
          { label: "Lot / from", render: (l) => `${l.lotCode ?? "—"} · ${l.fromBucket.toLowerCase().replace("_", " ")}` },
          { label: "Sent", num: true, render: (l) => qty(l.qty) },
          { label: "Unit cost", num: true, render: (l) => money(l.unitCost) },
          ...(c.status === "SETTLED" ? [
            { label: "Replaced", num: true, render: (l: (typeof c.lines)[number]) => qty(l.qtyReplaced) },
            { label: "Rejected", num: true, render: (l: (typeof c.lines)[number]) => (D(l.qtyRejected).gt(0) ? `${qty(l.qtyRejected)} → ${l.rejectedTo === "WRITTEN_OFF" ? "written off" : "hold"}` : "—") },
          ] : []),
        ]} />
      {c.status === "SETTLED" ? (
        <section className="panel" style={{ maxWidth: 480, marginLeft: "auto", width: "100%" }}>
          <div className="totalrow"><span>Original cost sent</span><strong>{money(c.claimValue)}</strong></div>
          <div className="totalrow"><span>Supplier credit</span><strong>{money(c.creditAmount)}</strong></div>
          <div className="totalrow"><span>Refund received</span><strong>{money(c.refundAmount)}</strong></div>
          <div className="totalrow"><span>Replacements (at cost)</span><strong>{money(c.replacedValue)}</strong></div>
          <div className="totalrow grand"><span>Loss</span><strong style={{ color: c.lossValue.gt(0) ? "var(--err)" : undefined }}>{money(c.lossValue)}</strong></div>
          <p className="small muted">Settled {fmtDateTime(c.settledAt)}</p>
        </section>
      ) : can(user, "purchases.claims") ? (
        <SettleForm claimId={c.id} claimValue={Number(c.claimValue)} accounts={accounts}
          lines={c.lines.map((l) => ({ id: l.id, name: l.product.name, lot: l.lotCode, qty: Number(l.qty), unitCost: Number(l.unitCost), device: l.deviceId ? dev(l.deviceId)?.imei1 ?? dev(l.deviceId)?.serial ?? null : null }))} />
      ) : null}
    </div>
  );
}
