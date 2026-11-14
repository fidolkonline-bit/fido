-- AlterTable
ALTER TABLE "RegisterSession" ADD COLUMN     "cashLeft" DECIMAL(14,2),
ADD COLUMN     "closedById" TEXT,
ADD COLUMN     "expectedOpening" DECIMAL(14,2),
ADD COLUMN     "openingNote" TEXT,
ADD COLUMN     "varianceReason" TEXT;

-- CreateTable
CREATE TABLE "RegisterMovement" (
    "id" TEXT NOT NULL,
    "registerId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "atClose" BOOLEAN NOT NULL DEFAULT false,
    "paymentId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegisterMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegisterMovement_paymentId_key" ON "RegisterMovement"("paymentId");

-- CreateIndex
CREATE INDEX "RegisterMovement_registerId_idx" ON "RegisterMovement"("registerId");

-- AddForeignKey
ALTER TABLE "RegisterSession" ADD CONSTRAINT "RegisterSession_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterMovement" ADD CONSTRAINT "RegisterMovement_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "RegisterSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterMovement" ADD CONSTRAINT "RegisterMovement_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterMovement" ADD CONSTRAINT "RegisterMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Registers closed before this change were closed by the person who opened them.
UPDATE "RegisterSession" SET "closedById" = "userId" WHERE "closedAt" IS NOT NULL AND "closedById" IS NULL;

-- One shared drawer per location. Registers that were open side by side (one per cashier) are merged into the
-- earliest open one at that location: their opening cash is added and their sales, payments and debt receipts
-- move onto it, so the expected cash in the drawer is unchanged. An audit event records each merge.
WITH ranked AS (
  SELECT id, "locationId", "openingCash",
         first_value(id) OVER (PARTITION BY "locationId" ORDER BY "openedAt", id) AS keep_id
  FROM "RegisterSession" WHERE "closedAt" IS NULL
), extra AS (SELECT * FROM ranked WHERE id <> keep_id),
audit AS (
  INSERT INTO "AuditEvent" (id, action, "subjectType", "subjectId", detail, "createdAt")
  SELECT 'regmerge_' || e.id, 'REGISTER_MERGED', 'RegisterSession', e.keep_id,
         jsonb_build_object('mergedRegisterId', e.id, 'openingCash', e."openingCash"::text, 'reason', 'shared cash drawer per location'), now()
  FROM extra e
), s AS (UPDATE "Sale" x SET "registerId" = e.keep_id FROM extra e WHERE x."registerId" = e.id),
   p AS (UPDATE "Payment" x SET "registerId" = e.keep_id FROM extra e WHERE x."registerId" = e.id),
   c AS (UPDATE "DebtCollection" x SET "registerId" = e.keep_id FROM extra e WHERE x."registerId" = e.id),
   k AS (UPDATE "RegisterSession" x SET "openingCash" = x."openingCash" + t.total
         FROM (SELECT keep_id, sum("openingCash") AS total FROM extra GROUP BY keep_id) t WHERE x.id = t.keep_id)
SELECT 1;
DELETE FROM "RegisterSession" r
WHERE r."closedAt" IS NULL AND EXISTS (
  SELECT 1 FROM "RegisterSession" o WHERE o."locationId" = r."locationId" AND o."closedAt" IS NULL
    AND (o."openedAt", o.id) < (r."openedAt", r.id));

-- At most one open drawer per location (not expressible in schema.prisma; keep it).
CREATE UNIQUE INDEX "RegisterSession_one_open_per_location" ON "RegisterSession"("locationId") WHERE "closedAt" IS NULL;

-- Block Supabase's REST API, like every other table.
ALTER TABLE "RegisterMovement" ENABLE ROW LEVEL SECURITY;
