import "server-only";
import { z } from "zod";
import { posting } from "./db";
import { D } from "./money";
import { nextNumber } from "./numbering";
import { createTask, completeTask } from "./tasks";
import type { CurrentUser } from "./auth";

export class ParcelError extends Error {}

export const parcelInput = z.object({
  idempotencyKey: z.string().min(8).max(80),
  sender: z.string().min(1, "Who sent it?").max(120),
  contents: z.string().min(1, "What is in it?").max(500),
  packages: z.coerce.number().int().min(1).default(1),
  busNumber: z.string().max(30).nullable().default(null),
  route: z.string().max(80).nullable().default(null),
  crewPhone: z.string().max(30).nullable().default(null),
  departureAt: z.coerce.date().nullable().default(null),
  etaAt: z.coerce.date().nullable().default(null),
  pickupStop: z.string().max(120).nullable().default(null),
  charges: z.coerce.number().min(0).default(0),
  locationId: z.string().nullable().default(null),
  assignedToId: z.string().nullable().default(null),
  notes: z.string().max(500).nullable().default(null),
});

// Bus parcel: owner/manager records it, the assigned worker is alerted. Collection never adds stock;
// only checked, accepted contents posted through Receive goods do (spec §13, AC-29).
export async function createParcel(user: CurrentUser, raw: unknown) {
  const input = parcelInput.parse(raw);
  const locationId = input.locationId ?? user.location?.id;
  if (!locationId) throw new ParcelError("Choose the shop that should collect it.");
  return posting(async (tx) => {
    const existing = await tx.busParcel.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;
    const number = await nextNumber(tx, "PARCEL");
    const { assignedToId, ...rest } = input;
    const p = await tx.busParcel.create({ data: { ...rest, number, locationId, charges: D(input.charges), createdById: user.personId } });
    const eta = input.etaAt ? ` · ETA ${input.etaAt.toLocaleTimeString("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit" })}` : "";
    await createTask(tx, {
      kind: "BUS_PARCEL", title: `Collect bus parcel ${number}${input.busNumber ? ` · bus ${input.busNumber}` : ""}${eta}`,
      details: [input.contents, input.pickupStop && `Stop: ${input.pickupStop}`, input.crewPhone && `Crew: ${input.crewPhone}`].filter(Boolean).join(" · "),
      locationId, assignedToId, priority: "URGENT", dueAt: input.etaAt, parcelId: p.id, createdById: user.personId,
    });
    return p;
  });
}

async function lock(tx: Parameters<Parameters<typeof posting>[0]>[0], id: string) {
  await tx.$queryRaw`SELECT id FROM "BusParcel" WHERE id = ${id} FOR UPDATE`;
  return tx.busParcel.findUniqueOrThrow({ where: { id } });
}

export async function markCollected(user: CurrentUser, id: string) {
  await posting(async (tx) => {
    const p = await lock(tx, id);
    if (!["DISPATCHED", "ACKNOWLEDGED"].includes(p.status)) throw new ParcelError(`Parcel is already ${p.status.toLowerCase()}.`);
    await tx.busParcel.update({ where: { id }, data: { status: "COLLECTED", collectedAt: new Date(), collectedById: user.personId } });
    for (const t of await tx.staffTask.findMany({ where: { parcelId: id, status: { in: ["PENDING", "ACKNOWLEDGED"] } } })) {
      if (t.status === "PENDING") await tx.staffTask.update({ where: { id: t.id }, data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date() } });
      await tx.taskEvent.create({ data: { taskId: t.id, kind: "NOTE", actorId: user.personId, note: "Parcel collected from bus" } });
    }
  });
}

export async function checkContents(user: CurrentUser, id: string, raw: { ok: boolean; notes: string | null }) {
  await posting(async (tx) => {
    const p = await lock(tx, id);
    if (p.status !== "COLLECTED") throw new ParcelError("Mark the parcel collected before checking contents.");
    if (!raw.ok && !raw.notes) throw new ParcelError("Describe what is missing or damaged.");
    await tx.busParcel.update({ where: { id }, data: { status: raw.ok ? "CHECKED" : "EXCEPTION", checkedAt: new Date(), checkedById: user.personId, checkNotes: raw.notes, discrepancy: !raw.ok } });
    for (const t of await tx.staffTask.findMany({ where: { parcelId: id } })) await completeTask(tx, t.id, user.personId, raw.ok ? "Contents checked OK" : `Discrepancy: ${raw.notes}`);
  });
}

export async function cancelParcel(user: CurrentUser, id: string) {
  await posting(async (tx) => {
    const p = await lock(tx, id);
    if (!["DISPATCHED", "ACKNOWLEDGED"].includes(p.status)) throw new ParcelError("Only an uncollected parcel can be cancelled.");
    await tx.busParcel.update({ where: { id }, data: { status: "CANCELLED" } });
    for (const t of await tx.staffTask.findMany({ where: { parcelId: id } })) {
      await tx.staffTask.update({ where: { id: t.id }, data: { status: "CANCELLED" } });
      await tx.taskEvent.create({ data: { taskId: t.id, kind: "CANCELLED", actorId: user.personId } });
    }
  });
}
