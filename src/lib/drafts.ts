import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db, posting } from "./db";
import { D, ZERO } from "./money";
import { nextNumber } from "./numbering";
import type { CurrentUser } from "./auth";

export class DraftError extends Error {}

const lineSchema = z.object({ productId: z.string(), sku: z.string(), name: z.string(), qty: z.coerce.number().positive(), unitPrice: z.coerce.number().min(0), discount: z.coerce.number().min(0).default(0) });
export type DraftLine = z.infer<typeof lineSchema>;
const total = (lines: DraftLine[]) => lines.reduce((a, l) => a.plus(D(l.unitPrice).mul(l.qty).minus(l.discount)), ZERO).toDecimalPlaces(2);
const ymdNow = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const dateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`);

export const draftInput = z.object({
  kind: z.enum(["QUOTE", "SUSPENDED"]),
  customerId: z.string().nullable().default(null),
  lines: z.array(lineSchema).min(1, "Add at least one item."),
  notes: z.string().max(500).nullable().default(null),
  validDays: z.coerce.number().int().min(1).max(90).default(7),
});

// Quotes and suspended sales hold no stock and no money; the POS posts the real sale once when converted.
export async function saveDraft(user: CurrentUser, raw: unknown) {
  const input = draftInput.parse(raw);
  if (!user.location) throw new DraftError("No location assigned.");
  return posting(async (tx) => {
    const number = await nextNumber(tx, input.kind === "QUOTE" ? "QUOTE" : "SUSPENDED");
    return tx.saleDraft.create({
      data: {
        number, kind: input.kind, locationId: user.location!.id, customerId: input.customerId, lines: input.lines as unknown as Prisma.InputJsonValue,
        total: total(input.lines), notes: input.notes, createdById: user.personId,
        validUntil: input.kind === "QUOTE" ? dateOnly(new Date(Date.now() + input.validDays * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10)) : null,
      },
    });
  });
}

export async function closeDraft(id: string, status: "CONVERTED" | "CANCELLED", saleId?: string) {
  // Only an open draft changes; converting twice cannot happen because the POS sale has its own idempotency key.
  await db.saleDraft.updateMany({ where: { id, status: "OPEN" }, data: { status, convertedSaleId: saleId ?? null } });
}

const addInterval = (d: Date, interval: string) => {
  const n = new Date(d);
  if (interval === "WEEK") n.setUTCDate(n.getUTCDate() + 7);
  else n.setUTCMonth(n.getUTCMonth() + 1);
  return n;
};

// One draft invoice per subscription period, keyed by (subscription, period): retries never duplicate (S05).
export async function generateSubscriptions() {
  const today = dateOnly(ymdNow());
  const due = await db.subscription.findMany({ where: { active: true, nextDate: { lte: today } } });
  let created = 0;
  for (const sub of due) {
    let next = sub.nextDate;
    while (next <= today && (!sub.endDate || next <= sub.endDate)) {
      const occurrence = next.toISOString().slice(0, 10);
      const lines = sub.lines as DraftLine[];
      try {
        await posting(async (tx) => {
          const exists = await tx.saleDraft.findUnique({ where: { subscriptionId_occurrence: { subscriptionId: sub.id, occurrence } } });
          if (exists) return;
          await tx.saleDraft.create({
            data: {
              number: await nextNumber(tx, "SUBSCRIPTION"), kind: "SUBSCRIPTION", locationId: sub.locationId, customerId: sub.customerId,
              lines: lines as unknown as Prisma.InputJsonValue, total: total(lines), notes: `${sub.name} · period from ${occurrence}`,
              subscriptionId: sub.id, occurrence, createdById: (await tx.person.findFirstOrThrow({ where: { login: { isNot: null } }, orderBy: { createdAt: "asc" } })).id,
            },
          });
          created++;
        });
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      }
      next = addInterval(next, sub.interval);
    }
    await db.subscription.update({ where: { id: sub.id }, data: { nextDate: next, active: !sub.endDate || next <= sub.endDate } });
  }
  return created;
}

// Recurring expenses: one expense per occurrence (idempotency key per rule + date), created as due, not paid.
export async function generateRecurringExpenses() {
  const today = dateOnly(ymdNow());
  const rules = await db.recurringExpense.findMany({ where: { active: true, nextDate: { lte: today } } });
  let created = 0;
  for (const r of rules) {
    let next = r.nextDate;
    while (next <= today && (!r.endDate || next <= r.endDate)) {
      const key = `recurring:${r.id}:${next.toISOString().slice(0, 10)}`;
      const exists = await db.expense.findUnique({ where: { idempotencyKey: key } });
      if (!exists) {
        await posting(async (tx) => {
          await tx.expense.create({
            data: {
              number: await nextNumber(tx, "EXPENSE"), categoryId: r.categoryId, locationId: r.locationId, contactId: r.contactId,
              expenseDate: next, amount: r.amount, description: `${r.name} (recurring)`, idempotencyKey: key, createdById: r.createdById,
            },
          });
        }).then(() => created++, (e) => { if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e; });
      }
      next = addInterval(next, r.interval);
    }
    await db.recurringExpense.update({ where: { id: r.id }, data: { nextDate: next, active: !r.endDate || next <= r.endDate } });
  }
  return created;
}
