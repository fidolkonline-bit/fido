import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { db } from "./db";
import { saveSetting } from "./settings";
import type { CurrentUser } from "./auth";
import { nextCutoff } from "./day-cutoff";

// A shop device is a browser the owner marked as standing in a shop. It keeps a random key in a long-lived cookie;
// the database only has its hash. Sign-ins on it end at the nightly cutoff, so staff sign in again every morning.

export class ShopDeviceError extends Error {}

const COOKIE = "fido_device";
const COOKIE_DAYS = 3 * 365;
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

// ── Nightly cutoff ──

export const attendanceSchema = z.object({
  dayCutoff: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 02:00.").default("02:00"),
});
export type AttendanceSettings = z.infer<typeof attendanceSchema>;

export async function getAttendanceSettings(): Promise<AttendanceSettings> {
  const row = await db.appSetting.findUnique({ where: { key: "attendance" } });
  const parsed = attendanceSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : attendanceSchema.parse({});
}

export async function saveAttendanceSettings(user: CurrentUser, raw: unknown) {
  const v = attendanceSchema.parse(raw);
  await saveSetting("attendance", { ...(await getAttendanceSettings()), ...v }, user.personId);
  return v;
}

// ── This browser's device ──

async function loadDevice() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const d = await db.shopDevice.findUnique({ where: { tokenHash: hashToken(token) }, include: { location: true } });
  return d && !d.revokedAt && d.location.active ? d : null;
}

export const currentDevice = cache(loadDevice);

export async function registerDevice(user: CurrentUser, input: { name: string; locationId: string }) {
  const name = input.name.trim();
  if (!name) throw new ShopDeviceError("Give this device a name, for example “Main shop till”.");
  if (name.length > 60) throw new ShopDeviceError("Keep the name under 60 characters.");
  const loc = await db.location.findUnique({ where: { id: input.locationId } });
  if (!loc || !loc.active) throw new ShopDeviceError("Choose the shop this device is in.");
  if (await currentDevice()) throw new ShopDeviceError("This device is already registered. Unregister it first to change it.");

  const token = randomBytes(32).toString("base64url");
  const cutoff = nextCutoff((await getAttendanceSettings()).dayCutoff);
  const device = await db.$transaction(async (tx) => {
    const d = await tx.shopDevice.create({ data: { name, locationId: loc.id, tokenHash: hashToken(token), registeredById: user.personId, lastSeenAt: new Date() } });
    // The sign-in that registered it now counts as a shop sign-in too: it moves to this shop and ends tonight.
    const s = await tx.session.findUniqueOrThrow({ where: { id: user.sessionId } });
    await tx.session.update({ where: { id: s.id }, data: { deviceId: d.id, locationId: loc.id, expiresAt: s.expiresAt < cutoff ? s.expiresAt : cutoff } });
    await tx.auditEvent.create({ data: { actorId: user.personId, action: "SHOP_DEVICE_REGISTERED", subjectType: "ShopDevice", subjectId: d.id, detail: { name, locationId: loc.id } } });
    return d;
  });
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: new Date(Date.now() + COOKIE_DAYS * 86_400_000),
  });
  // The session cookie must not outlive the session row.
  const session = jar.get("fido_session");
  if (session) jar.set("fido_session", session.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: cutoff });
  return device;
}

// Unregistering keeps the row (sessions and, later, clock events point at it); the key simply stops working.
export async function unregisterDevice(user: CurrentUser, id: string) {
  const d = await db.shopDevice.findUnique({ where: { id } });
  if (!d || d.revokedAt) throw new ShopDeviceError("This device is not registered.");
  const here = (await currentDevice())?.id === id;
  await db.$transaction([
    db.shopDevice.update({ where: { id }, data: { revokedAt: new Date() } }),
    db.auditEvent.create({ data: { actorId: user.personId, action: "SHOP_DEVICE_UNREGISTERED", subjectType: "ShopDevice", subjectId: id, detail: { name: d.name } } }),
  ]);
  if (here) (await cookies()).delete(COOKIE);
}

// Called by startSession: what a new sign-in on this browser should look like.
export async function deviceForSignIn() {
  const device = await currentDevice();
  if (!device) return null;
  const cutoff = nextCutoff((await getAttendanceSettings()).dayCutoff);
  await db.shopDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  return { id: device.id, locationId: device.locationId, cutoff };
}
