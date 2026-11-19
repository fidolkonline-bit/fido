import { Prisma } from "@prisma/client";
import { db } from "./db";
import { D, ZERO } from "./money";
import type { Result, Row, ParamOptions } from "./reports/types";

const ROLE: Record<string, string> = { USER: "Salesperson", AGENT: "Agent", TECHNICIAN: "Technician" };

// Everyone who can earn commission or has earned it: the "Person" filter of the commission report.
export async function commissionPeople(): Promise<ParamOptions> {
  const people = await db.person.findMany({
    where: { OR: [{ accruals: { some: {} } }, { commissionProfile: { isNot: null } }] },
    select: { id: true, fullName: true }, orderBy: { fullName: "asc" },
  });
  return [["all", "Everyone"], ...people.map((p) => [p.id, p.fullName] as [string, string])];
}

type Group = {
  date: Date; doc: string; href?: string; customer: string; status: string;
  total: Prisma.Decimal | null; paid: Prisma.Decimal | null;
  personId: string; person: string; roles: Set<string>;
  amount: Prisma.Decimal; n: number; approved: number; settled: number; returnLines: Set<string>; kind: "SALE" | "RETURN" | "REPAIR";
};

function payState(total: Prisma.Decimal.Value, paid: Prisma.Decimal.Value, credited: Prisma.Decimal.Value = 0) {
  const due = D(total).minus(paid).minus(credited);
  if (due.lte(0.005)) return D(credited).gt(0) && D(paid).lte(0) ? "Returned" : "Paid";
  return D(paid).gt(0) ? "Partial" : "Due";
}

function payout(g: Group) {
  if (g.settled === g.n) return "Paid";
  if (g.settled > 0) return "Part paid";
  if (g.approved === g.n) return "Approved";
  return g.approved > 0 ? "Part approved" : "Not approved";
}

/**
 * Commission statement, one row per invoice per person (the old "Sales Representative Report").
 * Rows come from commission entries created in the period: a sale's entries are made when it is sold, a return's
 * reversals when the goods come back (shown as their own negative row, so a statement already paid never changes),
 * and a repair technician's share when the job is collected.
 */
