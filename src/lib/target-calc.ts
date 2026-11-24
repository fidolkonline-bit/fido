// Sales-target maths (§9.3) with no database access, so it can be unit-tested.
import { Prisma } from "@prisma/client";

const ZERO = new Prisma.Decimal(0);
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const OFFSET = 330 * 60_000; // Asia/Colombo, UTC+05:30, no DST

// FLAT: whole value at the reached band's percent. PROGRESSIVE: each slice at its band's percent. FIXED: the reached band's amount.
export type TargetMode = "FLAT" | "PROGRESSIVE" | "FIXED";
export type Cadence = "PERIOD" | "DAILY";
export type Band = { from: number; to: number | null; percent?: number; amount?: number };

export const MODE_LABEL: Record<string, string> = { FIXED: "fixed amount", FLAT: "% of sales", PROGRESSIVE: "% per slice" };

export function validateBands(bands: Band[], mode: string) {
  if (!["FLAT", "PROGRESSIVE", "FIXED"].includes(mode)) throw new Error("Choose how the bonus pays.");
  if (!bands.length) throw new Error("Add at least one band.");
  const sorted = [...bands].sort((a, b) => a.from - b.from);
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    const bonus = mode === "FIXED" ? b.amount : b.percent;
    if (bonus == null || !(bonus >= 0) || !Number.isFinite(b.from) || b.from < 0 || (b.to != null && !(b.to > b.from)))
      throw new Error(mode === "FIXED" ? "Each band needs sales from < to and a bonus amount." : "Each band needs sales from < to and a percent.");
    if (mode !== "FIXED" && bonus > 100) throw new Error("A bonus percent cannot be above 100.");
    if (i > 0 && (sorted[i - 1].to == null || sorted[i - 1].to! > b.from)) throw new Error("Bands overlap or are ambiguous (§9.3).");
  }
  return sorted.map((b) => (mode === "FIXED" ? { from: b.from, to: b.to, amount: b.amount! } : { from: b.from, to: b.to, percent: b.percent! }));
}

export function earning(value: Prisma.Decimal, bands: Band[], mode: string) {
  const sorted = [...bands].sort((a, b) => a.from - b.from);
  if (mode === "PROGRESSIVE") {
    return sorted.reduce((a, b) => {
      const top = b.to == null ? value : Prisma.Decimal.min(value, b.to);
      const slice = Prisma.Decimal.max(top.minus(b.from), ZERO);
      return a.plus(slice.mul(b.percent ?? 0).div(100));
    }, ZERO).toDecimalPlaces(2);
  }
  // The highest band whose "from" is reached; above the last band's top, that band still applies.
  const band = [...sorted].reverse().find((b) => value.gte(b.from));
  if (!band || value.lte(0)) return ZERO;
  return mode === "FIXED" ? D(band.amount ?? 0).toDecimalPlaces(2) : value.mul(band.percent ?? 0).div(100).toDecimalPlaces(2);
}

// The chosen categories plus every sub-category under them. Empty choice = no filter (null).
export function expandCategories(chosen: string[], all: { id: string; parentId: string | null }[]): Set<string> | null {
  if (!chosen.length) return null;
  const out = new Set(chosen);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of all) if (c.parentId && out.has(c.parentId) && !out.has(c.id)) { out.add(c.id); grew = true; }
  }
  return out;
}

export type TargetLine = {
  soldAt: Date;
  lineTotal: Prisma.Decimal.Value;
  saleSubtotal: Prisma.Decimal.Value;
  saleDiscount: Prisma.Decimal.Value;
  returned: Prisma.Decimal.Value; // value of this line already returned
  categoryId: string | null; // category at the time of sale, else the product's current one
  reload: boolean;
};

// Net value of a line: after its own discount (already in lineTotal), its share of the invoice discount, and returns (§17.1).
export function lineNet(l: TargetLine) {
  const subtotal = D(l.saleSubtotal);
  const share = subtotal.gt(0) ? D(l.lineTotal).div(subtotal) : ZERO;
  return D(l.lineTotal).minus(D(l.saleDiscount).mul(share)).minus(l.returned);
}

export const businessDay = (d: Date) => new Date(d.getTime() + OFFSET).toISOString().slice(0, 10);

export type DayResult = { day: string; value: Prisma.Decimal; earning: Prisma.Decimal };

export function evaluate(lines: TargetLine[], t: { bands: Band[]; mode: string; cadence: string }, cats: Set<string> | null) {
  const counted = lines.filter((l) => !l.reload && (!cats || (l.categoryId != null && cats.has(l.categoryId))));
  const value = counted.reduce((a, l) => a.plus(lineNet(l)), ZERO).toDecimalPlaces(2);
  if (t.cadence !== "DAILY") return { value, earning: earning(value, t.bands, t.mode), days: null as DayResult[] | null };
  const byDay = new Map<string, Prisma.Decimal>();
  for (const l of counted) {
    const k = businessDay(l.soldAt);
    byDay.set(k, (byDay.get(k) ?? ZERO).plus(lineNet(l)));
  }
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => {
    const dv = v.toDecimalPlaces(2);
    return { day, value: dv, earning: earning(dv, t.bands, t.mode) };
  });
  return { value, earning: days.reduce((a, d) => a.plus(d.earning), ZERO), days };
}

export function bandText(b: Band, mode: string, fmt: (n: number) => string) {
  const range = `${fmt(b.from)}–${b.to == null ? "∞" : fmt(b.to)}`;
  return mode === "FIXED" ? `${range}: Rs ${fmt(b.amount ?? 0)}` : `${range}: ${b.percent ?? 0}%`;
}

// The period after [start, end] (YYYY-MM-DD): a whole calendar month rolls to the next whole month, otherwise the same number of days follows.
export function nextPeriod(start: string, end: string) {
  const s = new Date(`${start}T00:00:00Z`), e = new Date(`${end}T00:00:00Z`);
  const lastOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0));
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  if (s.getUTCDate() === 1 && ymd(e) === ymd(lastOfMonth(s.getUTCFullYear(), s.getUTCMonth()))) {
    const ns = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 1));
    return { start: ymd(ns), end: ymd(lastOfMonth(ns.getUTCFullYear(), ns.getUTCMonth())) };
  }
  const days = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
  return { start: ymd(new Date(e.getTime() + 86_400_000)), end: ymd(new Date(e.getTime() + days * 86_400_000)) };
}
