-- Safety, trade-ins, warranty, repair extras, stock take, tax, loyalty, instalments.
-- Additive: new tables and columns; two columns become optional (CommissionAccrual.saleLineId, DocumentFile.data) and the
-- commission foreign key is re-created to match. No table, column or row is removed. Existing values change only in the
-- backfills at the end (empty warranty dates on things already sold, tracking tokens on repair jobs, new permission keys).

-- DropForeignKey
ALTER TABLE "CommissionAccrual" DROP CONSTRAINT "CommissionAccrual_saleLineId_fkey";

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "taxEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxNumber" TEXT;

-- AlterTable
ALTER TABLE "CommissionAccrual" ADD COLUMN     "repairJobId" TEXT,
ALTER COLUMN "saleLineId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "DeviceIdentity" ADD COLUMN     "soldAt" TIMESTAMP(3),
ADD COLUMN     "warrantyUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DocumentFile" ADD COLUMN     "storagePath" TEXT,
ALTER COLUMN "data" DROP NOT NULL;

-- AlterTable
ALTER TABLE "LoginAccount" ADD COLUMN     "pinHash" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "tradeInId" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "taxRateId" TEXT;

-- AlterTable
ALTER TABLE "RepairJob" ADD COLUMN     "originDeviceId" TEXT,
ADD COLUMN     "originSaleLineId" TEXT,
ADD COLUMN     "signature" TEXT,
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "termsText" TEXT,
ADD COLUMN     "trackToken" TEXT,
ADD COLUMN     "warrantyClaim" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "loyaltyEarned" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SaleLine" ADD COLUMN     "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxName" TEXT,
ADD COLUMN     "taxRatePct" DECIMAL(6,3) NOT NULL DEFAULT 0,
ADD COLUMN     "warrantyDays" INTEGER,
ADD COLUMN     "warrantyName" TEXT,
ADD COLUMN     "warrantyUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "ip" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'PASSWORD',
    "ok" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "digest" TEXT,
    "path" TEXT,
    "method" TEXT,
    "route" TEXT,
    "kind" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeIn" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sellerIdType" TEXT NOT NULL DEFAULT 'NIC',
    "sellerIdNumber" TEXT NOT NULL,
    "sellerAddress" TEXT,
    "productId" TEXT NOT NULL,
    "imei1" TEXT,
    "imei2" TEXT,
    "serial" TEXT,
    "grade" TEXT NOT NULL DEFAULT 'B',
    "batteryHealth" INTEGER,
    "conditionNotes" TEXT,
    "accessories" TEXT,
    "ownershipDeclared" BOOLEAN NOT NULL DEFAULT false,
    "accountsRemoved" BOOLEAN NOT NULL DEFAULT false,
    "value" DECIMAL(14,2) NOT NULL,
    "settlement" TEXT NOT NULL,
    "readyToSell" BOOLEAN NOT NULL DEFAULT false,
    "deviceId" TEXT,
    "costLayerId" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairPhoto" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'INTAKE',
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "scope" TEXT,
    "categoryId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" TIMESTAMP(3),
    "adjustmentId" TEXT,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "expectedQty" DECIMAL(14,4) NOT NULL,
    "countedQty" DECIMAL(14,4),
    "expectedDeviceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "countedDeviceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unknownCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ratePct" DECIMAL(6,3) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyEntry" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstalmentPlan" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "financed" DECIMAL(14,2) NOT NULL,
    "paidBefore" DECIMAL(14,2) NOT NULL,
    "count" INTEGER NOT NULL,
    "frequency" TEXT NOT NULL,
    "firstDueAt" TIMESTAMP(3) NOT NULL,
    "guarantorName" TEXT,
    "guarantorPhone" TEXT,
    "guarantorId" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstalmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstalmentDue" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "remindedAt" TIMESTAMP(3),

    CONSTRAINT "InstalmentDue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginAttempt_username_createdAt_idx" ON "LoginAttempt"("username", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_ip_createdAt_idx" ON "LoginAttempt"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "ErrorLog_createdAt_idx" ON "ErrorLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradeIn_number_key" ON "TradeIn"("number");

-- CreateIndex
CREATE UNIQUE INDEX "TradeIn_deviceId_key" ON "TradeIn"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeIn_idempotencyKey_key" ON "TradeIn"("idempotencyKey");

-- CreateIndex
CREATE INDEX "TradeIn_customerId_idx" ON "TradeIn"("customerId");

-- CreateIndex
CREATE INDEX "TradeIn_imei1_idx" ON "TradeIn"("imei1");

-- CreateIndex
CREATE INDEX "RepairPhoto_jobId_idx" ON "RepairPhoto"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_number_key" ON "StockCount"("number");

-- CreateIndex
CREATE INDEX "StockCount_locationId_status_idx" ON "StockCount"("locationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountLine_countId_productId_key" ON "StockCountLine"("countId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRate_name_key" ON "TaxRate"("name");

-- CreateIndex
CREATE INDEX "LoyaltyEntry_contactId_idx" ON "LoyaltyEntry"("contactId");

-- CreateIndex
CREATE INDEX "LoyaltyEntry_sourceType_sourceId_idx" ON "LoyaltyEntry"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "InstalmentPlan_number_key" ON "InstalmentPlan"("number");

-- CreateIndex
CREATE UNIQUE INDEX "InstalmentPlan_saleId_key" ON "InstalmentPlan"("saleId");

-- CreateIndex
CREATE INDEX "InstalmentPlan_customerId_idx" ON "InstalmentPlan"("customerId");

-- CreateIndex
CREATE INDEX "InstalmentDue_dueAt_idx" ON "InstalmentDue"("dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "InstalmentDue_planId_seq_key" ON "InstalmentDue"("planId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "RepairJob_trackToken_key" ON "RepairJob"("trackToken");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "TaxRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionAccrual" ADD CONSTRAINT "CommissionAccrual_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "SaleLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionAccrual" ADD CONSTRAINT "CommissionAccrual_repairJobId_fkey" FOREIGN KEY ("repairJobId") REFERENCES "RepairJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairJob" ADD CONSTRAINT "RepairJob_originSaleLineId_fkey" FOREIGN KEY ("originSaleLineId") REFERENCES "SaleLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tradeInId_fkey" FOREIGN KEY ("tradeInId") REFERENCES "TradeIn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeIn" ADD CONSTRAINT "TradeIn_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeIn" ADD CONSTRAINT "TradeIn_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeIn" ADD CONSTRAINT "TradeIn_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeIn" ADD CONSTRAINT "TradeIn_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "DeviceIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeIn" ADD CONSTRAINT "TradeIn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairPhoto" ADD CONSTRAINT "RepairPhoto_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "RepairJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairPhoto" ADD CONSTRAINT "RepairPhoto_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyEntry" ADD CONSTRAINT "LoyaltyEntry_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstalmentPlan" ADD CONSTRAINT "InstalmentPlan_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstalmentPlan" ADD CONSTRAINT "InstalmentPlan_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstalmentPlan" ADD CONSTRAINT "InstalmentPlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstalmentDue" ADD CONSTRAINT "InstalmentDue_planId_fkey" FOREIGN KEY ("planId") REFERENCES "InstalmentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep the new tables away from Supabase's public REST API like every other app table.
ALTER TABLE "LoginAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ErrorLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TradeIn" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RepairPhoto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockCount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockCountLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaxRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LoyaltyEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InstalmentPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InstalmentDue" ENABLE ROW LEVEL SECURITY;

-- New permission keys for the default roles (new keys only; nothing an admin removed is re-added).
UPDATE "Role" SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['stock.count','tradein.create','instalments.manage']))
WHERE name IN ('Owner/Admin', 'Manager');
UPDATE "Role" SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['stock.count']))
WHERE name = 'Stock clerk';

-- Warranty backfill for sales made before this change: the product's warranty as it is today, counted from the sale date.
UPDATE "SaleLine" sl
SET "warrantyName" = w.name, "warrantyDays" = w."durationDays",
    "warrantyUntil" = CASE WHEN w."durationDays" > 0 THEN s."soldAt" + make_interval(days => w."durationDays") END
FROM "Sale" s, "Product" p, "Warranty" w
WHERE sl."saleId" = s.id AND sl."productId" = p.id AND p."warrantyId" = w.id AND s.stage = 'FINAL' AND sl."warrantyName" IS NULL;

UPDATE "DeviceIdentity" d
SET "soldAt" = s."soldAt", "warrantyUntil" = sl."warrantyUntil"
FROM "SaleLine" sl, "Sale" s
WHERE d."saleLineId" = sl.id AND sl."saleId" = s.id AND d.state = 'SOLD' AND d."soldAt" IS NULL;

-- Every repair job gets a tracking token (open jobs can be tracked straight away).
UPDATE "RepairJob" SET "trackToken" = substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 32) WHERE "trackToken" IS NULL;
