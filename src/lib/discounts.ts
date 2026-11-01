import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { D } from "./money";

type Rule = Awaited<ReturnType<typeof activeRules>>[number];

export async function activeRules(locationId: string | null, at = new Date()) {
  return db.discountRule.findMany({
    where: {
      active: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: at } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: at } }] },
        { OR: [{ locationId: null }, ...(locationId ? [{ locationId }] : [])] },
      ],
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
}

// The single best-priority rule that applies to this product; rules never stack (S08).
export function ruleFor(rules: Rule[], p: { id: string; categoryId: string | null; brandId: string | null }) {
  return rules.find((r) =>
    r.scope === "ALL" ||
    (r.scope === "PRODUCT" && r.targetIds.includes(p.id)) ||
    (r.scope === "CATEGORY" && !!p.categoryId && r.targetIds.includes(p.categoryId)) ||
    (r.scope === "BRAND" && !!p.brandId && r.targetIds.includes(p.brandId))) ?? null;
}

export function perUnitDiscount(rule: Rule, price: Prisma.Decimal.Value) {
  const v = rule.percent ? D(price).mul(rule.percent).div(100) : D(rule.amount);
  return Prisma.Decimal.min(v, D(price)).toDecimalPlaces(2);
}
