import { db } from "../db";
import type { ReportDef, Row, Ctx } from "./types";
import { D, ZERO, sum, inPeriod, locIn, totalsOf, groupSum } from "./util";

const methodName = (m: string) => m.toLowerCase().replace("_", " ");

// Current operational balances used by RP-24 and RP-25 (no double-entry ledger yet: spec §16/§17 RP-24/25).
export async function balances(ctx: Ctx) {
  const [accounts, flows, sales, customers, grns, suppliers, claims, credit, slips, comm, layers] = await Promise.all([
    db.account.findMany({ where: { active: true } }),
    db.payment.groupBy({ by: ["accountId", "direction"], where: { accountId: { not: null } }, _sum: { amount: true } }),
    db.sale.aggregate({ where: { stage: "FINAL" }, _sum: { total: true, paid: true, credited: true } }),
    db.contact.aggregate({ where: { isCustomer: true }, _sum: { openingBalance: true } }),
    db.goodsReceipt.aggregate({ where: { status: "POSTED" }, _sum: { total: true, paid: true } }),
    db.contact.aggregate({ where: { isSupplier: true, isCustomer: false }, _sum: { openingBalance: true } }),
    db.supplierClaim.aggregate({ where: { status: "SETTLED" }, _sum: { creditAmount: true } }),
    db.storeCreditEntry.aggregate({ _sum: { amount: true } }),
    db.payslip.findMany({ where: { run: { status: { in: ["APPROVED", "PART_PAID"] } } } }),
    db.commissionAccrual.aggregate({ where: { settlementId: null }, _sum: { amount: true } }),
    db.costLayer.findMany({ where: { locationId: locIn(ctx), qtyRemaining: { gt: 0 }, bucket: { not: "WRITTEN_OFF" } }, select: { qtyRemaining: true, unitCost: true } }),
  ]);
  const acct = accounts.map((a) => {
    const f = (d: string) => D(flows.find((x) => x.accountId === a.id && x.direction === d)?._sum.amount);
    return { name: a.name, type: a.type, balance: D(a.openingBalance).plus(f("IN")).minus(f("OUT")) };
  });
  return {
    acct,
    receivables: D(customers._sum.openingBalance).plus(D(sales._sum.total)).minus(D(sales._sum.paid)).minus(D(sales._sum.credited)),
    payables: D(suppliers._sum.openingBalance).plus(D(grns._sum.total)).minus(D(grns._sum.paid)).minus(D(claims._sum.creditAmount)),
    storeCredit: D(credit._sum.amount),
    payroll: sum(slips, (p) => D(p.net).minus(p.paid)),
    commission: D(comm._sum.amount),
    stock: layers.reduce((a, l) => a.plus(D(l.qtyRemaining).mul(l.unitCost)), ZERO),
  };
}

