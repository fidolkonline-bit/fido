import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, Badge } from "@/components/ui";
import { OpenRegisterForm, CloseRegisterForm } from "./RegisterForms";
import { expectedCash, DENOMINATIONS } from "@/lib/register";

export const metadata = { title: "Cash register" };

export default async function Register() {
  const user = await requirePermission("register.operate");
  const loc = user.location;
  const open = loc ? await db.registerSession.findFirst({ where: { locationId: loc.id, userId: user.personId, closedAt: null } }) : null;
  const totals = open ? await expectedCash(open.id) : null;
  const nonCash = open
    ? await db.payment.groupBy({ by: ["method"], where: { sale: { registerId: open.id }, method: { not: "CASH" } }, _sum: { amount: true } })
    : [];
  const history = await db.registerSession.findMany({
    where: { ...(loc ? { locationId: loc.id } : {}), ...(can(user, "register.review") ? {} : { userId: user.personId }), closedAt: { not: null } },
    orderBy: { openedAt: "desc" }, take: 20, include: { user: true },
  });

  return (
    <div className="stack">
      <PageHead eyebrow={`Payment Accounts / ${loc?.name ?? ""}`} title="Cash register" actions={open ? <Badge tone="ok">Open since {fmtDateTime(open.openedAt)}</Badge> : <Badge tone="warn">Closed</Badge>} />
      {!open && <OpenRegisterForm />}
      {open && totals && (
        <>
          <div className="stats">
            <div className="stat">Opening cash<strong>{money(totals.opening)}</strong>Counted at open</div>
            <div className="stat">Cash received<strong>{money(totals.cashIn)}</strong>Sales and collections</div>
            <div className="stat">Cash paid out<strong>{money(totals.cashOut)}</strong>Refunds / cash-out</div>
            <div className="stat">Expected in drawer<strong>{money(totals.expected)}</strong>Card/bank excluded</div>
          </div>
          {nonCash.length > 0 && (
            <p className="small muted">Non-cash this session (not in the drawer): {nonCash.map((r) => `${r.method.replace("_", " ").toLowerCase()} ${money(r._sum.amount)}`).join(" · ")}</p>
          )}
          <CloseRegisterForm registerId={open.id} expected={Number(totals.expected)} denominations={DENOMINATIONS} />
        </>
      )}
      <section>
        <h2>Closed registers</h2>
        <DataTable rows={history} rowKey={(r) => r.id} empty="No closed registers yet."
          columns={[
            { label: "Opened", primary: true, render: (r) => fmtDateTime(r.openedAt) },
            { label: "Closed", render: (r) => fmtDateTime(r.closedAt) },
            { label: "Operator", render: (r) => r.user.fullName },
            { label: "Expected", num: true, render: (r) => money(r.expectedCash) },
            { label: "Counted", num: true, render: (r) => money(r.countedCash) },
            { label: "Variance", num: true, render: (r) => <span style={{ color: r.variance && !r.variance.eq(0) ? "var(--err)" : "var(--ok)" }}>{money(r.variance)}</span> },
            { label: "Notes", render: (r) => r.notes ?? "" },
          ]} />
      </section>
    </div>
  );
}
