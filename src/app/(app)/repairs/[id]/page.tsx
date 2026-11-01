import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, qty, fmtDateTime } from "@/lib/money";
import { REPAIR_STATUS, isOpen } from "@/lib/repairs";
import { PageHead, DataTable, Badge, RowLink } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { StatusButtons, DiagnosisForm, ChargesForm, PaymentForm, IssuePart, CredentialReveal } from "../JobPanels";
import { doApprove, doReturnPart, doPurge } from "../actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const j = await db.repairJob.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: j?.number ?? "Not found" };
}

const toLocalInput = (d: Date | null) => (d ? new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 16) : "");
const EVENT: Record<string, string> = {
  STATUS: "Status", NOTE: "Note", ESTIMATE: "Diagnosis / estimate", APPROVAL: "Customer approval", PART_ISSUED: "Part issued", PART_RETURNED: "Part returned",
  CREDENTIAL_VIEWED: "Unlock code viewed", CREDENTIAL_PURGED: "Unlock code deleted", PAYMENT: "Payment", CHARGES: "Bill updated",
};

export default async function RepairJob({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const user = await requirePermission("repairs.view");
  const job = await db.repairJob.findUnique({
    where: { id: (await params).id },
    include: {
      customer: true, technician: true, location: true, createdBy: true,
      parts: { include: { product: true }, orderBy: { createdAt: "asc" } },
      payments: { orderBy: { paidAt: "asc" } },
      events: { include: { actor: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!job) notFound();
  const { new: isNew } = await searchParams;
  const manage = can(user, "repairs.manage");
  const open = isOpen(job.status);
  const due = D(job.total).minus(job.paid);
  const partsValue = job.parts.reduce((a, p) => a.plus(D(p.qtyIssued).minus(p.qtyReturned).mul(p.unitPrice)), D(0));
  const partsCost = job.parts.reduce((a, p) => a.plus(p.costTotal), D(0));
  const [technicians, accounts] = await Promise.all([
    db.person.findMany({ where: { active: true, login: { role: { permissions: { has: "repairs.manage" } } } }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
    db.account.findMany({ where: { active: true, type: { in: ["CARD", "BANK"] } }, select: { id: true, name: true } }),
  ]);
  const labels = Object.fromEntries(Object.entries(REPAIR_STATUS).map(([k, v]) => [k, v.label]));
  const st = REPAIR_STATUS[job.status];

  return (
    <div className="stack">
      <PageHead eyebrow={`Repair / ${job.location.name}`} title={job.number}
        actions={<>
          <Badge tone={st?.tone ?? "muted"}>{st?.label ?? job.status}</Badge>
          <Link className="btn" href={`/repairs/${job.id}/sticker`}>Job sticker</Link>
          <Link className="btn" href={`/repairs/${job.id}/sticker?bill=1`}>Print bill</Link>
        </>} />
      {isNew && <p className="note note-ok">Job created. Print the job sticker and stick it on the device.</p>}

      <div className="grid3 small">
        <div><span className="muted">Customer</span><br /><RowLink href={`/contacts/${job.customerId}`}>{job.customer.name}</RowLink>{job.customer.phone && <> · <a href={`tel:${job.customer.phone}`}>{job.customer.phone}</a></>}</div>
        <div><span className="muted">Device</span><br />{[job.deviceBrand, job.deviceModel, job.color].filter(Boolean).join(" · ")}{job.imei && <><br />IMEI {job.imei}</>}{job.serial && <> · SN {job.serial}</>}</div>
        <div><span className="muted">Received</span><br />{fmtDateTime(job.createdAt)} · {job.createdBy.fullName}<br /><span className="muted">Promised</span> {fmtDateTime(job.promisedAt)}</div>
        <div><span className="muted">Problem</span><br />{job.problem}</div>
        <div><span className="muted">Checklist</span><br />SIM × {job.simCount}{job.memoryCard ? " · memory card" : ""}{job.accessories ? ` · ${job.accessories}` : ""}{job.condition && <><br />{job.condition}</>}</div>
        <div><span className="muted">Technician</span><br />{job.technician?.fullName ?? "Not assigned"}</div>
      </div>

      {manage && open && (
        <section className="panel stack">
          <h2 style={{ margin: 0 }}>Move job</h2>
          {job.status === "AWAITING_APPROVAL" && (
            <form action={doApprove} className="row">
              <input type="hidden" name="jobId" value={job.id} />
              <select name="how" style={{ width: "auto" }} aria-label="How the customer approved"><option>by phone call</option><option>in person</option><option>by SMS reply</option></select>
              <SubmitButton>Customer approved estimate</SubmitButton>
            </form>
          )}
          <StatusButtons jobId={job.id} next={st?.next ?? []} labels={labels} />
          {due.gt(0) && (st?.next ?? []).includes("COLLECTED") && <p className="small muted" style={{ margin: 0 }}>Rs. {money(due)} is due — take payment before handing over.</p>}
        </section>
      )}

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Unlock code</h2>
        {job.credentialCipher ? (
          can(user, "repairs.credentials") ? (
            <div className="row">
              <CredentialReveal jobId={job.id} type={job.credentialType ?? "PIN"} />
              <div className="spacer" />
              <form action={doPurge}><input type="hidden" name="jobId" value={job.id} /><button className="btn btn-sm btn-ghost btn-danger">Delete code now</button></form>
            </div>
          ) : <p className="muted" style={{ margin: 0 }}>A {job.credentialType?.toLowerCase()} is stored. You are not allowed to view unlock codes.</p>
        ) : <p className="muted" style={{ margin: 0 }}>{job.credentialPurgedAt ? `Deleted ${fmtDateTime(job.credentialPurgedAt)}.` : "None recorded."}</p>}
      </section>

      {manage && open && (
        <section className="panel">
          <h2>Diagnosis & estimate</h2>
          <DiagnosisForm jobId={job.id} diagnosis={job.diagnosis ?? ""} estimate={job.estimate?.toString() ?? ""} technicianId={job.technicianId ?? ""}
            promisedAt={toLocalInput(job.promisedAt)} technicians={technicians.map((t) => ({ id: t.id, name: t.fullName }))}
            canAsk={(st?.next ?? []).includes("AWAITING_APPROVAL")} />
        </section>
      )}
      {!open && job.diagnosis && <p><span className="muted small">Diagnosis</span><br />{job.diagnosis}</p>}

      <section className="stack">
        <h2 style={{ margin: 0 }}>Parts</h2>
        <DataTable rows={job.parts} rowKey={(p) => p.id} empty="No parts issued."
          columns={[
            { label: "Part", primary: true, render: (p) => p.product.name },
            { label: "Issued", num: true, render: (p) => qty(p.qtyIssued) },
            { label: "Returned", num: true, render: (p) => qty(p.qtyReturned) },
            { label: "Charge each", num: true, render: (p) => money(p.unitPrice) },
            ...(can(user, "cost.view") ? [{ label: "Our cost", num: true, render: (p: (typeof job.parts)[number]) => money(p.costTotal) }] : []),
            {
              label: "", render: (p) => manage && (open || job.status === "CANCELLED") && D(p.qtyIssued).gt(p.qtyReturned) ? (
                <form action={doReturnPart} className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                  <input type="hidden" name="partId" value={p.id} /><input type="hidden" name="jobId" value={job.id} />
                  <input name="qty" defaultValue={D(p.qtyIssued).minus(p.qtyReturned).toString()} style={{ width: 60, minHeight: 32 }} inputMode="decimal" aria-label="Quantity to return" />
                  <button className="btn btn-sm">Return unused</button>
                </form>
              ) : null,
            },
          ]} />
        {manage && open && <IssuePart jobId={job.id} />}
      </section>

      <section className="grid2">
        <div className="panel">
          <h2>Bill</h2>
          <div className="totalrow"><span>Labour</span><strong>{money(job.labourCharge)}</strong></div>
          <div className="totalrow"><span>Parts</span><strong>{money(partsValue)}</strong></div>
          {D(job.otherCharge).gt(0) && <div className="totalrow"><span>Other</span><strong>{money(job.otherCharge)}</strong></div>}
          {D(job.discount).gt(0) && <div className="totalrow"><span>Discount</span><strong>−{money(job.discount)}</strong></div>}
          <div className="totalrow grand"><span>Total</span><strong>Rs. {money(job.total)}</strong></div>
          <div className="totalrow"><span>Paid (incl. advance)</span><strong>{money(job.paid)}</strong></div>
          <div className="totalrow"><span>Due</span><strong style={{ color: due.gt(0) ? "var(--err)" : undefined }}>{money(due)}</strong></div>
          {can(user, "cost.view") && <p className="small muted">Our cost: parts {money(partsCost)} + outside {money(job.externalCost)} · margin {money(D(job.total).minus(partsCost).minus(job.externalCost))}</p>}
          {manage && open && <details style={{ marginTop: 10 }}><summary className="small" style={{ cursor: "pointer" }}>Edit labour / charges / warranty</summary><div style={{ marginTop: 10 }}>
            <ChargesForm jobId={job.id} labour={job.labourCharge.toString()} other={job.otherCharge.toString()} discount={job.discount.toString()} externalCost={job.externalCost.toString()} warrantyDays={job.warrantyDays?.toString() ?? ""} />
          </div></details>}
        </div>
        <div className="panel">
          <h2>Payments</h2>
          {job.payments.length === 0 ? <p className="muted small">No payments yet.</p> : job.payments.map((p) => (
            <div key={p.id} className="totalrow small"><span>{fmtDateTime(p.paidAt)} · {p.method.toLowerCase().replace("_", " ")}</span><strong>{money(p.amount)}</strong></div>
          ))}
          {manage && job.status !== "CANCELLED" && job.status !== "COLLECTED" && <div style={{ marginTop: 12 }}><PaymentForm jobId={job.id} due={due.toFixed(2)} accounts={accounts} /></div>}
        </div>
      </section>

      <section>
        <h2>Timeline</h2>
        <DataTable rows={job.events} rowKey={(e) => e.id}
          columns={[
            { label: "When", primary: true, render: (e) => fmtDateTime(e.createdAt) },
            { label: "What", render: (e) => <>{EVENT[e.kind] ?? e.kind}{e.toStatus ? `: ${REPAIR_STATUS[e.toStatus]?.label ?? e.toStatus}` : ""}</> },
            { label: "Detail", render: (e) => e.note ?? "" },
            { label: "By", render: (e) => e.actor?.fullName ?? "System" },
          ]} />
      </section>
    </div>
  );
}
