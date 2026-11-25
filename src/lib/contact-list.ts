import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { D } from "@/lib/money";

type Dec = Prisma.Decimal;
const DAY = 86_400_000;

export const IDLE_OPTIONS: Record<string, string> = { "30": "30 days", "90": "3 months", "180": "6 months", "365": "a year" };

export type ContactFilters = { type: string; q: string; bal: string; group: string; idle: string; sort: string };

export function contactFilters(sp: Record<string, string | undefined>): ContactFilters {
  return { type: sp.type === "supplier" ? "supplier" : "customer", q: (sp.q ?? "").trim(), bal: sp.bal ?? "", group: sp.group ?? "", idle: sp.idle ?? "", sort: sp.sort ?? "name" };
}

export const isFiltered = (f: ContactFilters) => Boolean(f.q || f.bal || f.group || f.idle || f.sort !== "name");

// Per-contact document totals (spec §17.1). Customers: final sales and store credit. Suppliers: posted GRNs, with
// settled supplier claims counted as credit notes.
export type ContactStats = { docTotal: Dec; docPaid: Dec; docCredited: Dec; docCount: number; docDue: Dec; last: Date | null; storeCredit: Dec };

export async function contactStats(ids: string[], supplier: boolean): Promise<Map<string, ContactStats>> {
  const out = new Map<string, ContactStats>();
  const get = (id: string) => {
    let s = out.get(id);
    if (!s) out.set(id, (s = { docTotal: D(0), docPaid: D(0), docCredited: D(0), docCount: 0, docDue: D(0), last: null, storeCredit: D(0) }));
    return s;
  };
  if (!ids.length) return out;
  if (supplier) {
    const [grnAgg, claimAgg] = await Promise.all([
      db.goodsReceipt.groupBy({ by: ["supplierId"], where: { supplierId: { in: ids }, status: "POSTED" }, _sum: { total: true, paid: true }, _count: true, _max: { receivedAt: true } }),
      db.supplierClaim.groupBy({ by: ["supplierId"], where: { supplierId: { in: ids }, status: "SETTLED" }, _sum: { creditAmount: true } }),
    ]);
    for (const r of grnAgg) if (r.supplierId) Object.assign(get(r.supplierId), { docTotal: D(r._sum.total), docPaid: D(r._sum.paid), docCount: r._count, last: r._max.receivedAt });
    for (const r of claimAgg) get(r.supplierId).docCredited = D(r._sum.creditAmount);
  } else {
    const [saleAgg, creditAgg] = await Promise.all([
      db.sale.groupBy({ by: ["customerId"], where: { customerId: { in: ids }, stage: "FINAL" }, _sum: { total: true, paid: true, credited: true }, _count: true, _max: { soldAt: true } }),
      db.storeCreditEntry.groupBy({ by: ["contactId"], where: { contactId: { in: ids } }, _sum: { amount: true } }),
    ]);
    for (const r of saleAgg) Object.assign(get(r.customerId as string), { docTotal: D(r._sum.total), docPaid: D(r._sum.paid), docCredited: D(r._sum.credited), docCount: r._count, last: r._max.soldAt });
    for (const r of creditAgg) get(r.contactId).storeCredit = D(r._sum.amount);
  }
  for (const s of out.values()) s.docDue = s.docTotal.minus(s.docPaid).minus(s.docCredited);
  return out;
}

const EMPTY: ContactStats = { docTotal: D(0), docPaid: D(0), docCredited: D(0), docCount: 0, docDue: D(0), last: null, storeCredit: D(0) };
export const statsOf = (m: Map<string, ContactStats>, id: string) => m.get(id) ?? EMPTY;

export const openingDue = (c: { openingBalance: Dec; openingPaid: Dec }, supplier: boolean) => D(c.openingBalance).minus(supplier ? 0 : c.openingPaid);
export const dueOf = (c: { id: string; openingBalance: Dec; openingPaid: Dec }, m: Map<string, ContactStats>, supplier: boolean) =>
  openingDue(c, supplier).plus(statsOf(m, c.id).docDue);

const contactInclude = { group: true } satisfies Prisma.ContactInclude;
export type ListedContact = Prisma.ContactGetPayload<{ include: typeof contactInclude }>;

