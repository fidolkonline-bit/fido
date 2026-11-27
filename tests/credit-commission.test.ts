import { test } from "node:test";
import assert from "node:assert/strict";
import { commissionRoleLabel, creditRoleOf, heldForCollection, isCreditRole, saleCollected } from "../src/lib/credit-commission-rules";

test("only a Fintrex sale earns credit commission", () => {
  assert.equal(creditRoleOf({ channel: "FINTREX", instalmentPlan: null }), "FINTREX");
  assert.equal(creditRoleOf({ channel: "FINTREX", instalmentPlan: { status: "ACTIVE" } }), "FINTREX");
  assert.equal(creditRoleOf({ channel: "IN_STORE", instalmentPlan: { status: "ACTIVE" } }), null);
  assert.equal(creditRoleOf({ channel: "COD", instalmentPlan: null }), null);
});

test("Fintrex commission is held until the sale is collected in full; normal commission never is", () => {
  const sale = (paid: number, credited = 0) => ({ saleLine: { sale: { total: 80000, paid, credited } } });
  assert.equal(heldForCollection({ role: "FINTREX", ...sale(20000) }), true);
  assert.equal(heldForCollection({ role: "FINTREX", ...sale(80000) }), false);
  assert.equal(heldForCollection({ role: "FINTREX", ...sale(20000, 60000) }), false); // rest cancelled by a return
  assert.equal(heldForCollection({ role: "USER", ...sale(0) }), false);
  assert.equal(heldForCollection({ role: "TECHNICIAN", saleLine: null }), false);
  assert.ok(saleCollected({ total: "100.00", paid: "99.999", credited: 0 }));
});

test("credit roles are told apart from normal commission", () => {
  assert.ok(isCreditRole("FINTREX") && isCreditRole("INSTALMENT"));
  assert.ok(!isCreditRole("USER") && !isCreditRole("AGENT") && !isCreditRole("TECHNICIAN"));
  assert.equal(commissionRoleLabel("USER"), "Salesperson");
  assert.equal(commissionRoleLabel("FINTREX"), "Credit commission (Fintrex sale)");
});
