import { Prisma } from "@prisma/client";
import { db } from "./db";
import { D, ZERO } from "./money";
import type { Result, Row, ParamOptions } from "./reports/types";

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
  person: string; amount: Prisma.Decimal; returnLines: Set<string>; kind: "SALE" | "RETURN" | "REPAIR";
};

function payState(total: Prisma.Decimal.Value, paid: Prisma.Decimal.Value, credited: Prisma.Decimal.Value = 0) {
  const due = D(total).minus(paid).minus(credited);
  if (due.lte(0.005)) return D(credited).gt(0) && D(paid).lte(0) ? "Returned" : "Paid";
  return D(paid).gt(0) ? "Partial" : "Due";
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
    let key: string, base: Omit<Group, "person" | "amount" | "returnLines">;
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
    const g = groups.get(key) ?? { ...base, person: a.recipient.fullName, amount: ZERO, returnLines: new Set<string>() };
    g.amount = g.amount.plus(a.amount);
    // A returned line can carry two reversals (salesperson + agent); count its value once per person.
    if (ret && !g.returnLines.has(ret.id)) { g.returnLines.add(ret.id); g.total = (g.total ?? ZERO).minus(ret.value); }
    groups.set(key, g);
  }

  const list = [...groups.values()].sort((x, y) => (opts.personId ? 0 : x.person.localeCompare(y.person)) || y.date.getTime() - x.date.getTime());
  const one = !!opts.personId;
  const rows: Row[] = list.map((g) => ({
    date: g.date, invoice: g.doc, customer: g.customer, status: g.status, total: g.total, paid: g.paid,
    person: g.person, commission: g.amount, _href: g.href, _tone: g.kind === "RETURN" ? "warn" : undefined,
  }));
  const net = list.reduce((s, g) => s.plus(g.amount), ZERO);
  const sumOf = (k: string) => rows.reduce((s, r) => s.plus(D(r[k] as Prisma.Decimal.Value)), ZERO);
  // Same layout as the old Clicky "Sales Representative Report": one line per invoice, the person and their commission last.
  return {
    title: "Sales Representative Report",
    columns: [
      { key: "date", label: "Date", kind: "datetime" }, { key: "invoice", label: "Invoice No." }, { key: "customer", label: "Customer name" },
      { key: "status", label: "Payment status" }, { key: "total", label: "Total amount", kind: "money" }, { key: "paid", label: "Total paid", kind: "money" },
      { key: "commission", label: "Agent Commission", kind: "money", lead: { key: "person", label: "Agent" } },
    ],
    rows,
    // Invoice totals only add up for one person: with everyone, a sale shared by a salesperson and an agent appears twice.
    totals: { commission: net, ...(one ? { total: sumOf("total"), paid: sumOf("paid") } : {}) },
    notes: [
      "Commission is earned on the invoice value when the sale is made, so unpaid (Due) invoices earn it too.",
      "Returns are their own negative rows on the day the goods came back; the original invoice row never changes.",
      ...(one ? [] : ["Pick one person to total the invoice amounts; with everyone, a sale shared by a salesperson and an agent is listed for each."]),
    ],
  };
}
