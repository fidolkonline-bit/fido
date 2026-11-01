import { db } from "../db";
import type { PayLine } from "../payroll";
import type { ReportDef, Row } from "./types";
import { D, ZERO, sum, inPeriod, locIn, totalsOf, groupSum } from "./util";

const saleWhere = (ctx: Parameters<ReportDef["run"]>[0]) => ({ stage: "FINAL", soldAt: inPeriod(ctx), locationId: locIn(ctx) });

export const salesReports: ReportDef[] = [
  {
    id: "RP-01", slug: "profit-loss", title: "Profit / Loss", group: "Profit & sales",
    basis: "Invoice (accrual) basis: sales and costs by document date in Asia/Colombo; collections are a separate cash view.",
    async run(ctx) {
      const sw = saleWhere(ctx);
      const [sales, lineCost, returns, retCost, writeOffRet, expenses, adjLines, claims, repairs, accruals, targets, slips] = await Promise.all([
        db.sale.aggregate({ where: sw, _sum: { subtotal: true, discount: true, rounding: true } }),
        db.saleLine.aggregate({ where: { sale: sw }, _sum: { costTotal: true } }),
        db.saleReturn.aggregate({ where: { createdAt: inPeriod(ctx), locationId: locIn(ctx) }, _sum: { totalValue: true } }),
        db.saleReturnLine.aggregate({ where: { saleReturn: { createdAt: inPeriod(ctx), locationId: locIn(ctx) } }, _sum: { costValue: true } }),
        db.saleReturnLine.aggregate({ where: { disposition: "WRITTEN_OFF", saleReturn: { createdAt: inPeriod(ctx), locationId: locIn(ctx) } }, _sum: { costValue: true } }),
        db.expense.aggregate({ where: { expenseDate: inPeriod(ctx), locationId: locIn(ctx) }, _sum: { amount: true } }),
        db.stockAdjustmentLine.findMany({ where: { qty: { lt: 0 }, adjustment: { createdAt: inPeriod(ctx), locationId: locIn(ctx) } }, select: { qty: true, unitCost: true } }),
        db.supplierClaim.aggregate({ where: { status: "SETTLED", settledAt: inPeriod(ctx), locationId: locIn(ctx) }, _sum: { lossValue: true } }),
        db.repairJob.findMany({ where: { status: "COLLECTED", collectedAt: inPeriod(ctx), locationId: locIn(ctx) }, include: { parts: true } }),
        db.commissionAccrual.aggregate({ where: { createdAt: inPeriod(ctx), saleLine: { sale: { locationId: locIn(ctx) } } }, _sum: { amount: true } }),
        db.salesTarget.findMany({ where: { approvedAt: inPeriod(ctx) } }),
        db.payslip.findMany({ where: { run: { status: { in: ["APPROVED", "PART_PAID", "PAID"] }, periodEnd: { gte: new Date(`${ctx.fromYmd}T00:00:00Z`), lte: new Date(`${ctx.toYmd}T00:00:00Z`) } } } }),
      ]);
      const gross = D(sales._sum.subtotal).minus(D(sales._sum.discount));
      const netSales = gross.minus(D(returns._sum.totalValue));
      const cogs = D(lineCost._sum.costTotal).minus(D(retCost._sum.costValue));
      const grossProfit = netSales.minus(cogs);
      const repairIncome = sum(repairs, (r) => r.total);
      const repairCost = repairs.reduce((a, r) => a.plus(sum(r.parts, (p) => p.costTotal)).plus(r.externalCost), ZERO);
      const wastage = adjLines.reduce((a, l) => a.plus(D(l.qty).neg().mul(l.unitCost)), ZERO).plus(D(writeOffRet._sum.costValue));
      const claimLoss = D(claims._sum.lossValue);
      const commission = D(accruals._sum.amount);
      const targetBonus = targets.reduce((a, t) => a.plus(D((t.snapshot as { earning?: string } | null)?.earning)), ZERO);
      // Payroll counts salaries/allowances only: commission and target lines were already expensed when earned.
      const payroll = slips.reduce((a, p) => a.plus(p.gross).minus(sum((p.lines as PayLine[]).filter((l) => l.source === "COMMISSION" || l.source === "TARGET"), (l) => l.amount)), ZERO);
      const expenses2 = D(expenses._sum.amount);
      const net = grossProfit.plus(repairIncome).minus(repairCost).minus(expenses2).minus(payroll).minus(commission).minus(targetBonus).minus(wastage).minus(claimLoss);
      const rows: Row[] = [
        { item: "Sales (after line and invoice discounts)", amount: gross },
        { item: "− Sell returns / credit notes", amount: D(returns._sum.totalValue).neg() },
        { item: "= Net sales", amount: netSales, _tone: "ok" },
        { item: "− Cost of goods sold (original lot cost, less returns)", amount: cogs.neg() },
        { item: "= Gross profit", amount: grossProfit, _tone: "ok" },
        { item: "+ Repair income (jobs collected)", amount: repairIncome },
        { item: "− Repair parts and outside-repair cost", amount: repairCost.neg() },
        { item: "− Expenses (excl. tax)", amount: expenses2.neg() },
        { item: "− Payroll (salaries, allowances, deductions excluded)", amount: payroll.neg() },
        { item: "− Sales commission earned (net of return reversals)", amount: commission.neg() },
        { item: "− Sales target bonuses approved", amount: targetBonus.neg() },
        { item: "− Wastage / write-offs at original cost", amount: wastage.neg() },
        { item: "− Supplier recovery losses (settled claims)", amount: claimLoss.neg() },
        { item: "= Net operating result", amount: net, _tone: net.lt(0) ? "err" : "ok" },
      ];
      return {
        columns: [{ key: "item", label: "Line" }, { key: "amount", label: "Amount", kind: "money" }],
        rows: ctx.showCost ? rows : rows.filter((r) => !String(r.item).includes("Cost of goods") && !String(r.item).startsWith("= Gross") && !String(r.item).startsWith("= Net operating")),
        notes: [
          "Rounding on invoices is excluded from sales. Reload sales are included at face value with the provider rate as cost.",
          "Payroll, commission and target bonuses are business-wide; they are not split by location.",
          "Commission and target bonuses are counted when earned/approved; paying them later (directly or in payroll) is not counted again.",
        ],
      };
    },
  },
  {
    id: "RP-02", slug: "profit-breakdown", title: "Profit breakdowns", group: "Profit & sales",
    basis: "Line value before invoice-level discounts (legacy basis, as the old reports); returns not deducted. Use Profit / Loss for net figures.",
    params: [{ key: "by", label: "Group by", options: [["product", "Product"], ["category", "Category"], ["brand", "Brand"], ["location", "Location"], ["day", "Day"], ["customer", "Customer"], ["staff", "Staff"], ["invoice", "Invoice"]] }],
    async run(ctx) {
      const by = ctx.params.by ?? "product";
      const lines = await db.saleLine.findMany({
        where: { sale: saleWhere(ctx) },
        include: { product: { include: { category: true, brand: true } }, sale: { include: { location: true, customer: true, createdBy: true } } },
      });
      const keyOf = (l: (typeof lines)[number]) =>
        by === "category" ? l.product.category?.name ?? "No category" : by === "brand" ? l.product.brand?.name ?? "No brand"
        : by === "location" ? l.sale.location.name : by === "day" ? new Date(l.sale.soldAt.getTime() + 330 * 60_000).toISOString().slice(0, 10)
        : by === "customer" ? l.sale.customer?.name ?? "Walk-in" : by === "staff" ? l.sale.createdBy.fullName : by === "invoice" ? l.sale.number : `${l.product.sku} · ${l.nameSnapshot}`;
      const g = groupSum(lines, keyOf, { qty: (l) => l.qty, sales: (l) => l.lineTotal, cost: (l) => l.costTotal });
      const rows: Row[] = [...g.entries()].map(([k, v]) => ({ group: k, qty: v.qty, sales: v.sales, cost: v.cost, profit: v.sales.minus(v.cost), margin: v.sales.gt(0) ? v.sales.minus(v.cost).div(v.sales).mul(100) : ZERO }))
        .sort((a, b) => (by === "day" ? String(a.group).localeCompare(String(b.group)) : D(b.sales as never).cmp(D(a.sales as never))));
      return {
        columns: [{ key: "group", label: by[0].toUpperCase() + by.slice(1) }, { key: "qty", label: "Qty", kind: "qty" }, { key: "sales", label: "Sales", kind: "money" }, { key: "cost", label: "Cost", kind: "money", cost: true }, { key: "profit", label: "Profit", kind: "money", cost: true }, { key: "margin", label: "Margin %", kind: "pct", cost: true }],
        rows, totals: totalsOf(rows, ["qty", "sales", "cost", "profit"]),
      };
    },
  },
  {
    id: "RP-03", slug: "purchase-sale", title: "Purchase & Sale", group: "Profit & sales",
    basis: "Document dates. The difference between purchases and sales is NOT profit (stock on hand and timing differ).",
    async run(ctx) {
      const [p, claims, s, r] = await Promise.all([
        db.goodsReceipt.aggregate({ where: { status: "POSTED", receivedAt: inPeriod(ctx), locationId: locIn(ctx) }, _sum: { total: true, paid: true }, _count: true }),
        db.supplierClaim.aggregate({ where: { sentAt: inPeriod(ctx), locationId: locIn(ctx) }, _sum: { claimValue: true, creditAmount: true } }),
        db.sale.aggregate({ where: saleWhere(ctx), _sum: { total: true, paid: true, credited: true }, _count: true }),
        db.saleReturn.aggregate({ where: { createdAt: inPeriod(ctx), locationId: locIn(ctx) }, _sum: { totalValue: true } }),
      ]);
      const rows: Row[] = [
        { side: "Purchases (GRNs)", count: p._count, amount: p._sum.total, due: D(p._sum.total).minus(D(p._sum.paid)) },
        { side: "Supplier returns sent (at cost)", count: null, amount: claims._sum.claimValue, due: null },
        { side: "Sales (invoice totals)", count: s._count, amount: s._sum.total, due: D(s._sum.total).minus(D(s._sum.paid)).minus(D(s._sum.credited)) },
        { side: "Sell returns", count: null, amount: r._sum.totalValue, due: null },
      ];
      return {
        columns: [{ key: "side", label: "" }, { key: "count", label: "Documents", kind: "qty" }, { key: "amount", label: "Amount", kind: "money" }, { key: "due", label: "Still due", kind: "money" }],
        rows, summary: [{ label: "Sales − purchases (not profit)", value: D(s._sum.total).minus(D(r._sum.totalValue)).minus(D(p._sum.total)), kind: "money" }],
        notes: ["Tax is not configured, so tax-inclusive and exclusive figures are the same."],
      };
    },
  },
  {
    id: "RP-05", slug: "product-sell", title: "Product Sell", group: "Profit & sales",
    basis: "Sale lines by invoice date; quantities and values after line discounts; returned quantities shown separately.",
    params: [{ key: "mode", label: "View", options: [["detail", "Each line"], ["grouped", "Grouped by product"]] }],
    async run(ctx) {
      const lines = await db.saleLine.findMany({ where: { sale: saleWhere(ctx) }, include: { sale: { include: { customer: true } }, product: true, accruals: true }, orderBy: { sale: { soldAt: "asc" } } });
      if (ctx.params.mode === "grouped") {
        const g = groupSum(lines, (l) => `${l.product.sku} · ${l.nameSnapshot}`, { qty: (l) => l.qty, returned: (l) => l.returnedQty, discount: (l) => l.discount, total: (l) => l.lineTotal, commission: (l) => sum(l.accruals, (a) => a.amount) });
        const rows: Row[] = [...g.entries()].map(([k, v]) => ({ product: k, qty: v.qty, returned: v.returned, discount: v.discount, total: v.total, commission: v.commission })).sort((a, b) => D(b.total as never).cmp(D(a.total as never)));
        return { columns: [{ key: "product", label: "Product" }, { key: "qty", label: "Sold", kind: "qty" }, { key: "returned", label: "Returned", kind: "qty" }, { key: "discount", label: "Discount", kind: "money" }, { key: "total", label: "Value", kind: "money" }, { key: "commission", label: "Commission", kind: "money" }], rows, totals: totalsOf(rows, ["qty", "returned", "discount", "total", "commission"]) };
      }
      const rows: Row[] = lines.map((l) => ({ date: l.sale.soldAt, invoice: l.sale.number, customer: l.sale.customer?.name ?? "Walk-in", product: `${l.product.sku} · ${l.nameSnapshot}`, qty: l.qty, price: l.unitPrice, discount: l.discount, total: l.lineTotal, returned: l.returnedQty, _href: `/sales/${l.saleId}` }));
      return { columns: [{ key: "date", label: "Date", kind: "datetime" }, { key: "invoice", label: "Invoice" }, { key: "customer", label: "Customer" }, { key: "product", label: "Product" }, { key: "qty", label: "Qty", kind: "qty" }, { key: "price", label: "Price", kind: "money" }, { key: "discount", label: "Discount", kind: "money" }, { key: "total", label: "Line total", kind: "money" }, { key: "returned", label: "Returned", kind: "qty" }], rows, totals: totalsOf(rows, ["qty", "discount", "total", "returned"]) };
    },
  },
  {
    id: "RP-12", slug: "commissions", title: "Sales representative / commissions", group: "Profit & sales",
    basis: "Commission accrued on sales in the period (category pool × share), reversals from returns, and payout state. Target bonuses are in RP-35.",
    async run(ctx) {
      const acc = await db.commissionAccrual.findMany({ where: { createdAt: inPeriod(ctx), saleLine: { sale: { locationId: locIn(ctx) } } }, include: { recipient: true, settlement: true } });
      const g = groupSum(acc, (a) => `${a.recipient.fullName}|${a.role}`, {
        basis: (a) => (D(a.amount).gt(0) ? a.basis : 0), accrued: (a) => (D(a.amount).gt(0) ? a.amount : 0), reversed: (a) => (D(a.amount).lt(0) ? a.amount : 0),
        settled: (a) => (a.settlementId ? a.amount : 0), approved: (a) => (a.approvedAt && !a.settlementId ? a.amount : 0), pending: (a) => (!a.approvedAt && !a.settlementId ? a.amount : 0),
      });
      const rows: Row[] = [...g.entries()].map(([k, v]) => { const [name, role] = k.split("|"); return { name, role: role === "USER" ? "Salesperson" : "Agent", basis: v.basis, accrued: v.accrued, reversed: v.reversed, net: v.accrued.plus(v.reversed), paid: v.settled, approved: v.approved, pending: v.pending }; });
      return {
        columns: [{ key: "name", label: "Recipient" }, { key: "role", label: "Type" }, { key: "basis", label: "Eligible sales", kind: "money" }, { key: "accrued", label: "Accrued", kind: "money" }, { key: "reversed", label: "Return reversals", kind: "money" }, { key: "net", label: "Net", kind: "money" }, { key: "paid", label: "Paid", kind: "money" }, { key: "approved", label: "Approved, unpaid", kind: "money" }, { key: "pending", label: "Not approved", kind: "money" }],
        rows, totals: totalsOf(rows, ["basis", "accrued", "reversed", "net", "paid", "approved", "pending"]),
      };
    },
  },
  {
    id: "RP-15", slug: "sell-payments", title: "Sell payments", group: "Profit & sales",
    basis: "Money actually received from customers, by payment date (sales, repairs, COD). Store credit used is shown but is not money received.",
    async run(ctx) {
      const pays = await db.payment.findMany({
        where: { paidAt: inPeriod(ctx), OR: [{ sale: { locationId: locIn(ctx) } }, { repairJob: { locationId: locIn(ctx) } }] },
        include: { account: true, contact: { include: { group: true } }, sale: true, repairJob: true }, orderBy: { paidAt: "asc" },
      });
      const rows: Row[] = pays.map((p) => ({
        ref: p.number, date: p.paidAt, customer: p.contact?.name ?? "Walk-in", group: p.contact?.group?.name ?? "", method: p.method.toLowerCase().replace("_", " "), account: p.account?.name ?? "",
        for: p.sale?.number ?? p.repairJob?.number ?? "", amount: p.direction === "IN" ? p.amount : D(p.amount).neg(), _href: p.saleId ? `/sales/${p.saleId}` : p.repairJobId ? `/repairs/${p.repairJobId}` : undefined,
      }));
      const money = rows.filter((r) => r.method !== "store credit");
      return {
        columns: [{ key: "ref", label: "Reference" }, { key: "date", label: "Paid on", kind: "datetime" }, { key: "customer", label: "Customer" }, { key: "group", label: "Group" }, { key: "method", label: "Method" }, { key: "account", label: "Account" }, { key: "for", label: "For" }, { key: "amount", label: "Amount", kind: "money" }],
        rows, totals: totalsOf(rows, ["amount"]),
        summary: [{ label: "Money received (excl. store credit)", value: sum(money, (r) => r.amount as never), kind: "money" }],
        notes: ["Refunds and bounced cheques appear as negative amounts."],
      };
    },
  },
  {
    id: "RP-17", slug: "customers-suppliers", title: "Customers / Suppliers", group: "Profit & sales",
    basis: "Opening balance + documents − settlements, up to today. Period columns show activity in the chosen period.",
    params: [{ key: "type", label: "Contacts", options: [["customer", "Customers"], ["supplier", "Suppliers"]] }],
    async run(ctx) {
      const supplier = ctx.params.type === "supplier";
      const contacts = await db.contact.findMany({ where: { active: true, ...(supplier ? { isSupplier: true } : { isCustomer: true }) }, orderBy: { name: "asc" } });
      const ids = contacts.map((c) => c.id);
      if (supplier) {
        const [all, period, credits] = await Promise.all([
          db.goodsReceipt.groupBy({ by: ["supplierId"], where: { supplierId: { in: ids }, status: "POSTED" }, _sum: { total: true, paid: true } }),
          db.goodsReceipt.groupBy({ by: ["supplierId"], where: { supplierId: { in: ids }, status: "POSTED", receivedAt: inPeriod(ctx) }, _sum: { total: true } }),
          db.supplierClaim.groupBy({ by: ["supplierId"], where: { supplierId: { in: ids }, status: "SETTLED" }, _sum: { creditAmount: true } }),
        ]);
        const rows: Row[] = contacts.map((c) => {
          const a = all.find((x) => x.supplierId === c.id); const cr = credits.find((x) => x.supplierId === c.id);
          return { name: c.name, opening: c.openingBalance, purchases: period.find((x) => x.supplierId === c.id)?._sum.total ?? 0, credits: cr?._sum.creditAmount ?? 0, due: D(c.openingBalance).plus(D(a?._sum.total)).minus(D(a?._sum.paid)).minus(D(cr?._sum.creditAmount)), _href: `/contacts/${c.id}` };
        }).filter((r) => !D(r.due as never).eq(0) || !D(r.purchases as never).eq(0));
        return { columns: [{ key: "name", label: "Supplier" }, { key: "opening", label: "Opening", kind: "money" }, { key: "purchases", label: "Purchases in period", kind: "money" }, { key: "credits", label: "Supplier credits", kind: "money" }, { key: "due", label: "We owe", kind: "money" }], rows, totals: totalsOf(rows, ["opening", "purchases", "credits", "due"]) };
      }
      const [all, period, credit] = await Promise.all([
        db.sale.groupBy({ by: ["customerId"], where: { customerId: { in: ids }, stage: "FINAL" }, _sum: { total: true, paid: true, credited: true } }),
        db.sale.groupBy({ by: ["customerId"], where: { customerId: { in: ids }, stage: "FINAL", soldAt: inPeriod(ctx) }, _sum: { total: true, credited: true } }),
        db.storeCreditEntry.groupBy({ by: ["contactId"], where: { contactId: { in: ids } }, _sum: { amount: true } }),
      ]);
      const rows: Row[] = contacts.map((c) => {
        const a = all.find((x) => x.customerId === c.id); const p = period.find((x) => x.customerId === c.id);
        return { name: c.name, opening: c.openingBalance, sales: p?._sum.total ?? 0, returns: p?._sum.credited ?? 0, due: D(c.openingBalance).plus(D(a?._sum.total)).minus(D(a?._sum.paid)).minus(D(a?._sum.credited)), storeCredit: credit.find((x) => x.contactId === c.id)?._sum.amount ?? 0, _href: `/contacts/${c.id}` };
      }).filter((r) => !D(r.due as never).eq(0) || !D(r.sales as never).eq(0) || !D(r.storeCredit as never).eq(0));
      return { columns: [{ key: "name", label: "Customer" }, { key: "opening", label: "Opening", kind: "money" }, { key: "sales", label: "Sales in period", kind: "money" }, { key: "returns", label: "Returns in period", kind: "money" }, { key: "due", label: "Owes us", kind: "money" }, { key: "storeCredit", label: "Store credit held", kind: "money" }], rows, totals: totalsOf(rows, ["opening", "sales", "returns", "due", "storeCredit"]) };
    },
  },
  {
    id: "RP-18", slug: "customer-groups", title: "Customer groups", group: "Profit & sales",
    basis: "Invoice totals and returns by the customer's group, invoice date.",
    async run(ctx) {
      const sales = await db.sale.findMany({ where: saleWhere(ctx), include: { customer: { include: { group: true } } } });
      const g = groupSum(sales, (s) => s.customer?.group?.name ?? (s.customer ? "No group" : "Walk-in"), { sales: (s) => s.total, returns: (s) => s.credited });
      const rows: Row[] = [...g.entries()].map(([k, v]) => ({ group: k, invoices: v._n, sales: v.sales, returns: v.returns, net: v.sales.minus(v.returns) }));
      return { columns: [{ key: "group", label: "Group" }, { key: "invoices", label: "Invoices", kind: "qty" }, { key: "sales", label: "Sales", kind: "money" }, { key: "returns", label: "Returns", kind: "money" }, { key: "net", label: "Net", kind: "money" }], rows, totals: totalsOf(rows, ["invoices", "sales", "returns", "net"]) };
    },
  },
  {
    id: "RP-19", slug: "trending", title: "Trending products", group: "Profit & sales",
    basis: "Ranked by net quantity sold (sold − returned) in the period.",
    params: [{ key: "by", label: "Rank by", options: [["qty", "Net quantity"], ["value", "Net value"]] }],
    async run(ctx) {
      const lines = await db.saleLine.findMany({ where: { sale: saleWhere(ctx), product: { sku: { not: "RELOAD" } } }, include: { product: { include: { category: true, brand: true } } } });
      const g = groupSum(lines, (l) => l.productId, { qty: (l) => D(l.qty).minus(l.returnedQty), value: (l) => D(l.lineTotal).mul(D(l.qty).minus(l.returnedQty)).div(l.qty) });
      const meta = new Map(lines.map((l) => [l.productId, l.product]));
      const rows: Row[] = [...g.entries()].map(([id, v]) => ({ product: `${meta.get(id)!.sku} · ${meta.get(id)!.name}`, category: meta.get(id)!.category?.name ?? "", brand: meta.get(id)!.brand?.name ?? "", qty: v.qty, value: v.value, _href: `/products/${id}` }))
        .sort((a, b) => D((ctx.params.by === "value" ? b.value : b.qty) as never).cmp(D((ctx.params.by === "value" ? a.value : a.qty) as never))).slice(0, 50)
        .map((r, i) => ({ rank: i + 1, ...r }));
      return { columns: [{ key: "rank", label: "#", kind: "qty" }, { key: "product", label: "Product" }, { key: "category", label: "Category" }, { key: "brand", label: "Brand" }, { key: "qty", label: "Net qty", kind: "qty" }, { key: "value", label: "Net value", kind: "money" }], rows };
    },
  },
  {
    id: "RP-20", slug: "tax", title: "Tax", group: "Profit & sales",
    basis: "Output tax on sales and input tax on expenses as recorded. No tax rates are configured yet.",
    async run(ctx) {
      const [s, e] = await Promise.all([
        db.sale.aggregate({ where: saleWhere(ctx), _sum: { tax: true, total: true } }),
        db.expense.findMany({ where: { expenseDate: inPeriod(ctx), locationId: locIn(ctx), tax: { gt: 0 } }, include: { category: true } }),
      ]);
      const rows: Row[] = [
        { doc: "Sales — output tax", base: D(s._sum.total).minus(D(s._sum.tax)), tax: s._sum.tax ?? 0 },
        ...e.map((x) => ({ doc: `${x.number} · ${x.category.name}`, base: x.amount, tax: x.tax, _href: `/expenses/${x.id}` })),
      ];
      return { columns: [{ key: "doc", label: "Document" }, { key: "base", label: "Taxable base", kind: "money" }, { key: "tax", label: "Tax", kind: "money" }], rows, notes: ["VAT/SSCL rates must be set up and validated before tax reporting is relied on (spec §26)."] };
    },
  },
  {
    id: "RP-27", slug: "returns", title: "Returns / exchanges", group: "Profit & sales",
    basis: "Credit notes by return date: settlement (debt offset, refund, store credit), item destination and commission reversed.",
    async run(ctx) {
      const rets = await db.saleReturn.findMany({ where: { createdAt: inPeriod(ctx), locationId: locIn(ctx) }, include: { sale: { include: { customer: true } }, lines: { include: { saleLine: { include: { accruals: true } } } }, createdBy: true }, orderBy: { createdAt: "asc" } });
      const rows: Row[] = rets.map((r) => ({
        cn: r.number, date: r.createdAt, sale: r.sale.number, customer: r.sale.customer?.name ?? "Walk-in", value: r.totalValue, offset: r.debtOffset, refunded: r.refunded, credit: r.storeCredit,
        destination: [...new Set(r.lines.map((l) => l.disposition.toLowerCase().replace("_", " ")))].join(", "), cost: sum(r.lines, (l) => l.costValue),
        commission: sum(r.lines.flatMap((l) => l.saleLine.accruals.filter((a) => a.returnLineId === l.id)), (a) => a.amount), _href: `/returns/${r.id}`,
      }));
      return { columns: [{ key: "cn", label: "Credit note" }, { key: "date", label: "Date", kind: "datetime" }, { key: "sale", label: "Original sale" }, { key: "customer", label: "Customer" }, { key: "value", label: "Value", kind: "money" }, { key: "offset", label: "Debt offset", kind: "money" }, { key: "refunded", label: "Refunded", kind: "money" }, { key: "credit", label: "Store credit", kind: "money" }, { key: "destination", label: "Items to" }, { key: "cost", label: "Original cost", kind: "money", cost: true }, { key: "commission", label: "Commission reversed", kind: "money" }], rows, totals: totalsOf(rows, ["value", "offset", "refunded", "credit", "cost", "commission"]) };
    },
  },
];