export const moneyReports: ReportDef[] = [
  {
    id: "RP-13", slug: "registers", title: "Registers", group: "Money & balances", perm: "register.review",
    basis: "Register sessions opened in the period. Expected cash counts only cash; card, bank and cheque are listed separately.",
    async run(ctx) {
      const regs = await db.registerSession.findMany({ where: { openedAt: inPeriod(ctx), locationId: locIn(ctx) }, include: { user: true, location: true, payments: true, sales: { include: { payments: true } } }, orderBy: { openedAt: "asc" } });
      const rows: Row[] = regs.map((r) => {
        const cashIn = sum(r.payments.filter((p) => p.direction === "IN"), (p) => p.amount);
        const cashOut = sum(r.payments.filter((p) => p.direction === "OUT"), (p) => p.amount);
        const nonCash = sum(r.sales.flatMap((s) => s.payments).filter((p) => p.method !== "CASH" && p.method !== "STORE_CREDIT" && p.direction === "IN"), (p) => p.amount);
        return { opened: r.openedAt, closed: r.closedAt, location: r.location.name, user: r.user.fullName, opening: r.openingCash, cashIn, cashOut, expected: r.expectedCash ?? D(r.openingCash).plus(cashIn).minus(cashOut), counted: r.countedCash, variance: r.variance, nonCash, notes: r.notes ?? "", _tone: r.variance && !D(r.variance).eq(0) ? "err" : undefined };
      });
      return { columns: [{ key: "opened", label: "Opened", kind: "datetime" }, { key: "closed", label: "Closed", kind: "datetime" }, { key: "location", label: "Location" }, { key: "user", label: "Operator" }, { key: "opening", label: "Opening", kind: "money" }, { key: "cashIn", label: "Cash in", kind: "money" }, { key: "cashOut", label: "Cash out", kind: "money" }, { key: "expected", label: "Expected", kind: "money" }, { key: "counted", label: "Counted", kind: "money" }, { key: "variance", label: "Variance", kind: "money" }, { key: "nonCash", label: "Card/bank/cheque", kind: "money" }, { key: "notes", label: "Notes" }], rows, totals: totalsOf(rows, ["cashIn", "cashOut", "variance", "nonCash"]) };
    },
  },
  {
    id: "RP-14", slug: "expenses", title: "Expense", group: "Money & balances", perm: "expenses.view",
    basis: "Expenses by expense date (accrual), with what has been paid. Recurring ones are marked.",
    params: [{ key: "view", label: "View", options: [["category", "By category"], ["detail", "Each expense"]] }],
    async run(ctx) {
      const ex = await db.expense.findMany({ where: { expenseDate: inPeriod(ctx), locationId: locIn(ctx) }, include: { category: true, contact: true }, orderBy: { expenseDate: "asc" } });
      if (ctx.params.view === "detail") {
        const rows: Row[] = ex.map((e) => ({ date: e.expenseDate, ref: e.number, category: e.category.name, for: e.description ?? e.contact?.name ?? "", recurring: e.idempotencyKey?.startsWith("recurring:") ? "yes" : "", amount: e.amount, tax: e.tax, paid: e.paid, due: D(e.amount).plus(e.tax).minus(e.paid), _href: `/expenses/${e.id}` }));
        return { columns: [{ key: "date", label: "Date", kind: "date" }, { key: "ref", label: "Reference" }, { key: "category", label: "Category" }, { key: "for", label: "Description" }, { key: "recurring", label: "Recurring" }, { key: "amount", label: "Amount", kind: "money" }, { key: "tax", label: "Tax", kind: "money" }, { key: "paid", label: "Paid", kind: "money" }, { key: "due", label: "Due", kind: "money" }], rows, totals: totalsOf(rows, ["amount", "tax", "paid", "due"]) };
      }
      const g = groupSum(ex, (e) => e.category.name, { amount: (e) => e.amount, tax: (e) => e.tax, paid: (e) => e.paid });
      const rows: Row[] = [...g.entries()].map(([k, v]) => ({ category: k, count: v._n, amount: v.amount, tax: v.tax, paid: v.paid, due: v.amount.plus(v.tax).minus(v.paid) }));
      return { columns: [{ key: "category", label: "Category" }, { key: "count", label: "Expenses", kind: "qty" }, { key: "amount", label: "Amount", kind: "money" }, { key: "tax", label: "Tax", kind: "money" }, { key: "paid", label: "Paid", kind: "money" }, { key: "due", label: "Due", kind: "money" }], rows, totals: totalsOf(rows, ["count", "amount", "tax", "paid", "due"]) };
    },
  },
  {
    id: "RP-16", slug: "purchase-payments", title: "Purchase payments", group: "Money & balances", perm: "purchases.view",
    basis: "Payments made to suppliers against GRNs, by payment date. Bounced cheques appear as reversals.",
    async run(ctx) {
      const pays = await db.payment.findMany({ where: { paidAt: inPeriod(ctx), receiptId: { not: null }, receipt: { locationId: locIn(ctx) } }, include: { receipt: true, contact: true, account: true, cheque: true }, orderBy: { paidAt: "asc" } });
      const rows: Row[] = pays.map((p) => ({ ref: p.number, date: p.paidAt, supplier: p.contact?.name ?? "", grn: p.receipt?.number ?? "", method: methodName(p.method) + (p.cheque ? ` ${p.cheque.number} (${p.cheque.status.toLowerCase()})` : ""), account: p.account?.name ?? "", amount: p.direction === "OUT" ? p.amount : D(p.amount).neg(), _href: `/purchases/${p.receiptId}` }));
      return { columns: [{ key: "ref", label: "Reference" }, { key: "date", label: "Paid on", kind: "datetime" }, { key: "supplier", label: "Supplier" }, { key: "grn", label: "GRN" }, { key: "method", label: "Method" }, { key: "account", label: "Account" }, { key: "amount", label: "Amount", kind: "money" }], rows, totals: totalsOf(rows, ["amount"]) };
    },
  },
  {
    id: "RP-21", slug: "activity", title: "Activity log", group: "Money & balances", perm: "users.manage",
    basis: "Every recorded action: who, when, what. Unlock codes and passwords are never logged.",
    async run(ctx) {
      const ev = await db.auditEvent.findMany({ where: { createdAt: inPeriod(ctx) }, include: { actor: true }, orderBy: { createdAt: "desc" }, take: 2000 });
      const rows: Row[] = ev.map((e) => ({ at: e.createdAt, by: e.actor?.fullName ?? "System", action: e.action.toLowerCase().replaceAll("_", " "), subject: e.subjectType, detail: e.detail ? JSON.stringify(e.detail).slice(0, 140) : "" }));
      return { columns: [{ key: "at", label: "When", kind: "datetime" }, { key: "by", label: "By" }, { key: "action", label: "Action" }, { key: "subject", label: "Record" }, { key: "detail", label: "Detail" }], rows, notes: ev.length === 2000 ? ["Showing the latest 2,000 events; narrow the period for more."] : [] };
    },
  },
  {
    id: "RP-22", slug: "account-ledger", title: "Payment account ledger", group: "Money & balances", perm: "accounts.view",
    basis: "Every payment in and out of each account by date, with running balance. Payments without an account are listed at the end.",
    async run(ctx) {
      const accounts = await db.account.findMany({ where: { active: true }, orderBy: { name: "asc" } });
      const rows: Row[] = [];
      for (const a of accounts) {
        const before = await db.payment.groupBy({ by: ["direction"], where: { accountId: a.id, paidAt: { lt: ctx.from } }, _sum: { amount: true } });
        let bal = D(a.openingBalance).plus(D(before.find((b) => b.direction === "IN")?._sum.amount)).minus(D(before.find((b) => b.direction === "OUT")?._sum.amount));
        rows.push({ account: a.name, date: ctx.from, ref: "", what: "Balance brought forward", in: null, out: null, balance: bal, _tone: "ok" });
        const pays = await db.payment.findMany({ where: { accountId: a.id, paidAt: inPeriod(ctx) }, orderBy: { paidAt: "asc" }, include: { sale: true, receipt: true, expense: true, contact: true } });
        for (const p of pays) {
          bal = p.direction === "IN" ? bal.plus(p.amount) : bal.minus(p.amount);
          rows.push({ account: a.name, date: p.paidAt, ref: p.number, what: [p.sale?.number, p.receipt?.number, p.expense?.number, p.payslipId && "Salary", p.walletId && "Reload funding", p.settlementId && "Commission", p.reference].filter(Boolean).join(" · ") || methodName(p.method), in: p.direction === "IN" ? p.amount : null, out: p.direction === "OUT" ? p.amount : null, balance: bal });
        }
      }
      const unmapped = await db.payment.findMany({ where: { accountId: null, method: { not: "STORE_CREDIT" }, paidAt: inPeriod(ctx) } });
      for (const p of unmapped) rows.push({ account: "No account (needs mapping)", date: p.paidAt, ref: p.number, what: methodName(p.method), in: p.direction === "IN" ? p.amount : null, out: p.direction === "OUT" ? p.amount : null, balance: null, _tone: "warn" });
      return { columns: [{ key: "account", label: "Account" }, { key: "date", label: "Date", kind: "datetime" }, { key: "ref", label: "Reference" }, { key: "what", label: "For" }, { key: "in", label: "In", kind: "money" }, { key: "out", label: "Out", kind: "money" }, { key: "balance", label: "Balance", kind: "money" }], rows };
    },
  },
  {
    id: "RP-23", slug: "cash-flow", title: "Cash flow", group: "Money & balances", perm: "accounts.view",
    basis: "Actual money in and out by payment date and method. Store credit is not money; refunds and bounces are outflows/reversals.",
    async run(ctx) {
      const pays = await db.payment.findMany({ where: { paidAt: inPeriod(ctx), method: { not: "STORE_CREDIT" } }, include: { account: true } });
      const what = (p: (typeof pays)[number]) => p.saleId ? (p.returnId ? "Customer refunds" : "Sales & customer payments") : p.repairJobId ? "Repair payments" : p.receiptId ? "Supplier payments" : p.expenseId ? "Expenses" : p.payslipId ? "Salaries" : p.walletId ? "Reload wallet funding" : p.settlementId ? "Commission payouts" : p.claimId ? "Supplier refunds" : p.reversesId ? "Cheque reversals" : "Other";
      const g = groupSum(pays, (p) => `${what(p)}|${methodName(p.method)}`, { in: (p) => (p.direction === "IN" ? p.amount : 0), out: (p) => (p.direction === "OUT" ? p.amount : 0) });
      const rows: Row[] = [...g.entries()].map(([k, v]) => { const [w, m] = k.split("|"); return { what: w, method: m, in: v.in, out: v.out, net: v.in.minus(v.out) }; }).sort((a, b) => String(a.what).localeCompare(String(b.what)));
      return { columns: [{ key: "what", label: "Flow" }, { key: "method", label: "Method" }, { key: "in", label: "In", kind: "money" }, { key: "out", label: "Out", kind: "money" }, { key: "net", label: "Net", kind: "money" }], rows, totals: totalsOf(rows, ["in", "out", "net"]), notes: ["There are no internal account transfers recorded yet, so nothing is double counted between accounts."] };
    },
  },
  {
    id: "RP-24", slug: "balances", title: "Balance sheet / operational balances", group: "Money & balances", perm: "accounts.view", asOf: true,
    basis: "Current balances from the operational records (not a formal double-entry balance sheet). Stock at original lot cost.",
    async run(ctx) {
      const b = await balances(ctx);
      const rows: Row[] = [
        ...b.acct.map((a) => ({ side: "Asset", item: `${a.name} (${a.type.toLowerCase().replace("_", " ")})`, amount: a.balance })),
        { side: "Asset", item: "Customers owe us", amount: b.receivables },
        { side: "Asset", item: "Stock at cost (saleable + held)", amount: b.stock },
        { side: "Liability", item: "We owe suppliers", amount: b.payables },
        { side: "Liability", item: "Customer store credit", amount: b.storeCredit },
        { side: "Liability", item: "Approved payroll not yet paid", amount: b.payroll },
        { side: "Liability", item: "Commission earned, not yet paid", amount: b.commission },
      ];
      const assets = sum(rows.filter((r) => r.side === "Asset"), (r) => r.amount as never);
      const liab = sum(rows.filter((r) => r.side === "Liability"), (r) => r.amount as never);
      return { columns: [{ key: "side", label: "" }, { key: "item", label: "Item" }, { key: "amount", label: "Amount", kind: "money" }], rows, summary: [{ label: "Assets", value: assets, kind: "money" }, { label: "Liabilities", value: liab, kind: "money" }, { label: "Net (owner's equity incl. unreconciled openings)", value: assets.minus(liab), kind: "money" }] };
    },
  },
  {
    id: "RP-25", slug: "trial-balance", title: "Trial balance", group: "Money & balances", perm: "accounts.view", asOf: true,
    basis: "Debit/credit view of the operational balances. Until accounts are mapped to a chart of accounts, the difference is shown openly — not hidden in a balancing entry.",
    async run(ctx) {
      const b = await balances(ctx);
      const rows: Row[] = [
        ...b.acct.map((a) => (a.balance.gte(0) ? { account: a.name, debit: a.balance, credit: null } : { account: a.name, debit: null, credit: a.balance.neg() })),
        { account: "Trade receivables (customers)", debit: b.receivables.gte(0) ? b.receivables : null, credit: b.receivables.lt(0) ? b.receivables.neg() : null },
        { account: "Stock", debit: b.stock, credit: null },
        { account: "Trade payables (suppliers)", debit: null, credit: b.payables },
        { account: "Store credit liability", debit: null, credit: b.storeCredit },
        { account: "Payroll payable", debit: null, credit: b.payroll },
        { account: "Commission payable", debit: null, credit: b.commission },
      ];
      const dr = sum(rows, (r) => r.debit as never), cr = sum(rows, (r) => r.credit as never);
      const diff = dr.minus(cr);
      rows.push({ account: "Unmapped difference — owner's equity, retained result and opening balances not yet reconciled", debit: diff.lt(0) ? diff.neg() : null, credit: diff.gt(0) ? diff : null, _tone: "warn" });
      return { columns: [{ key: "account", label: "Account" }, { key: "debit", label: "Debit", kind: "money" }, { key: "credit", label: "Credit", kind: "money" }], rows, totals: totalsOf(rows, ["debit", "credit"]), notes: ["Spec §16: a formal trial balance needs a mapped chart of accounts and reconciled opening balances (after migration)."] };
    },
  },
  {
    id: "RP-26", slug: "cheques", title: "Cheques", group: "Money & balances", perm: "accounts.view",
    basis: "Cheques by cheque date: received / issued, status, and whether the money has actually cleared.",
    async run(ctx) {
      const ch = await db.cheque.findMany({ where: { realizeDate: { gte: new Date(`${ctx.fromYmd}T00:00:00Z`), lte: new Date(`${ctx.toYmd}T00:00:00Z`) } }, include: { payment: { include: { contact: true, account: true } } }, orderBy: { realizeDate: "asc" } });
      const rows: Row[] = ch.map((c) => ({ date: c.realizeDate, direction: c.direction.toLowerCase(), number: c.number, bank: c.bank ?? "", contact: c.payment.contact?.name ?? "", account: c.payment.account?.name ?? "", amount: c.payment.amount, status: c.status.toLowerCase(), _tone: c.status === "BOUNCED" ? "err" : ["PENDING", "DEPOSITED"].includes(c.status) ? "warn" : undefined }));
      const open = rows.filter((r) => ["pending", "deposited"].includes(String(r.status)));
      return { columns: [{ key: "date", label: "Cheque date", kind: "date" }, { key: "direction", label: "Direction" }, { key: "number", label: "Number" }, { key: "bank", label: "Bank" }, { key: "contact", label: "From / to" }, { key: "account", label: "Account" }, { key: "amount", label: "Amount", kind: "money" }, { key: "status", label: "Status" }], rows, totals: totalsOf(rows, ["amount"]), summary: [{ label: "Not yet cleared", value: sum(open, (r) => r.amount as never), kind: "money" }] };
    },
  },
];
