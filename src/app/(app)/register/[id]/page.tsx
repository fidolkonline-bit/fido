import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDateTime, D } from "@/lib/money";
import { PageHead, Badge } from "@/components/ui";
import { PrintOnLoad } from "../../sales/[id]/PrintOnLoad";
import { Breakdown } from "../Breakdown";
import { drawerSummary, MOVEMENT_REASONS, VARIANCE_REASONS } from "@/lib/register";

export const metadata = { title: "Cash settlement" };

// Day-end cash settlement slip: what the drawer should hold, what was counted, the difference and why.
export default async function Settlement({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ closed?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { closed } = await searchParams;
  const r = await db.registerSession.findUnique({ where: { id }, select: { locationId: true } });
  if (!r) notFound();
  const allowed = can(user, "register.review") || (can(user, "register.operate") && user.locations.some((l) => l.id === r.locationId));
  if (!allowed) notFound();
  const s = await drawerSummary(db, id);
  const reg = s.register;
  const business = await db.business.findFirst({ select: { name: true } });
  const variance = reg.variance != null ? D(reg.variance) : null;
  const counts = (reg.denominations ?? {}) as Record<string, number>;
  const handover = reg.movements.find((m) => m.atClose);
  const isClosed = !!reg.closedAt;

  return (
    <div className="stack">
      <div className="no-print">
        <PageHead eyebrow="Payment Accounts / Cash register" title="Cash settlement"
          actions={<><Link className="btn" href="/register">Cash register</Link>{isClosed && <PrintOnLoad enabled={false} label="Print" />}</>} />
        {closed === "1" && <p className="note note-ok">Register closed. This is the settlement for the day.</p>}
      </div>
      <div className="doc paper-A4">
        <div className="doc-top">
          <div><h3>{(business?.name ?? "").toUpperCase()}</h3><div className="small">{reg.location.name}</div></div>
          <div className="small" style={{ textAlign: "right" }}><strong>CASH SETTLEMENT</strong><br />{fmtDateTime(reg.openedAt)}<br />to {isClosed ? fmtDateTime(reg.closedAt) : "now (still open)"}</div>
        </div>
        <div className="small" style={{ marginBottom: 10 }}>
          Opened by {reg.user.fullName}{isClosed && <> · closed by {(reg.closedBy ?? reg.user).fullName}</>} · {s.salesCount} sales, Rs. {money(s.salesTotal)}
          {reg.expectedOpening != null && !D(reg.expectedOpening).eq(reg.openingCash) && (
            <><br />Opening differed from last close (Rs. {money(reg.expectedOpening)} left): {reg.openingNote}</>
          )}
        </div>

        <h4 style={{ margin: "8px 0 0" }}>Cash</h4>
        <Breakdown s={s} />

        {isClosed && variance && (
          <>
            <div className="totalrow"><span>Counted in the drawer</span><strong>{money(reg.countedCash)}</strong></div>
            <div className="totalrow grand">
              <span>{variance.eq(0) ? "Balanced" : variance.gt(0) ? "Extra cash" : "Short"}</span>
              <strong style={{ color: variance.eq(0) ? "var(--ok)" : "var(--err)" }}>{variance.gt(0) ? "+" : ""}{money(variance)}</strong>
            </div>
            {!variance.eq(0) && <p style={{ margin: "8px 0" }}><Badge tone="err">{VARIANCE_REASONS[reg.varianceReason ?? ""] ?? "No reason"}</Badge> {reg.notes}</p>}
            {variance.eq(0) && reg.notes && <p className="small" style={{ margin: "8px 0" }}>Note: {reg.notes}</p>}
            <div className="totalrow"><span>Handed over{handover ? ` (${MOVEMENT_REASONS[handover.reason]?.label.toLowerCase()})` : ""}</span><strong>{money(s.handedOver)}</strong></div>
            <div className="totalrow"><span>Left in drawer for next day</span><strong>{money(reg.cashLeft ?? reg.countedCash)}</strong></div>
          </>
        )}

        {reg.movements.filter((m) => !m.atClose).length > 0 && (
          <>
            <h4 style={{ margin: "14px 0 0" }}>Cash in / out during the day</h4>
            {reg.movements.filter((m) => !m.atClose).map((m) => (
              <div key={m.id} className="totalrow" style={{ fontSize: 13 }}>
                <span>{fmtDateTime(m.createdAt)} · {MOVEMENT_REASONS[m.reason]?.label ?? m.reason}{m.note ? ` · ${m.note}` : ""} · {m.createdBy.fullName}</span>
                <strong>{m.direction === "OUT" ? "−" : "+"}{money(m.amount)}</strong>
              </div>
            ))}
          </>
        )}

        {Object.keys(counts).length > 0 && (
          <>
            <h4 style={{ margin: "14px 0 0" }}>Notes and coins counted</h4>
            {Object.entries(counts).sort((a, b) => Number(b[0]) - Number(a[0])).map(([d, c]) => (
              <div key={d} className="totalrow" style={{ fontSize: 13 }}><span>Rs. {Number(d).toLocaleString()} × {c}</span><strong>{money(Number(d) * c)}</strong></div>
            ))}
          </>
        )}
        <div className="row small" style={{ marginTop: 28, justifyContent: "space-between" }}>
          <span>Cashier: ____________________</span><span>Checked by: ____________________</span>
        </div>
      </div>
    </div>
  );
}
