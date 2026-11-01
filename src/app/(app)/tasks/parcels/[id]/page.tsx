import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDateTime } from "@/lib/money";
import { PageHead, Badge, RowLink } from "@/components/ui";
import { ParcelStep } from "../../TaskForms";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const p = await db.busParcel.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: p?.number ?? "Not found" };
}

export default async function Parcel({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const p = await db.busParcel.findUnique({
    where: { id: (await params).id },
    include: { location: true, createdBy: true, receipt: true, tasks: { include: { assignedTo: true, events: { include: { actor: true }, orderBy: { createdAt: "asc" } } } } },
  });
  if (!p || !user.locations.some((l) => l.id === p.locationId)) notFound();
  const task = p.tasks[0];
  const steps = [
    ["Recorded", p.createdAt, p.createdBy.fullName],
    ["Acknowledged", task?.acknowledgedAt, task?.assignedTo?.fullName],
    ["Collected from bus", p.collectedAt, null],
    ["Contents checked", p.checkedAt, null],
    ["Received into stock", p.receipt?.receivedAt, p.receipt?.number],
  ] as const;

  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <PageHead eyebrow={`Staff Tasks / Bus parcel / ${p.location.name}`} title={p.number}
        actions={<Badge tone={p.status === "CLOSED" || p.status === "CHECKED" ? "ok" : p.status === "EXCEPTION" ? "err" : "warn"}>{p.status.toLowerCase()}</Badge>} />
      <div className="panel">
        <div className="eyebrow">Collect from</div>
        <strong style={{ fontSize: 22 }}>{p.busNumber ? `Bus ${p.busNumber}` : "Bus"}</strong>{p.route && <span className="muted"> · {p.route}</span>}
        <div className="grid3 small" style={{ marginTop: 10 }}>
          <div><span className="muted">ETA</span><br /><strong style={{ fontSize: 16 }}>{fmtDateTime(p.etaAt)}</strong></div>
          <div><span className="muted">Stop</span><br />{p.pickupStop ?? "—"}</div>
          <div><span className="muted">Crew</span><br />{p.crewPhone ? <a href={`tel:${p.crewPhone}`}>{p.crewPhone}</a> : "—"}</div>
          <div><span className="muted">From</span><br />{p.sender}</div>
          <div><span className="muted">Contents</span><br />{p.contents} · {p.packages} package(s)</div>
          <div><span className="muted">Bus charge</span><br />Rs. {money(p.charges)}</div>
        </div>
      </div>

      <section className="stack">
        {task?.status === "PENDING" && <ParcelStep parcelId={p.id} step="ack" label="Acknowledge — I will collect it" primary />}
        {["DISPATCHED", "ACKNOWLEDGED"].includes(p.status) && <ParcelStep parcelId={p.id} step="collected" label="I have collected it from the bus" primary={task?.status !== "PENDING"} />}
        {p.status === "COLLECTED" && <div className="panel"><h2>Check the contents</h2><ParcelStep parcelId={p.id} step="checked" label="Save check" primary withCheck /></div>}
        {["CHECKED", "EXCEPTION"].includes(p.status) && !p.receiptId && can(user, "purchases.post") && (
          <p className="note">Contents checked{p.discrepancy ? ` with a problem: ${p.checkNotes}` : ""}. <Link href={`/purchases/new?parcel=${p.id}`}>Receive the accepted goods into stock</Link> — only that adds stock.</p>
        )}
        {p.receipt && <p className="note note-ok">Received into stock on <RowLink href={`/purchases/${p.receipt.id}`}>{p.receipt.number}</RowLink>.</p>}
        {["DISPATCHED", "ACKNOWLEDGED"].includes(p.status) && can(user, "tasks.manage") && <ParcelStep parcelId={p.id} step="cancel" label="Cancel parcel" />}
      </section>

      <section className="panel">
        <h2>Progress</h2>
        {steps.map(([label, at, who]) => (
          <div key={label} className="totalrow small"><span>{at ? "✓" : "○"} {label}</span><span className="muted">{at ? `${fmtDateTime(at)}${who ? ` · ${who}` : ""}` : "—"}</span></div>
        ))}
        {task?.events.filter((e) => ["ESCALATED", "SMS_FALLBACK"].includes(e.kind)).map((e) => (
          <div key={e.id} className="totalrow small" style={{ color: "var(--err)" }}><span>{e.kind === "ESCALATED" ? "Escalated" : "SMS fallback sent"}{e.note ? ` · ${e.note}` : ""}</span><span>{fmtDateTime(e.createdAt)}</span></div>
        ))}
        {p.checkNotes && <p className="small">Check notes: {p.checkNotes}</p>}
      </section>
    </div>
  );
}
