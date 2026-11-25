// Quick receive end to end against a THROWAWAY database (never the live one): stock in without cost, sold and
// returned while waiting, blocked elsewhere, then the owner's cost is filled into every sale and return.
// Run: DATABASE_URL=postgresql://…localhost…/fido_test npx tsx --conditions=react-server tests/integration/quick-receive.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { finalizeSale } from "../../src/lib/sales";
import { postReturn } from "../../src/lib/returns";
import { postAdjustment } from "../../src/lib/adjustments";
import { quickReceive, completeReceipt, pendingImpact, remindPendingCost } from "../../src/lib/quick-receive";
import { lotDate } from "../../src/lib/lots";
import { D } from "../../src/lib/money";
import type { CurrentUser } from "../../src/lib/auth";

if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) throw new Error("Refusing to run: DATABASE_URL is not a local database.");

const step = async (name: string, fn: () => Promise<void>) => { await fn(); console.log("ok  " + name); };
const fails = async (fn: () => Promise<unknown>, re: RegExp) => { await assert.rejects(fn, (e: Error) => { assert.match(e.message, re); return true; }); };

async function main() {
  const loc = await db.location.findFirstOrThrow();
  const acct = await db.loginAccount.findFirstOrThrow({ include: { person: true, role: true } });
  // The shop salesperson is a different person from the owner, so the owner gets the alert.
  const staff = await db.person.create({ data: { fullName: "Kasun Test" } });
  const mk = (personId: string, name: string, perms: string[]): CurrentUser => ({
    sessionId: "t", accountId: acct.id, personId, name, username: acct.username, role: acct.role.name, roleId: acct.roleId,
    permissions: new Set(perms), maxDiscountPct: acct.maxDiscountPct, locations: [loc], location: loc, device: null, expiresAt: new Date(Date.now() + 86_400_000),
  });
  const owner = mk(acct.personId, acct.person.fullName, acct.role.permissions);
  const cashier = mk(staff.id, "Kasun Test", ["sales.create", "contacts.view", "products.view", "purchases.quick_receive"]);
  const customer = await db.contact.findFirstOrThrow({ where: { name: "Demo Customer" } });
  const supplier = await db.contact.findFirstOrThrow({ where: { isSupplier: true } });
  const cover = await db.product.findUniqueOrThrow({ where: { sku: "D-101" } });
  const phone = await db.product.findFirst({ where: { trackDevices: true } });
  const category = await db.category.findFirstOrThrow();
  const coverCostBefore = cover.defaultCost;
  if (!(await db.registerSession.findFirst({ where: { locationId: loc.id, closedAt: null } })))
    await db.registerSession.create({ data: { locationId: loc.id, userId: acct.personId, openingCash: 50000 } });

  const key = randomUUID();
  let grnId = "";
  let cableId = "";
  await step("salesperson quick-receives an existing and a new product without cost", async () => {
    const r = await quickReceive(cashier, {
      idempotencyKey: key, supplierId: null, notes: "bill in drawer",
      lines: [{ productId: cover.id, qty: 5 }, { newName: "  QR test  Type-C cable ", qty: 10, sellPrice: 800 }],
    });
    grnId = r.id;
    const g = await db.goodsReceipt.findUniqueOrThrow({ where: { id: r.id }, include: { lines: { include: { product: true, costLayer: true } } } });
    assert.equal(g.status, "PENDING_COST"); assert.equal(g.supplierId, null); assert.ok(D(g.total).eq(0));
    assert.equal(g.lines.length, 2);
    for (const l of g.lines) { assert.ok(l.costLayer?.costPending); assert.ok(D(l.unitCost).eq(0)); assert.equal(l.lotCode, `NEW-${lotDate(new Date())}`); }
    const cable = g.lines.find((l) => l.newProduct)!.product;
    cableId = cable.id;
    assert.equal(cable.name, "QR test Type-C cable"); assert.match(cable.sku, /^QP\d{4}$/); assert.ok(D(cable.sellPrice).eq(800));
    // An existing product's last cost is not overwritten with 0.
    assert.ok(D((await db.product.findUniqueOrThrow({ where: { id: cover.id } })).defaultCost).eq(coverCostBefore));
    // The owner got the bell row; the salesperson did not.
    const n = await db.notification.findMany({ where: { kind: "GRN_COST_PENDING", url: `/purchases/${r.id}` } });
    assert.ok(n.some((x) => x.personId === owner.personId)); assert.ok(!n.some((x) => x.personId === staff.id));
    // A retried save does not add the stock twice.
    const again = await quickReceive(cashier, { idempotencyKey: key, lines: [{ productId: cover.id, qty: 5 }] });
    assert.equal(again.id, r.id);
  });

  await step("quick receive refuses phones, duplicate new names and new products without a price", async () => {
    if (phone) await fails(() => quickReceive(cashier, { idempotencyKey: randomUUID(), lines: [{ productId: phone.id, qty: 1 }] }), /IMEI/);
    await fails(() => quickReceive(cashier, { idempotencyKey: randomUUID(), lines: [{ newName: "qr TEST type-c cable", qty: 1, sellPrice: 500 }] }), /already exists/);
    await fails(() => quickReceive(cashier, { idempotencyKey: randomUUID(), lines: [{ newName: "QR other thing", qty: 1 }] }), /selling price/);
  });

  const cableLot = (await db.costLayer.findFirstOrThrow({ where: { productId: cableId, bucket: "SALEABLE" } })).id;
  let saleLineId = "";
  let saleId = "";
  await step("pending-cost stock sells at once (cost 0 for now)", async () => {
    const s = await finalizeSale(cashier, { idempotencyKey: randomUUID(), customerId: customer.id, lines: [{ productId: cableId, qty: 4, unitPrice: 800, lots: [{ layerId: cableLot, qty: 4 }] }], payments: [{ method: "CASH", amount: 3200 }] });
    saleId = s.id;
    const line = await db.saleLine.findFirstOrThrow({ where: { saleId: s.id } });
    saleLineId = line.id;
    assert.ok(D(line.costTotal).eq(0));
  });

  await step("returns of pending stock: one back on the shelf, one held for inspection", async () => {
    await postReturn(owner, { idempotencyKey: randomUUID(), saleId, reason: "test", settlement: "STORE_CREDIT", lines: [{ saleLineId, qty: 1, disposition: "SALEABLE" }] });
    await postReturn(owner, { idempotencyKey: randomUUID(), saleId, reason: "test", settlement: "STORE_CREDIT", lines: [{ saleLineId, qty: 1, disposition: "INSPECTION" }] });
    const held = await db.costLayer.findFirstOrThrow({ where: { productId: cableId, bucket: "INSPECTION" } });
    assert.ok(held.costPending);
    const im = await pendingImpact(grnId);
    const c = im.find((x) => x.sold === "2")!;
    assert.ok(c); assert.equal(c.inStock, "7"); assert.equal(c.elsewhere, "1");
  });

  await step("write-offs and hold releases wait until the cost is added", async () => {
    await fails(() => postAdjustment(owner, { idempotencyKey: randomUUID(), reason: "DAMAGE", lines: [{ productId: cableId, mode: "REMOVE", qty: 1 }] }), /waiting for its cost/);
    await fails(() => postAdjustment(owner, { idempotencyKey: randomUUID(), reason: "DAMAGE", lines: [{ productId: cableId, mode: "REMOVE", qty: 1, costLayerId: cableLot }] }), /waiting for its cost/);
    const held = await db.costLayer.findFirstOrThrow({ where: { productId: cableId, bucket: "INSPECTION" } });
    await fails(() => postAdjustment(owner, { idempotencyKey: randomUUID(), reason: "RELEASE_HOLD", lines: [{ productId: cableId, mode: "RELEASE", qty: 1, costLayerId: held.id }] }), /waiting for its cost/);
  });

  await step("morning reminder goes out once while GRNs wait", async () => {
    await db.goodsReceipt.update({ where: { id: grnId }, data: { receivedAt: new Date(Date.now() - 24 * 3_600_000) } });
    assert.ok((await remindPendingCost()) >= 1);
    assert.equal(await remindPendingCost(), 0);
  });

  await step("owner adds cost: GRN posts and every sale, return and lot gets the cost", async () => {
    const g = await db.goodsReceipt.findUniqueOrThrow({ where: { id: grnId }, include: { lines: true } });
    const coverLine = g.lines.find((l) => l.productId === cover.id)!;
    const cableLine = g.lines.find((l) => l.productId === cableId)!;
    await fails(() => completeReceipt(owner, { receiptId: grnId, supplierId: supplier.id, lines: [{ lineId: cableLine.id, unitCost: 250 }] }), /every item/);
    await completeReceipt(owner, {
      receiptId: grnId, supplierId: supplier.id, supplierRef: `QR-${Date.now()}`,
      lines: [{ lineId: cableLine.id, unitCost: 250, categoryId: category.id }, { lineId: coverLine.id, unitCost: 400, newSellPrice: 2100 }],
      payment: { amount: 1000, method: "CASH", accountId: null },
    });
    const done = await db.goodsReceipt.findUniqueOrThrow({ where: { id: grnId } });
    assert.equal(done.status, "POSTED"); assert.equal(done.supplierId, supplier.id); assert.ok(done.costAddedAt);
    assert.ok(D(done.total).eq(10 * 250 + 5 * 400)); assert.ok(D(done.paid).eq(1000));
    assert.equal(await db.costLayer.count({ where: { productId: { in: [cableId, cover.id] }, costPending: true } }), 0);
    for (const l of await db.costLayer.findMany({ where: { productId: cableId } })) assert.ok(D(l.unitCost).eq(250), "every cable lot, held one too");
    assert.ok(D((await db.saleLine.findUniqueOrThrow({ where: { id: saleLineId } })).costTotal).eq(4 * 250));
    for (const a of await db.costAllocation.findMany({ where: { saleLineId } })) assert.ok(D(a.unitCost).eq(250));
    const rls = await db.saleReturnLine.findMany({ where: { saleLineId } });
    assert.equal(rls.length, 2);
    for (const rl of rls) assert.ok(D(rl.costValue).eq(250), "each returned cable carries its cost back");
    assert.equal(await db.stockMovement.count({ where: { productId: cableId, unitCost: 0 } }), 0);
    const cable = await db.product.findUniqueOrThrow({ where: { id: cableId } });
    assert.ok(D(cable.defaultCost).eq(250)); assert.equal(cable.categoryId, category.id);
    assert.ok(D((await db.product.findUniqueOrThrow({ where: { id: cover.id } })).sellPrice).eq(2100));
    assert.equal(await db.notification.count({ where: { kind: "GRN_COST_PENDING", url: `/purchases/${grnId}`, readAt: null } }), 0);
    await fails(() => completeReceipt(owner, { receiptId: grnId, supplierId: supplier.id, lines: [{ lineId: cableLine.id, unitCost: 1 }, { lineId: coverLine.id, unitCost: 1 }] }), /already has its cost/);
  });

  await step("after the cost is in, the stock can be written off as normal", async () => {
    await postAdjustment(owner, { idempotencyKey: randomUUID(), reason: "DAMAGE", lines: [{ productId: cableId, mode: "REMOVE", qty: 1, costLayerId: cableLot }] });
  });

  console.log("\nAll quick-receive checks passed.");
}

main().then(() => db.$disconnect()).catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
