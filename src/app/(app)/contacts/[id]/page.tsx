import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge, Stat } from "@/components/ui";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const row = await db.contact.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: row?.name ?? "Not found" };
}

export default async function ContactDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("contacts.view");
  const c = await db.contact.findUnique({ where: { id: (await params).id }, include: { group: true } });
  if (!c) notFound();

  const [sales, receipts, payments] = await Promise.all([
    c.isCustomer ? db.sale.findMany({ where: { customerId: c.id, stage: "FINAL" }, orderBy: { soldAt: "desc" }, take: 50 }) : [],
    c.isSupplier ? db.goodsReceipt.findMany({ where: { supplierId: c.id }, orderBy: { receivedAt: "desc" }, take: 50 }) : [],
    db.payment.findMany({ where: { contactId: c.id }, orderBy: { paidAt: "desc" }, take: 50, include: { account: true } }),
  ]);
  const customerDue = D(c.isCustomer ? c.openingBalance : 0).plus(sales.reduce((a, s) => a.plus(s.total).minus(s.paid).minus(s.credited), D(0)));
  const claimCredit = c.isSupplier ? await db.supplierClaim.aggregate({ where: { supplierId: c.id, status: "SETTLED" }, _sum: { creditAmount: true } }) : null;
  const supplierDue = D(c.isSupplier && !c.isCustomer ? c.openingBalance : 0).plus(receipts.reduce((a, r) => a.plus(r.total).minus(r.paid), D(0))).minus(D(claimCredit?._sum.creditAmount));

  return (
    <div className="stack">
      <PageHead
        eyebrow={`Contacts / ${[c.isCustomer && "Customer", c.isSupplier && "Supplier"].filter(Boolean).join(" & ")}`}
        title={c.name}
        actions={can(user, "contacts.manage") && <Link className="btn" href={`/contacts/${c.id}/edit`}>Edit</Link>}
      />
      <div className="stats">
        {c.isCustomer && <Stat label="Customer due" value={`Rs. ${money(customerDue)}`} basis="Opening + invoices − payments" />}
        {c.isCustomer && <Stat label="Credit limit" value={c.creditLimit ? `Rs. ${money(c.creditLimit)}` : "No limit"} basis={c.payTermDays ? `${c.payTermDays}-day terms` : "No terms set"} />}
        {c.isSupplier && <Stat label="Payable to supplier" value={`Rs. ${money(supplierDue)}`} basis="Posted GRNs − payments − supplier credits" />}
        <Stat label="Mobile" value={c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : "—"} basis={c.group?.name} />
      </div>

      {c.isCustomer && (
        <section>
          <h2>Sales</h2>
          <DataTable rows={sales} rowKey={(s) => s.id} empty="No sales to this customer yet."
            columns={[
              { label: "Invoice", primary: true, render: (s) => <RowLink href={`/sales/${s.id}`}>{s.number}</RowLink> },
              { label: "Date", render: (s) => fmtDateTime(s.soldAt) },
              { label: "Total", num: true, render: (s) => money(s.total) },
              { label: "Paid", num: true, render: (s) => money(s.paid) },
              { label: "Due", num: true, render: (s) => money(D(s.total).minus(s.paid).minus(s.credited)) },
            ]} />
        </section>
      )}
      {c.isSupplier && (
        <section>
          <h2>Receipts / GRNs</h2>
          <DataTable rows={receipts} rowKey={(r) => r.id} empty="No goods received from this supplier yet."
            columns={[
              { label: "GRN", primary: true, render: (r) => <RowLink href={`/purchases/${r.id}`}>{r.number}</RowLink> },
              { label: "Supplier ref", render: (r) => r.supplierRef ?? "—" },
              { label: "Date", render: (r) => fmtDateTime(r.receivedAt) },
              { label: "Total", num: true, render: (r) => money(r.total) },
              { label: "Due", num: true, render: (r) => money(D(r.total).minus(r.paid)) },
            ]} />
        </section>
      )}
      <section>
        <h2>Payments</h2>
        <DataTable rows={payments} rowKey={(p) => p.id} empty="No payments recorded."
          columns={[
            { label: "Reference", primary: true, render: (p) => p.number },
            { label: "Date", render: (p) => fmtDateTime(p.paidAt) },
            { label: "Direction", render: (p) => <Badge tone={p.direction === "IN" ? "ok" : "warn"}>{p.direction === "IN" ? "Received" : "Paid out"}</Badge> },
            { label: "Method", render: (p) => p.method.replace("_", " ").toLowerCase() },
            { label: "Account", render: (p) => p.account?.name ?? <span className="badge badge-warn">Unmapped</span> },
            { label: "Amount", num: true, render: (p) => money(p.amount) },
          ]} />
      </section>
    </div>
  );
}
