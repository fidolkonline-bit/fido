import { db } from "./db";
import { D } from "./money";

export const DENOMINATIONS = [5000, 2000, 1000, 500, 100, 50, 20, 10, 5, 2, 1];

// Expected cash = opening + actual cash receipts − cash refunds/outs (spec §8.3). Card/bank are excluded.
export async function expectedCash(registerId: string) {
  const r = await db.registerSession.findUniqueOrThrow({ where: { id: registerId } });
  const rows = await db.payment.groupBy({ by: ["direction"], where: { registerId, method: "CASH" }, _sum: { amount: true } });
  const cashIn = D(rows.find((x) => x.direction === "IN")?._sum.amount);
  const cashOut = D(rows.find((x) => x.direction === "OUT")?._sum.amount);
  return { opening: D(r.openingCash), cashIn, cashOut, expected: D(r.openingCash).plus(cashIn).minus(cashOut) };
}
