import "server-only";
import { db } from "./db";
import { createTask } from "./tasks";

const next = (at: Date, repeat: string) => {
  const n = new Date(at);
  if (repeat === "DAILY") n.setUTCDate(n.getUTCDate() + 1);
  else if (repeat === "WEEKLY") n.setUTCDate(n.getUTCDate() + 7);
  else if (repeat === "MONTHLY") n.setUTCMonth(n.getUTCMonth() + 1);
  else return null;
  return n;
};

// Due reminders become staff tasks (so they ring like any other task); each occurrence fires once.
export async function fireReminders() {
  const due = await db.reminder.findMany({ where: { active: true, nextAt: { lte: new Date() } }, take: 50 });
  let fired = 0;
  for (const r of due) {
    const key = r.nextAt.toISOString();
    const claimed = await db.reminder.updateMany({ where: { id: r.id, nextAt: r.nextAt, OR: [{ lastFiredKey: null }, { lastFiredKey: { not: key } }] }, data: { lastFiredKey: key } });
    if (!claimed.count) continue;
    await db.$transaction((tx) => createTask(tx, { kind: "GENERAL", title: `Reminder: ${r.title}`, details: r.details, locationId: r.locationId, assignedToId: r.assignedToId, createdById: r.createdById }));
    let n = next(r.nextAt, r.repeat);
    while (n && n <= new Date()) n = next(n, r.repeat); // skip missed occurrences instead of ringing for each
    await db.reminder.update({ where: { id: r.id }, data: n ? { nextAt: n } : { active: false } });
    fired++;
  }
  return fired;
}

export const canSee = (audience: string[], role: string) => audience.length === 0 || audience.includes(role);
