import Link from "next/link";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDate } from "@/lib/money";
import { contactFilters, isFiltered, listContacts, statsOf, dueOf, IDLE_OPTIONS } from "@/lib/contact-list";
import { PageHead, DataTable, RowLink, Tabs, Pager, PAGE_SIZE, pageOf } from "@/components/ui";

export const metadata = { title: "Contacts" };

type Params = { type?: string; q?: string; page?: string; bal?: string; group?: string; idle?: string; sort?: string };

export default async function Contacts({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requirePermission("contacts.view");
  const sp = await searchParams;
  const f = contactFilters(sp);
  const { type, q, bal, group, idle, sort } = f;
  const page = pageOf(sp.page);
  const supplier = type === "supplier";
  const [{ contacts, stats, hasNext, summary }, groups] = await Promise.all([
    listContacts(f, page, PAGE_SIZE),
    supplier ? Promise.resolve([]) : db.customerGroup.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const filtered = isFiltered(f);
  const noun = supplier ? "suppliers" : "customers";
  const lastLabel = supplier ? "Last purchase" : "Last sale";
  const exportQuery = new URLSearchParams(Object.entries({ type, q, bal, group, idle, sort }).filter(([, v]) => v)).toString();
  const canExport = can(user, "reports.view");

  return (
    <div>
      <PageHead
        eyebrow="Contacts"
        title={supplier ? "Suppliers" : "Customers"}
        actions={<>
          {canExport && <a className="btn" href={`/api/contacts/export?format=xlsx&${exportQuery}`} download>Export Excel</a>}
          {canExport && <a className="btn" href={`/api/contacts/export?format=pdf&${exportQuery}`} download>Export PDF</a>}
          {can(user, "contacts.manage") && <Link className="btn btn-primary" href={`/contacts/new?type=${type}`}>New {supplier ? "supplier" : "customer"}</Link>}
        </>}
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
              const due = dueOf(c, stats, supplier);
              return <span style={{ color: due.gt(0) ? "var(--err)" : undefined }}>{money(due)}</span>;
            },
          },
          ...(supplier ? [] : [
            { label: "Store credit", num: true, render: (c: (typeof contacts)[number]) => { const cr = statsOf(stats, c.id).storeCredit; return cr.gt(0) ? money(cr) : "—"; } },
            { label: "Credit limit", num: true, render: (c: (typeof contacts)[number]) => (c.creditLimit ? money(c.creditLimit) : "No limit") },
          ]),
          { label: lastLabel, render: (c) => fmtDate(statsOf(stats, c.id).last) },
        ]}
      />
      <Pager page={page} hasNext={hasNext} query={{ type, q, bal, group, idle, sort }} shown={contacts.length} noun={noun} />
    </div>
  );
}
