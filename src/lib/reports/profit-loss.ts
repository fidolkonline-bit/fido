import { Prisma } from "@prisma/client";
import { db } from "../db";
import type { PayLine } from "../payroll";
import type { Ctx, Result, Row, SheetItem } from "./types";
import { D, ZERO, sum, inPeriod, locIn } from "./util";

// Stock owned at an instant, from the stock ledger: every movement before it, on lots that are not written off.
// Cost is the lot's own cost; selling value counts saleable stock at today's selling price (as the Stock report).
async function stockAt(at: Date, locationIds: string[]) {
  const [r] = await db.$queryRaw<{ cost: Prisma.Decimal | null; retail: Prisma.Decimal | null }[]>`
    SELECT SUM(m.qty * l."unitCost") AS cost,
           SUM(CASE WHEN l.bucket = 'SALEABLE' THEN m.qty * p."sellPrice" ELSE 0 END) AS retail
    FROM "StockMovement" m
    JOIN "CostLayer" l ON l.id = m."costLayerId"
    JOIN "Product" p ON p.id = m."productId"
    WHERE m."createdAt" < ${at} AND m."locationId" = ANY(${locationIds}) AND l.bucket <> 'WRITTEN_OFF'`;
  return { cost: D(r?.cost), retail: D(r?.retail) };
}

// Units sold in the period from quick-received stock still waiting for its cost: they count at cost 0 until the owner
// adds it, so profit shown is too high until then.
async function costPendingAlerts(ctx: Ctx) {
  const rows = await db.costAllocation.findMany({
    where: { costLayer: { costPending: true }, saleLine: { sale: { stage: "FINAL", soldAt: inPeriod(ctx), locationId: locIn(ctx) } } },
    select: { qty: true, returnedQty: true },
  });
  const units = rows.reduce((a, r) => a.plus(r.qty).minus(r.returnedQty), ZERO);
  if (units.lte(0)) return [];
  const grns = await db.goodsReceipt.count({ where: { status: "PENDING_COST" } });
  return [`${units.toString()} unit${units.eq(1) ? "" : "s"} sold in this period came from stock still waiting for its cost (${grns} GRN${grns === 1 ? "" : "s"} under Purchases → Waiting for cost). They count at cost 0 until the cost is added, so profit here is higher than it really is.`];
}

