import "server-only";
import { db, posting } from "./db";
import { D, ZERO } from "./money";
import { can } from "./permissions";
import type { CurrentUser } from "./auth";
import { getAttendanceSettings } from "./shop-device";
import { attendance, dayStart, shiftEndFor, stillClockedIn, ymd } from "./hr";
import { drawerSummary } from "./register";

export class DayEndError extends Error {}

const ON_CLOCK_WINDOW = 16 * 3_600_000;

// Employees whose latest record is a clock-in at this shop within the last 16 hours.
export async function onClockAt(locationId: string) {
  const latest = await db.clockEvent.findMany({
    where: { voidedAt: null, at: { gte: new Date(Date.now() - ON_CLOCK_WINDOW) } },
    orderBy: { at: "desc" }, distinct: ["employeeId"],
    include: { employee: { include: { person: true } } },
  });
  return latest
    .filter((e) => e.kind === "IN" && e.locationId === locationId && e.employee.status === "ACTIVE")
    .map((e) => ({ employeeId: e.employeeId, personId: e.employee.personId, name: e.employee.person.fullName, since: e.at }));
}

export type DayReport = Awaited<ReturnType<typeof dayReport>>;

// What the End my day screen shows, and whether this person has to close the drawer before leaving.
export async function dayReport(user: CurrentUser, now = new Date()) {
  const loc = user.location;
  const settings = await getAttendanceSettings();
  const emp = await db.employeeProfile.findUnique({ where: { personId: user.personId }, include: { shift: true } });
  const active = emp?.status === "ACTIVE" ? emp : null;
  const last = active ? await db.clockEvent.findFirst({ where: { employeeId: active.id, voidedAt: null }, orderBy: { at: "desc" } }) : null;
  const since = stillClockedIn(last, now.getTime()) ? last!.at : null;

  // Work and sales are counted from the clock-in; without one, from the start of the business day.
  const from = since ?? dayStart(ymd(now));
  const [day, sales, collections, drawer, onClock] = await Promise.all([
    active && since ? attendance(active.id, ymd(since), ymd(since)).then((d) => d[0]) : null,
    db.sale.aggregate({ where: { createdById: user.personId, stage: "FINAL", createdAt: { gte: from } }, _count: true, _sum: { total: true } }),
    db.debtCollection.aggregate({ where: { createdById: user.personId, state: "POSTED", createdAt: { gte: from } }, _count: true, _sum: { received: true } }),
    loc ? db.registerSession.findFirst({ where: { locationId: loc.id, closedAt: null }, include: { user: true } }) : null,
    loc ? onClockAt(loc.id) : [],
  ]);
  const lastClose = !drawer && loc
    ? await db.registerSession.findFirst({ where: { locationId: loc.id, closedAt: { gte: from } }, orderBy: { closedAt: "desc" }, include: { closedBy: true } })
    : null;

  const others = onClock.filter((o) => o.personId !== user.personId);
  const minutes = since ? (day?.minutes ?? 0) + Math.max(0, Math.round((now.getTime() - since.getTime()) / 60_000)) : 0;
  let earlyBy = 0;
  if (since && active?.shift) {
    const end = shiftEndFor(active.shift, since);
    const mins = Math.round((end.getTime() - now.getTime()) / 60_000);
    if (mins > active.shift.graceMinutes) earlyBy = mins;
  }
  // The last person on the clock closes the drawer, when the setting asks for it.
  const lastOut = !!since && others.length === 0;
  const mustClose = settings.requireDrawerClose && lastOut && !!drawer;

  return {
    employee: active, since, minutes, late: !!day?.late, earlyBy, shift: active?.shift ?? null,
    sales: { count: sales._count, total: D(sales._sum.total ?? ZERO) },
    collections: { count: collections._count, total: D(collections._sum.received ?? ZERO) },
    drawer: drawer ? { ...drawer, summary: can(user, "register.operate") ? await drawerSummary(db, drawer.id) : null } : null,
    lastClose, others, lastOut, mustClose, canClose: can(user, "register.operate"),
  };
}

// Clock out (if on the clock) and record the day's end. The caller then signs the person out.
export async function endDay(user: CurrentUser, ip: string | null) {
  const r = await dayReport(user);
  if (r.mustClose && r.canClose) throw new DayEndError("You are the last one on the clock. Count and close the cash drawer first.");
  const clockOut = r.employee && r.since
    ? await posting(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "EmployeeProfile" WHERE id = ${r.employee!.id} FOR UPDATE`;
        const last = await tx.clockEvent.findFirst({ where: { employeeId: r.employee!.id, voidedAt: null }, orderBy: { at: "desc" } });
        if (!stillClockedIn(last)) return null;
        return tx.clockEvent.create({
          data: {
            employeeId: r.employee!.id, kind: "OUT", at: new Date(), source: "LOGOUT", locationId: user.device?.locationId ?? user.location?.id ?? null,
            deviceId: user.device?.id ?? null, ip: ip?.slice(0, 64) ?? null, sessionId: user.sessionId,
          },
        });
      })
    : null;
  await db.auditEvent.create({
    data: {
      actorId: user.personId, action: r.mustClose ? "DAY_ENDED_DRAWER_OPEN" : "DAY_ENDED", subjectType: "Person", subjectId: user.personId,
      detail: {
        clockIn: r.since?.toISOString() ?? null, clockOut: clockOut?.at.toISOString() ?? null, minutes: r.minutes, earlyBy: r.earlyBy,
        sales: r.sales.count, salesTotal: r.sales.total.toFixed(2), collections: r.collections.count, collected: r.collections.total.toFixed(2),
        drawerOpen: !!r.drawer, othersOnClock: r.others.map((o) => o.name), deviceId: user.device?.id ?? null,
      },
    },
  });
  return { clockOut };
}
