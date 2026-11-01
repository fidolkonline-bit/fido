import "server-only";
import { z } from "zod";
import { db, posting } from "./db";
import { D } from "./money";
import { nextNumber } from "./numbering";
import { createTask, completeTask } from "./tasks";
import { enqueueSms, kickSms, normalizeMobile } from "./sms";
import type { CurrentUser } from "./auth";

export class ReloadError extends Error {}

export const NETWORKS = ["DIALOG", "MOBITEL", "HUTCH", "AIRTEL"] as const;

export async function walletBalance(walletId: string) {
  const a = await db.walletMovement.aggregate({ where: { walletId }, _sum: { nominal: true } });
  return D(a._sum.nominal);
}

// Funding: money paid buys nominal credit at the wallet's rate (observed Mobitel: 9,600 → 10,000).
export async function fundWallet(user: CurrentUser, raw: unknown) {
  const input = z.object({
    walletId: z.string(), money: z.coerce.number().positive(), nominal: z.coerce.number().positive().nullable().default(null),
    method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"]), accountId: z.string().nullable().default(null), reference: z.string().max(80).nullable().default(null),
  }).parse(raw);
  return posting(async (tx) => {
    const w = await tx.reloadWallet.findUniqueOrThrow({ where: { id: input.walletId } });
    const money = D(input.money).toDecimalPlaces(2);
    const nominal = input.nominal ? D(input.nominal).toDecimalPlaces(2) : money.div(w.costRate).toDecimalPlaces(2);
    let accountId = input.accountId;
    let registerId: string | null = null;
    if (input.method === "CASH") {
      const loc = w.locationId ?? user.location?.id;
      registerId = (await tx.registerSession.findFirst({ where: { locationId: loc, userId: user.personId, closedAt: null } }))?.id ?? null;
      accountId ??= (await tx.account.findFirst({ where: { type: "CASH", active: true, locationId: loc } }))?.id ?? null;
    }
    if (!accountId) throw new ReloadError("Choose the account the funding was paid from.");
    await tx.payment.create({
      data: { number: await nextNumber(tx, "PAYMENT_OUT"), direction: "OUT", method: input.method, amount: money, accountId, registerId, walletId: w.id, reference: input.reference, createdById: user.personId },
    });
    await tx.walletMovement.create({ data: { walletId: w.id, kind: "FUNDING", nominal, money, reference: input.reference, createdById: user.personId } });
    return { nominal: nominal.toFixed(2) };
  });
}

export const requestInput = z.object({
  idempotencyKey: z.string().min(8).max(80),
  walletId: z.string().min(1, "Choose the wallet / channel."),
  network: z.enum(NETWORKS),
  mobile: z.string().min(9),
  amount: z.coerce.number().positive().max(100000),
  customerId: z.string().nullable().default(null),
  collection: z.enum(["SHOP", "OWNER", "CREDIT"]).default("SHOP"),
  notes: z.string().max(300).nullable().default(null),
  locationId: z.string().nullable().default(null),
  assignedToId: z.string().nullable().default(null),
  // Counter reload: the staff member already did it on the provider device and records the result now.
  doneNow: z.object({ result: z.enum(["SUCCESSFUL", "FAILED", "UNCERTAIN"]), providerRef: z.string().max(80).nullable().default(null) }).nullable().default(null),
});

