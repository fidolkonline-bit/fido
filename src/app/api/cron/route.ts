import { NextResponse } from "next/server";
import { dispatchTaskPushes, escalateOverdue } from "@/lib/tasks";
import { dispatchSms } from "@/lib/sms";
import { fireReminders } from "@/lib/essentials";
import { generateRecurringExpenses, generateSubscriptions } from "@/lib/drafts";

export const dynamic = "force-dynamic";

// Vercel Cron (every minute): escalate unacknowledged tasks even when no device is open, send queued SMS and phone pushes.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const reminders = await fireReminders();
  const escalated = await escalateOverdue();
  const [expenses, subscriptions] = await Promise.all([generateRecurringExpenses(), generateSubscriptions()]);
  const [sms, pushes] = await Promise.all([dispatchSms(50), dispatchTaskPushes()]);
  return NextResponse.json({ reminders, escalated, expenses, subscriptions, sms, pushes });
}
