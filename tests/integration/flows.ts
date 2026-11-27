// End-to-end check of the posting logic against a THROWAWAY database (never the live one).
// Run: DATABASE_URL=postgresql://…localhost…/fido_test npx tsx --conditions=react-server tests/integration/flows.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { finalizeSale, setSaleChannel } from "../../src/lib/sales";
import { createTradeIn } from "../../src/lib/tradeins";
import { openCount, postCount, saveCounted, scanInto } from "../../src/lib/stockcount";
import { createPlan, planProgress } from "../../src/lib/instalments";
import { pointsBalance, redeemPoints } from "../../src/lib/loyalty";
import { createRepair, changeStatus, setCharges, setRoute, sendOutside, returnFromOutside, refundRepair } from "../../src/lib/repairs";
import { postReturn } from "../../src/lib/returns";
import { postReceipt, autoLotCode } from "../../src/lib/purchases";
import { lotDate, nameInitials, nextLot } from "../../src/lib/lots";
import { availability, storeCreditBalance } from "../../src/lib/stock";
import { loginLocked, recordLoginAttempt } from "../../src/lib/login-guard";
import type { CurrentUser } from "../../src/lib/auth";
import { attendance, clockInOnSignIn, dayStart, todayYmd, ymd } from "../../src/lib/hr";
import { nightlyAttendance } from "../../src/lib/attendance-night";
import { dayReport, endDay } from "../../src/lib/day-end";
import { approveCommission, calculateRun, createRun, type PayLine } from "../../src/lib/payroll";
import { targetResult } from "../../src/lib/targets";
import { DENOMINATIONS, closeRegister, drawerSummary, openRegister, recordMovement } from "../../src/lib/register";

if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) throw new Error("Refusing to run: DATABASE_URL is not a local database.");

const step = async (name: string, fn: () => Promise<void>) => { await fn(); console.log("ok  " + name); };
const fails = async (fn: () => Promise<unknown>, re: RegExp) => { await assert.rejects(fn, (e: Error) => { assert.match(e.message, re); return true; }); };

