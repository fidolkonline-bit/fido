import Link from "next/link";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDateTime, D } from "@/lib/money";
import { PageHead, DataTable, Badge, RowLink } from "@/components/ui";
import { OpenRegisterForm, CloseRegisterForm, CashMoveForm } from "./RegisterForms";
import { Breakdown } from "./Breakdown";
import { drawerSummary, lastCashLeft, DENOMINATIONS, MOVEMENT_REASONS, VARIANCE_REASONS } from "@/lib/register";

export const metadata = { title: "Cash register" };

export default async function Register() {
  const user = await requirePermission("register.operate");
  const loc = user.location;
  const open = loc ? await db.registerSession.findFirst({ where: { locationId: loc.id, closedAt: null } }) : null;
  const s = open ? await drawerSummary(db, open.id) : null;
  const prev = !open && loc ? await lastCashLeft(db, loc.id) : null;
  const history = await db.registerSession.findMany({
    where: { ...(loc ? { locationId: loc.id } : {}), closedAt: { not: null } },
    orderBy: { closedAt: "desc" }, take: can(user, "register.review") ? 30 : 7, include: { user: true, closedBy: true },
  });

  return (
    <div className="stack">
      <PageHead
        eyebrow={`Payment Accounts / ${loc?.name ?? ""}`}
        title="Cash register"
        actions={open ? <Badge tone="ok">Open since {fmtDateTime(open.openedAt)}</Badge> : <Badge tone="warn">Closed</Badge>}
      />
      {!open && <OpenRegisterForm expectedOpening={prev ? Number(prev.cashLeft) : null} />}
      {open && s && (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            Opened by {s.register.user.fullName}. One drawer for the shop: everyone on shift takes cash into it. {s.salesCount} sales (Rs. {money(s.salesTotal)}) so far.
            {open.openingNote && <> Opening note: {open.openingNote}</>}
          </p>
          <div className="grid2" style={{ alignItems: "start" }}>
            <section className="panel"><h2 style={{ marginTop: 0 }}>Cash right now</h2><Breakdown s={s} /></section>
            <CashMoveForm reasons={Object.entries(MOVEMENT_REASONS).map(([value, r]) => ({ value, ...r }))} />
          </div>
          {s.register.movements.length > 0 && (
            <section>
              <h2>Cash in / out today</h2>
              <DataTable rows={s.register.movements} rowKey={(m) => m.id}
                columns={[
                  { label: "Time", primary: true, render: (m) => fmtDateTime(m.createdAt) },
                  { label: "Reason", render: (m) => MOVEMENT_REASONS[m.reason]?.label ?? m.reason },
                  { label: "Note", render: (m) => m.note ?? "" },
                  { label: "By", render: (m) => m.createdBy.fullName },
                  { label: "Amount", num: true, render: (m) => (m.direction === "OUT" ? "−" : "+") + money(m.amount) },
                ]} />
            </section>
          )}
          <CloseRegisterForm registerId={open.id} expected={Number(s.expected)} denominations={DENOMINATIONS}
            varianceReasons={Object.entries(VARIANCE_REASONS).map(([value, label]) => ({ value, label }))} />
        </>
      )}
      <section>
        <div className="row" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Settlements</h2><div className="spacer" />
          {can(user, "register.review") && can(user, "reports.view") && <Link className="small" href="/reports/registers">Registers report</Link>}
        </div>
        <DataTable rows={history} rowKey={(r) => r.id} empty="No closed registers yet."
          columns={[
            { label: "Closed", primary: true, render: (r) => <RowLink href={`/register/${r.id}`}>{fmtDateTime(r.closedAt)}</RowLink> },
            { label: "Closed by", render: (r) => (r.closedBy ?? r.user).fullName },
            { label: "Expected", num: true, render: (r) => money(r.expectedCash) },
            { label: "Counted", num: true, render: (r) => money(r.countedCash) },
            { label: "Difference", num: true, render: (r) => <span style={{ color: r.variance && !D(r.variance).eq(0) ? "var(--err)" : "var(--ok)" }}>{money(r.variance)}</span> },
            { label: "Reason", render: (r) => [r.varianceReason ? VARIANCE_REASONS[r.varianceReason] : "", r.notes].filter(Boolean).join(" · ") },
            { label: "Left in drawer", num: true, render: (r) => money(r.cashLeft ?? r.countedCash) },
          ]} />
      </section>
    </div>
  );
}
