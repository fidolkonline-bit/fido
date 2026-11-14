import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, fmtDate } from "@/lib/money";
import { PageHead, DataTable, RowLink, Tabs, Pager, PAGE_SIZE, pageOf } from "@/components/ui";

export const metadata = { title: "Contacts" };

type Params = { type?: string; q?: string; page?: string; bal?: string; group?: string; idle?: string; sort?: string };
type Dec = Prisma.Decimal;

const DAY = 86_400_000;
const IDLE_OPTIONS: Record<string, string> = { "30": "30 days", "90": "3 months", "180": "6 months", "365": "a year" };

// Dues = opening + posted documents − settlements (spec §17.1), plus each contact's last activity and store credit.
async function balancesFor(ids: string[], supplier: boolean) {
  if (supplier) {
    const [grnAgg, claimAgg] = await Promise.all([
      db.goodsReceipt.groupBy({ by: ["supplierId"], where: { supplierId: { in: ids }, status: "POSTED" }, _sum: { total: true, paid: true }, _max: { receivedAt: true } }),
      db.supplierClaim.groupBy({ by: ["supplierId"], where: { supplierId: { in: ids }, status: "SETTLED" }, _sum: { creditAmount: true } }),
    ]);
    const claimCredit = new Map(claimAgg.map((r) => [r.supplierId, D(r._sum.creditAmount)]));
    // Payable = posted GRNs − payments − supplier credit notes from settled claims.
    return {
      docDue: new Map(grnAgg.map((r) => [r.supplierId, D(r._sum.total).minus(D(r._sum.paid)).minus(claimCredit.get(r.supplierId) ?? 0)])),
      last: new Map(grnAgg.map((r) => [r.supplierId, r._max.receivedAt])),
      credit: new Map<string, Dec>(),
    };
  }
  const [saleAgg, creditAgg] = await Promise.all([
    db.sale.groupBy({ by: ["customerId"], where: { customerId: { in: ids }, stage: "FINAL" }, _sum: { total: true, paid: true, credited: true }, _max: { soldAt: true } }),
    db.storeCreditEntry.groupBy({ by: ["contactId"], where: { contactId: { in: ids } }, _sum: { amount: true } }),
  ]);
  return {
    docDue: new Map(saleAgg.map((r) => [r.customerId as string, D(r._sum.total).minus(D(r._sum.paid)).minus(D(r._sum.credited))])),
    last: new Map(saleAgg.map((r) => [r.customerId as string, r._max.soldAt])),
    credit: new Map(creditAgg.map((r) => [r.contactId, D(r._sum.amount)])),
  };
}

