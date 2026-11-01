import type { Tx } from "./db";

const DEFAULT_PREFIX: Record<string, string> = {
  SALE: "INV",
  GRN: "PO",
  PAYMENT_IN: "SP",
  PAYMENT_OUT: "PP",
  CREDIT_NOTE: "CN",
  ADJUSTMENT: "SA",
  TRANSFER: "ST",
  EXPENSE: "EP",
  PURCHASE_ORDER: "POR",
  SUPPLIER_CLAIM: "SR",
  REPAIR: "JOB",
  RELOAD: "RL",
  PARCEL: "BP",
  PAYROLL: "PR",
  QUOTE: "QT",
  SUSPENDED: "SUS",
  SUBSCRIPTION: "SUB",
  DEBT_RECEIPT: "RCP",
};

// Allocates a unique final document number inside the posting transaction (spec §15.2).
// The row lock from the upsert serialises concurrent tills; a rolled-back sale releases nothing visible.
export async function nextNumber(tx: Tx, docType: string, scope = "ALL") {
  const prefix = DEFAULT_PREFIX[docType] ?? docType;
  const rows = await tx.$queryRaw<{ prefix: string; value: number; digits: number; includeYear: boolean }[]>`
    INSERT INTO "NumberScheme" (id, "docType", scope, prefix, "nextValue", digits)
    VALUES (gen_random_uuid()::text, ${docType}, ${scope}, ${prefix}, 2, 4)
    ON CONFLICT ("docType", scope) DO UPDATE SET "nextValue" = "NumberScheme"."nextValue" + 1
    RETURNING prefix, "nextValue" - 1 AS value, digits, "includeYear"`;
  const { prefix: p, value, digits, includeYear } = rows[0];
  // Business year in Asia/Colombo, so a sale at 00:30 on 1 January gets the new year's prefix.
  const year = new Date(Date.now() + 330 * 60_000).getUTCFullYear();
  return `${p}${includeYear ? `${year}/` : ""}${String(value).padStart(digits, "0")}`;
}
