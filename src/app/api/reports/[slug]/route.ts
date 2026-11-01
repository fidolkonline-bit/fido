import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { reportBySlug } from "@/lib/reports";
import { runReport, toCsv } from "@/lib/reports/run";

export const dynamic = "force-dynamic";

// CSV export with exactly the same filters and permissions as the screen (AC-44).
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "signed-out" }, { status: 401 });
  const def = reportBySlug((await params).slug);
  if (!def) return NextResponse.json({ error: "not found" }, { status: 404 });
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  try {
    const { result, ctx } = await runReport(user, def, sp);
    const name = `${def.id}-${def.slug}_${def.asOf ? ctx.toYmd : `${ctx.fromYmd}_${ctx.toYmd}`}.csv`;
    return new NextResponse(toCsv(result), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}
