import { NextResponse } from "next/server";
import { escalateOverdue } from "@/lib/tasks";
import { dispatchSms } from "@/lib/sms";

export const dynamic = "force-dynamic";

// Vercel Cron (every minute): escalate unacknowledged tasks even when no device is open, and send queued SMS.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const escalated = await escalateOverdue();
  const sms = await dispatchSms(50);
  return NextResponse.json({ escalated, sms });
}
