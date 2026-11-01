import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { pushConfigured, removeSubscription, saveSubscription } from "@/lib/push";
import { failure, sameOrigin } from "./shared";

export const dynamic = "force-dynamic";

// The app (and the service worker, when the browser rotates a subscription) registers this device for phone alerts.
// Same-origin only; the session cookie says whose alerts it gets.
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "signed-out" }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "cross-site" }, { status: 403 });
  if (!pushConfigured()) return NextResponse.json({ error: "Phone notifications are not set up on the server (VAPID keys)." }, { status: 503 });
  try {
    await saveSubscription(user.sessionId, await req.json(), req.headers.get("user-agent"));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "signed-out" }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "cross-site" }, { status: 403 });
  try {
    const { endpoint } = (await req.json()) as { endpoint?: unknown };
    if (typeof endpoint === "string") await removeSubscription(user.accountId, endpoint);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
