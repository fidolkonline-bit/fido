import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { money, fmtDateTime, D } from "@/lib/money";
import { dayReport } from "@/lib/day-end";
import { DENOMINATIONS, VARIANCE_REASONS } from "@/lib/register";
import { PageHead, Badge, Stat } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { CloseRegisterForm } from "../register/RegisterForms";
import { endMyDay } from "./actions";

export const metadata = { title: "End my day" };

const time = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit" });
const hm = (mins: number) => `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;

// The day so far, the drawer close when this person is the last one on the clock, then clock out and sign out.
export default async function EndMyDay() {
  const user = await requireUser();
  const r = await dayReport(user);
  const where = user.device?.name ?? user.location?.name ?? "";
  const blocked = r.mustClose && r.canClose;
  const diff = r.lastClose?.variance != null ? D(r.lastClose.variance) : null;

  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <PageHead eyebrow={`End of day${where ? ` · ${where}` : ""}`} title={`Your day, ${user.name.split(" ")[0]}`} />

      <section className="panel stack">
        <div className="stats" style={{ borderBottom: 0, paddingBottom: 0 }}>
          {r.since ? (
            <>
              <Stat label="Clocked in" value={time(r.since)} basis={r.late ? <Badge tone="warn">Late</Badge> : r.shift ? `Shift ${r.shift.startTime}–${r.shift.endTime}` : "No shift set"} />
              <Stat label="Now" value={time(new Date())} basis={r.shift ? `Shift ends ${r.shift.endTime}` : undefined} />
              <Stat label="Worked" value={hm(r.minutes)} />
            </>
          ) : null}
          <Stat label="My sales" value={`Rs. ${money(r.sales.total)}`} basis={`${r.sales.count} sale${r.sales.count === 1 ? "" : "s"}`} />
          <Stat label="Debt collected" value={`Rs. ${money(r.collections.total)}`} basis={`${r.collections.count} payment${r.collections.count === 1 ? "" : "s"}`} />
        </div>
        {!r.employee && <p className="small muted" style={{ margin: 0 }}>Attendance isn&apos;t recorded for you: you don&apos;t have an employee profile.</p>}
        {r.employee && !r.since && <p className="small muted" style={{ margin: 0 }}>You are not clocked in, so there is nothing to clock out.</p>}
        {r.earlyBy > 0 && (
          <p className="note" style={{ margin: 0 }}>Your shift ends at {r.shift!.endTime}, {hm(r.earlyBy)} from now. Leaving early is shown on the attendance record for the manager to review.</p>
        )}
      </section>

      <section className="stack">
        <h2 style={{ margin: 0 }}>Cash drawer</h2>
        {r.drawer ? (
          r.mustClose && r.canClose ? (
            <>
              <p className="note" style={{ margin: 0 }}>You are the last one on the clock. Count and close the drawer before you go.</p>
              <CloseRegisterForm registerId={r.drawer.id} expected={Number(r.drawer.summary!.expected)} denominations={DENOMINATIONS} returnTo="/end"
                varianceReasons={Object.entries(VARIANCE_REASONS).map(([value, label]) => ({ value, label }))} />
            </>
          ) : r.mustClose ? (
            <p className="note note-err" style={{ margin: 0 }}>The drawer is still open and you are the last one on the clock, but you can&apos;t close it. Ending your day will note that the drawer was left open.</p>
          ) : (
            <div className="panel stack">
              <p className="small" style={{ margin: 0 }}>
                Open since {fmtDateTime(r.drawer.openedAt)} (opened by {r.drawer.user.fullName}).
                {r.drawer.summary && <> It should hold Rs. {money(r.drawer.summary.expected)}.</>}
              </p>
              {r.others.length > 0 && (
                <p className="small" style={{ margin: 0 }}>
                  Still on the clock: {r.others.map((o) => `${o.name} (since ${time(o.since)})`).join(", ")}. The last one to end their day closes the drawer.
                </p>
              )}
              {r.canClose && <div><Link className="btn btn-sm" href="/register#close">Count &amp; close now</Link></div>}
            </div>
          )
        ) : r.lastClose ? (
          <p className="small" style={{ margin: 0 }}>
            Closed at {time(r.lastClose.closedAt!)} by {r.lastClose.closedBy?.fullName ?? "someone"}: counted Rs. {money(r.lastClose.countedCash)},{" "}
            <span style={{ color: diff && !diff.eq(0) ? "var(--err)" : "var(--ok)" }}>{diff && !diff.eq(0) ? `difference Rs. ${money(diff)}` : "balanced"}</span>.{" "}
            <Link href={`/register/${r.lastClose.id}`}>Settlement</Link>
          </p>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>The drawer is closed.</p>
        )}
      </section>

      <ActionForm action={endMyDay} className="panel stack">
        {blocked ? (
          <p className="small muted" style={{ margin: 0 }}>Close the drawer above, then you can clock out.</p>
        ) : (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              {r.since ? "This records your clock-out with the server's time and signs you out of this device." : "This signs you out of this device."}
            </p>
            <div className="row"><SubmitButton pendingText="Ending…">{r.since ? "Clock out and sign out" : "Sign out"}</SubmitButton></div>
          </>
        )}
      </ActionForm>
    </div>
  );
}
