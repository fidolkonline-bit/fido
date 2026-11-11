// Pure schedule maths for instalment plans (no database), shared by the server, the preview and the tests.

export type Frequency = "WEEKLY" | "FORTNIGHTLY" | "MONTHLY";

// Equal instalments in cents; the last one takes the rounding remainder so the schedule adds up exactly.
export function splitAmount(total: number, count: number): number[] {
  const cents = Math.round(total * 100);
  const each = Math.floor(cents / count);
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? cents - each * (count - 1) : each) / 100);
}

// Due dates from the first one. Monthly keeps the day of the month, clamped for short months (31st → 30th / 28th).
export function dueDates(first: Date, count: number, frequency: Frequency): Date[] {
  return Array.from({ length: count }, (_, i) => {
    if (frequency !== "MONTHLY") return new Date(first.getTime() + i * (frequency === "WEEKLY" ? 7 : 14) * 86_400_000);
    const d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1, first.getUTCHours(), first.getUTCMinutes()));
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(first.getUTCDate(), lastDay));
    return d;
  });
}

export type DueState = { seq: number; dueAt: Date; amount: number; paid: number; state: "PAID" | "PART" | "DUE" | "OVERDUE" | "UPCOMING" };

// Money received on the sale since the plan was made settles instalments in order, oldest first.
export function applyPayments(dues: { seq: number; dueAt: Date; amount: number }[], settled: number, now = new Date()): DueState[] {
  let left = Math.round(Math.max(settled, 0) * 100);
  return [...dues].sort((a, b) => a.seq - b.seq).map((d) => {
    const amt = Math.round(d.amount * 100);
    const paid = Math.min(amt, left);
    left -= paid;
    const late = d.dueAt.getTime() < now.getTime();
    const state = paid >= amt ? "PAID" : late ? "OVERDUE" : paid > 0 ? "PART" : d.dueAt.getTime() - now.getTime() < 3 * 86_400_000 ? "DUE" : "UPCOMING";
    return { seq: d.seq, dueAt: d.dueAt, amount: d.amount, paid: paid / 100, state };
  });
}
