import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money } from "@/lib/money";
import { PageHead, DataTable, RowLink, Tabs, Pager, PAGE_SIZE, pageOf } from "@/components/ui";

export const metadata = { title: "Contacts" };

export default async function Contacts({ searchParams }: { searchParams: Promise<{ type?: string; q?: string; page?: string }> }) {
  const user = await requirePermission("contacts.view");
  const { type = "customer", q, page: pageParam } = await searchParams;
  const page = pageOf(pageParam);
  const supplier = type === "supplier";
  const where: Prisma.ContactWhereInput = {
    active: true,
    ...(supplier ? { isSupplier: true } : { isCustomer: true }),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { code: { equals: q, mode: "insensitive" } }, { company: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const found = await db.contact.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1, include: { group: true } });
  const contacts = found.slice(0, PAGE_SIZE);
  const ids = contacts.map((c) => c.id);

  // Dues = opening + posted documents − settlements (spec §17.1).
  const [saleAgg, grnAgg, claimAgg] = await Promise.all([
    db.sale.groupBy({ by: ["customerId"], where: { customerId: { in: ids }, stage: "FINAL" }, _sum: { total: true, paid: true, credited: true } }),
    db.goodsReceipt.groupBy({ by: ["supplierId"], where: { supplierId: { in: ids }, status: "POSTED" }, _sum: { total: true, paid: true } }),
    db.supplierClaim.groupBy({ by: ["supplierId"], where: { supplierId: { in: ids }, status: "SETTLED" }, _sum: { creditAmount: true } }),
  ]);
  const saleDue = new Map(saleAgg.map((r) => [r.customerId, D(r._sum.total).minus(D(r._sum.paid)).minus(D(r._sum.credited))]));
  const claimCredit = new Map(claimAgg.map((r) => [r.supplierId, D(r._sum.creditAmount)]));
  // Payable = posted GRNs − payments − supplier credit notes from settled claims.
  const grnDue = new Map(grnAgg.map((r) => [r.supplierId, D(r._sum.total).minus(D(r._sum.paid)).minus(claimCredit.get(r.supplierId) ?? 0)]));

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
        <button className="btn">Search</button>
      </form>
      <DataTable
        rows={contacts}
        rowKey={(c) => c.id}
        empty={q ? `No contacts match “${q}”.` : `No ${supplier ? "suppliers" : "customers"} yet.`}
        columns={[
          { label: supplier ? "Supplier" : "Customer", primary: true, render: (c) => <RowLink href={`/contacts/${c.id}`}>{c.name}</RowLink> },
          { label: "Mobile", render: (c) => c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : "—" },
          ...(supplier ? [] : [{ label: "Group", render: (c: (typeof contacts)[number]) => c.group?.name ?? "—" }]),
          {
            label: supplier ? "We owe" : "Due", num: true,
            render: (c) => {
              const due = D(c.openingBalance).minus(supplier ? 0 : c.openingPaid).plus((supplier ? grnDue : saleDue).get(c.id) ?? 0);
              return <span style={{ color: due.gt(0) ? "var(--err)" : undefined }}>{money(due)}</span>;
            },
          },
          ...(supplier ? [] : [{ label: "Credit limit", num: true, render: (c: (typeof contacts)[number]) => (c.creditLimit ? money(c.creditLimit) : "No limit") }]),
        ]}
      />
      <Pager page={page} hasNext={found.length > PAGE_SIZE} query={{ type, q }} shown={contacts.length} noun={supplier ? "suppliers" : "customers"} />
    </div>
  );
}
