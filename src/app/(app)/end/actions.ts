"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp, endSession, requireUser } from "@/lib/auth";
import { endDay } from "@/lib/day-end";
import { formError, type FormState } from "@/lib/forms";

const time = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit" });

// Clock out, then sign out. The login page says when the clock-out was recorded.
export async function endMyDay(_: FormState): Promise<FormState> {
  const user = await requireUser();
  let out: Date | null = null;
  try {
    out = (await endDay(user, clientIp(await headers()))).clockOut?.at ?? null;
  } catch (e) {
    return formError(e);
  }
  await endSession();
  redirect(out ? `/login?bye=${time(out)}` : "/login");
}
