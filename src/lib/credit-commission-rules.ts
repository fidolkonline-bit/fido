// Credit-sale commission names and rules shared by the server, the pages and the tests (no database).
import { D } from "./money";

// CommissionAccrual roles for the extra commission on phones sold on credit. The shop sells on credit only through
// Fintrex; INSTALMENT is kept so rows from the short time shop instalment plans earned it still read correctly.
export const CREDIT_ROLES = ["FINTREX", "INSTALMENT"] as const;
export type CreditRole = (typeof CREDIT_ROLES)[number];

export const CREDIT_ROLE_LABEL: Record<CreditRole, string> = { FINTREX: "Fintrex sale", INSTALMENT: "Instalment plan" };

export const isCreditRole = (v: string): v is CreditRole => (CREDIT_ROLES as readonly string[]).includes(v);

// Only a Fintrex sale earns credit commission.
export function creditRoleOf(sale: { channel: string; instalmentPlan?: { status: string } | null }): CreditRole | null {
  return sale.channel === "FINTREX" ? "FINTREX" : null;
}

type Money = Parameters<typeof D>[0];
type SaleMoney = { total: Money; paid: Money; credited: Money };

// What the shop has still to collect on a sale (returns cancel debt through `credited`).
export const saleDueAmount = (s: SaleMoney) => D(s.total).minus(D(s.paid)).minus(D(s.credited));
export const saleCollected = (s: SaleMoney) => saleDueAmount(s).lte(0.005);

// Credit commission is earned at the sale but held — not approved, not paid, not in payroll — until the shop has
// collected the sale in full. Normal commission is not held.
export function heldForCollection(a: { role: string; saleLine?: { sale: SaleMoney } | null }) {
  return isCreditRole(a.role) && !!a.saleLine && !saleCollected(a.saleLine.sale);
}

// Label for any commission role, in reports and statements.
export function commissionRoleLabel(role: string) {
  if (isCreditRole(role)) return `Credit commission (${CREDIT_ROLE_LABEL[role]})`;
  return role === "USER" ? "Salesperson" : role === "TECHNICIAN" ? "Technician (repairs)" : role === "AGENT" ? "Agent" : role;
}
