import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, fmtDateTime } from "@/lib/money";
import { Barcode } from "@/components/Barcode";
import { PrintOnLoad } from "../../../sales/[id]/PrintOnLoad";

export const metadata = { title: "Repair print" };

// Job sticker: readable job number, device, short issue and a barcode of the job number only — never the PIN (§12).
export default async function Sticker({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ bill?: string; phone?: string }> }) {
  await requirePermission("repairs.view");
  const job = await db.repairJob.findUnique({ where: { id: (await params).id }, include: { customer: true, location: { include: { business: true } }, parts: { include: { product: true } } } });
  if (!job) notFound();
  const { bill, phone } = await searchParams;
  const device = [job.deviceBrand, job.deviceModel].filter(Boolean).join(" ");

  if (!bill) {
    return (
      <div className="stack">
        <div className="row no-print">
          <PrintOnLoad enabled={false} label="Print sticker" />
          <a className="btn" href={phone ? "?" : "?phone=1"}>{phone ? "Hide" : "Show"} customer mobile</a>
          <span className="small muted">Sized for a 50 × 30 mm sticker.</span>
        </div>
        <style>{"@page { size: 50mm 30mm; margin: 0; }"}</style>
        <div className="label" style={{ width: "50mm", height: "30mm" }}>
          <div className="l-name">{job.number}</div>
          <Barcode value={job.number} height={34} showText={false} />
          <div className="l-meta" style={{ fontWeight: 600 }}>{device}</div>
          <div className="l-meta">{job.problem.slice(0, 40)}{phone && job.customer.phone ? ` · ${job.customer.phone}` : ""}</div>
        </div>
      </div>
    );
  }

  const due = D(job.total).minus(job.paid);
  return (
    <div className="stack">
      <div className="no-print"><PrintOnLoad enabled={false} label="Print bill" /></div>
      <style>{"@page { size: 80mm auto; margin: 0; }"}</style>
      <div className="doc paper-80mm">
        <div className="doc-top">
          <div><h3>{job.location.business.name.toUpperCase()}</h3><div className="small">{job.location.name}</div></div>
          <div className="small" style={{ textAlign: "right" }}><strong>REPAIR</strong><br />{job.number}<br />{fmtDateTime(job.createdAt)}</div>
        </div>
        <div className="small" style={{ marginBottom: 8 }}>Customer: {job.customer.name}<br />Device: {device}{job.imei ? ` · ${job.imei}` : ""}<br />Issue: {job.problem}</div>
        {D(job.labourCharge).gt(0) && <div className="totalrow"><span>Labour</span><strong>{money(job.labourCharge)}</strong></div>}
        {job.parts.filter((p) => D(p.qtyIssued).gt(p.qtyReturned)).map((p) => (
          <div key={p.id} className="totalrow"><span>{p.product.name} × {D(p.qtyIssued).minus(p.qtyReturned).toString()}</span><strong>{money(D(p.qtyIssued).minus(p.qtyReturned).mul(p.unitPrice))}</strong></div>
        ))}
        {D(job.otherCharge).gt(0) && <div className="totalrow"><span>Other</span><strong>{money(job.otherCharge)}</strong></div>}
        {D(job.discount).gt(0) && <div className="totalrow"><span>Discount</span><strong>−{money(job.discount)}</strong></div>}
        <div className="totalrow grand"><span>Total</span><strong>Rs. {money(job.total)}</strong></div>
        <div className="totalrow"><span>Paid</span><strong>{money(job.paid)}</strong></div>
        {due.gt(0) && <div className="totalrow"><span>Balance due</span><strong>{money(due)}</strong></div>}
        {job.warrantyDays ? <p className="small">Repair warranty: {job.warrantyDays} days from collection.</p> : null}
        <div style={{ textAlign: "center", marginTop: 8 }}><Barcode value={job.number} height={30} /></div>
      </div>
    </div>
  );
}
