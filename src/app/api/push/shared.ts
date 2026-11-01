import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { PushNotReady } from "@/lib/push";

export function sameOrigin(req: Request) {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = req.headers.get("origin");
  return !origin || new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
}

export function failure(e: unknown) {
  if (e instanceof ZodError) return NextResponse.json({ error: "This browser sent an unusable subscription." }, { status: 400 });
  if (e instanceof SyntaxError) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (e instanceof PushNotReady) return NextResponse.json({ error: e.message }, { status: 503 });
  console.error("Push subscription failed", e);
  return NextResponse.json({ error: "Could not save this device. Try again." }, { status: 500 });
}
