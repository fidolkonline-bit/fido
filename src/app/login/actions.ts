"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { startSession, verifyPassword } from "@/lib/auth";

export async function login(_: { error?: string } | undefined, form: FormData) {
  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");
  if (!username || !password) return { error: "Enter your username and password." };
  const account = await verifyPassword(username, password);
  if (!account) return { error: "Username or password is not correct, or this login is disabled." };
  await startSession(account.id, (await headers()).get("user-agent"));
  redirect("/");
}
