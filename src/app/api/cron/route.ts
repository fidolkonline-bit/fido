import { NextResponse } from "next/server";
import { dispatchTaskPushes, escalateOverdue } from "@/lib/tasks";
import { dispatchSms } from "@/lib/sms";
import { fireReminders } from "@/lib/essentials";
import { generateRecurringExpenses, generateSubscriptions } from "@/lib/drafts";
import { remindInstalments } from "@/lib/instalments";
import { db } from "@/lib/db";
import { nightlyAttendance } from "@/lib/attendance-night";

export const dynamic = "force-dynamic";

// Vercel Cron (every minute): escalate unacknowledged tasks even when no device is open, send queued SMS and phone pushes.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const reminders = await fireReminders();
  const escalated = await escalateOverdue();
  const [expenses, subscriptions] = await Promise.all([generateRecurringExpenses(), generateSubscriptions()]);
  const instalments = await remindInstalments();
  const [sms, pushes] = await Promise.all([dispatchSms(50), dispatchTaskPushes()]);
  // After the nightly cutoff: forgotten clock-outs are closed (flagged for review) and open drawers reported.
  const attendance = await nightlyAttendance();
  // Housekeeping (cheap, safe to repeat): old error-log rows and sign-in tries are dropped after 90 days.
  const old = new Date(Date.now() - 90 * 86_400_000);
  await Promise.all([db.errorLog.deleteMany({ where: { createdAt: { lt: old } } }), db.loginAttempt.deleteMany({ where: { createdAt: { lt: old } } })]);
  return NextResponse.json({ reminders, escalated, expenses, subscriptions, instalments, sms, pushes, attendance });
}
