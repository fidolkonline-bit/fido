import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPayments, dueDates, splitAmount } from "../src/lib/instalment-rules";

test("instalments add up exactly", () => {
  assert.deepEqual(splitAmount(100, 3), [33.33, 33.33, 33.34]);
  assert.deepEqual(splitAmount(90000, 6), [15000, 15000, 15000, 15000, 15000, 15000]);
  for (const [t, n] of [[12345.67, 7], [0.05, 3], [99999.99, 12]] as const) assert.equal(Math.round(splitAmount(t, n).reduce((a, b) => a + b, 0) * 100), Math.round(t * 100));
});

test("monthly dates clamp to short months", () => {
  const d = dueDates(new Date("2027-01-31T04:00:00Z"), 4, "MONTHLY").map((x) => x.toISOString().slice(0, 10));
  assert.deepEqual(d, ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
});

test("weekly and fortnightly dates", () => {
  assert.deepEqual(dueDates(new Date("2027-03-01T00:00:00Z"), 3, "WEEKLY").map((x) => x.toISOString().slice(0, 10)), ["2027-03-01", "2027-03-08", "2027-03-15"]);
  assert.deepEqual(dueDates(new Date("2027-03-01T00:00:00Z"), 2, "FORTNIGHTLY").map((x) => x.toISOString().slice(0, 10)), ["2027-03-01", "2027-03-15"]);
});

test("payments settle the oldest instalment first", () => {
  const dues = [1, 2, 3].map((seq) => ({ seq, dueAt: new Date(`2027-0${seq}-10T00:00:00Z`), amount: 1000 }));
  const s = applyPayments(dues, 1500, new Date("2027-02-15T00:00:00Z"));
  assert.deepEqual(s.map((x) => [x.paid, x.state]), [[1000, "PAID"], [500, "OVERDUE"], [0, "UPCOMING"]]);
  assert.deepEqual(applyPayments(dues, 3000, new Date("2027-06-01T00:00:00Z")).map((x) => x.state), ["PAID", "PAID", "PAID"]);
  assert.deepEqual(applyPayments(dues, 0, new Date("2027-01-08T12:00:00Z")).map((x) => x.state), ["DUE", "UPCOMING", "UPCOMING"]);
});
