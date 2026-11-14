import Link from "next/link";
import { db } from "@/lib/db";
import { can, type CurrentUser } from "@/lib/auth";
import { money, fmtDateTime, D } from "@/lib/money";
import { Badge, DataTable, RowLink, Stat } from "@/components/ui";
import { drawerSummary, VARIANCE_REASONS } from "@/lib/register";

const diffColor = (v: unknown) => (v != null && !D(v as string).eq(0) ? "var(--err)" : "var(--ok)");

// Home page: the shop's cash drawer at a glance, and recent day-end settlements for the owner.
export async function DrawerCard({ user }: { user: CurrentUser }) {
  const loc = user.location;
  if (!loc) return null;
  const operate = can(user, "register.operate");
  const review = can(user, "register.review");
  const open = await db.registerSession.findFirst({ where: { locationId: loc.id, closedAt: null }, select: { id: true } });
  const s = open ? await drawerSummary(db, open.id) : null;
  const recent = await db.registerSession.findMany({
    where: { locationId: loc.id, closedAt: { not: null } }, orderBy: { closedAt: "desc" }, take: review ? 5 : 1, include: { closedBy: true, user: true },
  });
  const last = recent[0];

  return (
    <section className="panel stack">
      <div className="row">
        <h2 style={{ margin: 0 }}>Cash drawer</h2>
        {s ? <Badge tone="ok">Open</Badge> : <Badge tone="warn">Closed</Badge>}
        <div className="spacer" />
        {s && operate && <Link className="btn btn-sm" href="/register#move">Cash in / out</Link>}
        {s && operate && <Link className="btn btn-sm btn-primary" href="/register#close">Count &amp; close</Link>}
        {!s && operate && <Link className="btn btn-sm btn-primary" href="/register">Open register</Link>}
      </div>
      {s ? (
        <>
          <div className="stats" style={{ borderBottom: 0, paddingBottom: 0 }}>
            <Stat label="Opening cash" value={`Rs. ${money(s.opening)}`} basis={`${fmtDateTime(s.register.openedAt)} · ${s.register.user.fullName}`} />
            <Stat label="Cash in" value={`Rs. ${money(s.cashIn)}`} basis="Sales, debt payments, repairs…" />
            <Stat label="Cash out" value={`Rs. ${money(s.cashOut)}`} basis="Refunds, expenses, owner…" />
            <Stat label="Should be in drawer" value={`Rs. ${money(s.expected)}`} basis={<Link href={`/register/${s.register.id}`}>See breakdown</Link>} />
          </div>
        </>
      ) : last ? (
        <p className="small" style={{ margin: 0 }}>
          Last closed {fmtDateTime(last.closedAt)} by {(last.closedBy ?? last.user).fullName}:{" "}
          <span style={{ color: diffColor(last.variance) }}>{last.variance && !D(last.variance).eq(0) ? `difference Rs. ${money(last.variance)} (${VARIANCE_REASONS[last.varianceReason ?? ""] ?? "no reason"})` : "balanced"}</span>
          {" · "}Rs. {money(last.cashLeft ?? last.countedCash)} left in the drawer. <Link href={`/register/${last.id}`}>Settlement</Link>
        </p>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>Open the register with the cash in the drawer at the start of the day. Close it at the end of the day by counting the cash.</p>
      )}
      {review && recent.length > 0 && (
        <DataTable rows={recent} rowKey={(r) => r.id}
          columns={[
            { label: "Closed", primary: true, render: (r) => <RowLink href={`/register/${r.id}`}>{fmtDateTime(r.closedAt)}</RowLink> },
            { label: "By", render: (r) => (r.closedBy ?? r.user).fullName },
            { label: "Expected", num: true, render: (r) => money(r.expectedCash) },
            { label: "Counted", num: true, render: (r) => money(r.countedCash) },
            { label: "Difference", num: true, render: (r) => <span style={{ color: diffColor(r.variance) }}>{money(r.variance)}</span> },
            { label: "Reason", render: (r) => [r.varianceReason ? VARIANCE_REASONS[r.varianceReason] : "", r.notes].filter(Boolean).join(" · ") },
          ]} />
      )}
    </section>
  );
}
