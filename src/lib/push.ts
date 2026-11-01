import "server-only";
import webpush from "web-push";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "./db";

// Web Push transport for the installed app (Android, iPhone home-screen app, Windows/Mac browsers).
// Polling in TaskAlerts stays the source of truth; a push only wakes a phone whose app is closed.
// Configure with VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT (`npx web-push generate-vapid-keys`).

export type PushPayload = { title: string; body: string; url: string; tag?: string; urgent?: boolean };

let ready: boolean | null = null;
function setup() {
  if (ready !== null) return ready;
  const pub = process.env.VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!pub || !priv) return (ready = false);
  // Apple's push service rejects a missing or localhost subject; set VAPID_SUBJECT to mailto:… or the app URL.
  const site = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const subject = process.env.VAPID_SUBJECT?.trim() || (site ? `https://${site}` : "https://localhost");
  try {
    webpush.setVapidDetails(subject, pub, priv);
    ready = true;
  } catch (e) {
    console.error("Web Push disabled: VAPID keys are invalid.", e);
    ready = false;
  }
  return ready;
}

export const pushConfigured = () => setup();
export const pushPublicKey = () => (setup() ? process.env.VAPID_PUBLIC_KEY!.trim() : null);

// Only real browser push services, so a crafted subscription cannot make the server call an arbitrary URL.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];

export const subscriptionInput = z.object({
  endpoint: z.string().url().max(2000).refine((u) => {
    const url = new URL(u);
    return url.protocol === "https:" && PUSH_HOSTS.some((h) => h.test(url.hostname));
  }, "Not a browser push service."),
  keys: z.object({ p256dh: z.string().min(16).max(200), auth: z.string().min(8).max(100) }),
});

export class PushNotReady extends Error {}

// The table arrives with a migration; until `npm run db:deploy` has run, push quietly does nothing.
function missingTable(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2021" || e.code === "P2022");
}
let pausedUntil = 0;
export const pushPaused = () => Date.now() < pausedUntil;
export function pushError(e: unknown) {
  if (missingTable(e)) {
    if (!pushPaused()) console.error("Web Push tables are missing: run `npm run db:deploy`. Task pushes pause for 5 minutes.");
    pausedUntil = Date.now() + 5 * 60_000; // keep the logs quiet until the migration has run
    return new PushNotReady("Notifications are not ready on the server yet (database update pending).");
  }
  return e;
}

export async function saveSubscription(sessionId: string, raw: unknown, userAgent: string | null) {
  const sub = subscriptionInput.parse(raw);
  const data = { p256dh: sub.keys.p256dh, auth: sub.keys.auth, sessionId, userAgent: userAgent?.slice(0, 200) ?? null, lastError: null };
  try {
    // Same browser, new login: the endpoint moves to the session that is signed in now.
    await db.pushSubscription.upsert({ where: { endpoint: sub.endpoint }, create: { endpoint: sub.endpoint, ...data }, update: data });
  } catch (e) {
    throw pushError(e);
  }
}

export async function removeSubscription(accountId: string, endpoint: string) {
  try {
    await db.pushSubscription.deleteMany({ where: { endpoint, session: { accountId } } });
  } catch (e) {
    throw pushError(e);
  }
}

type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

// Subscriptions whose login session is still live (logged-out or expired sessions get nothing).
export function liveSubscriptions(account: Prisma.LoginAccountWhereInput, extra: Prisma.PushSubscriptionWhereInput = {}) {
  return db.pushSubscription.findMany({
    where: { ...extra, session: { revokedAt: null, expiresAt: { gt: new Date() }, account: { allowLogin: true, person: { active: true }, ...account } } },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
}

export async function sendPush(subs: Sub[], payload: PushPayload) {
  if (!setup() || !subs.length) return { devices: subs.length, delivered: 0 };
  const unique = [...new Map(subs.map((s) => [s.endpoint, s])).values()];
  const body = JSON.stringify(payload);
  const results = await Promise.allSettled(
    unique.map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
        TTL: 60 * 60, // an hour-old task alert is no longer useful
        urgency: payload.urgent ? "high" : "normal",
        topic: payload.tag?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined, // a newer alert replaces an undelivered one
        timeout: 10_000,
      }),
    ),
  );
  const ok: string[] = [];
  const gone: string[] = [];
  const failed: { id: string; error: string }[] = [];
  results.forEach((r, i) => {
    const s = unique[i];
    if (r.status === "fulfilled") ok.push(s.id);
    else {
      const err = r.reason as { statusCode?: number; body?: string; message?: string };
      if (err.statusCode === 404 || err.statusCode === 410) gone.push(s.id); // unsubscribed or app removed
      else failed.push({ id: s.id, error: `${err.statusCode ?? ""} ${err.body || err.message || "send failed"}`.trim().slice(0, 300) });
    }
  });
  await Promise.all([
    ok.length && db.pushSubscription.updateMany({ where: { id: { in: ok } }, data: { lastSuccessAt: new Date(), lastError: null } }),
    gone.length && db.pushSubscription.deleteMany({ where: { id: { in: gone } } }),
    ...failed.map((f) => db.pushSubscription.update({ where: { id: f.id }, data: { lastError: f.error } })),
  ]);
  return { devices: unique.length, delivered: ok.length, errors: failed.map((f) => f.error) };
}