// RP-01 in the old Clicky layout, which banks already receive. Every line of that page is kept, in its order and with its
// wording; lines this system has no record of (purchase/sell shipping, production, bulk returns …) show Rs 0.00.
// Net Profit follows the formula printed under it; costs Clicky had no line for are folded into the nearest line:
//   - repair jobs collected are sales, their parts and outside-repair cost are purchase price;
//   - wastage, returns written off and supplier-recovery losses are stock adjustment (stock found reduces it);
//   - approved sales-target bonuses are payroll.
export async function profitLoss(ctx: Ctx): Promise<Result> {
  const sw = { stage: "FINAL", soldAt: inPeriod(ctx), locationId: locIn(ctx) };
  const inLoc = { createdAt: inPeriod(ctx), locationId: locIn(ctx) };
  const [lines, sales, retLines, returns, grn, tradeIns, expenses, adjLines, recovered, claimLoss, claimsSent, repairs, accruals, targets, slips, rewards, opening, closing] = await Promise.all([
    db.saleLine.aggregate({ where: { sale: sw }, _sum: { lineTotal: true, taxAmount: true, costTotal: true } }),
    db.sale.aggregate({ where: sw, _sum: { discount: true, rounding: true } }),
    db.saleReturnLine.findMany({ where: { saleReturn: inLoc }, select: { qty: true, value: true, costValue: true, disposition: true, saleLine: { select: { qty: true, lineTotal: true, taxAmount: true } } } }),
    db.saleReturn.aggregate({ where: inLoc, _sum: { totalValue: true } }),
    db.goodsReceipt.aggregate({ where: { status: "POSTED", receivedAt: inPeriod(ctx), locationId: locIn(ctx) }, _sum: { total: true } }),
    db.tradeIn.aggregate({ where: inLoc, _sum: { value: true } }),
    db.expense.aggregate({ where: { expenseDate: inPeriod(ctx), locationId: locIn(ctx) }, _sum: { amount: true } }),
    db.stockAdjustmentLine.findMany({ where: { adjustment: inLoc }, select: { qty: true, unitCost: true, fromBucket: true, toBucket: true, adjustment: { select: { reason: true } } } }),
    db.stockAdjustment.aggregate({ where: inLoc, _sum: { recoveredAmount: true } }),
    db.supplierClaim.aggregate({ where: { status: "SETTLED", settledAt: inPeriod(ctx), locationId: locIn(ctx) }, _sum: { lossValue: true } }),
    db.supplierClaim.aggregate({ where: { status: { not: "CANCELLED" }, sentAt: inPeriod(ctx), locationId: locIn(ctx) }, _sum: { claimValue: true } }),
    db.repairJob.findMany({ where: { status: "COLLECTED", collectedAt: inPeriod(ctx), locationId: locIn(ctx) }, include: { parts: true } }),
    db.commissionAccrual.aggregate({ where: { createdAt: inPeriod(ctx), OR: [{ saleLine: { sale: { locationId: locIn(ctx) } } }, { repairJob: { locationId: locIn(ctx) } }] }, _sum: { amount: true } }),
    db.salesTarget.findMany({ where: { approvedAt: inPeriod(ctx) } }),
    db.payslip.findMany({ where: { run: { status: { in: ["APPROVED", "PART_PAID", "PAID"] }, periodEnd: { gte: new Date(`${ctx.fromYmd}T00:00:00Z`), lte: new Date(`${ctx.toYmd}T00:00:00Z`) } } } }),
    db.storeCreditEntry.aggregate({ where: { sourceType: "Loyalty", createdAt: inPeriod(ctx) }, _sum: { amount: true } }),
    stockAt(ctx.from, ctx.locationIds),
    stockAt(ctx.to, ctx.locationIds),
  ]);

  // Sales: line values after line discounts, without tax; invoice discounts are "Total Sell discount" (as Clicky).
  const repairIncome = sum(repairs, (r) => r.total);
  const totalSales = D(lines._sum.lineTotal).minus(D(lines._sum.taxAmount)).plus(repairIncome);
  // Returns in the period take back their line value and their original cost; the part of the invoice discount that
  // went back with them is no longer a discount given.
  const share = (l: (typeof retLines)[number], v: Prisma.Decimal.Value) => (D(l.saleLine.qty).gt(0) ? D(v).mul(l.qty).div(l.saleLine.qty) : ZERO);
  const returnedLineValue = sum(retLines, (l) => share(l, l.saleLine.lineTotal));
  const returnedExTax = returnedLineValue.minus(sum(retLines, (l) => share(l, l.saleLine.taxAmount)));
  const returnedDiscount = returnedLineValue.minus(sum(retLines, (l) => l.value));
  const sellDiscount = D(sales._sum.discount).minus(returnedDiscount);

  const repairCost = repairs.reduce((a, r) => a.plus(sum(r.parts, (p) => p.costTotal)).plus(r.externalCost), ZERO);
  const purchasePrice = D(lines._sum.costTotal).minus(sum(retLines, (l) => l.costValue)).plus(repairCost);
  const grossProfit = totalSales.minus(returnedExTax).minus(purchasePrice);

  const writtenOff = sum(adjLines.filter((l) => l.toBucket === "WRITTEN_OFF"), (l) => D(l.qty).abs().mul(l.unitCost));
  const found = sum(adjLines.filter((l) => !l.fromBucket && l.toBucket === "SALEABLE" && D(l.qty).gt(0)), (l) => D(l.qty).mul(l.unitCost));
  const returnsWrittenOff = sum(retLines.filter((l) => l.disposition === "WRITTEN_OFF"), (l) => l.costValue);
  const stockAdjustment = writtenOff.plus(returnsWrittenOff).plus(D(claimLoss._sum.lossValue)).minus(found);
  const damage = sum(adjLines.filter((l) => l.toBucket === "WRITTEN_OFF" && l.adjustment.reason === "DAMAGE"), (l) => D(l.qty).abs().mul(l.unitCost)).plus(returnsWrittenOff);

  const commission = D(accruals._sum.amount);
  const targetBonus = targets.reduce((a, t) => a.plus(D((t.snapshot as { earning?: string } | null)?.earning)), ZERO);
  // Commission and target lines inside payslips were already counted when earned/approved.
  const salaries = slips.reduce((a, p) => a.plus(p.gross).minus(sum((p.lines as PayLine[]).filter((l) => l.source === "COMMISSION" || l.source === "TARGET"), (l) => l.amount)), ZERO);
  const payroll = salaries.plus(targetBonus);
  const reward = D(rewards._sum.amount);
  const expense = D(expenses._sum.amount);
  const stockRecovered = D(recovered._sum.recoveredAmount);
  const roundOff = D(sales._sum.rounding);

  const netProfit = grossProfit.plus(stockRecovered).plus(roundOff)
    .minus(stockAdjustment).minus(expense).minus(sellDiscount).minus(reward).minus(payroll).minus(commission);

  const cost = ctx.showCost;
  const left: (SheetItem | false)[] = [
    cost && { label: "Opening Stock", sub: "(By purchase price):", value: opening.cost },
    { label: "Opening Stock", sub: "(By sale price):", value: opening.retail },
    cost && { label: "Total purchase:", sub: "(Exc. tax, Discount)", value: D(grn._sum.total).plus(D(tradeIns._sum.value)) },
    cost && { label: "Total Stock Adjustment:", value: stockAdjustment },
    { label: "Total Expense:", value: expense },
    { label: "Total purchase shipping charge:", value: ZERO },
    { label: "Purchase additional expenses:", value: ZERO },
    { label: "Total transfer shipping charge:", value: ZERO },
    { label: "Total Sell discount:", value: sellDiscount },
    { label: "Total customer reward:", value: reward },
    cost && { label: "Total Damage :", value: damage },
    { label: "Total Exchange :", value: ZERO },
    { label: "Total Sell Return:", value: D(returns._sum.totalValue) },
    { label: "Total Bulk Sell Return:", value: ZERO },
    { label: "Total Sell Commissions:", value: commission },
    { label: "Total Payroll:", value: payroll },
    { label: "Total Production Cost:", value: ZERO },
  ];
  const right: (SheetItem | false)[] = [
    cost && { label: "Closing stock", sub: "(By purchase price):", value: closing.cost },
    { label: "Closing stock", sub: "(By sale price):", value: closing.retail },
    { label: "Total Sales:", sub: "(Exc. tax, Discount)", value: totalSales },
    { label: "Total sell shipping charge:", value: ZERO },
    { label: "Sell additional expenses:", value: ZERO },
    { label: "Total Stock Recovered:", value: stockRecovered },
    cost && { label: "Total Purchase Return:", value: D(claimsSent._sum.claimValue) },
    { label: "Total Purchase discount:", value: ZERO },
    { label: "Total sell round off:", value: roundOff },
  ];
  const results = cost ? [
    { label: "Gross Profit", value: grossProfit, note: "(Total sell price - Total purchase price)" },
    {
      label: "Net Profit", value: netProfit,
      note: "Gross Profit + (Total sell shipping charge + Sell additional expenses + Total Stock Recovered + Total Purchase discount + Total sell round off )\n"
        + "- ( Total Stock Adjustment + Total Expense + Total purchase shipping charge + Total transfer shipping charge + Purchase additional expenses + Total Sell discount + "
        + "Total customer reward + Total Payroll + Total Production Cost + Total Bulk Retrun Refundable + Total Commission)",
    },
  ] : [];
  const sheet = { left: left.filter((x): x is SheetItem => !!x), right: right.filter((x): x is SheetItem => !!x), results };
  const label = (i: SheetItem) => `${i.label.replace(/\s*:\s*$/, "")}${i.sub ? ` ${i.sub.replace(/:$/, "")}` : ""}`;
  const rows: Row[] = [...sheet.left, ...sheet.right].map((i) => ({ item: label(i), amount: i.value }))
    .concat(results.map((r) => ({ item: r.label, amount: r.value, _tone: r.label === "Net Profit" && D(r.value).lt(0) ? "err" as const : "ok" as const })));
  return {
    title: "Profit / Loss Report",
    alerts: await costPendingAlerts(ctx),
    sheet,
    columns: [{ key: "item", label: "Line" }, { key: "amount", label: "Amount", kind: "money" }],
    rows,
    notes: [
      "Total Sales include repair jobs collected; their parts and outside-repair cost are in the purchase price. Total Sell Return is already taken out of Gross Profit.",
      "Total Stock Adjustment is stock written off (wastage, damage, loss, returns written off and supplier-recovery losses) at cost, less stock found. Total Damage is the damaged part of it.",
      "Total Payroll is salaries and allowances of approved payroll runs plus approved sales-target bonuses. Payroll, commission and customer rewards are business-wide, not split by location.",
      "Opening and closing stock are what the stock ledger held at the start and end of the period; the sale-price value uses today's selling prices.",
    ],
  };
}

