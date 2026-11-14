import "server-only";
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { imeiProblem } from "./imei";
import { db, posting, type Tx } from "./db";
import { D, ZERO } from "./money";
import { nextNumber } from "./numbering";
import { allocateFifo, deriveLayer, takeFromLayer } from "./stock";
import { seal, unseal } from "./vault";
import { can } from "./permissions";
import { enqueueSms, kickSms } from "./sms";
import type { CurrentUser } from "./auth";
import { requireDrawer } from "./register";

export class RepairError extends Error {}

export const REPAIR_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "err" | "muted"; next: string[] }> = {
  RECEIVED: { label: "Received", tone: "warn", next: ["DIAGNOSIS", "AWAITING_APPROVAL", "AWAITING_PARTS", "IN_PROGRESS", "CANCELLED"] },
  DIAGNOSIS: { label: "Diagnosis", tone: "warn", next: ["AWAITING_APPROVAL", "AWAITING_PARTS", "IN_PROGRESS", "CANCELLED"] },
  AWAITING_APPROVAL: { label: "Awaiting customer approval", tone: "warn", next: ["IN_PROGRESS", "AWAITING_PARTS", "CANCELLED"] },
  AWAITING_PARTS: { label: "Awaiting parts", tone: "warn", next: ["IN_PROGRESS", "CANCELLED"] },
  IN_PROGRESS: { label: "In progress", tone: "warn", next: ["TESTING", "READY", "AWAITING_PARTS"] },
  TESTING: { label: "Testing", tone: "warn", next: ["READY", "IN_PROGRESS"] },
  READY: { label: "Ready to collect", tone: "ok", next: ["COLLECTED", "IN_PROGRESS"] },
  COLLECTED: { label: "Collected", tone: "muted", next: [] },
  CANCELLED: { label: "Cancelled", tone: "muted", next: [] },
};
const OPEN = ["RECEIVED", "DIAGNOSIS", "AWAITING_APPROVAL", "AWAITING_PARTS", "IN_PROGRESS", "TESTING", "READY"];
export const isOpen = (s: string) => OPEN.includes(s);

const deviceName = (j: { deviceBrand: string | null; deviceModel: string }) => [j.deviceBrand, j.deviceModel].filter(Boolean).join(" ");
const due = (j: { total: Prisma.Decimal.Value; paid: Prisma.Decimal.Value }) => D(j.total).minus(D(j.paid));

async function event(tx: Tx, jobId: string, actorId: string, kind: string, extra: { fromStatus?: string; toStatus?: string; note?: string } = {}) {
  await tx.repairEvent.create({ data: { jobId, actorId, kind, ...extra } });
}

