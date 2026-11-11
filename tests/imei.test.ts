import { test } from "node:test";
import assert from "node:assert/strict";
import { imeiProblem, luhnOk } from "../src/lib/imei";

test("valid 15-digit IMEIs pass", () => {
  for (const v of ["490154203237518", "356938035643809", "352099001761481"]) assert.equal(imeiProblem(v), null, v);
});
test("one mistyped digit is caught", () => {
  assert.match(imeiProblem("490154203237519")!, /check digit/);
  assert.match(imeiProblem("356938035643808")!, /check digit/);
});
test("format rules", () => {
  assert.match(imeiProblem("12345")!, /14–17 digits/);
  assert.match(imeiProblem("35693803564380A")!, /14–17 digits/);
  assert.match(imeiProblem("000000000000000")!, /not a real IMEI/);
  assert.equal(imeiProblem("35693803564380"), null); // 14 digits: no check digit to test
  assert.equal(imeiProblem(""), null);
  assert.equal(imeiProblem(null), null);
});
test("luhn", () => { assert.ok(luhnOk("79927398713")); assert.ok(!luhnOk("79927398710")); });