export async function createReload(user: CurrentUser, raw: unknown) {
  const input = requestInput.parse(raw);
  const mobile = normalizeMobile(input.mobile);
  if (!mobile) throw new ReloadError("Enter a valid Sri Lankan mobile number (07XXXXXXXX).");
  if (input.collection === "CREDIT" && !input.customerId) throw new ReloadError("Choose the customer who will owe for this reload.");
  const locationId = input.locationId ?? user.location?.id;
  if (!locationId) throw new ReloadError("Choose the shop that should do this reload.");

  const r = await posting(async (tx) => {
    const existing = await tx.reloadRequest.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;
    // Never top up a number again while an earlier reload to it has an unknown result (§10, AC-19).
    const pending = await tx.reloadRequest.findFirst({ where: { mobile: "0" + mobile.slice(2), status: "UNCERTAIN" } });
    if (pending) throw new ReloadError(`Reload ${pending.number} to this number has an uncertain result. Check the provider and record it first.`);
    const number = await nextNumber(tx, "RELOAD");
    const req = await tx.reloadRequest.create({
      data: {
        number, walletId: input.walletId, network: input.network, mobile: "0" + mobile.slice(2), amount: D(input.amount).toDecimalPlaces(2),
        customerId: input.customerId, collection: input.collection, notes: input.notes, locationId, assignedToId: input.doneNow ? user.personId : input.assignedToId,
        status: input.doneNow ? "PROCESSING" : "REQUESTED", claimedAt: input.doneNow ? new Date() : null,
        idempotencyKey: input.idempotencyKey, requestedById: user.personId,
      },
    });
    if (!input.doneNow) {
      await createTask(tx, {
        kind: "RELOAD", title: `Reload Rs.${D(input.amount).toFixed(0)} · ${input.network.toLowerCase()} · ${req.mobile}`, details: input.notes,
        locationId, assignedToId: input.assignedToId, priority: "URGENT", reloadRequestId: req.id, createdById: user.personId,
      });
    }
    return req;
  });
  if (input.doneNow) await recordOutcome(user, r.id, { result: input.doneNow.result, providerRef: input.doneNow.providerRef, note: null });
  return { id: r.id, number: r.number };
}

// Staff claims the request so two people never reload the same number twice.
export async function claimReload(user: CurrentUser, id: string) {
  await posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ReloadRequest" WHERE id = ${id} FOR UPDATE`;
    const r = await tx.reloadRequest.findUniqueOrThrow({ where: { id } });
    if (r.status === "PROCESSING" && r.assignedToId === user.personId) return;
    if (!["REQUESTED", "ACKNOWLEDGED"].includes(r.status)) throw new ReloadError(`This reload is already ${r.status.toLowerCase()}.`);
    await tx.reloadRequest.update({ where: { id }, data: { status: "PROCESSING", claimedAt: new Date(), acknowledgedAt: r.acknowledgedAt ?? new Date(), assignedToId: user.personId } });
    for (const t of await tx.staffTask.findMany({ where: { reloadRequestId: id, status: "PENDING" } })) {
      await tx.staffTask.update({ where: { id: t.id }, data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), assignedToId: user.personId } });
      await tx.taskEvent.create({ data: { taskId: t.id, kind: "CLAIMED", actorId: user.personId } });
    }
  });
}

