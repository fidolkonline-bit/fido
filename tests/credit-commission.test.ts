import { test } from "node:test";
import assert from "node:assert/strict";
import { commissionRoleLabel, creditRoleOf, isCreditRole } from "../src/lib/credit-commission-rules";

test("a Fintrex sale earns the Fintrex rate, an active plan the instalment rate, never both", () => {
  assert.equal(creditRoleOf({ channel: "FINTREX", instalmentPlan: null }), "FINTREX");
  assert.equal(creditRoleOf({ channel: "FINTREX", instalmentPlan: { status: "ACTIVE" } }), "FINTREX");
  assert.equal(creditRoleOf({ channel: "IN_STORE", instalmentPlan: { status: "ACTIVE" } }), "INSTALMENT");
  assert.equal(creditRoleOf({ channel: "COD", instalmentPlan: { status: "ACTIVE" } }), "INSTALMENT");
});

test("cash sales and cancelled plans earn nothing", () => {
  assert.equal(creditRoleOf({ channel: "IN_STORE", instalmentPlan: null }), null);
  assert.equal(creditRoleOf({ channel: "IN_STORE", instalmentPlan: { status: "CANCELLED" } }), null);
});

test("credit roles are told apart from normal commission", () => {
  assert.ok(isCreditRole("FINTREX") && isCreditRole("INSTALMENT"));
  assert.ok(!isCreditRole("USER") && !isCreditRole("AGENT") && !isCreditRole("TECHNICIAN"));
  assert.equal(commissionRoleLabel("USER"), "Salesperson");
  assert.equal(commissionRoleLabel("INSTALMENT"), "Credit commission (Instalment plan)");
});
