"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp, loginLocked, recordLoginAttempt, startSession, verifyPassword } from "@/lib/auth";
import { clockInOnSignIn } from "@/lib/hr";

export async function login(_: { error?: string } | undefined, form: FormData) {
  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");
  if (!username || !password) return { error: "Enter your username and password." };
  const h = await headers();
  const ip = clientIp(h);
  // Checked before the password so a locked name cannot be guessed further, right or wrong.
  if (await loginLocked(username, ip)) return { error: "Too many wrong tries. Wait 15 minutes, or ask the owner to reset your password." };
  const account = await verifyPassword(username, password);
  await recordLoginAttempt(username, ip, !!account);
  if (!account) return { error: "Username or password is not correct, or this login is disabled." };
  const s = await startSession(account.id, h.get("user-agent"));
  // On a shop device the sign-in starts the day: clock in, then the start-of-day screen (which opens the drawer).
  if (s.device) {
    await clockInOnSignIn({ personId: account.personId, sessionId: s.sessionId, deviceId: s.device.id, locationId: s.device.locationId, ip });
    redirect("/start");
  }
  redirect("/");
}
