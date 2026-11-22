import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { unreadCount } from "@/lib/notify";

export const dynamic = "force-dynamic";

// Polled by the bell in the top bar.
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "signed-out" }, { status: 401 });
  return NextResponse.json({ unread: await unreadCount(user.personId) }, { headers: { "Cache-Control": "no-store" } });
}
