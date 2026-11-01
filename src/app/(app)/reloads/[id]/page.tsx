import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDateTime } from "@/lib/money";
import { PageHead, Badge, RowLink } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { RELOAD_STATUS } from "../status";
import { OutcomeForm } from "../OutcomeForm";
import { doClaim, doCancel } from "../actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const r = await db.reloadRequest.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: r?.number ?? "Not found" };
}

const COLLECT: Record<string, string> = { SHOP: "Cash at the shop counter", OWNER: "Collected by the owner", CREDIT: "Customer owes" };

export default async function ReloadDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const r = await db.reloadRequest.findUnique({
    where: { id: (await params).id },
    include: { wallet: true, customer: true, assignedTo: true, requestedBy: true, location: true, tasks: { include: { events: { include: { actor: true }, orderBy: { createdAt: "asc" } } } } },
  });
  if (!r || !user.locations.some((l) => l.id === r.locationId)) notFound();
  const st = RELOAD_STATUS[r.status];
  const mine = !r.assignedToId || r.assignedToId === user.personId;
  const events = r.tasks.flatMap((t) => t.events);

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <PageHead eyebrow={`Reloads / ${r.location.name}`} title={`${r.number} · Rs. ${money(r.amount)}`} actions={<Badge tone={st?.[1] ?? "muted"}>{st?.[0] ?? r.status}</Badge>} />
      <div className="panel" style={{ fontSize: 18 }}>
        <div className="eyebrow">Reload to</div>
        <strong style={{ fontSize: 28, letterSpacing: 1, fontVariantNumeric: "tabular-nums" }}>{r.mobile}</strong>
        <div className="muted">{r.network.toLowerCase()} · {r.wallet.name}</div>
      </div>
      <div className="grid3 small">
        <div><span className="muted">Money</span><br />{COLLECT[r.collection]}{r.customer && <> · <RowLink href={`/contacts/${r.customerId}`}>{r.customer.name}</RowLink></>}</div>
        <div><span className="muted">Requested</span><br />{fmtDateTime(r.createdAt)} · {r.requestedBy.fullName}</div>
        <div><span className="muted">Staff</span><br />{r.assignedTo?.fullName ?? "Anyone on shift"}</div>
      </div>
      {r.notes && <p className="note">{r.notes}</p>}

      {["REQUESTED", "ACKNOWLEDGED"].includes(r.status) && can(user, "reloads.process") && mine && (
        <form action={doClaim}><input type="hidden" name="id" value={r.id} /><SubmitButton pendingText="Claiming…">I am doing this reload now</SubmitButton></form>
      )}
      {["PROCESSING", "UNCERTAIN"].includes(r.status) && can(user, "reloads.process") && (mine || can(user, "reloads.wallets")) && <OutcomeForm id={r.id} uncertain={r.status === "UNCERTAIN"} />}
      {["REQUESTED", "ACKNOWLEDGED"].includes(r.status) && can(user, "reloads.request") && (
        <form action={doCancel}><input type="hidden" name="id" value={r.id} /><button className="btn btn-danger">Cancel request</button></form>
      )}
      {r.status === "SUCCESSFUL" && r.saleId && <p>Recorded as sale <Link href={`/sales/${r.saleId}`}>view sale</Link>{r.providerRef ? ` · provider ref ${r.providerRef}` : ""}.</p>}
      {r.resultNote && <p className="small muted">Note: {r.resultNote}</p>}

      {events.length > 0 && (
        <section className="panel">
          <h2>Timeline</h2>
          {events.map((e) => <div key={e.id} className="totalrow small"><span>{e.kind.toLowerCase().replace("_", " ")}{e.note ? ` · ${e.note}` : ""}</span><span className="muted">{fmtDateTime(e.createdAt)}{e.actor ? ` · ${e.actor.fullName}` : ""}</span></div>)}
          {r.completedAt && <div className="totalrow small"><span>Finished</span><span className="muted">{fmtDateTime(r.completedAt)}</span></div>}
        </section>
      )}
    </div>
  );
}
