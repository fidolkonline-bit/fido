import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, qty, colomboDayStart } from "@/lib/money";
import { PageHead, DataTable, Stat } from "@/components/ui";

export const metadata = { title: "Reports" };

// First operational reports; the full RP-01…RP-36 catalogue follows in Phase E.
export default async function Reports({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await requirePermission("reports.view");
  const { days = "30" } = await searchParams;
  const since = days === "0" ? colomboDayStart() : new Date(Date.now() - Number(days) * 86_400_000);
  const loc = user.location?.id;
  const saleWhere = { stage: "FINAL", soldAt: { gte: since }, ...(loc ? { locationId: loc } : {}) };
  const showCost = can(user, "cost.view");

  const [sales, lines, pays, commissions] = await Promise.all([
    db.sale.aggregate({ where: saleWhere, _sum: { subtotal: true, discount: true, total: true, paid: true, credited: true }, _count: true }),
    db.saleLine.groupBy({ by: ["productId", "nameSnapshot"], where: { sale: saleWhere }, _sum: { qty: true, lineTotal: true, costTotal: true }, orderBy: { _sum: { lineTotal: "desc" } }, take: 15 }),
    db.payment.groupBy({ by: ["method"], where: { direction: "IN", method: { not: "STORE_CREDIT" }, paidAt: { gte: since }, ...(loc ? { sale: { locationId: loc } } : {}) }, _sum: { amount: true } }),
    db.commissionAccrual.groupBy({ by: ["recipientId", "role"], where: { saleLine: { sale: saleWhere } }, _sum: { amount: true, basis: true } }),
  ]);
  const returnWhere = { createdAt: { gte: since }, ...(loc ? { locationId: loc } : {}) };
  const [cost, returned, returnedCost] = await Promise.all([
    db.saleLine.aggregate({ where: { sale: saleWhere }, _sum: { costTotal: true } }),
    db.saleReturn.aggregate({ where: returnWhere, _sum: { totalValue: true }, _count: true }),
    db.saleReturnLine.aggregate({ where: { saleReturn: returnWhere }, _sum: { costValue: true } }),
  ]);
  const cogs = D(cost._sum.costTotal).minus(D(returnedCost._sum.costValue));
  const people = await db.person.findMany({ where: { id: { in: commissions.map((c) => c.recipientId) } }, select: { id: true, fullName: true } });
  const nameOf = new Map(people.map((p) => [p.id, p.fullName]));
  const netSales = D(sales._sum.subtotal).minus(D(sales._sum.discount)).minus(D(returned._sum.totalValue));

  return (
    <div className="stack">
      <PageHead eyebrow={`Reports / ${user.location?.name ?? ""}`} title="Reports" />
      <form className="toolbar">
        <select name="days" defaultValue={days} aria-label="Period" style={{ flex: "0 1 200px" }}>
          <option value="0">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option>
        </select>
        <button className="btn">Apply</button>
        <span className="small muted">Invoice basis for sales · payment-date basis for collections · Asia/Colombo dates</span>
      </form>
      <div className="stats">
        <Stat label="Net sales" value={`Rs. ${money(netSales)}`} basis={`${sales._count} invoices − ${returned._count} credit notes (Rs. ${money(returned._sum.totalValue)})`} />
        {showCost && <Stat label="Cost of goods (FIFO)" value={`Rs. ${money(cogs)}`} basis="Original lot cost, less returns" />}
        {showCost && <Stat label="Gross profit" value={`Rs. ${money(netSales.minus(cogs))}`} basis="Net sales − COGS" />}
        <Stat label="Unpaid on these invoices" value={`Rs. ${money(D(sales._sum.total).minus(D(sales._sum.paid)).minus(D(sales._sum.credited)))}`} basis="Invoice total − paid − returned" />
      </div>

      <section>
        <h2>Collections by method</h2>
        <DataTable rows={pays} rowKey={(p) => p.method} empty="No payments in this period." cards={false}
          columns={[{ label: "Method", render: (p) => p.method.replace("_", " ").toLowerCase() }, { label: "Amount", num: true, render: (p) => money(p._sum.amount) }]} />
      </section>

      <section>
        <h2>Top products</h2>
        <DataTable rows={lines} rowKey={(l) => l.productId + l.nameSnapshot} empty="No sales in this period."
          columns={[
            { label: "Product", primary: true, render: (l) => l.nameSnapshot },
            { label: "Qty", num: true, render: (l) => qty(l._sum.qty) },
            { label: "Sales", num: true, render: (l) => money(l._sum.lineTotal) },
            ...(showCost ? [
              { label: "Cost", num: true, render: (l: (typeof lines)[number]) => money(l._sum.costTotal) },
              { label: "Margin", num: true, render: (l: (typeof lines)[number]) => money(D(l._sum.lineTotal).minus(D(l._sum.costTotal))) },
            ] : []),
          ]} />
        <p className="small muted">Product margins use line values before invoice-level discounts (legacy basis).</p>
      </section>

      <section>
        <h2>Commission accrued</h2>
        <DataTable rows={commissions} rowKey={(c) => c.recipientId + c.role} empty="No commission accrued in this period."
          columns={[
            { label: "Recipient", primary: true, render: (c) => nameOf.get(c.recipientId) ?? "—" },
            { label: "Type", render: (c) => (c.role === "USER" ? "User" : "Agent") },
            { label: "Eligible value", num: true, render: (c) => money(c._sum.basis) },
            { label: "Accrued", num: true, render: (c) => money(c._sum.amount) },
          ]} />
      </section>
    </div>
  );
}
