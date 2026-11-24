import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { earning, evaluate, expandCategories, lineNet, nextPeriod, validateBands, type TargetLine } from "../src/lib/target-calc";

const d = (v: number | string) => new Prisma.Decimal(v);
// Colombo time: 10:00 local = 04:30 UTC.
const at = (day: string, hh = "10:00") => new Date(new Date(`${day}T${hh}:00.000Z`).getTime() - 330 * 60_000);
const line = (o: Partial<TargetLine> & { cat?: string | null; total?: number }): TargetLine => ({
  soldAt: o.soldAt ?? at("2026-11-02"), lineTotal: o.total ?? o.lineTotal ?? 1000, saleSubtotal: o.saleSubtotal ?? o.total ?? 1000,
  saleDiscount: o.saleDiscount ?? 0, returned: o.returned ?? 0, categoryId: o.cat === undefined ? "acc" : o.cat, reload: o.reload ?? false,
});
const FIXED = [{ from: 20000, to: 40000, amount: 500 }, { from: 40000, to: null, amount: 1200 }];

test("fixed bonus: below, at and above the bands", () => {
  assert.equal(earning(d(19999.99), FIXED, "FIXED").toString(), "0");
  assert.equal(earning(d(20000), FIXED, "FIXED").toString(), "500");
  assert.equal(earning(d(39999), FIXED, "FIXED").toString(), "500");
  assert.equal(earning(d(85000), FIXED, "FIXED").toString(), "1200");
});

test("percent modes still work as before", () => {
  const bands = [{ from: 0, to: 100000, percent: 1 }, { from: 100000, to: null, percent: 2 }];
  assert.equal(earning(d(150000), bands, "FLAT").toString(), "3000");
  assert.equal(earning(d(150000), bands, "PROGRESSIVE").toString(), "2000");
});

test("a fixed band starting at 0 pays nothing on a day with no sales", () => {
  assert.equal(earning(d(0), [{ from: 0, to: null, amount: 100 }], "FIXED").toString(), "0");
});

test("only chosen categories count; a phone on the same bill is ignored", () => {
  const cats = expandCategories(["acc"], []);
  const r = evaluate([line({ total: 150000, cat: "phone" }), line({ total: 5000 })], { bands: FIXED, mode: "FIXED", cadence: "PERIOD" }, cats);
  assert.equal(r.value.toString(), "5000");
  assert.equal(r.earning.toString(), "0");
});

test("no categories chosen counts everything except reloads", () => {
  const r = evaluate([line({ total: 15000, cat: "phone" }), line({ total: 6000, cat: null }), line({ total: 9000, reload: true })], { bands: FIXED, mode: "FIXED", cadence: "PERIOD" }, null);
  assert.equal(r.value.toString(), "21000");
  assert.equal(r.earning.toString(), "500");
});

test("sub-categories of a chosen category count, other branches do not", () => {
  const all = [{ id: "acc", parentId: null }, { id: "covers", parentId: "acc" }, { id: "silicone", parentId: "covers" }, { id: "phone", parentId: null }];
  const cats = expandCategories(["acc"], all)!;
  assert.deepEqual([...cats].sort(), ["acc", "covers", "silicone"]);
  assert.equal(expandCategories([], all), null);
});

test("line value takes its share of the invoice discount and its returns", () => {
  // Bill: phone 90,000 + cover 10,000, invoice discount 1,000 → cover carries 100; 2,000 of the cover returned.
  assert.equal(lineNet(line({ lineTotal: 10000, saleSubtotal: 100000, saleDiscount: 1000, returned: 2000 })).toString(), "7900");
});

test("daily: each day judged on its own and the bonuses added up", () => {
  const lines = [
    line({ total: 12000, soldAt: at("2026-11-02", "09:00") }), line({ total: 9000, soldAt: at("2026-11-02", "18:00") }), // 21,000 → 500
    line({ total: 15000, soldAt: at("2026-11-03") }), // 15,000 → 0
    line({ total: 45000, soldAt: at("2026-11-04") }), // 45,000 → 1,200
  ];
  const r = evaluate(lines, { bands: FIXED, mode: "FIXED", cadence: "DAILY" }, null);
  assert.equal(r.value.toString(), "81000");
  assert.equal(r.earning.toString(), "1700");
  assert.deepEqual(r.days!.map((x) => [x.day, x.value.toString(), x.earning.toString()]), [["2026-11-02", "21000", "500"], ["2026-11-03", "15000", "0"], ["2026-11-04", "45000", "1200"]]);
  // The same sales judged as one period total reach only the top band once.
  assert.equal(evaluate(lines, { bands: FIXED, mode: "FIXED", cadence: "PERIOD" }, null).earning.toString(), "1200");
});

test("daily uses Sri Lanka midnight, not UTC", () => {
  // 23:30 local on the 2nd is 18:00 UTC on the 2nd; 00:30 local on the 3rd is 19:00 UTC on the 2nd.
  const r = evaluate([line({ total: 20000, soldAt: at("2026-11-02", "23:30") }), line({ total: 20000, soldAt: at("2026-11-03", "00:30") })], { bands: FIXED, mode: "FIXED", cadence: "DAILY" }, null);
  assert.deepEqual(r.days!.map((x) => x.day), ["2026-11-02", "2026-11-03"]);
  assert.equal(r.earning.toString(), "1000");
});

test("band validation", () => {
  assert.throws(() => validateBands([{ from: 0, to: 100, amount: 5 }, { from: 50, to: null, amount: 9 }], "FIXED"), /overlap/);
  assert.throws(() => validateBands([{ from: 0, to: null, percent: 5 }], "FIXED"), /bonus amount/);
  assert.throws(() => validateBands([{ from: 0, to: null, percent: 150 }], "FLAT"), /above 100/);
  assert.throws(() => validateBands([], "FIXED"), /at least one band/);
  assert.deepEqual(validateBands([{ from: 40000, to: null, amount: 1200 }, { from: 20000, to: 40000, amount: 500 }], "FIXED"), FIXED);
});

test("next period: whole months roll to whole months, other ranges keep their length", () => {
  assert.deepEqual(nextPeriod("2026-11-01", "2026-11-30"), { start: "2026-12-01", end: "2026-12-31" });
  assert.deepEqual(nextPeriod("2027-01-01", "2027-01-31"), { start: "2027-02-01", end: "2027-02-28" });
  assert.deepEqual(nextPeriod("2026-11-02", "2026-11-08"), { start: "2026-11-09", end: "2026-11-15" });
});
