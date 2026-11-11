import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { checkDiscountLimits, type LimitLine } from "../src/lib/discount-limits";

const d = (v: number | string) => new Prisma.Decimal(v);
const line = (o: Partial<Record<keyof LimitLine, number | string | boolean | null>> = {}): LimitLine => ({
  name: (o.name as string) ?? "Phone case", qty: d((o.qty as number) ?? 1), price: d((o.price as number) ?? 1000), listPrice: d((o.listPrice as number) ?? 1000),
  discount: d((o.discount as number) ?? 0), ruleAmount: d((o.ruleAmount as number) ?? 0), hasRule: !!o.hasRule,
  minSellPrice: o.minSellPrice == null ? null : d(o.minSellPrice as number),
});

test("no discount passes with a 0% limit", () => {
  assert.equal(checkDiscountLimits([line()], d(0), 0), null);
});

test("line discount at the limit passes", () => {
  assert.equal(checkDiscountLimits([line({ discount: 100 })], d(0), 10), null);
});

test("line discount above the limit is refused", () => {
  assert.match(checkDiscountLimits([line({ discount: 101 })], d(0), 10)!, /above your limit/);
});

test("price cut counts as discount", () => {
  assert.match(checkDiscountLimits([line({ price: 850 })], d(0), 10)!, /above your limit/);
});

test("line 10% plus invoice 10% no longer stacks", () => {
  assert.match(checkDiscountLimits([line({ discount: 100 })], d(90), 10)!, /whole sale/);
});

test("invoice discount alone up to the limit passes", () => {
  assert.equal(checkDiscountLimits([line(), line()], d(200), 10), null);
  assert.match(checkDiscountLimits([line(), line()], d(201), 10)!, /whole sale/);
});

test("split allowance across line and invoice passes when the total is inside the limit", () => {
  assert.equal(checkDiscountLimits([line({ discount: 50 })], d(50), 10), null);
});

test("a running offer does not use the cashier's allowance", () => {
  assert.equal(checkDiscountLimits([line({ discount: 300, ruleAmount: 300, hasRule: true })], d(0), 0), null);
  assert.match(checkDiscountLimits([line({ discount: 301, ruleAmount: 300, hasRule: true })], d(0), 0)!, /above your limit/);
});

test("selling one line above list does not fund a discount on another", () => {
  const lines = [line({ price: 1200 }), line({ name: "Charger", discount: 100 })];
  assert.equal(checkDiscountLimits(lines, d(100), 10), null);
  assert.match(checkDiscountLimits(lines, d(150), 10)!, /whole sale/);
  assert.match(checkDiscountLimits([line({ price: 1200 }), line({ name: "Charger", discount: 150 })], d(0), 10)!, /Charger is above your limit/);
});

test("minimum price is checked after the line discount", () => {
  assert.match(checkDiscountLimits([line({ discount: 100, minSellPrice: 950 })], d(0), 50)!, /cannot be sold below 950.00/);
  assert.equal(checkDiscountLimits([line({ discount: 50, minSellPrice: 950 })], d(0), 50), null);
});

test("minimum price is checked after the invoice discount share", () => {
  assert.match(checkDiscountLimits([line({ minSellPrice: 950 })], d(100), 50)!, /cannot be sold below/);
});

test("a tier price below the minimum is allowed when sold at that tier price", () => {
  assert.equal(checkDiscountLimits([line({ price: 900, listPrice: 900, minSellPrice: 950 })], d(0), 0), null);
});

test("quantity is respected", () => {
  assert.equal(checkDiscountLimits([line({ qty: 3, discount: 300 })], d(0), 10), null);
  assert.match(checkDiscountLimits([line({ qty: 3, discount: 301 })], d(0), 10)!, /above your limit/);
});