// ───────────── Profit by product / category / brand / location / invoice / date / customer / day ─────────────

export const PROFIT_TABS: [string, string][] = [
  ["product", "Profit by products"], ["category", "Profit by categories"], ["brand", "Profit by brands"], ["location", "Profit by locations"],
  ["invoice", "Profit by invoice"], ["date", "Profit by date"], ["customer", "Profit by customer"], ["day", "Profit by day"],
];
const HEAD: Record<string, string> = { product: "Product", category: "Category", brand: "Brand", location: "Location", invoice: "Invoice No.", date: "Date", customer: "Customer", day: "Days" };
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WALK_IN = "Walk-In Customer";
const REPAIRS = "Repair jobs";
const localYmd = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const weekday = (d: Date) => DAYS[(new Date(d.getTime() + 330 * 60_000).getUTCDay() + 6) % 7];

type Part = { key: string; qty: Prisma.Decimal; sales: Prisma.Decimal; cost: Prisma.Decimal; href?: string };

// The same Gross Profit as the statement above, split by one dimension: sale lines in the period (after line discounts,
// without tax), less returns made in the period (on the day and at the location of the return, against the original
// sale's product / invoice / customer), plus repair jobs collected. Every tab therefore totals to the statement's Gross Profit.
export async function profitBy(ctx: Ctx, by: string): Promise<Result> {
  const sw = { stage: "FINAL", soldAt: inPeriod(ctx), locationId: locIn(ctx) };
  const saleInc = { location: { select: { name: true } }, customer: { select: { name: true } } } as const;
  const productInc = { select: { name: true, sku: true, category: { select: { name: true } }, brand: { select: { name: true } } } } as const;
  const [lines, rets, repairs] = await Promise.all([
    db.saleLine.findMany({ where: { sale: sw }, select: { qty: true, lineTotal: true, taxAmount: true, costTotal: true, nameSnapshot: true, product: productInc, sale: { select: { id: true, number: true, soldAt: true, ...saleInc } } } }),
    db.saleReturnLine.findMany({
      where: { saleReturn: { createdAt: inPeriod(ctx), locationId: locIn(ctx) } },
      select: { qty: true, costValue: true, saleReturn: { select: { createdAt: true, location: { select: { name: true } } } }, saleLine: { select: { qty: true, lineTotal: true, taxAmount: true, nameSnapshot: true, product: productInc, sale: { select: { id: true, number: true, ...saleInc } } } } },
    }),
    db.repairJob.findMany({ where: { status: "COLLECTED", collectedAt: inPeriod(ctx), locationId: locIn(ctx) }, select: { id: true, number: true, total: true, externalCost: true, collectedAt: true, parts: { select: { costTotal: true } }, location: { select: { name: true } }, customer: { select: { name: true } } } }),
  ]);
  type P = (typeof lines)[number]["product"];
  const productKey = (p: P, name: string) => `${name || p.name} (${p.sku})`;
  const pick = (p: P, name: string, s: { id: string; number: string; location: { name: string }; customer: { name: string } | null }, at: Date, location: string) =>
    by === "product" ? { key: productKey(p, name) } : by === "category" ? { key: p.category?.name ?? "Uncategorized" } : by === "brand" ? { key: p.brand?.name ?? "No brand" }
    : by === "location" ? { key: location } : by === "invoice" ? { key: s.number, href: `/sales/${s.id}` } : by === "customer" ? { key: s.customer?.name ?? WALK_IN }
    : by === "day" ? { key: weekday(at) } : { key: localYmd(at) };

  const parts: Part[] = [
    ...lines.map((l) => ({ ...pick(l.product, l.nameSnapshot, l.sale, l.sale.soldAt, l.sale.location.name), qty: D(l.qty), sales: D(l.lineTotal).minus(l.taxAmount), cost: D(l.costTotal) })),
    ...rets.map((r) => {
      const f = D(r.saleLine.qty).gt(0) ? D(r.qty).div(r.saleLine.qty) : ZERO;
      return { ...pick(r.saleLine.product, r.saleLine.nameSnapshot, r.saleLine.sale, r.saleReturn.createdAt, r.saleReturn.location.name), qty: D(r.qty).neg(), sales: D(r.saleLine.lineTotal).minus(r.saleLine.taxAmount).mul(f).neg(), cost: D(r.costValue).neg() };
    }),
    ...repairs.map((j) => ({
      ...(by === "product" || by === "category" || by === "brand" ? { key: REPAIRS } : by === "location" ? { key: j.location.name } : by === "invoice" ? { key: j.number, href: `/repairs/${j.id}` }
        : by === "customer" ? { key: j.customer.name } : by === "day" ? { key: weekday(j.collectedAt!) } : { key: localYmd(j.collectedAt!) }),
      qty: ZERO, sales: D(j.total), cost: sum(j.parts, (p) => p.costTotal).plus(j.externalCost),
    })),
  ];
  const g = new Map<string, Part>();
  for (const p of parts) {
    const a = g.get(p.key);
    if (a) { a.qty = a.qty.plus(p.qty); a.sales = a.sales.plus(p.sales); a.cost = a.cost.plus(p.cost); } else g.set(p.key, { ...p });
  }
  const order = by === "day" ? (a: Part, b: Part) => DAYS.indexOf(a.key) - DAYS.indexOf(b.key) : (a: Part, b: Part) => a.key.localeCompare(b.key, undefined, { numeric: true });
  const rows: Row[] = [...g.values()].sort(order).map((p) => ({
    name: by === "date" ? new Date(`${p.key}T00:00:00Z`) : p.key, profit: p.sales.minus(p.cost), qty: p.qty, sales: p.sales, cost: p.cost,
    margin: p.sales.gt(0) ? p.sales.minus(p.cost).div(p.sales).mul(100) : ZERO, _href: p.href,
  }));
  const tab = PROFIT_TABS.find(([k]) => k === by)?.[1] ?? "Profit";
  return {
    title: tab,
    columns: [
      { key: "name", label: HEAD[by] ?? "Group", kind: by === "date" ? "date" : "text" },
      { key: "profit", label: "Gross Profit", kind: "money" },
      { key: "qty", label: "Qty sold (net)", kind: "qty" }, { key: "sales", label: "Sales (exc. tax)", kind: "money" }, { key: "cost", label: "Purchase price", kind: "money" }, { key: "margin", label: "Margin %", kind: "pct" },
    ],
    rows,
    totals: { profit: sum(rows, (r) => r.profit as Prisma.Decimal), qty: sum(rows, (r) => r.qty as Prisma.Decimal), sales: sum(rows, (r) => r.sales as Prisma.Decimal), cost: sum(rows, (r) => r.cost as Prisma.Decimal) },
    notes: ["Profit by every tab considers line discounts only; invoice discounts are not considered (they are in Total Sell discount above). Returns are taken off on the day and at the location they were made; repair jobs are listed as their own line."],
  };
}