async function main() {
  const loc = await db.location.findFirstOrThrow();
  const acct = await db.loginAccount.findFirstOrThrow({ include: { person: true, role: true } });
  const mk = (maxDiscountPct: number, perms: string[]): CurrentUser => ({
    sessionId: "t", accountId: acct.id, personId: acct.personId, name: acct.person.fullName, username: acct.username, role: acct.role.name, roleId: acct.roleId,
    permissions: new Set(perms), maxDiscountPct: new (acct.maxDiscountPct.constructor as never as new (v: number) => typeof acct.maxDiscountPct)(maxDiscountPct), locations: [loc], location: loc, device: null, expiresAt: new Date(Date.now() + 86_400_000),
  });
  const owner = mk(100, acct.role.permissions);
  const cashier = mk(10, ["sales.create", "contacts.view"]);
  const customer = await db.contact.findFirstOrThrow({ where: { name: "Demo Customer" } });
  const cover = await db.product.findUniqueOrThrow({ where: { sku: "D-101" } });
  const charger = await db.product.findUniqueOrThrow({ where: { sku: "D-102" } });
  const cashAcct = await db.account.findFirstOrThrow({ where: { type: "CASH" } });
  if (!(await db.registerSession.findFirst({ where: { locationId: loc.id, closedAt: null } })))
    await db.registerSession.create({ data: { locationId: loc.id, userId: acct.personId, openingCash: 50000 } });
  const lotOf = async (productId: string) => (await db.costLayer.findFirstOrThrow({ where: { productId, bucket: "SALEABLE", qtyRemaining: { gt: 0 } }, orderBy: { receivedAt: "asc" } })).id;
  const sale = (user: CurrentUser, o: Record<string, unknown>) => finalizeSale(user, { idempotencyKey: randomUUID(), customerId: null, payments: [], ...o });

  await step("discount limits no longer stack", async () => {
    const line = { productId: charger.id, qty: 1, unitPrice: 1500, discount: 150, lots: [{ layerId: await lotOf(charger.id), qty: 1 }] };
    await fails(() => sale(cashier, { lines: [line], invoiceDiscount: 135, payments: [{ method: "CASH", amount: 1215 }] }), /whole sale/);
    const ok = await sale(cashier, { lines: [line], invoiceDiscount: 0, payments: [{ method: "CASH", amount: 1350 }] });
    assert.ok(ok.number);
  });

  await step("sale type (Fintrex / COD) is saved, needs a customer, and can be corrected with a log entry", async () => {
    const line = async () => ({ productId: cover.id, qty: 1, unitPrice: 2000, lots: [{ layerId: await lotOf(cover.id), qty: 1 }] });
    await fails(async () => sale(owner, { channel: "FINTREX", lines: [await line()], payments: [{ method: "CASH", amount: 2000 }] }), /customer for a Fintrex sale/);
    await fails(async () => sale(owner, { channel: "NOPE", customerId: customer.id, lines: [await line()], payments: [{ method: "CASH", amount: 2000 }] }), /Invalid/);
    const plain = await sale(owner, { lines: [await line()], payments: [{ method: "CASH", amount: 2000 }] });
    assert.equal((await db.sale.findUniqueOrThrow({ where: { id: plain.id } })).channel, "IN_STORE");     // default
    const f = await sale(owner, { channel: "FINTREX", channelRef: " FX-1001 ", customerId: customer.id, lines: [await line()], payments: [{ method: "CASH", amount: 500 }, { method: "OTHER", amount: 1500, reference: "Fintrex" }] });
    const fs = await db.sale.findUniqueOrThrow({ where: { id: f.id } });
    assert.equal(fs.channel, "FINTREX"); assert.equal(fs.channelRef, "FX-1001"); assert.equal(fs.paymentState, "PAID");
    const c = await sale(owner, { channel: "COD", customerId: customer.id, lines: [await line()] });
    assert.equal((await db.sale.findUniqueOrThrow({ where: { id: c.id } })).channel, "COD");
    // A wrongly tagged sale is corrected; the ref is dropped for in-store; walk-in sales cannot be Fintrex/COD.
    await setSaleChannel(owner, f.id, { channel: "COD", channelRef: "WB-77" });
    assert.equal((await db.sale.findUniqueOrThrow({ where: { id: f.id } })).channelRef, "WB-77");
    await setSaleChannel(owner, f.id, { channel: "IN_STORE", channelRef: "ignored" });
    assert.equal((await db.sale.findUniqueOrThrow({ where: { id: f.id } })).channelRef, null);
    assert.equal(await db.auditEvent.count({ where: { action: "SALE_TYPE_CHANGED", subjectId: f.id } }), 2);
    await fails(() => setSaleChannel(owner, plain.id, { channel: "COD", channelRef: null }), /needs a customer/);
    const n = await db.sale.count({ where: { channel: "FINTREX", id: { in: [plain.id, f.id, c.id] } } });
    assert.equal(n, 0);
  });

  await step("tax (inclusive), warranty snapshot and loyalty points on a sale", async () => {
    const b = await db.business.findFirstOrThrow();
    const rate = await db.taxRate.create({ data: { name: "VAT-test", ratePct: 18, isDefault: true } });
    await db.business.update({ where: { id: b.id }, data: { taxEnabled: true } });
    const w = await db.warranty.upsert({ where: { name: "Test 6 months" }, update: {}, create: { name: "Test 6 months", durationDays: 180 } });
    await db.product.update({ where: { id: charger.id }, data: { warrantyId: w.id } });
    await db.appSetting.upsert({ where: { key: "loyalty" }, update: { value: { enabled: true, earnPer: 100, pointValue: 1, minRedeem: 5 } }, create: { key: "loyalty", value: { enabled: true, earnPer: 100, pointValue: 1, minRedeem: 5 } } });
    const r = await sale(owner, { customerId: customer.id, lines: [{ productId: charger.id, qty: 1, unitPrice: 1500, lots: [{ layerId: await lotOf(charger.id), qty: 1 }] }], payments: [{ method: "CASH", amount: 1500 }] });
    const s = await db.sale.findUniqueOrThrow({ where: { id: r.id }, include: { lines: true } });
    assert.equal(s.total.toString(), "1500");                    // tax does not change the total
    assert.equal(s.tax.toFixed(2), "228.81");                    // 1500 × 18 / 118
    assert.equal(s.lines[0].taxName, rate.name);
    assert.equal(s.lines[0].warrantyDays, 180);
    assert.ok(s.lines[0].warrantyUntil && Math.round((s.lines[0].warrantyUntil.getTime() - s.soldAt.getTime()) / 86_400_000) === 180);
    assert.equal(s.loyaltyEarned, 15);
    assert.equal(await pointsBalance(db, customer.id), 15);
    await db.business.update({ where: { id: b.id }, data: { taxEnabled: false } });
  });

  await step("loyalty points convert to store credit, once", async () => {
    await fails(() => redeemPoints(owner, customer.id, 16), /Only 15 points/);
    const r = await redeemPoints(owner, customer.id, 10);
    assert.equal(r.credit, "10.00");
    assert.equal(await pointsBalance(db, customer.id), 5);
    assert.equal((await storeCreditBalance(db as never, customer.id)).toFixed(2), "10.00");
  });

  let phoneProductId = "";
  await step("trade-in: IMEI checked, stock in at agreed value, seller credited", async () => {
    const phone = await db.product.create({ data: { sku: "T-USED-1", name: "Used iPhone 12 64GB", trackDevices: true, sellPrice: 95000, defaultCost: 0 } });
    phoneProductId = phone.id;
    const base = { customerId: customer.id, sellerIdNumber: "901234567V", productId: phone.id, ownershipDeclared: true, accountsRemoved: true, value: 60000 };
    await fails(() => createTradeIn(owner, { ...base, idempotencyKey: randomUUID(), imei1: "490154203237519", settlement: "STORE_CREDIT" }), /check digit/);
    await fails(() => createTradeIn(owner, { ...base, idempotencyKey: randomUUID(), imei1: "490154203237518", settlement: "STORE_CREDIT", ownershipDeclared: false }), /theirs to sell/);
    const before = await storeCreditBalance(db as never, customer.id);
    const key = randomUUID();
    const t = await createTradeIn(owner, { ...base, idempotencyKey: key, imei1: "490154203237518", settlement: "STORE_CREDIT" });
    assert.equal((await createTradeIn(owner, { ...base, idempotencyKey: key, imei1: "490154203237518", settlement: "STORE_CREDIT" })).id, t.id); // retry = same record
    assert.equal((await storeCreditBalance(db as never, customer.id)).minus(before).toFixed(2), "60000.00");
    const dev = await db.deviceIdentity.findFirstOrThrow({ where: { imei1: "490154203237518" }, include: { costLayer: true } });
    assert.equal(dev.state, "HELD"); assert.equal(dev.costLayer!.bucket, "INSPECTION"); assert.equal(dev.costLayer!.unitCost.toFixed(2), "60000.00");
    await fails(() => createTradeIn(owner, { ...base, idempotencyKey: randomUUID(), imei1: "490154203237518", settlement: "STORE_CREDIT" }), /already in stock/);
    // Cash trade-in reduces the register's expected cash through a payment OUT.
    const c = await createTradeIn(owner, { ...base, idempotencyKey: randomUUID(), imei1: "356938035643809", settlement: "CASH", value: 20000, readyToSell: true });
    const pay = await db.payment.findFirstOrThrow({ where: { tradeInId: c.id } });
    assert.equal(pay.direction, "OUT"); assert.ok(pay.registerId); assert.equal(pay.accountId, cashAcct.id);
  });

  await step("sold phone carries its warranty; instalment plan over a credit sale", async () => {
    const dev = await db.deviceIdentity.findFirstOrThrow({ where: { imei1: "356938035643809" } });
    const w = await db.warranty.findFirstOrThrow({ where: { name: "Test 6 months" } });
    await db.product.update({ where: { id: phoneProductId }, data: { warrantyId: w.id } });
    await db.contact.update({ where: { id: customer.id }, data: { creditLimit: 500000 } });
    const r = await sale(owner, { customerId: customer.id, lines: [{ productId: phoneProductId, qty: 1, unitPrice: 95000, deviceIds: [dev.id] }], payments: [{ method: "CASH", amount: 35000 }] });
    const sold = await db.deviceIdentity.findUniqueOrThrow({ where: { id: dev.id } });
    assert.equal(sold.state, "SOLD"); assert.ok(sold.soldAt && sold.warrantyUntil);
    const first = new Date(Date.now() + 30 * 86_400_000);
    const plan = await createPlan(owner, { saleId: r.id, count: 3, frequency: "MONTHLY", firstDueAt: first });
    await fails(() => createPlan(owner, { saleId: r.id, count: 3, frequency: "MONTHLY", firstDueAt: first }), /already has plan/);
    const p = await db.instalmentPlan.findUniqueOrThrow({ where: { id: plan.id }, include: { dues: true, sale: true } });
    assert.equal(p.financed.toFixed(2), "60000.00");
    assert.deepEqual(p.dues.sort((a, b) => a.seq - b.seq).map((d) => d.amount.toFixed(2)), ["20000.00", "20000.00", "20000.00"]);
    await db.sale.update({ where: { id: r.id }, data: { paid: { increment: 25000 } } }); // stands in for a debt payment
    const after = planProgress(await db.instalmentPlan.findUniqueOrThrow({ where: { id: plan.id }, include: { dues: true, sale: true } }));
    assert.deepEqual(after.dues.map((d) => d.paid), [20000, 5000, 0]); assert.equal(after.balance, 35000);
  });

  await step("return takes back loyalty points", async () => {
    const s = await db.sale.findFirstOrThrow({ where: { loyaltyEarned: 15 }, include: { lines: true } });
    const before = await pointsBalance(db, customer.id);
    await postReturn(owner, { idempotencyKey: randomUUID(), saleId: s.id, reason: "test", settlement: "STORE_CREDIT", lines: [{ saleLineId: s.lines[0].id, qty: 1, disposition: "SALEABLE" }] });
    assert.equal(before - (await pointsBalance(db, customer.id)), 15);
  });

  await step("stock take: count, scan, post one adjustment, idempotent", async () => {
    const have = (await availability(loc.id, [cover.id])).get(cover.id)!.toNumber();
    const c = await openCount(owner, { categoryId: null, notes: "test", includeZero: false });
    await fails(() => openCount(owner, { categoryId: null, notes: null, includeZero: false }), /already open/);
    const line = await db.stockCountLine.findUniqueOrThrow({ where: { countId_productId: { countId: c.id, productId: cover.id } } });
    await saveCounted(owner, c.id, [{ lineId: line.id, counted: have - 2 }]);
    const cable = await db.product.findUniqueOrThrow({ where: { sku: "D-103" } });
    const cableHave = (await availability(loc.id, [cable.id])).get(cable.id)!.toNumber();
    const cl = await db.stockCountLine.findUniqueOrThrow({ where: { countId_productId: { countId: c.id, productId: cable.id } } });
    await saveCounted(owner, c.id, [{ lineId: cl.id, counted: cableHave }]);
    const sc = await scanInto(owner, c.id, "D-103"); assert.ok("ok" in sc);       // one more cable than expected
    const bad = await scanInto(owner, c.id, "NOT-A-CODE"); assert.ok("error" in bad);
    const r = await postCount(owner, c.id);
    assert.equal(r.differences, 2);
    assert.equal((await availability(loc.id, [cover.id])).get(cover.id)!.toNumber(), have - 2);
    assert.equal((await availability(loc.id, [cable.id])).get(cable.id)!.toNumber(), cableHave + 1);
    await fails(() => postCount(owner, c.id), /posted/);
    assert.equal(await db.stockAdjustment.count({ where: { idempotencyKey: `stock-count-${c.id}` } }), 1);
  });

  await step("repair: terms, tracking token, technician commission at handover", async () => {
    await db.appSetting.upsert({ where: { key: "repairs" }, update: { value: { commissionPct: 20 } }, create: { key: "repairs", value: { commissionPct: 20 } } });
    // No mobile on this customer: the "ready" SMS is skipped, so nothing needs a web request to send from.
    const walkIn = await db.contact.create({ data: { name: "Repair test customer" } });
    const j = await createRepair(owner, { idempotencyKey: randomUUID(), customerId: walkIn.id, deviceModel: "Galaxy A15", problem: "Screen", technicianId: acct.personId, termsAccepted: true, notifyCustomer: false });
    const job = await db.repairJob.findUniqueOrThrow({ where: { id: j.id } });
    assert.ok(job.trackToken && job.trackToken.length >= 20); assert.ok(job.termsAcceptedAt && job.termsText);
    await setCharges(owner, j.id, { labour: 5000, other: 0, discount: 500, externalCost: 0, warrantyDays: 30 });
    await changeStatus(owner, j.id, "IN_PROGRESS", null);
    await fails(() => changeStatus(owner, j.id, "READY", null), /repaired/);
    await changeStatus(owner, j.id, "READY", null, { result: "REPAIRED" });
    await db.repairJob.update({ where: { id: j.id }, data: { paid: 4500 } });
    await changeStatus(owner, j.id, "COLLECTED", null);
    const acc = await db.commissionAccrual.findMany({ where: { repairJobId: j.id } });
    assert.equal(acc.length, 1); assert.equal(acc[0].role, "TECHNICIAN"); assert.equal(acc[0].amount.toFixed(2), "900.00");
  });

  await step("repair: outsourced to another shop, back not fixed, ready as not repaired", async () => {
    const cust = await db.contact.create({ data: { name: "Outsource test customer" } });
    const shop = await db.contact.create({ data: { name: "Board repair shop", isCustomer: false } });
    const j = await createRepair(owner, { idempotencyKey: randomUUID(), customerId: cust.id, deviceModel: "iPhone 11", problem: "No power", estimate: 12000, deposit: { amount: 2000, method: "CASH" }, notifyCustomer: false });
    await setRoute(owner, j.id, "OUTSOURCED");
    await sendOutside(owner, j.id, { vendorId: shop.id, quote: 8000, note: "board" });
    let job = await db.repairJob.findUniqueOrThrow({ where: { id: j.id } });
    assert.equal(job.status, "OUTSOURCED"); assert.equal(job.route, "OUTSOURCED");
    assert.ok((await db.contact.findUniqueOrThrow({ where: { id: shop.id } })).isSupplier);
    await fails(() => changeStatus(owner, j.id, "READY", null, { result: "REPAIRED" }), /cannot move/);
    await fails(() => setRoute(owner, j.id, "IN_HOUSE"), /outside shop/);
    await fails(() => sendOutside(owner, j.id, { vendorId: shop.id }), /cannot be sent/);
    const trip = await db.repairOutsource.findFirstOrThrow({ where: { jobId: j.id } });
    await returnFromOutside(owner, j.id, { outsourceId: trip.id, cost: 1500, result: "NOT_REPAIRED" });
    await fails(() => returnFromOutside(owner, j.id, { outsourceId: trip.id, cost: 1500, result: "NOT_REPAIRED" }), /already/);
    job = await db.repairJob.findUniqueOrThrow({ where: { id: j.id } });
    assert.equal(job.status, "TESTING"); assert.equal(job.externalCost.toFixed(2), "1500.00");
    // A typed outside cost is ignored once outside-shop records exist.
    await setCharges(owner, j.id, { labour: 0, other: 0, discount: 0, externalCost: 99, warrantyDays: 30 });
    assert.equal((await db.repairJob.findUniqueOrThrow({ where: { id: j.id } })).externalCost.toFixed(2), "1500.00");
    await fails(() => changeStatus(owner, j.id, "READY", null, { result: "NOT_REPAIRED" }), /why/);
    // Paid ahead before the bill is final: no refund yet.
    await fails(() => refundRepair(owner, j.id, { amount: 100, method: "CASH", accountId: null, reference: null }), /ready/);
    await changeStatus(owner, j.id, "READY", null, { result: "REPAIRED" });
    // Reopened: the result is cleared until it is ready again.
    await changeStatus(owner, j.id, "IN_PROGRESS", null);
    assert.equal((await db.repairJob.findUniqueOrThrow({ where: { id: j.id } })).outcome, null);
    await changeStatus(owner, j.id, "READY", null, { result: "NOT_REPAIRED", reason: "Beyond repair", fee: 500 });
    job = await db.repairJob.findUniqueOrThrow({ where: { id: j.id } });
    assert.equal(job.outcome, "NOT_REPAIRED"); assert.equal(job.outcomeReason, "Beyond repair");
    assert.equal(job.total.toFixed(2), "500.00"); assert.equal(job.warrantyDays, null); assert.equal(job.paid.toFixed(2), "2000.00");
    // The 2,000 advance is more than the 500 fee: 1,500 goes back before handover, and no more than that.
    await fails(() => changeStatus(owner, j.id, "COLLECTED", null), /Refund/);
    await fails(() => refundRepair(owner, j.id, { amount: 1600, method: "CASH", accountId: null, reference: null }), /At most/);
    await refundRepair(owner, j.id, { amount: 1500, method: "CASH", accountId: null, reference: null });
    const out = await db.payment.findFirstOrThrow({ where: { repairJobId: j.id, direction: "OUT" } });
    assert.equal(out.amount.toFixed(2), "1500.00"); assert.ok(out.registerId);
    await changeStatus(owner, j.id, "COLLECTED", null);
    assert.equal((await db.repairJob.findUniqueOrThrow({ where: { id: j.id } })).paid.toFixed(2), "500.00");
  });

  await step("shared cash drawer: cash in/out, count with reason, hand-over and next opening", async () => {
    const counts = (amount: number) => {
      const c: Record<string, number> = {};
      let left = amount;
      for (const d of DENOMINATIONS) { const n = Math.floor(left / d); if (n) c[d] = n; left -= n * d; }
      assert.equal(left, 0);
      return c;
    };
    const other = await db.person.create({ data: { fullName: "Second cashier" } });
    const second: CurrentUser = { ...cashier, personId: other.id, name: other.fullName };
    const drawer = await db.registerSession.findFirstOrThrow({ where: { locationId: loc.id, closedAt: null } });
    const before = await drawerSummary(db, drawer.id);
    // A different cashier sells into the same drawer.
    const r = await sale(second, { lines: [{ productId: cover.id, qty: 1, unitPrice: 2000, lots: [{ layerId: await lotOf(cover.id), qty: 1 }] }], payments: [{ method: "CASH", amount: 2000 }] });
    assert.equal((await db.sale.findUniqueOrThrow({ where: { id: r.id } })).registerId, drawer.id);
    await fails(() => openRegister(owner, { openingCash: 100, note: null }), /already open/);
    await fails(() => recordMovement(owner, { reason: "OWNER_TOOK", amount: 1e9, note: null }), /should only hold/);
    await recordMovement(owner, { reason: "OWNER_TOOK", amount: 1000, note: "lunch money" });
    await recordMovement(second, { reason: "FLOAT_IN", amount: 300, note: null });
    const mid = await drawerSummary(db, drawer.id);
    assert.equal(mid.expected.toFixed(2), before.expected.plus(2000).minus(1000).plus(300).toFixed(2));
    assert.ok(mid.outBy.some((x) => x.label === "Owner took cash" && x.amount.eq(1000)));
    const expected = Number(mid.expected);
    // Short by 500: a reason and a note are required.
    const base = { registerId: drawer.id, counts: counts(expected - 500), cashLeft: 5000, handoverReason: "OWNER_TOOK" };
    await fails(() => closeRegister(second, { ...base, varianceReason: null, notes: null }), /Choose the reason/);
    await fails(() => closeRegister(second, { ...base, varianceReason: "WRONG_CHANGE", notes: null }), /Write a note/);
    await fails(() => closeRegister(second, { ...base, cashLeft: expected + 1, varianceReason: "WRONG_CHANGE", notes: "x" }), /between 0 and the counted/);
    const res = await closeRegister(second, { ...base, varianceReason: "WRONG_CHANGE", notes: "gave 500 too much change" });
    assert.equal(res.variance.toFixed(2), "-500.00");
    assert.equal(res.handover.toFixed(2), (expected - 500 - 5000).toFixed(2));
    const closed = await db.registerSession.findUniqueOrThrow({ where: { id: drawer.id } });
    assert.equal(closed.closedById, other.id); assert.equal(closed.varianceReason, "WRONG_CHANGE"); assert.equal(closed.cashLeft?.toFixed(2), "5000.00");
    const after = await drawerSummary(db, drawer.id);
    assert.equal(after.expected.toFixed(2), mid.expected.toFixed(2));       // hand-over is not part of expected cash
    assert.equal(after.handedOver.toFixed(2), res.handover.toFixed(2));
    await fails(() => closeRegister(owner, { ...base, varianceReason: "OTHER", notes: "x" }), /already closed/);
    // Drawer closed: no cash sales, no cash in/out.
    const lot = await lotOf(cover.id);
    await fails(() => sale(owner, { lines: [{ productId: cover.id, qty: 1, unitPrice: 2000, lots: [{ layerId: lot, qty: 1 }] }], payments: [{ method: "CASH", amount: 2000 }] }), /Open the cash register/);
    await fails(() => recordMovement(owner, { reason: "FLOAT_IN", amount: 10, note: null }), /closed/);
    // Next opening is checked against what was left.
    await fails(() => openRegister(owner, { openingCash: 4000, note: null }), /Write a note/);
    const [a, b] = await Promise.allSettled([openRegister(owner, { openingCash: 5000, note: null }), openRegister(second, { openingCash: 5000, note: null })]);
    assert.equal([a, b].filter((x) => x.status === "fulfilled").length, 1);  // only one drawer opens
    const next = await db.registerSession.findFirstOrThrow({ where: { locationId: loc.id, closedAt: null } });
    assert.equal(next.expectedOpening?.toFixed(2), "5000.00");
  });

  await step("GRN lot is supplier code + date by default, -2 on the same day; typed lots are kept", async () => {
    const code = `MT${randomUUID().slice(0, 4).toUpperCase()}`;
    const sup = await db.contact.create({ data: { name: `Multi Trade Center Peta ${code}`, isSupplier: true, isCustomer: false, supplierCode: code } });
    const grn = (lots: (string | null)[], lotCode: string | null = null, supplierId = sup.id) =>
      postReceipt(owner, { idempotencyKey: randomUUID(), supplierId, lotCode, lines: lots.map((l) => ({ productId: cover.id, lotCode: l, qtyReceived: 1, unitCost: 500 })) });
    const lotsOf = async (id: string) => (await db.receiptLine.findMany({ where: { receiptId: id } })).map((l) => l.lotCode).sort();
    const day = lotDate(new Date());
    assert.match(day, /^\d{6}$/);
    assert.equal(await autoLotCode(db, sup.id, new Date()), `${code}-${day}`);                 // what the form shows
    const a = await grn([null, ""]);
    assert.deepEqual(await lotsOf(a.id), [`${code}-${day}`, `${code}-${day}`]);                // one lot per GRN
    const b = await grn([" BOX-7 ", null]);                                                     // same day: -2
    assert.deepEqual(await lotsOf(b.id), ["BOX-7", `${code}-${day}-2`]);
    assert.ok(await db.costLayer.findFirst({ where: { receiptLine: { receiptId: b.id }, lotCode: `${code}-${day}-2` } }));
    const c = await grn([null], " MY-LOT ");                                                    // GRN lot typed by hand
    assert.deepEqual(await lotsOf(c.id), ["MY-LOT"]);
    assert.equal(await autoLotCode(db, sup.id, new Date()), `${code}-${day}-3`);
    const plain = await db.contact.create({ data: { name: `Zeta Yellow ${code}`, isSupplier: true, isCustomer: false } });
    const d = await grn([null], null, plain.id);                                                // no code: initials
    assert.deepEqual(await lotsOf(d.id), [`ZYM-${day}`]);
    assert.equal(nameInitials("Multi Trade Center Peta"), "MTCP");
    assert.equal(nextLot("X-181126", ["X-181126", "X-181126-2", "X-181126-B", "X-1811260"]), "X-181126-3");
  });

  await step("login lock after 5 wrong tries, cleared by a good one", async () => {
    const u = `lock-${randomUUID().slice(0, 8)}`;
    for (let i = 0; i < 4; i++) await recordLoginAttempt(u, "10.0.0.9", false);
    assert.equal(await loginLocked(u, null), false);
    await recordLoginAttempt(u, "10.0.0.9", false);
    assert.equal(await loginLocked(u, null), true);
    await db.loginAttempt.deleteMany({ where: { username: u, ok: false } }); // what a password reset does
    assert.equal(await loginLocked(u, null), false);
  });

  await step("sign-in on a shop device clocks in once; never on a second sign-in or when switched off", async () => {
    const person = await db.person.create({ data: { fullName: `Clock ${randomUUID().slice(0, 6)}` } });
    const emp = await db.employeeProfile.create({ data: { personId: person.id, joinedOn: new Date("2026-01-01") } });
    const device = await db.shopDevice.create({ data: { name: "Test till", locationId: loc.id, tokenHash: randomUUID(), registeredById: acct.personId } });
    const sign = (sessionId: string) => clockInOnSignIn({ personId: person.id, sessionId, deviceId: device.id, locationId: loc.id, ip: "10.0.0.7" });
    const first = await sign("s1");
    assert.ok(first);
    assert.equal(first.source, "LOGIN");
    assert.equal(first.deviceId, device.id);
    assert.equal(first.ip, "10.0.0.7");
    assert.equal(await sign("s2"), null); // already on the clock
    const both = await Promise.all([db.clockEvent.update({ where: { id: first.id }, data: { voidedAt: new Date(), voidReason: "test" } }).then(() => sign("s3")), sign("s4")]);
    assert.equal(await db.clockEvent.count({ where: { employeeId: emp.id, voidedAt: null } }), 1, "parallel sign-ins make one clock-in");
    assert.ok(both.some(Boolean));
    // A clock-in older than 16 hours is a forgotten clock-out: the next sign-in starts a new day.
    await db.clockEvent.updateMany({ where: { employeeId: emp.id, voidedAt: null }, data: { at: new Date(Date.now() - 20 * 3_600_000) } });
    assert.ok(await sign("s5"));
    await db.appSetting.upsert({ where: { key: "attendance" }, create: { key: "attendance", value: { dayCutoff: "02:00", autoClockIn: false } }, update: { value: { dayCutoff: "02:00", autoClockIn: false } } });
    await db.clockEvent.updateMany({ where: { employeeId: emp.id }, data: { voidedAt: new Date(), voidReason: "test" } });
    assert.equal(await sign("s6"), null, "switched off");
    await db.appSetting.delete({ where: { key: "attendance" } });
    // No employee profile (the owner): nothing recorded.
    assert.equal(await clockInOnSignIn({ personId: acct.personId, sessionId: "s7", deviceId: device.id, locationId: loc.id, ip: null }), null);
  });

  await step("end of day: others still on the clock leave the drawer open; the last one must close it; one clock-out", async () => {
    const device = await db.shopDevice.create({ data: { name: "End till", locationId: loc.id, tokenHash: randomUUID(), registeredById: acct.personId } });
    const staff = await Promise.all(["Asha", "Bimal"].map(async (n) => {
      const person = await db.person.create({ data: { fullName: `${n} ${randomUUID().slice(0, 6)}` } });
      const emp = await db.employeeProfile.create({ data: { personId: person.id, joinedOn: new Date("2026-01-01") } });
      await clockInOnSignIn({ personId: person.id, sessionId: `in-${n}`, deviceId: device.id, locationId: loc.id, ip: null });
      const u: CurrentUser = { ...owner, personId: person.id, name: person.fullName, sessionId: `end-${n}`, permissions: new Set(["register.operate"]), device: { id: device.id, name: device.name, locationId: loc.id } };
      return { emp, u };
    }));
    const [a, b] = staff;
    if (!(await db.registerSession.findFirst({ where: { locationId: loc.id, closedAt: null } })))
      await db.registerSession.create({ data: { locationId: loc.id, userId: acct.personId, openingCash: 1000 } });

    const ra = await dayReport(a.u);
    assert.equal(ra.mustClose, false);
    assert.ok(ra.others.some((o) => o.personId === b.u.personId));
    const outA = await endDay(a.u, "10.0.0.8");
    assert.equal(outA.clockOut?.source, "LOGOUT");
    assert.equal(outA.clockOut?.deviceId, device.id);
    assert.equal((await endDay(a.u, null)).clockOut, null, "a second end of day adds no clock-out");

    assert.equal((await dayReport(b.u)).mustClose, true);
    await fails(() => endDay(b.u, null), /last one on the clock/);
    // Someone who cannot close the drawer may still leave; the audit notes the open drawer.
    const noPerm = { ...b.u, permissions: new Set<string>() };
    assert.equal((await dayReport(noPerm)).canClose, false);

    const open = await db.registerSession.findFirstOrThrow({ where: { locationId: loc.id, closedAt: null } });
    const { expected } = await drawerSummary(db, open.id);
    const counts: Record<string, number> = {};
    let rest = Math.round(Number(expected));
    for (const d of [...DENOMINATIONS].sort((x, y) => y - x)) { const c = Math.floor(rest / d); if (c) { counts[d] = c; rest -= c * d; } }
    await closeRegister(owner, { registerId: open.id, counts, varianceReason: rest ? "COUNTING_ERROR" : null, notes: rest ? "test" : null, cashLeft: null, handoverReason: null });
    const outB = await endDay(b.u, null);
    assert.ok(outB.clockOut);
    assert.equal(await db.clockEvent.count({ where: { employeeId: { in: [a.emp.id, b.emp.id] }, kind: "OUT", voidedAt: null } }), 2);
    assert.equal(await db.auditEvent.count({ where: { action: "DAY_ENDED", actorId: { in: [a.u.personId, b.u.personId] } } }), 3);
    const [dayA] = await attendance(a.emp.id, todayYmd(), todayYmd());
    assert.ok(dayA.firstIn && dayA.lastOut);
  });

  await step("nightly job: forgotten clock-out set to the shift end and flagged; open drawer reported once", async () => {
    const shift = await db.shift.create({ data: { name: `Night test ${randomUUID().slice(0, 6)}`, startTime: "09:00", endTime: "18:00", restDays: [] } });
    const mk2 = async (n: string, shiftId: string | null) => {
      const person = await db.person.create({ data: { fullName: `${n} ${randomUUID().slice(0, 6)}` } });
      return db.employeeProfile.create({ data: { personId: person.id, joinedOn: new Date("2026-01-01"), shiftId } });
    };
    const withShift = await mk2("Chamara", shift.id);
    const noShift = await mk2("Dilini", null);
    // Two business days ago, 08:55 Colombo: always before the last nightly cutoff.
    const twoDaysAgo = ymd(new Date(Date.now() - 2 * 86_400_000));
    const inAt = new Date(dayStart(twoDaysAgo).getTime() + (8 * 60 + 55) * 60_000);
    for (const e of [withShift, noShift]) await db.clockEvent.create({ data: { employeeId: e.id, kind: "IN", at: inAt, source: "LOGIN", locationId: loc.id } });

    const old = new Date(dayStart(twoDaysAgo).getTime() + 8 * 3_600_000);
    const open = await db.registerSession.findFirst({ where: { locationId: loc.id, closedAt: null } });
    const reg = open ?? await db.registerSession.create({ data: { locationId: loc.id, userId: acct.personId, openingCash: 1000, openedAt: old } });
    if (open) await db.registerSession.update({ where: { id: open.id }, data: { openedAt: old } });

    const first = await nightlyAttendance();
    assert.ok(first.autoClockOuts >= 2);
    assert.equal(first.drawerAlerts, 1);
    const outShift = await db.clockEvent.findFirstOrThrow({ where: { employeeId: withShift.id, kind: "OUT" } });
    assert.equal(outShift.source, "AUTO");
    assert.equal(outShift.at.getTime(), dayStart(twoDaysAgo).getTime() + 18 * 3_600_000, "set to the shift end");
    const outNoShift = await db.clockEvent.findFirstOrThrow({ where: { employeeId: noShift.id, kind: "OUT" } });
    assert.equal(outNoShift.at.getTime(), inAt.getTime(), "no shift: no hours assumed");
    const [d] = await attendance(withShift.id, twoDaysAgo, twoDaysAgo);
    assert.equal(d.autoOut, true);
    assert.equal(d.missingOut, false);
    assert.equal(d.leftEarly, false);
    assert.equal(d.minutes, 9 * 60 + 5);

    const again = await nightlyAttendance();
    assert.equal(again.drawerAlerts, 0, "one alert per drawer");
    assert.equal(await db.clockEvent.count({ where: { employeeId: { in: [withShift.id, noShift.id] }, kind: "OUT" } }), 2, "safe to repeat");
    // Someone clocked in after the last cutoff is left alone.
    const fresh = await mk2("Eranga", shift.id);
    await db.clockEvent.create({ data: { employeeId: fresh.id, kind: "IN", at: new Date(Date.now() - 60_000), source: "LOGIN", locationId: loc.id } });
    await nightlyAttendance();
    assert.equal(await db.clockEvent.count({ where: { employeeId: fresh.id, kind: "OUT" } }), 0);
    await db.registerSession.update({ where: { id: reg.id }, data: { closedAt: new Date() } });
  });

  await step("owners get a bell notification for clock-in and End my day; never for their own clock-in; switchable", async () => {
    const device = await db.shopDevice.create({ data: { name: "Bell till", locationId: loc.id, tokenHash: randomUUID(), registeredById: acct.personId } });
    const person = await db.person.create({ data: { fullName: `Bell ${randomUUID().slice(0, 6)}` } });
    await db.employeeProfile.create({ data: { personId: person.id, joinedOn: new Date("2026-01-01") } });
    const mine = (kind: string) => db.notification.findMany({ where: { personId: acct.personId, kind, title: { startsWith: person.fullName } } });
    await clockInOnSignIn({ personId: person.id, sessionId: "bell-in", deviceId: device.id, locationId: loc.id, ip: null });
    const ins = await mine("CLOCK_IN");
    assert.equal(ins.length, 1);
    assert.match(ins[0].body, /Bell till/);
    assert.equal(ins[0].readAt, null);
    assert.equal(await db.notification.count({ where: { personId: person.id } }), 0, "not told about their own clock-in");

    const u: CurrentUser = { ...owner, personId: person.id, name: person.fullName, sessionId: "bell-end", permissions: new Set(["register.operate"]), device: { id: device.id, name: device.name, locationId: loc.id } };
    if (await db.registerSession.findFirst({ where: { locationId: loc.id, closedAt: null } })) await db.registerSession.updateMany({ where: { locationId: loc.id, closedAt: null }, data: { closedAt: new Date() } });
    await endDay(u, null);
    const outs = await mine("CLOCK_OUT");
    assert.equal(outs.length, 1);
    assert.match(outs[0].body, /worked/);
    assert.match(outs[0].body, /sales/);

    await db.appSetting.upsert({ where: { key: "attendance" }, create: { key: "attendance", value: { notifyClock: false } }, update: { value: { notifyClock: false } } });
    await clockInOnSignIn({ personId: person.id, sessionId: "bell-in-2", deviceId: device.id, locationId: loc.id, ip: null });
    assert.equal((await mine("CLOCK_IN")).length, 1, "switched off: no new notification");
    await db.appSetting.delete({ where: { key: "attendance" } });
  });

  await step("payroll: one person on their own, left out of the everyone payroll, no double pay; cancelled run gets a new revision", async () => {
    const tag = randomUUID().slice(0, 6);
    const mkEmp = async (name: string, salary: number | null) => {
      const person = await db.person.create({ data: { fullName: `${name} ${tag}` } });
      const e = await db.employeeProfile.create({ data: { personId: person.id, joinedOn: new Date("2025-01-01") } });
      if (salary) await db.salaryHistory.create({ data: { employeeId: e.id, amount: salary, payPeriod: "MONTH", effectiveFrom: new Date("2025-01-01"), createdById: acct.personId } });
      return e;
    };
    const a = await mkEmp("Payroll A", 60000), b = await mkEmp("Payroll B", 45000), c = await mkEmp("Payroll C", null);
    const [from, to] = ["2025-03-01", "2025-03-31"];
    const slipsOf = (runId: string) => db.payslip.findMany({ where: { runId } });

    const solo = await createRun(owner, from, to, null, a.id);
    assert.equal(solo.employeeId, a.id);
    const soloSlips = await slipsOf(solo.id);
    assert.deepEqual(soloSlips.map((p) => p.employeeId), [a.id], "only that person");
    assert.equal(soloSlips[0].net.toString(), "60000");
    await fails(() => createRun(owner, from, to, null, a.id), /already in payroll/);
    await fails(() => createRun(owner, from, to, null, c.id), /no salary/);

    const all = await createRun(owner, from, to, null, null);
    let ids = (await slipsOf(all.id)).map((p) => p.employeeId);
    assert.ok(ids.includes(b.id) && !ids.includes(a.id), "everyone payroll skips the person paid on their own");
    await fails(() => createRun(owner, "2025-03-15", "2025-04-14", null, null), /already covers/);
    await fails(() => createRun(owner, from, to, null, b.id), /already in payroll/);

    await calculateRun(owner, all.id);
    await calculateRun(owner, all.id, b.id);
    ids = (await slipsOf(all.id)).map((p) => p.employeeId);
    assert.ok(ids.includes(b.id) && !ids.includes(a.id), "recalculating keeps them out");

    // Cancelling the one-person draft hands them back to the everyone payroll as a new revision.
    await db.payrollRun.update({ where: { id: solo.id }, data: { status: "CANCELLED" } });
    await calculateRun(owner, all.id);
    const back = await db.payslip.findFirstOrThrow({ where: { runId: all.id, employeeId: a.id } });
    assert.equal(back.revision, 2);
    const again = await createRun(owner, "2025-05-01", "2025-05-31", null, a.id);
    await db.payrollRun.update({ where: { id: again.id }, data: { status: "CANCELLED" } });
    const redo = await createRun(owner, "2025-05-01", "2025-05-31", null, a.id);
    assert.equal((await slipsOf(redo.id))[0].revision, 2, "a cancelled one-person draft can be redone");
  });

  await step("sales target: only chosen categories (and sub-categories) count, after invoice discount and returns", async () => {
    const acc = await db.category.create({ data: { name: `Target Accessories ${randomUUID().slice(0, 6)}` } });
    const covers = await db.category.create({ data: { name: `Target Covers ${randomUUID().slice(0, 6)}`, parentId: acc.id } });
    const phones = await db.category.create({ data: { name: `Target Phones ${randomUUID().slice(0, 6)}` } });
    await db.product.update({ where: { id: cover.id }, data: { categoryId: covers.id } });
    await db.product.update({ where: { id: charger.id }, data: { categoryId: phones.id } });
    if (!(await db.registerSession.findFirst({ where: { locationId: loc.id, closedAt: null } })))
      await db.registerSession.create({ data: { locationId: loc.id, userId: acct.personId, openingCash: 0 } });
    const day = dayStart(todayYmd());
    const base = { personId: acct.personId, periodStart: new Date(`${todayYmd()}T00:00:00Z`), periodEnd: new Date(`${todayYmd()}T00:00:00Z`), mode: "FIXED", bands: [{ from: 1000, to: null, amount: 100 }] };
    const accOnly = { ...base, cadence: "DAILY", categoryIds: [acc.id] };
    const all = { ...base, cadence: "PERIOD", categoryIds: [] };
    const [a0, b0] = [await targetResult(accOnly), await targetResult(all)];
    // One bill: cover 2,000 + "phone" 15,000, invoice discount 170 → the cover carries 20 of it.
    const s = await sale(owner, {
      lines: [{ productId: cover.id, qty: 1, unitPrice: 2000, lots: [{ layerId: await lotOf(cover.id), qty: 1 }] }, { productId: charger.id, qty: 1, unitPrice: 15000, lots: [{ layerId: await lotOf(charger.id), qty: 1 }] }],
      invoiceDiscount: 170, payments: [{ method: "CASH", amount: 16830 }],
    });
    const [a1, b1] = [await targetResult(accOnly), await targetResult(all)];
    assert.equal(a1.value.minus(a0.value).toString(), "1980", "only the cover counts for an Accessories target");
    assert.equal(b1.value.minus(b0.value).toString(), "16830", "no categories = everything");
    assert.equal(a1.days?.length, 1);
    assert.equal(a1.days![0].day, ymd(day));
    assert.equal(a1.earning.toString(), "100");
    const lines = await db.saleLine.findMany({ where: { saleId: s.id } });
    await postReturn(owner, { idempotencyKey: randomUUID(), saleId: s.id, reason: "test", settlement: "REFUND", lines: [{ saleLineId: lines.find((l) => l.productId === cover.id)!.id, qty: 1, disposition: "SALEABLE" }] });
    const a2 = await targetResult(accOnly);
    assert.equal(a2.value.toString(), a0.value.toString(), "a returned cover no longer counts");
  });

  await step("Fintrex commission: per phone, follows type changes and returns, held until the sale is collected in full", async () => {
    const tag = randomUUID().slice(0, 6);
    const person = await db.person.create({ data: { fullName: `Credit Seller ${tag}` } });
    const emp = await db.employeeProfile.create({ data: { personId: person.id, joinedOn: new Date("2025-01-01") } });
    await db.salaryHistory.create({ data: { employeeId: emp.id, amount: 50000, payPeriod: "MONTH", effectiveFrom: new Date("2025-01-01"), createdById: acct.personId } });
    await db.appSetting.upsert({ where: { key: "creditCommission" }, update: { value: { fintrex: 500 } }, create: { key: "creditCommission", value: { fintrex: 500 } } });
    if (!(await db.registerSession.findFirst({ where: { locationId: loc.id, closedAt: null } })))
      await db.registerSession.create({ data: { locationId: loc.id, userId: acct.personId, openingCash: 50000 } });
    const phone = await db.product.create({ data: { sku: `T-CREDIT-${tag}`, name: "Credit test phone", trackDevices: true, sellPrice: 80000, defaultCost: 0 } });
    const luhn = (body: string) => { let t = 0; for (let i = 0; i < 14; i++) { let d = Number(body[i]); if (i % 2) { d *= 2; if (d > 9) d -= 9; } t += d; } return body + ((10 - (t % 10)) % 10); };
    const devices: string[] = [];
    for (let i = 0; i < 4; i++) {
      const imei1 = luhn(`35${String(Date.now()).slice(-8)}${String(i).padStart(4, "0")}`);
      await createTradeIn(owner, { idempotencyKey: randomUUID(), customerId: customer.id, sellerIdNumber: "901234567V", productId: phone.id, ownershipDeclared: true, accountsRemoved: true, value: 30000, imei1, settlement: "CASH", readyToSell: true });
      devices.push((await db.deviceIdentity.findFirstOrThrow({ where: { imei1 } })).id);
    }
    const credit = async (saleId: string) => {
      const rows = await db.commissionAccrual.findMany({ where: { saleLine: { saleId }, role: { in: ["FINTREX", "INSTALMENT"] } } });
      return { total: rows.reduce((a, r) => a + Number(r.amount), 0), rows };
    };
    const sell = (deviceIds: string[], o: Record<string, unknown>) => sale(owner, { customerId: customer.id, commissionMode: "USER", salespersonId: person.id, lines: [{ productId: phone.id, qty: deviceIds.length, unitPrice: 80000, deviceIds }], ...o });

    // Fintrex: 2 phones on one line, 20,000 down and the rest still to come from Fintrex → 2 × 500, to the salesperson.
    const f = await sell(devices.slice(0, 2), { channel: "FINTREX", payments: [{ method: "CASH", amount: 20000 }] });
    let c = await credit(f.id);
    assert.equal(c.total, 1000); assert.ok(c.rows.every((r) => r.recipientId === person.id && r.role === "FINTREX"));
    // Wrong type corrected → taken back as a minus row; set back → earned again (no edits to old rows).
    await setSaleChannel(owner, f.id, { channel: "IN_STORE", channelRef: null });
    assert.equal((await credit(f.id)).total, 0);
    await setSaleChannel(owner, f.id, { channel: "FINTREX", channelRef: null });
    c = await credit(f.id);
    assert.equal(c.total, 1000); assert.equal(c.rows.length, 3);
    // Returning one phone takes back that phone's 500, tagged with the return.
    const fl = await db.saleLine.findFirstOrThrow({ where: { saleId: f.id } });
    await postReturn(owner, { idempotencyKey: randomUUID(), saleId: f.id, reason: "test", settlement: "STORE_CREDIT", lines: [{ saleLineId: fl.id, qty: 1, disposition: "SALEABLE", deviceIds: [devices[0]] }] });
    c = await credit(f.id);
    assert.equal(c.total, 500); assert.ok(c.rows.some((r) => r.returnLineId && Number(r.amount) === -500));

    // A shop credit sale with an instalment plan earns no credit commission (only Fintrex does).
    const s1 = await sell([devices[2]], { payments: [{ method: "CASH", amount: 20000 }] });
    await createPlan(owner, { saleId: s1.id, count: 3, frequency: "MONTHLY", firstDueAt: new Date(Date.now() + 30 * 86_400_000) });
    assert.equal((await credit(s1.id)).total, 0);

    // Not collected in full: approval skips it, payroll lists it on hold at 0 and does not settle it.
    await approveCommission(owner, person.id, new Date());
    assert.ok((await credit(f.id)).rows.every((r) => !r.approvedAt), "held Fintrex commission is not approved");
    const run = await createRun(owner, "2025-07-01", "2025-07-31", null, emp.id);
    let slip = await db.payslip.findFirstOrThrow({ where: { runId: run.id } });
    let lines = slip.lines as PayLine[];
    const hold = lines.find((l) => l.label.startsWith("Fintrex commission on hold"));
    assert.ok(hold, "on-hold line on the payslip"); assert.equal(hold!.amount, "0.00"); assert.match(hold!.label, /500\.00 on 1 sale/);
    assert.ok(!lines.some((l) => l.label.startsWith("Fintrex sale commission")));
    const ids = (await credit(f.id)).rows.map((r) => r.id);
    assert.ok(!slip.commissionIds.some((id) => ids.includes(id)));

    // Fintrex pays the rest → the commission can be approved and joins the salary.
    const fs = await db.sale.findUniqueOrThrow({ where: { id: f.id } });
    await db.sale.update({ where: { id: f.id }, data: { paid: { increment: fs.total.minus(fs.paid).minus(fs.credited) } } }); // stands in for the Fintrex payment
    await approveCommission(owner, person.id, new Date());
    assert.ok((await credit(f.id)).rows.every((r) => r.approvedAt));
    await calculateRun(owner, run.id);
    slip = await db.payslip.findFirstOrThrow({ where: { runId: run.id } });
    lines = slip.lines as PayLine[];
    assert.equal(lines.find((l) => l.label.startsWith("Fintrex sale commission"))?.amount, "500.00");
    assert.ok(!lines.some((l) => l.label.startsWith("Fintrex commission on hold")));
    assert.ok(ids.every((id) => slip.commissionIds.includes(id)));

    // A rate change applies to new sales only: a returned phone takes back what it earned, not the new rate.
    const s2 = await sell([devices[3]], { channel: "FINTREX", payments: [{ method: "OTHER", amount: 80000, reference: "Fintrex" }] });
    await db.appSetting.update({ where: { key: "creditCommission" }, data: { value: { fintrex: 700 } } });
    const l2 = await db.saleLine.findFirstOrThrow({ where: { saleId: s2.id } });
    await postReturn(owner, { idempotencyKey: randomUUID(), saleId: s2.id, reason: "test", settlement: "STORE_CREDIT", lines: [{ saleLineId: l2.id, qty: 1, disposition: "SALEABLE", deviceIds: [devices[3]] }] });
    assert.equal((await credit(s2.id)).total, 0);
  });

  console.log("\nAll integration flows passed.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
