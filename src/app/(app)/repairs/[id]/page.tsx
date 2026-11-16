import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, qty, fmtDateTime, fmtDate } from "@/lib/money";
import { REPAIR_STATUS, isOpen, canSendOut, FAIL_REASONS, OUTCOMES } from "@/lib/repairs";
import { PageHead, DataTable, Badge, RowLink } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { StatusButtons, DiagnosisForm, ChargesForm, PaymentForm, RefundForm, IssuePart, CredentialReveal, RoutePicker, SendOutsideForm, ReturnFromOutsideForm } from "../JobPanels";
import { doApprove, doReturnPart, doPurge, removeRepairPhoto } from "../actions";
import { headers } from "next/headers";
import { PhotoUpload } from "../PhotoPanel";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { FILES_BUCKET, signedUrl, storageConfigured } from "@/lib/storage";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const j = await db.repairJob.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: j?.number ?? "Not found" };
}

const toLocalInput = (d: Date | null) => (d ? new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 16) : "");
const EVENT: Record<string, string> = {
  STATUS: "Status", NOTE: "Note", ESTIMATE: "Diagnosis / estimate", APPROVAL: "Customer approval", PART_ISSUED: "Part issued", PART_RETURNED: "Part returned",
  CREDENTIAL_VIEWED: "Unlock code viewed", CREDENTIAL_PURGED: "Unlock code deleted", PAYMENT: "Payment", CHARGES: "Bill updated",
  REFUND: "Refund", ROUTE: "Route", OUTSOURCE_SENT: "Sent to outside shop", OUTSOURCE_BACK: "Back from outside shop",
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
      photos: { orderBy: { createdAt: "asc" } },
      outsources: { include: { vendor: true }, orderBy: { sentAt: "asc" } },
      originSaleLine: { include: { sale: { select: { id: true, number: true } } } },
    },
  });
  if (!job) notFound();
  const storageOn = storageConfigured();
  const photos = storageOn ? await Promise.all(job.photos.map(async (p) => ({ ...p, url: await signedUrl(FILES_BUCKET, p.storagePath, 600).catch(() => null) }))) : [];
  const h = await headers();
  const trackUrl = job.trackToken ? `${h.get("x-forwarded-proto") ?? (/^(localhost|127\.)/.test(h.get("host") ?? "") ? "http" : "https")}://${h.get("host")}/track/${job.trackToken}` : null;
  const { new: isNew } = await searchParams;
  const manage = can(user, "repairs.manage");
  const open = isOpen(job.status);
  const due = D(job.total).minus(job.paid);
  const partsValue = job.parts.reduce((a, p) => a.plus(D(p.qtyIssued).minus(p.qtyReturned).mul(p.unitPrice)), D(0));
  const partsCost = job.parts.reduce((a, p) => a.plus(p.costTotal), D(0));
  const openTrip = job.outsources.find((o) => !o.returnedAt) ?? null;
  const partsOnJob = job.parts.filter((p) => D(p.qtyIssued).gt(p.qtyReturned)).length;
  const failed = job.outcome === "NOT_REPAIRED";
  // Money goes back only once the bill is final (Ready) or the job is cancelled; before that, paying ahead is normal.
  const owedBack = job.status === "CANCELLED" ? D(job.paid) : job.status === "READY" ? due.neg() : D(0);
  const [technicians, accounts, shops] = await Promise.all([
    db.person.findMany({ where: { active: true, login: { role: { permissions: { has: "repairs.manage" } } } }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
    db.account.findMany({ where: { active: true, type: { in: ["CARD", "BANK"] } }, select: { id: true, name: true } }),
    manage && open ? db.contact.findMany({ where: { active: true, isSupplier: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
  ]);
  const labels = Object.fromEntries(Object.entries(REPAIR_STATUS).map(([k, v]) => [k, v.label]));
  const st = REPAIR_STATUS[job.status];
  const statusLabel = failed && (job.status === "READY" || job.status === "COLLECTED") ? `${st?.label} · not repaired` : st?.label ?? job.status;

  return (
    <div className="stack">
      <PageHead eyebrow={`Repair / ${job.location.name}`} title={job.number}
        actions={<>
          <Badge tone={failed && job.status === "READY" ? "err" : st?.tone ?? "muted"}>{statusLabel}</Badge>
          <Link className="btn" href={`/repairs/${job.id}/sticker`}>Job sticker</Link>
          <Link className="btn" href={`/repairs/${job.id}/sticker?bill=1`}>Print bill</Link>
          <WhatsAppLink phone={job.customer.phone} label="WhatsApp update"
            text={`${job.customer.name}, your ${[job.deviceBrand, job.deviceModel].filter(Boolean).join(" ")} (job ${job.number}) is now: ${failed && job.status === "READY" ? "ready to collect — sorry, we could not repair it" : st?.label ?? job.status}.${job.status === "AWAITING_APPROVAL" && job.estimate ? ` Estimate Rs. ${money(job.estimate)} — please reply to approve.` : ""}${job.status === "READY" && due.gt(0) ? ` Balance to pay Rs. ${money(due)}.` : ""}${trackUrl ? ` Track it here: ${trackUrl}` : ""}`} />
        </>} />
      {isNew && <p className="note note-ok">Job created. Print the job sticker and stick it on the device, then add photos of the device below.</p>}
      {job.originSaleLine && (
        <p className={"note " + (job.warrantyClaim ? "note-ok" : "")}>
          {job.warrantyClaim ? "Warranty claim" : "Out-of-warranty repair"} on <RowLink href={`/sales/${job.originSaleLine.sale.id}`}>{job.originSaleLine.sale.number}</RowLink> · {job.originSaleLine.nameSnapshot}
          {job.originSaleLine.warrantyUntil ? ` · warranty until ${fmtDate(job.originSaleLine.warrantyUntil)}` : ""}
        </p>
      )}

      <div className="grid3 small">
        <div><span className="muted">Customer</span><br /><RowLink href={`/contacts/${job.customerId}`}>{job.customer.name}</RowLink>{job.customer.phone && <> · <a href={`tel:${job.customer.phone}`}>{job.customer.phone}</a></>}</div>
        <div><span className="muted">Device</span><br />{[job.deviceBrand, job.deviceModel, job.color].filter(Boolean).join(" · ")}{job.imei && <><br />IMEI {job.imei}</>}{job.serial && <> · SN {job.serial}</>}</div>
        <div><span className="muted">Received</span><br />{fmtDateTime(job.createdAt)} · {job.createdBy.fullName}<br /><span className="muted">Promised</span> {fmtDateTime(job.promisedAt)}</div>
        <div><span className="muted">Problem</span><br />{job.problem}</div>
        <div><span className="muted">Checklist</span><br />SIM × {job.simCount}{job.memoryCard ? " · memory card" : ""}{job.accessories ? ` · ${job.accessories}` : ""}{job.condition && <><br />{job.condition}</>}</div>
        <div><span className="muted">Technician</span><br />{job.technician?.fullName ?? "Not assigned"}</div>
        <div><span className="muted">Estimate</span><br />{job.estimate != null ? `Rs. ${money(job.estimate)}` : "Not given yet"}{D(job.paid).gt(0) && <><br /><span className="muted">Paid so far</span> Rs. {money(job.paid)}</>}</div>
        <div><span className="muted">Repair route</span><br />{job.route === "IN_HOUSE" ? "In-house" : job.route === "OUTSOURCED" ? `Outsourced${openTrip ? ` · now at ${openTrip.vendor.name}` : ""}` : "Not decided"}</div>
        {job.outcome && <div><span className="muted">Result</span><br /><span style={{ color: failed ? "var(--err)" : "var(--ok)" }}>{OUTCOMES[job.outcome]}</span>{job.outcomeReason && ` — ${job.outcomeReason}`}</div>}
      </div>

      <section className="panel stack">
        <div className="row"><h2 style={{ margin: 0 }}>Photos</h2><div className="spacer" />{manage && storageOn && <PhotoUpload jobId={job.id} />}</div>
        {!storageOn && <p className="small muted" style={{ margin: 0 }}>Photos need file storage. The owner switches it on under Settings › Backups &amp; file storage.</p>}
        {storageOn && !photos.length && <p className="small muted" style={{ margin: 0 }}>No photos yet. Photograph the screen, back and any damage before the device leaves the counter.</p>}
        {photos.length > 0 && (
          <div className="row" style={{ flexWrap: "wrap", gap: 10, alignItems: "flex-start" }}>
            {photos.map((p) => (
              <figure key={p.id} style={{ margin: 0, width: 132 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer"><img src={p.url} alt={`${p.kind.toLowerCase()} photo`} loading="lazy" style={{ width: 132, height: 132, objectFit: "cover", borderRadius: 8 }} /></a> : <div className="empty" style={{ height: 132 }}>Unavailable</div>}
                <figcaption className="small muted row" style={{ gap: 4 }}>
                  {({ INTAKE: "As received", WORK: "During work", DONE: "After repair" } as Record<string, string>)[p.kind]}
                  {manage && <form action={removeRepairPhoto} className="no-print"><input type="hidden" name="id" value={p.id} /><button className="btn btn-sm" aria-label="Remove photo">×</button></form>}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
        <div className="small muted">
          {job.termsAcceptedAt ? <>Terms accepted by the customer on {fmtDateTime(job.termsAcceptedAt)}{job.signature ? " — signed:" : " (no signature)."}</> : "Terms were not accepted on screen for this job."}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {job.signature && <><br /><img src={job.signature} alt="Customer signature" style={{ height: 64, background: "#fff", borderRadius: 6, marginTop: 4 }} /></>}
        </div>
        {trackUrl && <div className="small muted no-print">Customer tracking link (no login, no personal details): <a href={trackUrl} target="_blank" rel="noopener noreferrer">{trackUrl}</a></div>}
      </section>

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
          {job.status === "OUTSOURCED" && <p className="small muted" style={{ margin: 0 }}>The device is at {openTrip?.vendor.name ?? "the outside shop"}. Record it back under “How it is repaired” to continue.</p>}
          <StatusButtons jobId={job.id} next={st?.next ?? []} labels={labels} reasons={FAIL_REASONS} partsOnJob={partsOnJob} />
          {due.gt(0) && (st?.next ?? []).includes("COLLECTED") && <p className="small muted" style={{ margin: 0 }}>Rs. {money(due)} is due — take payment before handing over.</p>}
        </section>
      )}

      {(manage && open && job.status !== "READY") || job.outsources.length > 0 ? (
        <section className="panel stack">
          <h2 style={{ margin: 0 }}>How it is repaired</h2>
          {manage && open && job.status !== "READY" && <RoutePicker jobId={job.id} route={job.route} locked={job.status === "OUTSOURCED"} />}
          {job.outsources.length > 0 && (
            <DataTable rows={job.outsources} rowKey={(o) => o.id}
              columns={[
                { label: "Outside shop", primary: true, render: (o) => <>{o.vendor.name}{o.vendor.phone && <> · <a href={`tel:${o.vendor.phone}`}>{o.vendor.phone}</a></>}{o.note && <><br /><span className="small muted">{o.note}</span></>}</> },
                { label: "Sent", render: (o) => fmtDateTime(o.sentAt) },
                { label: "Expected", render: (o) => { const late = !o.returnedAt && o.expectedAt && o.expectedAt < new Date(); return <span style={{ color: late ? "var(--err)" : undefined }}>{o.expectedAt ? fmtDateTime(o.expectedAt) : "—"}{late ? " · late" : ""}</span>; } },
                { label: "Quote", num: true, render: (o) => (o.quote != null ? money(o.quote) : "—") },
                { label: "Back", render: (o) => (o.returnedAt ? fmtDateTime(o.returnedAt) : <Badge tone="warn">Still there</Badge>) },
                { label: "Result", render: (o) => (o.result ? <Badge tone={o.result === "REPAIRED" ? "ok" : "err"}>{o.result === "REPAIRED" ? "Fixed" : "Not fixed"}</Badge> : "—") },
                ...(can(user, "cost.view") ? [{ label: "Charged us", num: true, render: (o: (typeof job.outsources)[number]) => (o.cost != null ? money(o.cost) : "—") }] : []),
              ]} />
          )}
          {manage && openTrip && <ReturnFromOutsideForm jobId={job.id} outsourceId={openTrip.id} shop={openTrip.vendor.name} quote={openTrip.quote?.toString() ?? ""} />}
          {manage && job.route === "OUTSOURCED" && !openTrip && canSendOut(job.status) && (
            job.outsources.length ? <details><summary className="small" style={{ cursor: "pointer" }}>Send to another outside shop</summary><div style={{ marginTop: 10 }}><SendOutsideForm jobId={job.id} shops={shops} /></div></details>
              : <SendOutsideForm jobId={job.id} shops={shops} />
          )}
          {manage && open && job.route === "IN_HOUSE" && <p className="small muted" style={{ margin: 0 }}>Issue the spare parts used under Parts below; they come out of stock and go on the bill.</p>}
        </section>
      ) : null}

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
        {manage && open && job.status !== "OUTSOURCED" && (job.route === "OUTSOURCED"
          ? <details><summary className="small" style={{ cursor: "pointer" }}>Issue a part from our stock (e.g. sent along to the outside shop)</summary><div style={{ marginTop: 10 }}><IssuePart jobId={job.id} /></div></details>
          : <IssuePart jobId={job.id} />)}
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
          {due.lt(0) ? <div className="totalrow"><span>{job.status === "READY" ? "Owed back to customer" : "Paid ahead of the bill"}</span><strong style={{ color: "var(--warn)" }}>{money(due.neg())}</strong></div>
            : <div className="totalrow"><span>Due</span><strong style={{ color: due.gt(0) ? "var(--err)" : undefined }}>{money(due)}</strong></div>}
          {can(user, "cost.view") && <p className="small muted">Our cost: parts {money(partsCost)} + outside {money(job.externalCost)} · margin {money(D(job.total).minus(partsCost).minus(job.externalCost))}</p>}
          {manage && open && <details style={{ marginTop: 10 }}><summary className="small" style={{ cursor: "pointer" }}>Edit labour / charges / warranty</summary><div style={{ marginTop: 10 }}>
            <ChargesForm jobId={job.id} labour={job.labourCharge.toString()} other={job.otherCharge.toString()} discount={job.discount.toString()} externalCost={job.externalCost.toString()} warrantyDays={job.warrantyDays?.toString() ?? ""} outsideFromTrips={job.outsources.length > 0} />
          </div></details>}
        </div>
        <div className="panel">
          <h2>Payments</h2>
          {job.payments.length === 0 ? <p className="muted small">No payments yet.</p> : job.payments.map((p) => (
            <div key={p.id} className="totalrow small"><span>{fmtDateTime(p.paidAt)} · {p.method.toLowerCase().replace("_", " ")}{p.direction === "OUT" ? " · refund" : ""}</span><strong>{p.direction === "OUT" ? "−" : ""}{money(p.amount)}</strong></div>
          ))}
          {manage && job.status !== "COLLECTED" && owedBack.gt(0) && <div style={{ marginTop: 12 }}><RefundForm jobId={job.id} owed={owedBack.toFixed(2)} accounts={accounts} /></div>}
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
