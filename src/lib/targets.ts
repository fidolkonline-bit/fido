import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { D, ZERO } from "./money";

export type Band = { from: number; to: number | null; percent: number };

export function validateBands(bands: Band[]) {
  const sorted = [...bands].sort((a, b) => a.from - b.from);
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    if (!(b.percent >= 0) || b.from < 0 || (b.to != null && b.to <= b.from)) throw new Error("Each band needs from < to and a percent.");
    if (i > 0 && (sorted[i - 1].to == null || sorted[i - 1].to! > b.from)) throw new Error("Bands overlap or are ambiguous (§9.3).");
  }
  return sorted;
}

// Achieved = net sales credited to the person (salesperson, else the cashier) in the period, after returns, excluding rounding.
export async function achieved(personId: string, start: Date, end: Date) {
  const endExcl = new Date(end.getTime() + 86_400_000 - 330 * 60_000);
  const startInst = new Date(start.getTime() - 330 * 60_000);
  const sales = await db.sale.findMany({
    where: { stage: "FINAL", soldAt: { gte: startInst, lt: endExcl }, OR: [{ salespersonId: personId }, { salespersonId: null, createdById: personId }] },
    select: { subtotal: true, discount: true, credited: true, lines: { select: { product: { select: { sku: true } } } } },
  });
  // Reloads are excluded: their margin is the provider spread, not a sales target.
  return sales.filter((s) => !s.lines.every((l) => l.product.sku === "RELOAD")).reduce((a, s) => a.plus(s.subtotal).minus(s.discount).minus(s.credited), ZERO);
}

export function earning(value: Prisma.Decimal, bands: Band[], mode: string) {
  const sorted = [...bands].sort((a, b) => a.from - b.from);
  if (mode === "PROGRESSIVE") {
    return sorted.reduce((a, b) => {
      const top = b.to == null ? value : Prisma.Decimal.min(value, b.to);
      const slice = Prisma.Decimal.max(top.minus(b.from), ZERO);
      return a.plus(slice.mul(b.percent).div(100));
    }, ZERO).toDecimalPlaces(2);
  }
  const band = [...sorted].reverse().find((b) => value.gte(b.from));
  return band ? value.mul(band.percent).div(100).toDecimalPlaces(2) : ZERO;
}

export async function targetResult(t: { personId: string; periodStart: Date; periodEnd: Date; bands: unknown; mode: string }) {
  const value = await achieved(t.personId, t.periodStart, t.periodEnd);
  return { value, earning: earning(value, t.bands as Band[], t.mode) };
}

