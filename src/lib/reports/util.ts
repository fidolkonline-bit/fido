import { Prisma } from "@prisma/client";
import { D, ZERO } from "../money";
import type { Ctx, Row, Cell } from "./types";

export { D, ZERO };
export const sum = <T,>(rows: T[], f: (r: T) => Prisma.Decimal.Value | null | undefined) => rows.reduce((a, r) => a.plus(D(f(r))), ZERO);
export const inPeriod = (ctx: Ctx) => ({ gte: ctx.from, lt: ctx.to });
export const dateIn = (ctx: Ctx) => ({ gte: new Date(`${ctx.fromYmd}T00:00:00.000Z`), lte: new Date(`${ctx.toYmd}T00:00:00.000Z`) }); // @db.Date columns
export const locIn = (ctx: Ctx) => ({ in: ctx.locationIds });
export function totalsOf(rows: Row[], keys: string[]): Record<string, Cell> {
  return Object.fromEntries(keys.map((k) => [k, rows.reduce((a, r) => a.plus(D(r[k] as Prisma.Decimal.Value)), ZERO)]));
}
export function groupSum<T>(items: T[], key: (t: T) => string, fields: Record<string, (t: T) => Prisma.Decimal.Value | null | undefined>) {
  const m = new Map<string, Record<string, Prisma.Decimal> & { _n: number }>();
  for (const it of items) {
    const k = key(it);
    const acc = m.get(k) ?? Object.assign(Object.fromEntries(Object.keys(fields).map((f) => [f, ZERO])), { _n: 0 }) as Record<string, Prisma.Decimal> & { _n: number };
    for (const [f, get] of Object.entries(fields)) acc[f] = acc[f].plus(D(get(it)));
    acc._n++;
    m.set(k, acc);
  }
  return m;
}