async function lockJob(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "RepairJob" WHERE id = ${id} FOR UPDATE`;
  return tx.repairJob.findUniqueOrThrow({ where: { id }, include: { parts: true, customer: true } });
}

// Total = labour + other + parts actually used (issued − returned) × price − discount.
async function recompute(tx: Tx, jobId: string) {
  const job = await tx.repairJob.findUniqueOrThrow({ where: { id: jobId }, include: { parts: true } });
  const parts = job.parts.reduce((a, p) => a.plus(D(p.qtyIssued).minus(p.qtyReturned).mul(p.unitPrice)), ZERO);
  const total = Prisma.Decimal.max(D(job.labourCharge).plus(job.otherCharge).plus(parts).minus(job.discount), ZERO).toDecimalPlaces(2);
  await tx.repairJob.update({ where: { id: jobId }, data: { total } });
  return total;
}

async function cashRegister(tx: Tx, user: CurrentUser, locationId: string) {
  return requireDrawer(tx, locationId, "Open the cash register to take cash.");
}

async function recordPayment(tx: Tx, user: CurrentUser, job: { id: string; customerId: string; locationId: string; number: string }, raw: { amount: number; method: string; accountId?: string | null; reference?: string | null }) {
  const amount = D(raw.amount).toDecimalPlaces(2);
  if (amount.lte(0)) return ZERO;
  let accountId = raw.accountId ?? null;
  const registerId = raw.method === "CASH" ? await cashRegister(tx, user, job.locationId) : null;
  if (!accountId) {
    const type = raw.method === "CASH" ? "CASH" : raw.method === "CARD" ? "CARD" : "BANK";
    accountId = (await tx.account.findFirst({ where: { active: true, type, OR: [{ locationId: job.locationId }, { locationId: null }] }, orderBy: { createdAt: "asc" } }))?.id ?? null;
  }
  await tx.payment.create({
    data: {
      number: await nextNumber(tx, "PAYMENT_IN"), direction: "IN", method: raw.method, amount, accountId, registerId,
      contactId: job.customerId, repairJobId: job.id, reference: raw.reference ?? null, createdById: user.personId,
    },
  });
  await tx.repairJob.update({ where: { id: job.id }, data: { paid: { increment: amount } } });
  await event(tx, job.id, user.personId, "PAYMENT", { note: `${raw.method.toLowerCase().replace("_", " ")} ${amount.toFixed(2)}` });
  return amount;
}

// ───────────── Intake ─────────────

export const intakeInput = z.object({
  idempotencyKey: z.string().min(8).max(80),
  customerId: z.string().min(1, "Choose or add the customer."),
  serviceType: z.enum(["CARRY_IN", "PICKUP", "ON_SITE"]).default("CARRY_IN"),
  deviceBrand: z.string().max(60).nullable().default(null),
  deviceModel: z.string().min(1, "Device model is required.").max(100),
  // A customer's phone: a 15-digit IMEI is checked for typos, anything else is kept as written.
  imei: z.string().max(20).nullable().default(null).superRefine((v, c) => { if (v && /^\d{15}$/.test(v.trim())) { const m = imeiProblem(v); if (m) c.addIssue({ code: "custom", message: m }); } }),
  serial: z.string().max(60).nullable().default(null),
  color: z.string().max(30).nullable().default(null),
  simCount: z.coerce.number().int().min(0).max(4).default(0),
  memoryCard: z.boolean().default(false),
  accessories: z.string().max(300).nullable().default(null),
  condition: z.string().max(500).nullable().default(null),
  problem: z.string().min(1, "Describe the problem.").max(1000),
  credentialType: z.enum(["NONE", "PIN", "PATTERN", "PASSWORD"]).default("NONE"),
  credential: z.string().max(100).nullable().default(null),
  technicianId: z.string().nullable().default(null),
  estimate: z.coerce.number().min(0).nullable().default(null),
  promisedAt: z.coerce.date().nullable().default(null),
  deposit: z.object({ amount: z.coerce.number().positive(), method: z.enum(["CASH", "CARD", "BANK_TRANSFER", "OTHER"]), accountId: z.string().nullable().default(null), reference: z.string().nullable().default(null) }).nullable().default(null),
  notifyCustomer: z.boolean().default(true),
  // Customer agreement at the counter: ticked terms and (optionally) a signature drawn on the screen.
  termsAccepted: z.boolean().default(false),
  signature: z.string().max(80_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "Signature could not be read.").nullable().default(null),
  // Warranty claim on something this shop sold (from Warranty lookup).
  claimSaleLineId: z.string().nullable().default(null),
  claimDeviceId: z.string().nullable().default(null),
});

// Repair settings: terms printed on the job sheet and the technician's share of labour.
export const repairSettingsSchema = z.object({
  terms: z.string().max(3000).default(
    "1. The shop is not responsible for data on the device; back it up first.\n2. Devices not collected within 90 days of the ready notice may be disposed of to recover costs.\n3. The estimate may change after diagnosis; no extra work is done without your approval.\n4. Warranty on a repair covers only the part replaced and the work done.\n5. Liquid-damaged and previously repaired devices are accepted at the owner's risk.",
  ),
  commissionPct: z.coerce.number().min(0).max(100).default(0),
});
export type RepairSettings = z.infer<typeof repairSettingsSchema>;
export async function getRepairSettings(client: Pick<Tx, "appSetting"> = db): Promise<RepairSettings> {
  const row = await client.appSetting.findUnique({ where: { key: "repairs" } });
  const parsed = repairSettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : repairSettingsSchema.parse({});
}

export async function createRepair(user: CurrentUser, raw: unknown) {
  const input = intakeInput.parse(raw);
  const location = user.location;
  if (!location) throw new RepairError("No business location is assigned to your login.");
  if (input.credentialType !== "NONE" && !input.credential) throw new RepairError("Enter the PIN / pattern, or choose “None”.");
  const cipher = input.credentialType !== "NONE" && input.credential ? seal(JSON.stringify({ type: input.credentialType, value: input.credential })) : null;

  const job = await posting(async (tx) => {
    const existing = await tx.repairJob.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;
    const number = await nextNumber(tx, "REPAIR");
    const settings = await getRepairSettings(tx);
    // A warranty claim must point at a real sale line of this customer; the warranty date decides the flag.
    let claim: { saleLineId: string; deviceId: string | null; inWarranty: boolean } | null = null;
    if (input.claimSaleLineId) {
      const line = await tx.saleLine.findUnique({ where: { id: input.claimSaleLineId }, include: { sale: true, devices: true } });
      if (!line) throw new RepairError("The original sale for this warranty claim was not found.");
      const device = input.claimDeviceId ? line.devices.find((d) => d.id === input.claimDeviceId) ?? null : null;
      const until = device?.warrantyUntil ?? line.warrantyUntil;
      claim = { saleLineId: line.id, deviceId: device?.id ?? null, inWarranty: !!until && until.getTime() >= Date.now() };
    }
    const job = await tx.repairJob.create({
      data: {
        trackToken: randomBytes(18).toString("base64url"),
        termsText: input.termsAccepted ? settings.terms : null, termsAcceptedAt: input.termsAccepted ? new Date() : null, signature: input.termsAccepted ? input.signature : null,
        warrantyClaim: claim?.inWarranty ?? false, originSaleLineId: claim?.saleLineId ?? null, originDeviceId: claim?.deviceId ?? null,
        number, locationId: location.id, customerId: input.customerId, serviceType: input.serviceType,
        deviceBrand: input.deviceBrand, deviceModel: input.deviceModel, imei: input.imei, serial: input.serial, color: input.color,
        simCount: input.simCount, memoryCard: input.memoryCard, accessories: input.accessories, condition: input.condition, problem: input.problem,
        credentialCipher: cipher, credentialType: cipher ? input.credentialType : null,
        technicianId: input.technicianId, estimate: input.estimate, promisedAt: input.promisedAt,
        idempotencyKey: input.idempotencyKey, createdById: user.personId,
      },
    });
    await event(tx, job.id, user.personId, "STATUS", { toStatus: "RECEIVED", note: input.problem.slice(0, 200) });
    if (input.deposit) await recordPayment(tx, user, job, input.deposit);
    await tx.auditEvent.create({ data: { actorId: user.personId, action: "REPAIR_RECEIVED", subjectType: "RepairJob", subjectId: job.id, detail: { number } } });
    return job;
  });

  if (input.notifyCustomer) {
    const c = await db.contact.findUnique({ where: { id: job.customerId } });
    const promised = job.promisedAt ? job.promisedAt.toLocaleDateString("en-GB", { timeZone: "Asia/Colombo", day: "2-digit", month: "short" }) : "we will call you";
    if (await enqueueSms("REPAIR_RECEIVED", { to: c?.phone, vars: { job: job.number, device: deviceName(job), promised }, sourceType: "RepairJob", sourceId: job.id })) kickSms();
  }
  return { id: job.id, number: job.number };
}

// ───────────── Workflow ─────────────

export async function changeStatus(user: CurrentUser, jobId: string, to: string, note: string | null) {
  const result = await posting(async (tx) => {
    const job = await lockJob(tx, jobId);
    const allowed = REPAIR_STATUS[job.status]?.next ?? [];
    if (!allowed.includes(to)) throw new RepairError(`A job that is “${REPAIR_STATUS[job.status]?.label}” cannot move to “${REPAIR_STATUS[to]?.label ?? to}”.`);
    if (to === "COLLECTED" && due(job).gt(0) && !can(user, "sales.credit_override"))
      throw new RepairError(`Rs. ${due(job).toFixed(2)} is still due. Take payment before handing over.`);
    if (to === "CANCELLED" && job.parts.some((p) => D(p.qtyIssued).gt(p.qtyReturned)))
      throw new RepairError("Return the issued parts to stock before cancelling the job.");
    const data: Prisma.RepairJobUpdateInput = { status: to };
    if (to === "READY") data.readyAt = new Date();
    if (to === "COLLECTED") {
      data.collectedAt = new Date();
      // Handover policy: the unlock credential is no longer needed and is deleted (history stays).
      if (job.credentialCipher) { data.credentialCipher = null; data.credentialPurgedAt = new Date(); }
    }
    await tx.repairJob.update({ where: { id: jobId }, data });
    await event(tx, jobId, user.personId, "STATUS", { fromStatus: job.status, toStatus: to, note: note ?? undefined });
    // Technician commission: a share of the labour charged, earned once, when the customer collects. It then goes
    // through the same approval and payout as sales commission. Free warranty work (no labour) earns nothing.
    if (to === "COLLECTED" && job.technicianId) {
      const { commissionPct } = await getRepairSettings(tx);
      const labour = Prisma.Decimal.max(D(job.labourCharge).minus(job.discount), 0);
      const amount = labour.mul(commissionPct).div(100).toDecimalPlaces(4);
      const already = await tx.commissionAccrual.count({ where: { repairJobId: jobId } });
      if (amount.gt(0) && !already)
        await tx.commissionAccrual.create({ data: { repairJobId: jobId, recipientId: job.technicianId, role: "TECHNICIAN", basis: labour.toDecimalPlaces(2), amount } });
    }
    if (to === "COLLECTED" && job.credentialCipher) await event(tx, jobId, user.personId, "CREDENTIAL_PURGED", { note: "Deleted at handover" });
    return job;
  });
  if (to === "READY") {
    const d = due(result);
    if (await enqueueSms("REPAIR_READY", { to: result.customer.phone, vars: { job: result.number, device: deviceName(result), due: d.gt(0) ? ` Balance Rs.${d.toFixed(2)}.` : "" }, sourceType: "RepairJob", sourceId: jobId, key: new Date().toISOString().slice(0, 13) })) kickSms();
  }
}

export async function setDiagnosis(user: CurrentUser, jobId: string, raw: { diagnosis: string | null; estimate: number | null; technicianId: string | null; promisedAt: Date | null; askApproval: boolean }) {
  const job = await posting(async (tx) => {
    const job = await lockJob(tx, jobId);
    if (!isOpen(job.status)) throw new RepairError("This job is closed.");
    const toApproval = raw.askApproval && raw.estimate != null && REPAIR_STATUS[job.status].next.includes("AWAITING_APPROVAL");
    await tx.repairJob.update({
      where: { id: jobId },
      data: { diagnosis: raw.diagnosis, estimate: raw.estimate, technicianId: raw.technicianId, promisedAt: raw.promisedAt, ...(toApproval ? { status: "AWAITING_APPROVAL" } : {}) },
    });
    await event(tx, jobId, user.personId, "ESTIMATE", { note: `${raw.estimate != null ? `Estimate ${D(raw.estimate).toFixed(2)}. ` : ""}${raw.diagnosis ?? ""}`.slice(0, 300), ...(toApproval ? { fromStatus: job.status, toStatus: "AWAITING_APPROVAL" } : {}) });
    return { ...job, toApproval };
  });
  if (job.toApproval && raw.estimate != null) {
    if (await enqueueSms("REPAIR_ESTIMATE", { to: job.customer.phone, vars: { job: job.number, device: deviceName(job), estimate: D(raw.estimate).toFixed(2) }, sourceType: "RepairJob", sourceId: jobId, key: D(raw.estimate).toFixed(2) })) kickSms();
  }
}

export async function approveEstimate(user: CurrentUser, jobId: string, how: string) {
  await posting(async (tx) => {
    const job = await lockJob(tx, jobId);
    if (job.status !== "AWAITING_APPROVAL") throw new RepairError("This job is not waiting for approval.");
    await tx.repairJob.update({ where: { id: jobId }, data: { estimateApprovedAt: new Date(), status: "IN_PROGRESS" } });
    await event(tx, jobId, user.personId, "APPROVAL", { fromStatus: job.status, toStatus: "IN_PROGRESS", note: `Customer approved (${how})` });
  });
}

export async function setCharges(user: CurrentUser, jobId: string, raw: { labour: number; other: number; discount: number; externalCost: number; warrantyDays: number | null }) {
  await posting(async (tx) => {
    const job = await lockJob(tx, jobId);
    if (!isOpen(job.status)) throw new RepairError("This job is closed.");
    for (const v of [raw.labour, raw.other, raw.discount, raw.externalCost]) if (!(v >= 0)) throw new RepairError("Charges cannot be negative.");
    await tx.repairJob.update({ where: { id: jobId }, data: { labourCharge: raw.labour, otherCharge: raw.other, discount: raw.discount, externalCost: raw.externalCost, warrantyDays: raw.warrantyDays } });
    const total = await recompute(tx, jobId);
    await event(tx, jobId, user.personId, "CHARGES", { note: `Labour ${raw.labour}, other ${raw.other}, discount ${raw.discount} → total ${total.toFixed(2)}` });
  });
}

export async function takeRepairPayment(user: CurrentUser, jobId: string, raw: { amount: number; method: string; accountId: string | null; reference: string | null }) {
  await posting(async (tx) => {
    const job = await lockJob(tx, jobId);
    if (job.status === "CANCELLED") throw new RepairError("This job is cancelled.");
    await recordPayment(tx, user, job, raw);
  });
}

// ───────────── Parts (issued once, returnable) ─────────────

type Alloc = { layerId: string; qty: string; unitCost: string; returnedQty: string };

export async function issuePart(user: CurrentUser, jobId: string, raw: { productId: string; qty: number; unitPrice: number; layerId: string | null }) {
  await posting(async (tx) => {
    const job = await lockJob(tx, jobId);
    if (!isOpen(job.status)) throw new RepairError("This job is closed.");
    const product = await tx.product.findUniqueOrThrow({ where: { id: raw.productId } });
    if (product.trackDevices) throw new RepairError("IMEI-tracked products cannot be issued as repair parts.");
    const qty = D(raw.qty);
    if (qty.lte(0)) throw new RepairError("Quantity must be more than zero.");
    let picks: { layerId: string; qty: Prisma.Decimal; unitCost: Prisma.Decimal }[] = [];
    if (product.stockManaged) {
      if (raw.layerId) {
        const l = await takeFromLayer(tx, raw.layerId, qty);
        if (l.productId !== product.id || l.locationId !== job.locationId) throw new RepairError("That lot is not this part at this location.");
        picks = [{ layerId: l.id, qty, unitCost: l.unitCost }];
      } else picks = await allocateFifo(tx, product.id, job.locationId, qty, product.name);
      for (const p of picks) {
        await tx.stockMovement.create({
          data: { productId: product.id, locationId: job.locationId, costLayerId: p.layerId, qty: p.qty.neg(), unitCost: p.unitCost, kind: "REPAIR_ISSUE", sourceType: "RepairJob", sourceId: job.id, reference: job.number, actorId: user.personId },
        });
      }
    }
    const costTotal = picks.reduce((a, p) => a.plus(p.qty.mul(p.unitCost)), ZERO);
    await tx.repairPart.create({
      data: {
        jobId, productId: product.id, qtyIssued: qty, unitPrice: D(raw.unitPrice).toDecimalPlaces(2), costTotal,
        allocations: picks.map((p) => ({ layerId: p.layerId, qty: p.qty.toString(), unitCost: p.unitCost.toString(), returnedQty: "0" })),
      },
    });
    await recompute(tx, jobId);
    await event(tx, jobId, user.personId, "PART_ISSUED", { note: `${product.name} × ${qty.toString()}` });
  });
}

export async function returnPart(user: CurrentUser, partId: string, qtyRaw: number) {
  await posting(async (tx) => {
    const part = await tx.repairPart.findUniqueOrThrow({ where: { id: partId }, include: { product: true } });
    const job = await lockJob(tx, part.jobId);
    if (!isOpen(job.status) && job.status !== "CANCELLED") throw new RepairError("This job is closed.");
    const qty = D(qtyRaw);
    const open = D(part.qtyIssued).minus(part.qtyReturned);
    if (qty.lte(0) || qty.gt(open)) throw new RepairError(`Only ${open.toString()} can be returned.`);
    const allocs = part.allocations as Alloc[];
    let need = qty;
    let costBack = ZERO;
    // Unused parts go back into the lots they came from (latest first), at their original cost.
    for (const a of [...allocs].reverse()) {
      if (need.lte(0)) break;
      const left = D(a.qty).minus(a.returnedQty);
      if (left.lte(0)) continue;
      const take = Prisma.Decimal.min(left, need);
      const layer = await tx.costLayer.findUniqueOrThrow({ where: { id: a.layerId } });
      let target = layer.id;
      if (layer.bucket === "SALEABLE" && layer.locationId === job.locationId) await tx.costLayer.update({ where: { id: layer.id }, data: { qtyRemaining: { increment: take } } });
      else target = (await deriveLayer(tx, layer, { locationId: job.locationId, qty: take, bucket: "SALEABLE", sourceType: "RepairJob", sourceId: job.id })).id;
      await tx.stockMovement.create({
        data: { productId: part.productId, locationId: job.locationId, costLayerId: target, qty: take, unitCost: D(a.unitCost), kind: "REPAIR_RETURN", sourceType: "RepairJob", sourceId: job.id, reference: job.number, actorId: user.personId },
      });
      a.returnedQty = D(a.returnedQty).plus(take).toString();
      costBack = costBack.plus(take.mul(a.unitCost));
      need = need.minus(take);
    }
    await tx.repairPart.update({ where: { id: partId }, data: { qtyReturned: { increment: qty }, costTotal: { decrement: costBack }, allocations: allocs } });
    await recompute(tx, job.id);
    await event(tx, job.id, user.personId, "PART_RETURNED", { note: `${part.product.name} × ${qty.toString()} back to stock` });
  });
}

// ───────────── Credentials (restricted, audited) ─────────────

export async function revealCredential(user: CurrentUser, jobId: string) {
  if (!can(user, "repairs.credentials")) throw new RepairError("You are not allowed to see unlock codes.");
  const job = await db.repairJob.findUniqueOrThrow({ where: { id: jobId } });
  if (!job.credentialCipher) throw new RepairError(job.credentialPurgedAt ? "The code was deleted at handover." : "No code was recorded.");
  await db.$transaction([
    db.repairEvent.create({ data: { jobId, actorId: user.personId, kind: "CREDENTIAL_VIEWED" } }),
    db.auditEvent.create({ data: { actorId: user.personId, action: "REPAIR_CREDENTIAL_VIEWED", subjectType: "RepairJob", subjectId: jobId } }),
  ]);
  return JSON.parse(unseal(job.credentialCipher)) as { type: string; value: string };
}

export async function purgeCredential(user: CurrentUser, jobId: string) {
  await db.$transaction([
    db.repairJob.update({ where: { id: jobId }, data: { credentialCipher: null, credentialPurgedAt: new Date() } }),
    db.repairEvent.create({ data: { jobId, actorId: user.personId, kind: "CREDENTIAL_PURGED", note: "Deleted manually" } }),
  ]);
}
