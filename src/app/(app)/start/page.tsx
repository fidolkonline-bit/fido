import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { money } from "@/lib/money";
import * as H from "@/lib/hr";
import { lastCashLeft } from "@/lib/register";
import { PageHead, Badge } from "@/components/ui";
import { OpenRegisterForm } from "../register/RegisterForms";
import { ClockButton } from "../hrm/ClockButton";

export const metadata = { title: "Start of day" };

const time = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit" });
const hourNow = () => Number(new Date().toLocaleString("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", hour12: false }));
const hm = (mins: number) => (mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m` : `${mins} min`);

// Shown after signing in on a shop device: the clock-in that just happened and, if nobody has yet, opening the drawer.
export default async function StartOfDay() {
  const user = await requireUser();
  if (!user.device) redirect("/");
  const loc = user.location;
  const next = can(user, "sales.create") ? "/pos" : "/";
  const operate = can(user, "register.operate");

  const [emp, drawer] = await Promise.all([
    db.employeeProfile.findUnique({ where: { personId: user.personId }, include: { shift: true } }),
    loc ? db.registerSession.findFirst({ where: { locationId: loc.id, closedAt: null }, include: { user: true } }) : null,
  ]);
  const active = emp?.status === "ACTIVE" ? emp : null;
  // Nothing to tell this person: not an employee, and the drawer is open or not theirs to open.
  if (!active && (drawer || !operate)) redirect(next);

  const today = H.todayYmd();
  const [last, day, prev] = await Promise.all([
    active ? db.clockEvent.findFirst({ where: { employeeId: active.id, voidedAt: null }, orderBy: { at: "desc" } }) : null,
    active ? H.attendance(active.id, today, today).then((d) => d[0]) : null,
    !drawer && operate && loc ? lastCashLeft(db, loc.id) : null,
  ]);
  const onClock = H.stillClockedIn(last);
  const since = onClock ? last!.at : null;

  let status: React.ReactNode = null;
  if (since && day) {
    const [sh, sm] = (active!.shift?.startTime ?? "09:00").split(":").map(Number);
    const lateBy = Math.round((since.getTime() - (H.dayStart(today).getTime() + (sh * 60 + sm) * 60_000)) / 60_000);
    status = day.offDayWork
      ? <Badge tone="warn">{day.holiday ? `Holiday: ${day.holiday}` : "Rest day"} — recorded as off-day work</Badge>
      : day.late ? <Badge tone="warn">{hm(lateBy)} after the shift start</Badge>
      : day.firstIn ? <Badge tone="ok">On time</Badge> : null;
  }

  const h = hourNow();
  const greeting = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <PageHead eyebrow={`Start of day · ${user.device.name}`} title={`${greeting}, ${user.name.split(" ")[0]}`} />

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Attendance</h2>
        {active && since ? (
          <>
            <p style={{ margin: 0, fontSize: 22 }}>Clocked in at <strong>{time(since)}</strong></p>
            <div className="row" style={{ gap: 8 }}>
              {status}
              <span className="small muted">{active.shift ? `${active.shift.name} · ${active.shift.startTime}–${active.shift.endTime}` : "No shift set"}</span>
            </div>
            {last?.source === "LOGIN" && last.sessionId === user.sessionId && <p className="small muted" style={{ margin: 0 }}>Recorded when you signed in on {user.device.name}, with the server&apos;s time.</p>}
          </>
        ) : active ? (
          <ClockButton clockedIn={false} since={null} />
        ) : (
          <p className="small muted" style={{ margin: 0 }}>Attendance isn&apos;t recorded for you: you don&apos;t have an employee profile.</p>
        )}
      </section>

      {drawer ? (
        <section className="panel stack">
          <div className="row"><h2 style={{ margin: 0 }}>Cash drawer</h2><Badge tone="ok">Open</Badge></div>
          <p className="small" style={{ margin: 0 }}>Opened at {time(drawer.openedAt)} by {drawer.user.fullName} with Rs. {money(drawer.openingCash)}.</p>
        </section>
      ) : operate ? (
        <OpenRegisterForm expectedOpening={prev ? Number(prev.cashLeft) : null} />
      ) : (
        <p className="note">The cash drawer isn&apos;t open yet. Ask someone who can open the register.</p>
      )}

      <div className="row">
        <Link className="btn btn-primary" href={next} style={{ minHeight: 48 }}>{next === "/pos" ? "Go to POS" : "Continue"}</Link>
        {next !== "/" && <Link className="btn" href="/" style={{ minHeight: 48 }}>Home</Link>}
      </div>
    </div>
  );
}