export default async function Contacts({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requirePermission("contacts.view");
  const { type = "customer", q, page: pageParam, bal = "", group = "", idle = "", sort = "name" } = await searchParams;
  const page = pageOf(pageParam);
  const supplier = type === "supplier";
  const where: Prisma.ContactWhereInput = {
    active: true,
    ...(supplier ? { isSupplier: true } : { isCustomer: true }),
    ...(!supplier && group === "none" ? { groupId: null } : !supplier && group ? { groupId: group } : {}),
    ...(!supplier && bal === "over" ? { creditLimit: { not: null } } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { code: { equals: q, mode: "insensitive" } }, { company: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const orderBy: Prisma.ContactOrderByWithRelationInput[] = sort === "newest" ? [{ createdAt: "desc" }, { id: "asc" }] : [{ name: "asc" }, { id: "asc" }];

  const dueOf = (c: { id: string; openingBalance: Dec; openingPaid: Dec }, docDue: Map<string, Dec>) =>
    D(c.openingBalance).minus(supplier ? 0 : c.openingPaid).plus(docDue.get(c.id) ?? 0);

  // Balance filters and "highest due" need every matching contact's balance, so those are filtered and paged here;
  // plain browsing stays paged in the database.
  const needsBalances = Boolean(bal || idle || sort === "due");
  let pageIds: string[] | null = null;
  let hasNext: boolean | undefined;
  let summary: { count: number; total: Dec } | null = null;
  if (needsBalances) {
    const all = await db.contact.findMany({ where, orderBy, select: { id: true, openingBalance: true, openingPaid: true, creditLimit: true } });
    const b = await balancesFor(all.map((c) => c.id), supplier);
    const idleDays = Number(idle);
    const cutoff = idleDays > 0 ? new Date(Date.now() - idleDays * DAY) : null;
    let rows = all.map((c) => ({ id: c.id, due: dueOf(c, b.docDue), limit: c.creditLimit, last: b.last.get(c.id) ?? null, credit: b.credit.get(c.id) ?? D(0) }));
    if (bal === "due") rows = rows.filter((r) => r.due.gt(0));
    if (bal === "advance") rows = supplier ? rows.filter((r) => r.due.lt(0)) : rows.filter((r) => r.credit.gt(0) || r.due.lt(0));
    if (bal === "over") rows = rows.filter((r) => r.limit != null && r.due.gt(r.limit));
    if (bal === "clear") rows = rows.filter((r) => r.due.eq(0));
    if (idle === "never") rows = rows.filter((r) => !r.last);
    else if (cutoff) rows = rows.filter((r) => r.last && r.last < cutoff);
    if (sort === "due") rows.sort((a, z) => z.due.comparedTo(a.due));
    if (bal === "due" || bal === "over") summary = { count: rows.length, total: rows.reduce((a, r) => a.plus(r.due), D(0)) };
    pageIds = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((r) => r.id);
    hasNext = rows.length > page * PAGE_SIZE;
  }

  const found = pageIds
    ? await db.contact.findMany({ where: { id: { in: pageIds } }, include: { group: true } })
    : await db.contact.findMany({ where, orderBy, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1, include: { group: true } });
  const contacts = pageIds ? pageIds.map((id) => found.find((c) => c.id === id)!).filter(Boolean) : found.slice(0, PAGE_SIZE);
  hasNext ??= !pageIds && found.length > PAGE_SIZE;
  const [b, groups] = await Promise.all([
    balancesFor(contacts.map((c) => c.id), supplier),
    supplier ? Promise.resolve([]) : db.customerGroup.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const filtered = Boolean(q || bal || group || idle || sort !== "name");
  const noun = supplier ? "suppliers" : "customers";
  const lastLabel = supplier ? "Last purchase" : "Last sale";

  return (
    <div>
      <PageHead
        eyebrow="Contacts"
        title={supplier ? "Suppliers" : "Customers"}
        actions={can(user, "contacts.manage") && <Link className="btn btn-primary" href={`/contacts/new?type=${type}`}>New {supplier ? "supplier" : "customer"}</Link>}
      />
      <Tabs items={[
        { label: "Customers", href: "/contacts?type=customer", active: !supplier },
        { label: "Suppliers", href: "/contacts?type=supplier", active: supplier },
      ]} />
      <form className="toolbar" role="search">
        <input type="hidden" name="type" value={type} />
        <input name="q" defaultValue={q} placeholder="Search name, phone or code" aria-label="Search contacts" />
        <select name="bal" defaultValue={bal} aria-label="Balance">
          <option value="">Any balance</option>
          {supplier ? (
            <>
              <option value="due">We owe them</option>
              <option value="advance">They owe us / advance paid</option>
              <option value="clear">Fully settled</option>
            </>
          ) : (
            <>
              <option value="due">Has dues</option>
              <option value="over">Over credit limit</option>
              <option value="advance">Has store credit / advance</option>
              <option value="clear">Fully settled</option>
            </>
          )}
        </select>
        {!supplier && (
          <select name="group" defaultValue={group} aria-label="Customer group">
            <option value="">All groups</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            <option value="none">No group</option>
          </select>
        )}
        <select name="idle" defaultValue={idle} aria-label={supplier ? "Last purchase" : "Last sale"}>
          <option value="">{supplier ? "Any last purchase" : "Any last sale"}</option>
          {Object.entries(IDLE_OPTIONS).map(([v, l]) => <option key={v} value={v}>{supplier ? "No purchase" : "Not bought"} in {l}</option>)}
          <option value="never">{supplier ? "Never purchased from" : "Never bought"}</option>
        </select>
        <select name="sort" defaultValue={sort} aria-label="Sort">
          <option value="name">Name A–Z</option>
          <option value="due">{supplier ? "We owe most first" : "Highest due first"}</option>
          <option value="newest">Newest added</option>
        </select>
        <button className="btn">Filter</button>
        {filtered && <Link className="btn btn-sm" href={`/contacts?type=${type}`}>Clear</Link>}
      </form>
      {summary && summary.count > 0 && (
        <p className="small" style={{ marginTop: 0 }}>
          {summary.count} {summary.count === 1 ? noun.slice(0, -1) : noun}{" "}
          {supplier ? <>· we owe <strong>{money(summary.total)}</strong> in total.</> : <>{summary.count === 1 ? "owes" : "owe"} <strong>{money(summary.total)}</strong> in total.</>}
        </p>
      )}
      <DataTable
        rows={contacts}
        rowKey={(c) => c.id}
        empty={filtered ? `No ${noun} match these filters.` : `No ${noun} yet.`}
        columns={[
          { label: supplier ? "Supplier" : "Customer", primary: true, render: (c) => <RowLink href={`/contacts/${c.id}`}>{c.name}</RowLink> },
          { label: "Mobile", render: (c) => c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : "—" },
          ...(supplier ? [] : [{ label: "Group", render: (c: (typeof contacts)[number]) => c.group?.name ?? "—" }]),
          {
            label: supplier ? "We owe" : "Due", num: true,
            render: (c) => {
              const due = dueOf(c, b.docDue);
              return <span style={{ color: due.gt(0) ? "var(--err)" : undefined }}>{money(due)}</span>;
            },
          },
          ...(supplier ? [] : [
            { label: "Store credit", num: true, render: (c: (typeof contacts)[number]) => { const cr = b.credit.get(c.id); return cr?.gt(0) ? money(cr) : "—"; } },
            { label: "Credit limit", num: true, render: (c: (typeof contacts)[number]) => (c.creditLimit ? money(c.creditLimit) : "No limit") },
          ]),
          { label: lastLabel, render: (c) => { const d = b.last.get(c.id); return d ? fmtDate(d) : "—"; } },
        ]}
      />
      <Pager page={page} hasNext={hasNext} query={{ type, q, bal, group, idle, sort }} shown={contacts.length} noun={noun} />
    </div>
  );
}
