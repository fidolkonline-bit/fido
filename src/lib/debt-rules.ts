// Customer debt: what is owed, in which order a repayment settles it, and how an amount splits (CR-03).
// Pure and shared by the browser and the server, so the POS preview is exactly what the server will post.

export const OPENING = "OPENING";

// One thing the customer owes: a posted invoice with a balance, or the unpaid opening balance.
export type Obligation = {
  key: string; // sale id, or OPENING
  kind: "OPENING" | "INVOICE";
  ref: string; // invoice number (or "Opening balance"); "Invoice at another branch" when the viewer may not see it
  docDate: string; // ISO: invoice date, or the opening balance's reference date
  dueDate: string | null; // ISO; null = no due date configured
  due: string; // 2 dp
  overdue: boolean;
  location: string | null;
  restricted: boolean; // at a location this user is not assigned to: amount only, no document details
};

export type Allocation = { key: string; amount: string };

const cents = (v: string | number) => Math.round(Number(v) * 100);
const fromCents = (c: number) => (c / 100).toFixed(2);

// Proposed order (not legacy behaviour): oldest due date first; the opening balance counts its reference date as its
// due date; invoices without a due date follow all dated obligations, by document date; ties by reference.
export function orderObligations<T extends Obligation>(list: T[]): T[] {
  const sortDate = (o: Obligation) => o.dueDate ?? (o.kind === "OPENING" ? o.docDate : null);
  return [...list].sort((a, b) => {
    const da = sortDate(a), dbb = sortDate(b);
    if (da && dbb && da !== dbb) return da < dbb ? -1 : 1;
    if (da && !dbb) return -1;
    if (!da && dbb) return 1;
    if (a.docDate !== b.docDate) return a.docDate < b.docDate ? -1 : 1;
    return a.ref.localeCompare(b.ref);
  });
}

// Suggested split of an amount over the obligations, in order. Never more than each one's due.
export function suggestAllocation(list: Obligation[], amount: string | number): Allocation[] {
  let left = Math.max(0, cents(amount));
  const out: Allocation[] = [];
  for (const o of orderObligations(list)) {
    if (left <= 0) break;
    const take = Math.min(left, cents(o.due));
    if (take > 0) out.push({ key: o.key, amount: fromCents(take) });
    left -= take;
  }
  return out;
}

export const totalDue = (list: Obligation[]) => fromCents(list.reduce((a, o) => a + cents(o.due), 0));
export const totalOverdue = (list: Obligation[]) => fromCents(list.filter((o) => o.overdue).reduce((a, o) => a + cents(o.due), 0));
export const sumAlloc = (a: Allocation[]) => fromCents(a.reduce((s, x) => s + cents(x.amount), 0));

// Checks a hand-chosen split: known obligations, each within its due, no duplicates, adding up to the amount applied.
export function checkAllocation(list: Obligation[], alloc: Allocation[], applied: string | number): string | null {
  const byKey = new Map(list.map((o) => [o.key, o]));
  const seen = new Set<string>();
  for (const a of alloc) {
    const o = byKey.get(a.key);
    if (!o) return "An invoice in the allocation is no longer outstanding.";
    if (seen.has(a.key)) return `${o.ref} is in the allocation twice.`;
    seen.add(a.key);
    if (cents(a.amount) <= 0) return `Each amount in the allocation must be above 0 (${o.ref}).`;
    if (cents(a.amount) > cents(o.due)) return `${o.ref} has only Rs. ${o.due} due.`;
  }
  if (cents(sumAlloc(alloc)) !== cents(applied)) return `The allocation adds up to Rs. ${sumAlloc(alloc)}, not Rs. ${fromCents(cents(applied))}.`;
  return null;
}

// "0771234567" → "077****567". Search results identify a customer without showing the whole number.
export function maskPhone(p: string | null | undefined) {
  const d = (p ?? "").trim();
  if (d.length < 7) return d ? "****" : "";
  return `${d.slice(0, 3)}${"*".repeat(Math.max(4, d.length - 6))}${d.slice(-3)}`;
}

// Which account types may receive each method, and the default type when the cashier does not choose.
export const ACCOUNT_TYPES: Record<string, string[]> = {
  CASH: ["CASH", "OWNER_COLLECTION"], CARD: ["CARD", "BANK"], BANK_TRANSFER: ["BANK", "OWNER_COLLECTION", "WALLET"],
  CHEQUE: ["BANK", "OWNER_COLLECTION"], OTHER: ["CASH", "BANK", "CARD", "WALLET", "OWNER_COLLECTION"],
};
export const DEFAULT_TYPE: Record<string, string> = { CASH: "CASH", CARD: "CARD", BANK_TRANSFER: "BANK", CHEQUE: "BANK", OTHER: "BANK" };

// The configured default receiving account: this location's own account of the default type first, then a shared one.
export function defaultAccount<T extends { type: string; locationId: string | null }>(accounts: T[], method: string, locationId: string): T | null {
  const fit = accounts.filter((a) => a.type === DEFAULT_TYPE[method] && (a.locationId === locationId || !a.locationId));
  return fit.find((a) => a.locationId === locationId) ?? fit[0] ?? null;
}
