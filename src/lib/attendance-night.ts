import "server-only";
import { db, posting } from "./db";
import { money } from "./money";
import { nextCutoff } from "./day-cutoff";
import { getAttendanceSettings } from "./shop-device";
import { shiftEndFor, ymd } from "./hr";
import { liveSubscriptions, sendPush } from "./push";

const time = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit" });

// Owners and managers who review drawers (or attendance) get the alert on their installed app.
async function notify(permission: string, payload: { title: string; body: string; url: string; tag: string }) {
  try {
    await sendPush(await liveSubscriptions({ role: { permissions: { has: permission } } }), payload);
  } catch (e) {
    console.error("attendance alert failed", e);
  }
}

// One alert per drawer: when someone ends the day leaving it open, or when it is still open after the nightly cutoff.
export async function alertDrawerOpen(registerId: string, why: string) {
  const already = await db.auditEvent.findFirst({ where: { action: "DRAWER_OPEN_ALERT", subjectId: registerId }, select: { id: true } });
  if (already) return false;
  const r = await db.registerSession.findUnique({ where: { id: registerId }, include: { location: true, user: true } });
  if (!r || r.closedAt) return false;
  await db.auditEvent.create({ data: { actorId: null, action: "DRAWER_OPEN_ALERT", subjectType: "RegisterSession", subjectId: r.id, detail: { why } } });
  await notify("register.review", {
    title: `Cash drawer still open · ${r.location.name}`,
    body: `${why} Opened ${time(r.openedAt)} by ${r.user.fullName} with Rs. ${money(r.openingCash)}.`,
    url: "/register", tag: `drawer-${r.id}`,
  });
  return true;
}

// Every cron run (cheap and safe to repeat): after the nightly cutoff, close forgotten clock-ins and report open drawers.
export async function nightlyAttendance(now = new Date()) {
  const { dayCutoff } = await getAttendanceSettings();
  const lastCutoff = new Date(nextCutoff(dayCutoff, now).getTime() - 86_400_000);

  // Latest record per employee in the last week; an IN from before the last cutoff was never ended.
  const latest = await db.clockEvent.findMany({
    where: { voidedAt: null, at: { gte: new Date(now.getTime() - 7 * 86_400_000) } },
    orderBy: { at: "desc" }, distinct: ["employeeId"], include: { employee: { include: { shift: true, person: true } } },
  });
  const closed: { name: string; at: Date; day: string }[] = [];
  for (const e of latest) {
    if (e.kind !== "IN" || e.at >= lastCutoff) continue;
    const end = e.employee.shift ? shiftEndFor(e.employee.shift, e.at) : null;
    if (end && end > lastCutoff) continue; // a shift that runs past the cutoff: wait for the next one
    // Shift end when it came after the clock-in; otherwise no hours are assumed. Either way it is flagged for review.
    const at = end && end > e.at ? end : e.at;
    const out = await posting(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "EmployeeProfile" WHERE id = ${e.employeeId} FOR UPDATE`;
      const last = await tx.clockEvent.findFirst({ where: { employeeId: e.employeeId, voidedAt: null }, orderBy: { at: "desc" } });
      if (last?.id !== e.id) return null; // something was recorded meanwhile
      return tx.clockEvent.create({
        data: {
          employeeId: e.employeeId, kind: "OUT", at, source: "AUTO", locationId: e.locationId, deviceId: e.deviceId,
          note: end && end > e.at ? "No clock-out by the nightly cutoff: set to the shift end. Check and correct." : "No clock-out by the nightly cutoff and no shift end to use: no hours counted. Check and correct.",
        },
      });
    });
    if (out) closed.push({ name: e.employee.person.fullName, at, day: ymd(e.at) });
  }
  if (closed.length) {
    await db.auditEvent.create({ data: { actorId: null, action: "AUTO_CLOCK_OUT", subjectType: "Attendance", subjectId: closed[0].day, detail: { people: closed.map((c) => ({ name: c.name, at: c.at.toISOString() })) } } });
    await notify("attendance.manage", {
      title: `No clock-out: ${closed.length === 1 ? closed[0].name : `${closed.length} people`}`,
      body: `${closed.map((c) => c.name).join(", ")} did not end the day. Clock-out set automatically; check it on Attendance.`,
      url: `/hrm/attendance?day=${closed[0].day}`, tag: `autoout-${closed[0].day}`,
    });
  }

  const drawers = await db.registerSession.findMany({ where: { closedAt: null, openedAt: { lt: lastCutoff } }, select: { id: true } });
  let drawerAlerts = 0;
  for (const d of drawers) if (await alertDrawerOpen(d.id, "It was not closed by the nightly cutoff.")) drawerAlerts++;
  return { autoClockOuts: closed.length, drawerAlerts };
}

