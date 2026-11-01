import { NextResponse, type NextRequest } from "next/server";

// Fast redirect for missing cookies; the session itself is validated on the server in each layout/action.
export function middleware(req: NextRequest) {
  if (!req.cookies.get("fido_session")) {
    if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "signed-out" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!login|api/cron|_next|favicon.ico|icon|manifest).*)"] };
