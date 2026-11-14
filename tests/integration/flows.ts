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
import { createRepair, changeStatus, setCharges } from "../../src/lib/repairs";
import { postReturn } from "../../src/lib/returns";
import { availability, storeCreditBalance } from "../../src/lib/stock";
import { loginLocked, recordLoginAttempt } from "../../src/lib/login-guard";
import type { CurrentUser } from "../../src/lib/auth";
import { DENOMINATIONS, closeRegister, drawerSummary, openRegister, recordMovement } from "../../src/lib/register";

if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) throw new Error("Refusing to run: DATABASE_URL is not a local database.");

const step = async (name: string, fn: () => Promise<void>) => { await fn(); console.log("ok  " + name); };
const fails = async (fn: () => Promise<unknown>, re: RegExp) => { await assert.rejects(fn, (e: Error) => { assert.match(e.message, re); return true; }); };

async function main() {
  const loc = await db.location.findFirstOrThrow();
  const acct = await db.loginAccount.findFirstOrThrow({ include: { person: true, role: true } });
  const mk = (maxDiscountPct: number, perms: string[]): CurrentUser => ({
    sessionId: "t", accountId: acct.id, personId: acct.personId, name: acct.person.fullName, username: acct.username, role: acct.role.name, roleId: acct.roleId,
    permissions: new Set(perms), maxDiscountPct: new (acct.maxDiscountPct.constructor as never as new (v: number) => typeof acct.maxDiscountPct)(maxDiscountPct), locations: [loc], location: loc,
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
    await changeStatus(owner, j.id, "READY", null);
    await db.repairJob.update({ where: { id: j.id }, data: { paid: 4500 } });
    await changeStatus(owner, j.id, "COLLECTED", null);
    const acc = await db.commissionAccrual.findMany({ where: { repairJobId: j.id } });
    assert.equal(acc.length, 1); assert.equal(acc[0].role, "TECHNICIAN"); assert.equal(acc[0].amount.toFixed(2), "900.00");
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

  await step("login lock after 5 wrong tries, cleared by a good one", async () => {
    const u = `lock-${randomUUID().slice(0, 8)}`;
    for (let i = 0; i < 4; i++) await recordLoginAttempt(u, "10.0.0.9", false);
    assert.equal(await loginLocked(u, null), false);
    await recordLoginAttempt(u, "10.0.0.9", false);
    assert.equal(await loginLocked(u, null), true);
    await db.loginAttempt.deleteMany({ where: { username: u, ok: false } }); // what a password reset does
    assert.equal(await loginLocked(u, null), false);
  });

  console.log("\nAll integration flows passed.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
