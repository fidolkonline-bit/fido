-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "openingPaid" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "collectionId" TEXT;

-- CreateTable
CREATE TABLE "DebtCollection" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "tendered" DECIMAL(14,2) NOT NULL,
    "change" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "received" DECIMAL(14,2) NOT NULL,
    "allocated" DECIMAL(14,2) NOT NULL,
    "advance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "debtBefore" DECIMAL(14,2) NOT NULL,
    "debtAfter" DECIMAL(14,2) NOT NULL,
    "accountId" TEXT,
    "registerId" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference" TEXT,
    "note" TEXT,
    "state" TEXT NOT NULL DEFAULT 'POSTED',
    "stateReason" TEXT,
    "stateAt" TIMESTAMP(3),
    "stateById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DebtCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebtAllocation" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "saleId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "dueBefore" DECIMAL(14,2) NOT NULL,
    "dueAfter" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "DebtAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DebtCollection_number_key" ON "DebtCollection"("number");

-- CreateIndex
CREATE UNIQUE INDEX "DebtCollection_idempotencyKey_key" ON "DebtCollection"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DebtCollection_customerId_idx" ON "DebtCollection"("customerId");

-- CreateIndex
CREATE INDEX "DebtCollection_paidAt_idx" ON "DebtCollection"("paidAt");

-- CreateIndex
CREATE INDEX "DebtAllocation_saleId_idx" ON "DebtAllocation"("saleId");

-- CreateIndex
CREATE INDEX "DebtAllocation_collectionId_idx" ON "DebtAllocation"("collectionId");

-- CreateIndex
CREATE INDEX "Payment_collectionId_idx" ON "Payment"("collectionId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "DebtCollection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtCollection" ADD CONSTRAINT "DebtCollection_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtCollection" ADD CONSTRAINT "DebtCollection_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtCollection" ADD CONSTRAINT "DebtCollection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtCollection" ADD CONSTRAINT "DebtCollection_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "RegisterSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtCollection" ADD CONSTRAINT "DebtCollection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtAllocation" ADD CONSTRAINT "DebtAllocation_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "DebtCollection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtAllocation" ADD CONSTRAINT "DebtAllocation_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Every app table is closed to Supabase's public API; the app reaches Postgres only through Prisma.
ALTER TABLE "DebtCollection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DebtAllocation" ENABLE ROW LEVEL SECURITY;

-- Debt at the POS (CR-03): grant the new keys to the default roles (new keys only; nothing an admin removed is re-added).
UPDATE "Role" SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['debt.view','debt.receive','debt.allocate','debt.account','debt.backdate','debt.reverse']))
WHERE name IN ('Owner/Admin', 'Manager');
UPDATE "Role" SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['debt.view','debt.receive']))
WHERE name = 'Cashier';

-- The price-tier keys from the previous change were only in the seed, so existing roles never received them.
UPDATE "Role" SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['pricing.manage','pricing.tier_override']))
WHERE name = 'Owner/Admin';
UPDATE "Role" SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['pricing.tier_override']))
WHERE name = 'Manager';
