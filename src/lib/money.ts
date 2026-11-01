import { Prisma } from "@prisma/client";

export const D = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);
export const ZERO = new Prisma.Decimal(0);

const lkr = new Intl.NumberFormat("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat("en-LK", { maximumFractionDigits: 2 });

export function money(v: Prisma.Decimal.Value | null | undefined) {
  return lkr.format(Number(D(v).toFixed(2)));
}

export function qty(v: Prisma.Decimal.Value | null | undefined) {
  return qtyFmt.format(Number(D(v)));
}

// Configured sale rounding (observed: nearest 0.5) applies only to the sale total.
export function roundTo(value: Prisma.Decimal, step: Prisma.Decimal.Value) {
  const s = D(step);
  if (s.lte(0)) return value.toDecimalPlaces(2);
  return value.div(s).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).mul(s).toDecimalPlaces(2);
}

const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Colombo", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});
const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", day: "2-digit", month: "short", year: "numeric" });

export const fmtDateTime = (d: Date | null | undefined) => (d ? dateTimeFmt.format(d) : "—");
export const fmtDate = (d: Date | null | undefined) => (d ? dateFmt.format(d) : "—");

// Start of the current business day in Asia/Colombo (UTC+05:30, no DST) as an instant.
export function colomboDayStart(now = new Date()) {
  const offsetMs = 330 * 60_000;
  const local = new Date(now.getTime() + offsetMs);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - offsetMs);
}