export async function commissionStatement(opts: { from: Date; to: Date; personId?: string; locationIds?: string[] }): Promise<Result> {
  const loc = opts.locationIds ? { in: opts.locationIds } : undefined;
  const acc = await db.commissionAccrual.findMany({
    where: {
      createdAt: { gte: opts.from, lt: opts.to },
      ...(opts.personId ? { recipientId: opts.personId } : {}),
      ...(loc ? { OR: [{ saleLine: { sale: { locationId: loc } } }, { repairJob: { locationId: loc } }] } : {}),
    },
    include: {
      recipient: { select: { id: true, fullName: true } },
      saleLine: { select: { sale: { select: { id: true, number: true, soldAt: true, total: true, paid: true, credited: true, customer: { select: { name: true } } } } } },
      repairJob: { select: { id: true, number: true, total: true, paid: true, customer: { select: { name: true } } } },
    },
  });
  const retIds = acc.flatMap((a) => (a.returnLineId ? [a.returnLineId] : []));
  const retLines = retIds.length
    ? await db.saleReturnLine.findMany({ where: { id: { in: retIds } }, select: { id: true, value: true, saleReturn: { select: { id: true, number: true, createdAt: true } } } })
    : [];
  const retById = new Map(retLines.map((r) => [r.id, r]));

  const groups = new Map<string, Group>();
  for (const a of acc) {
    const sale = a.saleLine?.sale;
    const ret = a.returnLineId ? retById.get(a.returnLineId) : undefined;
    let key: string, base: Omit<Group, "personId" | "person" | "roles" | "amount" | "n" | "approved" | "settled" | "returnLines">;
    if (sale && ret) {
      key = `R|${ret.saleReturn.id}|${a.recipientId}`;
      base = { kind: "RETURN", date: ret.saleReturn.createdAt, doc: `${ret.saleReturn.number} (return of ${sale.number})`, href: `/returns/${ret.saleReturn.id}`, customer: sale.customer?.name ?? "Walk-In Customer", status: "Return", total: ZERO, paid: null };
    } else if (sale) {
      key = `S|${sale.id}|${a.recipientId}`;
      base = { kind: "SALE", date: sale.soldAt, doc: sale.number, href: `/sales/${sale.id}`, customer: sale.customer?.name ?? "Walk-In Customer", status: payState(sale.total, sale.paid, sale.credited), total: D(sale.total), paid: D(sale.paid) };
    } else if (a.repairJob) {
      const j = a.repairJob;
      key = `J|${j.id}|${a.recipientId}`;
      base = { kind: "REPAIR", date: a.createdAt, doc: `Repair ${j.number}`, href: `/repairs/${j.id}`, customer: j.customer.name, status: payState(j.total, j.paid), total: D(j.total), paid: D(j.paid) };
    } else continue;
    const g = groups.get(key) ?? { ...base, personId: a.recipientId, person: a.recipient.fullName, roles: new Set<string>(), amount: ZERO, n: 0, approved: 0, settled: 0, returnLines: new Set<string>() };
    g.roles.add(ROLE[a.role] ?? a.role);
    g.amount = g.amount.plus(a.amount);
    g.n++;
    if (a.approvedAt) g.approved++;
    if (a.settlementId) g.settled++;
    // A returned line can carry two reversals (salesperson + agent); count its value once per person.
    if (ret && !g.returnLines.has(ret.id)) { g.returnLines.add(ret.id); g.total = (g.total ?? ZERO).minus(ret.value); }
    groups.set(key, g);
  }

  const list = [...groups.values()].sort((x, y) => (opts.personId ? 0 : x.person.localeCompare(y.person)) || y.date.getTime() - x.date.getTime());
  const one = !!opts.personId;
  const rows: Row[] = list.map((g) => ({
    date: g.date, invoice: g.doc, customer: g.customer, status: g.status, total: g.total, paid: g.paid,
    person: g.person, role: [...g.roles].join(" + "), commission: g.amount, payout: payout(g), _href: g.href,
    _tone: g.kind === "RETURN" ? "warn" : undefined,
  }));
  const net = list.reduce((s, g) => s.plus(g.amount), ZERO);
  const paidOut = acc.filter((a) => a.settlementId).reduce((s, a) => s.plus(a.amount), ZERO);
  const docs = list.filter((g) => g.kind !== "RETURN").length;
  const columns: Result["columns"] = [
    { key: "date", label: "Date", kind: "datetime" }, { key: "invoice", label: "Invoice No." }, { key: "customer", label: "Customer" },
    { key: "status", label: "Payment status" }, { key: "total", label: "Total amount", kind: "money" }, { key: "paid", label: "Total paid", kind: "money" },
    ...(one ? [] : [{ key: "person", label: "Person" }]), { key: "role", label: "As" },
    { key: "commission", label: "Commission", kind: "money" }, { key: "payout", label: "Payout" },
  ];
  return {
    columns, rows,
    // Invoice totals only add up for one person: with everyone, a sale shared by a salesperson and an agent appears twice.
    totals: { commission: net, ...(one ? { total: rows.reduce((s, r) => s.plus(D(r.total as Prisma.Decimal.Value)), ZERO), paid: rows.reduce((s, r) => s.plus(D(r.paid as Prisma.Decimal.Value)), ZERO) } : {}) },
    summary: [
      ...(one && list[0] ? [{ label: "Person", value: list[0].person }] : []),
      { label: "Invoices & repairs", value: docs, kind: "qty" as const },
      { label: "Net commission", value: net, kind: "money" as const, note: "After return reversals" },
      { label: "Already paid out", value: paidOut, kind: "money" as const },
      { label: "Still to pay", value: net.minus(paidOut), kind: "money" as const },
    ],
    notes: [
      "Commission is earned on the invoice value when the sale is made, so unpaid (Due) invoices earn it too.",
      "Returns appear as their own negative rows on the day the goods came back; the original invoice row is never changed.",
      ...(one ? [] : ["Pick one person to see their invoice totals; with everyone, a sale shared by a salesperson and an agent is listed once for each."]),
    ],
  };
}