// One query path for the screen and the exports, so an export always matches the filters on screen.
// `page` null returns every matching contact.
export async function listContacts(f: ContactFilters, page: number | null, pageSize: number) {
  const supplier = f.type === "supplier";
  const where: Prisma.ContactWhereInput = {
    active: true,
    ...(supplier ? { isSupplier: true } : { isCustomer: true }),
    ...(!supplier && f.group === "none" ? { groupId: null } : !supplier && f.group ? { groupId: f.group } : {}),
    ...(!supplier && f.bal === "over" ? { creditLimit: { not: null } } : {}),
    ...(f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { phone: { contains: f.q } }, { code: { equals: f.q, mode: "insensitive" } }, { supplierCode: { equals: f.q, mode: "insensitive" } }, { company: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
  const orderBy: Prisma.ContactOrderByWithRelationInput[] = f.sort === "newest" ? [{ createdAt: "desc" }, { id: "asc" }] : [{ name: "asc" }, { id: "asc" }];

  // Balance filters and "highest due" need every matching contact's balance; plain browsing stays paged in the database.
  const needsBalances = Boolean(f.bal || f.idle || f.sort === "due");
  if (!needsBalances) {
    const found = await db.contact.findMany({ where, orderBy, include: contactInclude, ...(page ? { skip: (page - 1) * pageSize, take: pageSize + 1 } : {}) });
    const contacts = page ? found.slice(0, pageSize) : found;
    return { contacts, stats: await contactStats(contacts.map((c) => c.id), supplier), hasNext: page ? found.length > pageSize : false, summary: null };
  }

  const all = await db.contact.findMany({ where, orderBy, select: { id: true, openingBalance: true, openingPaid: true, creditLimit: true } });
  const stats = await contactStats(all.map((c) => c.id), supplier);
  const idleDays = Number(f.idle);
  const cutoff = idleDays > 0 ? new Date(Date.now() - idleDays * DAY) : null;
  let rows = all.map((c) => {
    const s = statsOf(stats, c.id);
    return { id: c.id, due: dueOf(c, stats, supplier), limit: c.creditLimit, last: s.last, credit: s.storeCredit };
  });
  if (f.bal === "due") rows = rows.filter((r) => r.due.gt(0));
  if (f.bal === "advance") rows = supplier ? rows.filter((r) => r.due.lt(0)) : rows.filter((r) => r.credit.gt(0) || r.due.lt(0));
  if (f.bal === "over") rows = rows.filter((r) => r.limit != null && r.due.gt(r.limit));
  if (f.bal === "clear") rows = rows.filter((r) => r.due.eq(0));
  if (f.idle === "never") rows = rows.filter((r) => !r.last);
  else if (cutoff) rows = rows.filter((r) => r.last && r.last < cutoff);
  if (f.sort === "due") rows.sort((a, z) => z.due.comparedTo(a.due));
  const summary = f.bal === "due" || f.bal === "over" ? { count: rows.length, total: rows.reduce((a, r) => a.plus(r.due), D(0)) } : null;

  const ids = (page ? rows.slice((page - 1) * pageSize, page * pageSize) : rows).map((r) => r.id);
  const found = new Map((await db.contact.findMany({ where: { id: { in: ids } }, include: contactInclude })).map((c) => [c.id, c]));
  const contacts = ids.map((id) => found.get(id)).filter((c): c is ListedContact => Boolean(c));
  return { contacts, stats, hasNext: page ? rows.length > page * pageSize : false, summary };
}

// Plain-words description of the active filters, for export headers.
export async function describeFilters(f: ContactFilters) {
  const supplier = f.type === "supplier";
  const parts: string[] = [];
  if (f.q) parts.push(`Search “${f.q}”`);
  const bal: Record<string, string> = supplier
    ? { due: "We owe them", advance: "They owe us / advance paid", clear: "Fully settled" }
    : { due: "Has dues", over: "Over credit limit", advance: "Has store credit / advance", clear: "Fully settled" };
  if (bal[f.bal]) parts.push(bal[f.bal]);
  if (!supplier && f.group === "none") parts.push("No group");
  else if (!supplier && f.group) parts.push(`Group: ${(await db.customerGroup.findUnique({ where: { id: f.group } }))?.name ?? "?"}`);
  if (f.idle === "never") parts.push(supplier ? "Never purchased from" : "Never bought");
  else if (IDLE_OPTIONS[f.idle]) parts.push(`${supplier ? "No purchase" : "Not bought"} in ${IDLE_OPTIONS[f.idle]}`);
  if (f.sort === "due") parts.push(supplier ? "Sorted: we owe most first" : "Sorted: highest due first");
  if (f.sort === "newest") parts.push("Sorted: newest added");
  return parts.length ? parts.join(" · ") : `All active ${supplier ? "suppliers" : "customers"}`;
}
