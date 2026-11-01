import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { alertsFor } from "@/lib/tasks";

export const dynamic = "force-dynamic";

// Polled by every signed-in device (spec §13: polling fallback; server acknowledgement is authoritative).
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "signed-out" }, { status: 401 });
  const alerts = await alertsFor(user);
  return NextResponse.json({ alerts, at: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
