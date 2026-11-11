"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp, loginLocked, recordLoginAttempt, startSession, verifyPassword } from "@/lib/auth";

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
  await startSession(account.id, h.get("user-agent"));
  redirect("/");
}
