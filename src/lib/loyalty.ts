import "server-only";
import { z } from "zod";
import { db, posting, type Tx } from "./db";
import { D } from "./money";
import type { CurrentUser } from "./auth";

// Loyalty points: earned on every sale to a named customer, turned into store credit when the customer wants to
// spend them (store credit is already a payment method at the POS, so points never need their own till logic).
export const loyaltySchema = z.object({
  enabled: z.boolean().default(false),
  earnPer: z.coerce.number().positive().default(100), // Rs. spent for 1 point
  pointValue: z.coerce.number().positive().default(1), // Rs. of store credit per point
  minRedeem: z.coerce.number().int().min(1).default(100), // smallest number of points that can be converted
});
export type LoyaltySettings = z.infer<typeof loyaltySchema>;

export async function getLoyalty(client: Pick<Tx, "appSetting"> = db): Promise<LoyaltySettings> {
  const row = await client.appSetting.findUnique({ where: { key: "loyalty" } });
  const parsed = loyaltySchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : loyaltySchema.parse({});
}

export const pointsFor = (total: number | string, s: LoyaltySettings) => (s.enabled ? Math.floor(Number(total) / s.earnPer) : 0);

export async function pointsBalance(client: Pick<Tx, "loyaltyEntry">, contactId: string) {
  const agg = await client.loyaltyEntry.aggregate({ where: { contactId }, _sum: { points: true } });
  return agg._sum.points ?? 0;
}

export class LoyaltyError extends Error {}

// Convert points to store credit, under a lock on the customer so two tills cannot spend the same points.
export async function redeemPoints(user: CurrentUser, contactId: string, points: number) {
  if (!Number.isInteger(points) || points <= 0) throw new LoyaltyError("Enter a whole number of points.");
  return posting(async (tx) => {
    const s = await getLoyalty(tx);
    if (!s.enabled) throw new LoyaltyError("Loyalty points are switched off.");
    if (points < s.minRedeem) throw new LoyaltyError(`At least ${s.minRedeem} points are needed to convert.`);
    await tx.$queryRaw`SELECT id FROM "Contact" WHERE id = ${contactId} FOR UPDATE`;
    const balance = await pointsBalance(tx, contactId);
    if (points > balance) throw new LoyaltyError(`Only ${balance} points are available.`);
    const credit = D(points).mul(s.pointValue).toDecimalPlaces(2);
    const entry = await tx.loyaltyEntry.create({ data: { contactId, points: -points, sourceType: "Redeem", sourceId: contactId, reference: `Converted to Rs. ${credit.toFixed(2)} store credit` } });
    await tx.storeCreditEntry.create({ data: { contactId, amount: credit, sourceType: "Loyalty", sourceId: entry.id, reference: `${points} loyalty points` } });
    await tx.auditEvent.create({ data: { actorId: user.personId, action: "LOYALTY_REDEEMED", subjectType: "Contact", subjectId: contactId, detail: { points, credit: credit.toString() } } });
    return { credit: credit.toFixed(2), left: balance - points };
  });
}
