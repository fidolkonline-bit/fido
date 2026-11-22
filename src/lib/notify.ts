import "server-only";
import { after } from "next/server";
import { db } from "./db";
import { liveSubscriptions, sendPush } from "./push";
import type { Permission } from "./permissions";

export type NotificationKind = "CLOCK_IN" | "CLOCK_OUT" | "AUTO_CLOCK_OUT" | "DRAWER_OPEN";

// Tell everyone whose role has `permission` (owners and managers): a row for the bell, and a push to their installed
// app. The person who caused it is left out. Never throws: an alert must not break a sign-in or a clock-out.
export async function notifyPeople(permission: Permission, n: { kind: NotificationKind; title: string; body: string; url: string; tag: string; exceptPersonId?: string | null }) {
  try {
    const people = await db.loginAccount.findMany({
      where: { allowLogin: true, person: { active: true }, role: { permissions: { has: permission } }, ...(n.exceptPersonId ? { personId: { not: n.exceptPersonId } } : {}) },
      select: { personId: true },
    });
    const ids = [...new Set(people.map((p) => p.personId))];
    if (!ids.length) return 0;
    const url = /^\/(?!\/)/.test(n.url) ? n.url : "/"; // same-site paths only
    await db.notification.createMany({ data: ids.map((personId) => ({ personId, kind: n.kind, title: n.title, body: n.body, url })) });
    const push = async () => {
      try {
        await sendPush(await liveSubscriptions({ personId: { in: ids } }), { title: n.title, body: n.body, url, tag: n.tag });
      } catch (e) {
        console.error("notification push failed", e);
      }
    };
    // Inside a request the push goes out after the response, so nobody waits for it; elsewhere (cron, tests) it is awaited.
    try { after(push); } catch { await push(); }
    return ids.length;
  } catch (e) {
    console.error("notification failed", e);
    return 0;
  }
}

export const unreadCount = (personId: string) => db.notification.count({ where: { personId, readAt: null } });