// One confirmed success = one sale + one wallet deduction. Failed posts nothing. Uncertain waits for reconciliation (§10).
export async function recordOutcome(user: CurrentUser, id: string, raw: { result: "SUCCESSFUL" | "FAILED" | "UNCERTAIN"; providerRef: string | null; note: string | null }) {
  const out = await posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ReloadRequest" WHERE id = ${id} FOR UPDATE`;
    const r = await tx.reloadRequest.findUniqueOrThrow({ where: { id }, include: { wallet: true } });
    if (!["PROCESSING", "UNCERTAIN"].includes(r.status)) throw new ReloadError(r.status === "SUCCESSFUL" ? "This reload is already recorded as successful." : "Claim the reload before recording its result.");
    if (r.assignedToId && r.assignedToId !== user.personId && !user.permissions.has("reloads.wallets")) throw new ReloadError("Another staff member is handling this reload.");

    if (raw.result !== "SUCCESSFUL") {
      await tx.reloadRequest.update({ where: { id }, data: { status: raw.result, providerRef: raw.providerRef, resultNote: raw.note, completedAt: raw.result === "FAILED" ? new Date() : null } });
      if (raw.result === "FAILED") for (const t of await tx.staffTask.findMany({ where: { reloadRequestId: id } })) await completeTask(tx, t.id, user.personId, "Reload failed");
      return { r, sale: null };
    }

    const bal = D((await tx.walletMovement.aggregate({ where: { walletId: r.walletId }, _sum: { nominal: true } }))._sum.nominal);
    if (bal.lt(r.amount)) throw new ReloadError(`${r.wallet.name} shows only Rs.${bal.toFixed(2)}. Record the wallet funding first, then confirm.`);
    const amount = D(r.amount);
    const cost = amount.mul(r.wallet.costRate).toDecimalPlaces(4);

    const product = await tx.product.upsert({ where: { sku: "RELOAD" }, update: {}, create: { sku: "RELOAD", name: "Mobile reload", stockManaged: false, notForSale: true } });
    let registerId: string | null = null;
    if (r.collection === "SHOP") {
      const reg = await tx.registerSession.findFirst({ where: { locationId: r.locationId, userId: user.personId, closedAt: null } });
      if (!reg) throw new ReloadError("Open your cash register to take the reload cash.");
      registerId = reg.id;
    }
    const number = await nextNumber(tx, "SALE");
    const paid = r.collection === "CREDIT" ? D(0) : amount;
    const sale = await tx.sale.create({
      data: {
        number, locationId: r.locationId, customerId: r.customerId, subtotal: amount, total: amount, paid,
        paymentState: paid.gte(amount) ? "PAID" : "DUE", createdById: user.personId, registerId, notes: `Reload ${r.number}`,
        lines: { create: { productId: product.id, nameSnapshot: `Reload ${r.network.toLowerCase()} ${r.mobile}`, qty: 1, unitPrice: amount, lineTotal: amount, costTotal: cost } },
      },
    });
    if (r.collection !== "CREDIT") {
      const accountId = r.collection === "SHOP"
        ? (await tx.account.findFirst({ where: { type: "CASH", active: true, locationId: r.locationId } }))?.id ?? null
        : (await tx.account.findFirst({ where: { type: "OWNER_COLLECTION", active: true } }))?.id ?? null;
      // Owner-collected money goes to the owner's collection account, never the shop till (AC-20).
      await tx.payment.create({
        data: {
          number: await nextNumber(tx, "PAYMENT_IN"), direction: "IN", method: r.collection === "SHOP" ? "CASH" : "OTHER", amount, accountId, registerId,
          contactId: r.customerId, saleId: sale.id, reloadRequestId: r.id, reference: r.collection === "OWNER" ? "Collected by owner" : null, createdById: user.personId,
        },
      });
    }
    await tx.walletMovement.create({ data: { walletId: r.walletId, kind: "RELOAD", nominal: amount.neg(), reference: raw.providerRef ?? r.number, sourceType: "ReloadRequest", sourceId: r.id, createdById: user.personId } });
    await tx.reloadRequest.update({ where: { id }, data: { status: "SUCCESSFUL", providerRef: raw.providerRef, resultNote: raw.note, completedAt: new Date(), saleId: sale.id } });
    for (const t of await tx.staffTask.findMany({ where: { reloadRequestId: id } })) await completeTask(tx, t.id, user.personId, "Reload successful");
    await tx.auditEvent.create({ data: { actorId: user.personId, action: "RELOAD_CONFIRMED", subjectType: "ReloadRequest", subjectId: r.id, detail: { amount: amount.toString(), sale: number } } });
    return { r, sale };
  });
  if (out.sale && (await enqueueSms("RELOAD_DONE", { to: out.r.mobile, vars: { mobile: out.r.mobile, amount: D(out.r.amount).toFixed(2), ref: raw.providerRef ?? out.r.number }, sourceType: "ReloadRequest", sourceId: out.r.id }))) kickSms();
  return { status: raw.result, saleId: out.sale?.id ?? null };
}

export async function cancelReload(user: CurrentUser, id: string) {
  await posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ReloadRequest" WHERE id = ${id} FOR UPDATE`;
    const r = await tx.reloadRequest.findUniqueOrThrow({ where: { id } });
    if (!["REQUESTED", "ACKNOWLEDGED"].includes(r.status)) throw new ReloadError("Only a reload that nobody has started can be cancelled.");
    await tx.reloadRequest.update({ where: { id }, data: { status: "CANCELLED", completedAt: new Date() } });
    for (const t of await tx.staffTask.findMany({ where: { reloadRequestId: id } })) {
      await tx.staffTask.update({ where: { id: t.id }, data: { status: "CANCELLED" } });
      await tx.taskEvent.create({ data: { taskId: t.id, kind: "CANCELLED", actorId: user.personId } });
    }
  });
}
