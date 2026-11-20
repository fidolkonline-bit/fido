import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dayStart } from "@/lib/hr";
import { resolvePeriod, toCsv } from "@/lib/reports/run";
import { commissionStatement } from "@/lib/commission-statement";
import { reportXlsx, reportPdf, download, exportFormat, generatedLine } from "@/lib/reports/export";

export const dynamic = "force-dynamic";

// The signed-in person's own commission statement as PDF / Excel / CSV. Never anyone else's.
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "signed-out" }, { status: 401 });
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const format = exportFormat(sp.format);
  const { from, to } = resolvePeriod(sp);
  const result = await commissionStatement({ from: dayStart(from), to: new Date(dayStart(to).getTime() + 86_400_000), personId: user.personId });
  const name = `commission-${from}_${to}`;
  if (format === "csv") return download(toCsv(result), format, name);
  const business = (await db.business.findFirst({ select: { name: true } }))?.name ?? "Fido";
  const meta = { title: `${result.title} - ${business}`, lines: [`${user.name} · ${from} to ${to}`, generatedLine(user.name)] };
  return download(format === "pdf" ? reportPdf(result, meta) : await reportXlsx(result, meta), format, name);
}
