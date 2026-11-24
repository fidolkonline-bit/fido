import "server-only";
import { db } from "./db";
import { ZERO } from "./money";
import { evaluate, expandCategories, validateBands, earning, type Band, type TargetLine } from "./target-calc";

export { validateBands, earning, type Band };

type TargetInput = { personId: string; periodStart: Date; periodEnd: Date; bands: unknown; mode: string; cadence: string; categoryIds: string[] };

// Sale lines credited to the person (salesperson, else the cashier) in the period, net of discounts and returns, excluding rounding.
async function targetLines(personId: string, start: Date, end: Date, cats: Set<string> | null): Promise<TargetLine[]> {
  const startInst = new Date(start.getTime() - 330 * 60_000);
  const endExcl = new Date(end.getTime() + 86_400_000 - 330 * 60_000);
  const inCats = cats ? [...cats] : null;
  const lines = await db.saleLine.findMany({
    where: {
      sale: { stage: "FINAL", soldAt: { gte: startInst, lt: endExcl }, OR: [{ salespersonId: personId }, { salespersonId: null, createdById: personId }] },
      ...(inCats ? { OR: [{ categoryId: { in: inCats } }, { categoryId: null, product: { categoryId: { in: inCats } } }] } : {}),
    },
    select: {
      lineTotal: true, categoryId: true,
      product: { select: { sku: true, categoryId: true } },
      sale: { select: { soldAt: true, subtotal: true, discount: true } },
      returnLines: { select: { value: true } },
    },
  });
  return lines.map((l) => ({
    soldAt: l.sale.soldAt, lineTotal: l.lineTotal, saleSubtotal: l.sale.subtotal, saleDiscount: l.sale.discount,
    returned: l.returnLines.reduce((a, r) => a.plus(r.value), ZERO),
    categoryId: l.categoryId ?? l.product.categoryId,
    // Reloads are excluded: their margin is the provider spread, not a sales target.
    reload: l.product.sku === "RELOAD",
  }));
}

export async function targetResult(t: TargetInput) {
  const cats = t.categoryIds.length ? expandCategories(t.categoryIds, await db.category.findMany({ select: { id: true, parentId: true } })) : null;
  const lines = await targetLines(t.personId, t.periodStart, t.periodEnd, cats);
  return evaluate(lines, { bands: t.bands as Band[], mode: t.mode, cadence: t.cadence }, cats);
}
