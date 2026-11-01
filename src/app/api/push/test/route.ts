import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { liveSubscriptions, pushConfigured, pushError, sendPush } from "@/lib/push";
import { failure, sameOrigin } from "../shared";

export const dynamic = "force-dynamic";

// Start-of-shift check (spec §13): push a test alert to this device only, through the real push service.
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "signed-out" }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "cross-site" }, { status: 403 });
  if (!pushConfigured()) return NextResponse.json({ error: "Phone notifications are not set up on the server (VAPID keys)." }, { status: 503 });
  try {
    const subs = await liveSubscriptions({ id: user.accountId }, { sessionId: user.sessionId });
    if (!subs.length) return NextResponse.json({ error: "This device is not registered for notifications yet." }, { status: 409 });
    const r = await sendPush(subs, { title: "Fido test alert", body: `Notifications work on this device, ${user.name}.`, url: "/settings#device", tag: "fido-test", urgent: true });
    if (!r.delivered) return NextResponse.json({ error: `The push service refused it: ${r.errors?.[0] ?? "unknown error"}` }, { status: 502 });
    return NextResponse.json({ ok: true, delivered: r.delivered });
  } catch (e) {
    return failure(pushError(e));
  }
}
