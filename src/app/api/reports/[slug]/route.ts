import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { reportBySlug } from "@/lib/reports";
import { runReport, toCsv } from "@/lib/reports/run";
import { reportXlsx, reportPdf, download, exportFormat, generatedLine } from "@/lib/reports/export";

export const dynamic = "force-dynamic";

// CSV, Excel or PDF export with exactly the same filters and permissions as the screen (AC-44).
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "signed-out" }, { status: 401 });
  const def = reportBySlug((await params).slug);
  if (!def) return NextResponse.json({ error: "not found" }, { status: 404 });
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const format = exportFormat(sp.format);
  try {
    const { result, ctx, paramDefs, scope } = await runReport(user, def, sp);
    const name = `${def.id}-${def.slug}_${def.asOf ? ctx.toYmd : `${ctx.fromYmd}_${ctx.toYmd}`}`;
    if (format === "csv") return download(toCsv(result), format, name);
    const business = (await db.business.findFirst({ select: { name: true } }))?.name ?? "Fido";
    const chosen = paramDefs.map((p) => `${p.label}: ${p.options.find(([v]) => v === ctx.params[p.key])?.[1] ?? ""}`);
    const meta = {
      title: `${result.title ?? def.title} - ${business}`,
      lines: [[def.asOf ? `As of ${ctx.toYmd}` : `${ctx.fromYmd} to ${ctx.toYmd}`, scope, ...chosen].filter(Boolean).join(" · "), generatedLine(user.name)],
    };
    return download(format === "pdf" ? reportPdf(result, meta) : await reportXlsx(result, meta), format, name);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}
