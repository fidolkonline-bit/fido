// Credit-sale commission names and rules shared by the server, the pages and the tests (no database).

// CommissionAccrual roles for the extra commission on phones sold on credit.
export const CREDIT_ROLES = ["FINTREX", "INSTALMENT"] as const;
export type CreditRole = (typeof CREDIT_ROLES)[number];

export const CREDIT_ROLE_LABEL: Record<CreditRole, string> = { FINTREX: "Fintrex sale", INSTALMENT: "Instalment plan" };

export const isCreditRole = (v: string): v is CreditRole => (CREDIT_ROLES as readonly string[]).includes(v);

// A Fintrex sale earns the Fintrex rate; otherwise a sale with an active instalment plan earns the instalment rate.
// A sale is never paid both.
export function creditRoleOf(sale: { channel: string; instalmentPlan: { status: string } | null }): CreditRole | null {
  if (sale.channel === "FINTREX") return "FINTREX";
  if (sale.instalmentPlan?.status === "ACTIVE") return "INSTALMENT";
  return null;
}

// Label for any commission role, in reports and statements.
export function commissionRoleLabel(role: string) {
  if (isCreditRole(role)) return `Credit commission (${CREDIT_ROLE_LABEL[role]})`;
  return role === "USER" ? "Salesperson" : role === "TECHNICIAN" ? "Technician (repairs)" : role === "AGENT" ? "Agent" : role;
}
