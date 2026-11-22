import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { reportBySlug } from "@/lib/reports";
import { runReport, toCsv, withColumns } from "@/lib/reports/run";
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
    const run = await runReport(user, def, sp);
    const { ctx, paramDefs, scope, breakdown } = run;
    // part=breakdown exports the open tab (e.g. Profit by products) with the columns shown on screen.
    if (sp.part === "breakdown" && !breakdown) return NextResponse.json({ error: "You don't have permission for this action (cost.view)." }, { status: 403 });
    const result = sp.part === "breakdown" && breakdown ? withColumns(breakdown.result, sp.cols) : run.result;
    const name = `${def.id}-${def.slug}${sp.part === "breakdown" && breakdown ? `-by-${breakdown.by}` : ""}_${def.asOf ? ctx.toYmd : `${ctx.fromYmd}_${ctx.toYmd}`}`;
    if (format === "csv") return download(toCsv(result), format, name);
    const business = (await db.business.findFirst({ select: { name: true } }))?.name ?? "Fido";
    const chosen = paramDefs.map((p) => `${p.label}: ${p.options.find(([v]) => v === ctx.params[p.key])?.[1] ?? ""}`);
    const meta = {
      // The statement layout is headed like the old Clicky page: "Fido.lk - Profit / Loss Report".
      title: result.sheet ? `${business} - ${result.title ?? def.title}` : `${result.title ?? def.title} - ${business}`,
      lines: [[def.asOf ? `As of ${ctx.toYmd}` : `${ctx.fromYmd} to ${ctx.toYmd}`, scope, ...chosen].filter(Boolean).join(" · "), generatedLine(user.name)],
    };
    return download(format === "pdf" ? reportPdf(result, meta) : await reportXlsx(result, meta), format, name);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}
