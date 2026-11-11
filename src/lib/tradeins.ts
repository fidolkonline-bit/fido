import "server-only";
import { z } from "zod";
import { posting } from "./db";
import { D } from "./money";
import { nextNumber } from "./numbering";
import { imeiProblem } from "./imei";
import { lockImeis } from "./stock";
import type { CurrentUser } from "./auth";

export class TradeInError extends Error {}

const imei = (label: string) => z.string().trim().nullable().default(null).superRefine((v, c) => { const m = imeiProblem(v, label); if (m) c.addIssue({ code: "custom", message: m }); });

export const tradeInInput = z.object({
  idempotencyKey: z.string().min(8).max(80),
  customerId: z.string().min(1, "Choose or add the seller as a customer."),
  sellerIdType: z.enum(["NIC", "PASSPORT", "DRIVING_LICENCE"]).default("NIC"),
  sellerIdNumber: z.string().trim().min(5, "Enter the seller's ID number.").max(30),
  sellerAddress: z.string().trim().max(300).nullable().default(null),
  productId: z.string().min(1, "Choose the product this phone goes into stock as."),
  imei1: imei("IMEI"),
  imei2: imei("IMEI 2"),
  serial: z.string().trim().max(60).nullable().default(null),
  grade: z.enum(["A", "B", "C", "D"]).default("B"),
  batteryHealth: z.coerce.number().int().min(0).max(100).nullable().default(null),
  conditionNotes: z.string().trim().max(500).nullable().default(null),
  accessories: z.string().trim().max(300).nullable().default(null),
  ownershipDeclared: z.boolean(),
  accountsRemoved: z.boolean(),
  value: z.coerce.number().positive("Enter the agreed value."),
  settlement: z.enum(["CASH", "BANK_TRANSFER", "STORE_CREDIT"]),
  accountId: z.string().nullable().default(null),
  reference: z.string().trim().max(80).nullable().default(null),
  readyToSell: z.boolean().default(false),
});

// One posting: the device enters stock at the agreed value (own lot, own cost), the seller is paid or credited.
// By default the phone is held for checking (bucket INSPECTION) and released with a stock adjustment.
export async function createTradeIn(user: CurrentUser, raw: unknown) {
  const input = tradeInInput.parse(raw);
  const location = user.location;
  if (!location) throw new TradeInError("No business location is assigned to your login.");
  if (!input.imei1 && !input.serial) throw new TradeInError("Enter the phone's IMEI or serial number.");
  if (!input.ownershipDeclared) throw new TradeInError("The seller must confirm the phone is theirs to sell.");

  return posting(async (tx) => {
    const existing = await tx.tradeIn.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, number: true } });
    if (existing) return existing;

    const product = await tx.product.findUnique({ where: { id: input.productId } });
    if (!product || !product.active) throw new TradeInError("That product is not available.");
    if (!product.trackDevices || !product.stockManaged) throw new TradeInError(`${product.name} is not IMEI-tracked. Choose (or create) a used-phone product with IMEI tracking on.`);

    const imeis = [input.imei1, input.imei2].filter((x): x is string => !!x);
    if (new Set(imeis).size !== imeis.length) throw new TradeInError("IMEI 1 and IMEI 2 are the same.");
    if (imeis.length) {
      await lockImeis(tx, imeis);
      const clash = await tx.deviceIdentity.findFirst({ where: { OR: [{ imei1: { in: imeis } }, { imei2: { in: imeis } }], state: { notIn: ["SOLD", "WRITTEN_OFF"] } } });
      if (clash) throw new TradeInError("This IMEI is already in stock. Check the phone before buying it.");
    }
    // A phone this shop sold before comes back with its history.
    const soldBefore = imeis.length ? await tx.deviceIdentity.findFirst({ where: { imei1: { in: imeis }, state: "SOLD" }, orderBy: { createdAt: "desc" }, select: { id: true } }) : null;

    const value = D(input.value).toDecimalPlaces(2);
    const number = await nextNumber(tx, "TRADE_IN");
    const now = new Date();
    const bucket = input.readyToSell ? "SALEABLE" : "INSPECTION";

    const trade = await tx.tradeIn.create({
      data: {
        number, locationId: location.id, customerId: input.customerId, sellerIdType: input.sellerIdType, sellerIdNumber: input.sellerIdNumber,
        sellerAddress: input.sellerAddress, productId: product.id, imei1: input.imei1, imei2: input.imei2, serial: input.serial, grade: input.grade,
        batteryHealth: input.batteryHealth, conditionNotes: input.conditionNotes, accessories: input.accessories,
        ownershipDeclared: input.ownershipDeclared, accountsRemoved: input.accountsRemoved, value, settlement: input.settlement,
        readyToSell: input.readyToSell, idempotencyKey: input.idempotencyKey, createdById: user.personId,
      },
    });
    const layer = await tx.costLayer.create({
      data: {
        productId: product.id, locationId: location.id, lotCode: `TRADE-${number}`, qtyIn: 1, qtyRemaining: 1, unitCost: value, bucket,
        sourceType: "TradeIn", sourceId: trade.id, receivedAt: now,
      },
    });
    await tx.stockMovement.create({
      data: { productId: product.id, locationId: location.id, costLayerId: layer.id, qty: 1, unitCost: value, kind: "TRADE_IN", sourceType: "TradeIn", sourceId: trade.id, reference: number, actorId: user.personId },
    });
    const device = await tx.deviceIdentity.create({
      data: {
        productId: product.id, costLayerId: layer.id, locationId: location.id, imei1: input.imei1, imei2: input.imei2, serial: input.serial,
        condition: `USED-${input.grade}`, state: input.readyToSell ? "SALEABLE" : "HELD",
      },
    });
    await tx.tradeIn.update({ where: { id: trade.id }, data: { deviceId: device.id, costLayerId: layer.id } });

    if (input.settlement === "STORE_CREDIT") {
      await tx.storeCreditEntry.create({ data: { contactId: input.customerId, amount: value, sourceType: "TradeIn", sourceId: trade.id, reference: number } });
    } else {
      let accountId = input.accountId;
      let registerId: string | null = null;
      if (input.settlement === "CASH") {
        // Cash leaves this cashier's drawer, so the register must be open and its expected cash drops.
        const reg = await tx.registerSession.findFirst({ where: { locationId: location.id, userId: user.personId, closedAt: null } });
        if (!reg) throw new TradeInError("Open your cash register before paying cash for a trade-in.");
        registerId = reg.id;
        if (!accountId) accountId = (await tx.account.findFirst({ where: { type: "CASH", active: true, OR: [{ locationId: location.id }, { locationId: null }] }, orderBy: { createdAt: "asc" } }))?.id ?? null;
      }
      if (!accountId) throw new TradeInError("Choose the account the money is paid from.");
      await tx.payment.create({
        data: {
          number: await nextNumber(tx, "PAYMENT_OUT"), direction: "OUT", method: input.settlement, amount: value, accountId, contactId: input.customerId,
          tradeInId: trade.id, registerId, reference: input.reference ?? number, createdById: user.personId,
        },
      });
    }

    await tx.auditEvent.create({
      data: { actorId: user.personId, action: "TRADE_IN_POSTED", subjectType: "TradeIn", subjectId: trade.id, detail: { number, value: value.toString(), settlement: input.settlement, imei: input.imei1, soldBefore: !!soldBefore } },
    });
    return { id: trade.id, number };
  });
}
