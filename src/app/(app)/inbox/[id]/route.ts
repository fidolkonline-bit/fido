import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Opening a notification marks it read and goes to what it is about. Only the recipient's own, only same-site paths.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const n = await db.notification.findFirst({ where: { id: (await params).id, personId: user.personId } });
  if (!n) return NextResponse.redirect(new URL("/inbox", req.url));
  if (!n.readAt) await db.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
  return NextResponse.redirect(new URL(/^\/(?!\/)/.test(n.url) ? n.url : "/inbox", req.url));
}
