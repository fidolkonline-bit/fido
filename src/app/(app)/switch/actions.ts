"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { clientIp, endSession, hashPassword, loginLocked, recordLoginAttempt, requireUser, startSession, verifyPassword, verifyPin } from "@/lib/auth";
import type { FormState } from "@/lib/forms";

const WEAK = new Set(["0000", "1111", "1234", "4321", "123456", "000000", "111111", "2222", "9999"]);

// Hand the till to another cashier without typing a full password. Only works from a device that is already signed in,
// only for people allowed at this location, and wrong PINs count towards the same lock as wrong passwords.
export async function switchCashier(_: FormState, f: FormData): Promise<FormState> {
  const current = await requireUser();
  const accountId = String(f.get("accountId") ?? "");
  const pin = String(f.get("pin") ?? "");
  if (!accountId || !/^\d{4,6}$/.test(pin)) return { error: "Choose your name and enter your 4–6 digit PIN." };
  const target = await db.loginAccount.findUnique({ where: { id: accountId }, include: { role: true, locations: true } });
  if (!target || !target.pinHash) return { error: "This person has no PIN. Sign in with the password instead." };
  const loc = current.location;
  const allowedHere = target.role.permissions.includes("settings.manage") || (!!loc && target.locations.some((l) => l.locationId === loc.id));
  if (!allowedHere) return { error: "This person is not assigned to this location." };
  const h = await headers();
  const ip = clientIp(h);
  if (await loginLocked(target.username, null)) return { error: "Too many wrong tries for this person. Wait 15 minutes or sign in with the password." };
  const ok = await verifyPin(accountId, pin);
  await recordLoginAttempt(target.username, ip, !!ok, "PIN");
  if (!ok) return { error: "PIN is not correct." };
  await endSession();
  await startSession(target.id, h.get("user-agent"), { viaPin: true, locationId: loc?.id ?? null });
  await db.auditEvent.create({ data: { actorId: target.personId, action: "CASHIER_SWITCHED", subjectType: "Person", subjectId: target.personId, detail: { from: current.personId } } });
  redirect("/");
}

export async function setOwnPin(_: FormState, f: FormData): Promise<FormState> {
  const user = await requireUser();
  const pin = String(f.get("pin") ?? "");
  const remove = f.get("remove") === "1";
  if (!(await verifyPassword(user.username, String(f.get("current") ?? "")))) return { error: "Current password is not correct." };
  if (remove) {
    await db.loginAccount.update({ where: { id: user.accountId }, data: { pinHash: null } });
    return { ok: "PIN removed. You can only sign in with your password now." };
  }
  if (!/^\d{4,6}$/.test(pin)) return { error: "PIN must be 4 to 6 digits." };
  if (WEAK.has(pin)) return { error: "That PIN is too easy to guess. Choose another." };
  if (pin !== String(f.get("confirm") ?? "")) return { error: "The two PINs do not match." };
  await db.loginAccount.update({ where: { id: user.accountId }, data: { pinHash: await hashPassword(pin) } });
  await db.auditEvent.create({ data: { actorId: user.personId, action: "PIN_SET", subjectType: "Person", subjectId: user.personId } });
  return { ok: "PIN saved. Use Switch cashier on a signed-in shop device." };
}
