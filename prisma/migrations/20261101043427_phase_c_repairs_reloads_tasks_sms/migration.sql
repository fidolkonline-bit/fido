-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "reloadRequestId" TEXT,
ADD COLUMN     "repairJobId" TEXT,
ADD COLUMN     "walletId" TEXT;

-- CreateTable
CREATE TABLE "RepairJob" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL DEFAULT 'CARRY_IN',
    "deviceBrand" TEXT,
    "deviceModel" TEXT NOT NULL,
    "imei" TEXT,
    "serial" TEXT,
    "color" TEXT,
    "simCount" INTEGER NOT NULL DEFAULT 0,
    "memoryCard" BOOLEAN NOT NULL DEFAULT false,
    "accessories" TEXT,
    "condition" TEXT,
    "problem" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "technicianId" TEXT,
    "diagnosis" TEXT,
    "estimate" DECIMAL(14,2),
    "estimateApprovedAt" TIMESTAMP(3),
    "promisedAt" TIMESTAMP(3),
    "labourCharge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "otherCharge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "externalCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "warrantyDays" INTEGER,
    "credentialCipher" TEXT,
    "credentialType" TEXT,
    "credentialPurgedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "readyAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3),

    CONSTRAINT "RepairJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairEvent" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "actorId" TEXT,
    "kind" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairPart" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qtyIssued" DECIMAL(14,4) NOT NULL,
    "qtyReturned" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "costTotal" DECIMAL(14,4) NOT NULL,
    "allocations" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReloadWallet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "networks" TEXT[],
    "costRate" DECIMAL(9,6) NOT NULL,
    "locationId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReloadWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletMovement" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "nominal" DECIMAL(14,2) NOT NULL,
    "money" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "reference" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReloadRequest" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "customerId" TEXT,
    "collection" TEXT NOT NULL DEFAULT 'SHOP',
    "notes" TEXT,
    "locationId" TEXT NOT NULL,
    "assignedToId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "providerRef" TEXT,
    "resultNote" TEXT,
    "saleId" TEXT,
    "idempotencyKey" TEXT,
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ReloadRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffTask" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "locationId" TEXT NOT NULL,
    "assignedToId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "dueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "acknowledgedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "reloadRequestId" TEXT,
    "parcelId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusParcel" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "contents" TEXT NOT NULL,
    "packages" INTEGER NOT NULL DEFAULT 1,
    "busNumber" TEXT,
    "route" TEXT,
    "crewPhone" TEXT,
    "departureAt" TIMESTAMP(3),
    "etaAt" TIMESTAMP(3),
    "pickupStop" TEXT,
    "charges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "locationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISPATCHED',
    "collectedAt" TIMESTAMP(3),
    "collectedById" TEXT,
    "checkedAt" TIMESTAMP(3),
    "checkedById" TEXT,
    "checkNotes" TEXT,
    "discrepancy" BOOLEAN NOT NULL DEFAULT false,
    "receiptId" TEXT,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusParcel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "event" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("event")
);

-- CreateTable
CREATE TABLE "NotificationIntent" (
    "id" TEXT NOT NULL,
    "uniqueKey" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'SMS',
    "recipient" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "providerId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "NotificationIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RepairJob_number_key" ON "RepairJob"("number");

-- CreateIndex
CREATE UNIQUE INDEX "RepairJob_idempotencyKey_key" ON "RepairJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RepairJob_status_idx" ON "RepairJob"("status");

-- CreateIndex
CREATE INDEX "RepairJob_customerId_idx" ON "RepairJob"("customerId");

-- CreateIndex
CREATE INDEX "RepairEvent_jobId_idx" ON "RepairEvent"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "ReloadWallet_name_key" ON "ReloadWallet"("name");

-- CreateIndex
CREATE INDEX "WalletMovement_walletId_createdAt_idx" ON "WalletMovement"("walletId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReloadRequest_number_key" ON "ReloadRequest"("number");

-- CreateIndex
CREATE UNIQUE INDEX "ReloadRequest_saleId_key" ON "ReloadRequest"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "ReloadRequest_idempotencyKey_key" ON "ReloadRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ReloadRequest_status_idx" ON "ReloadRequest"("status");

-- CreateIndex
CREATE INDEX "StaffTask_assignedToId_status_idx" ON "StaffTask"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "StaffTask_locationId_status_idx" ON "StaffTask"("locationId", "status");

-- CreateIndex
CREATE INDEX "TaskEvent_taskId_idx" ON "TaskEvent"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "BusParcel_number_key" ON "BusParcel"("number");

-- CreateIndex
CREATE UNIQUE INDEX "BusParcel_idempotencyKey_key" ON "BusParcel"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationIntent_uniqueKey_key" ON "NotificationIntent"("uniqueKey");

-- CreateIndex
CREATE INDEX "NotificationIntent_status_idx" ON "NotificationIntent"("status");

-- CreateIndex
CREATE INDEX "NotificationIntent_sourceType_sourceId_idx" ON "NotificationIntent"("sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "RepairJob" ADD CONSTRAINT "RepairJob_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairJob" ADD CONSTRAINT "RepairJob_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairJob" ADD CONSTRAINT "RepairJob_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairJob" ADD CONSTRAINT "RepairJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairEvent" ADD CONSTRAINT "RepairEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "RepairJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairEvent" ADD CONSTRAINT "RepairEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairPart" ADD CONSTRAINT "RepairPart_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "RepairJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairPart" ADD CONSTRAINT "RepairPart_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReloadWallet" ADD CONSTRAINT "ReloadWallet_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletMovement" ADD CONSTRAINT "WalletMovement_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "ReloadWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletMovement" ADD CONSTRAINT "WalletMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReloadRequest" ADD CONSTRAINT "ReloadRequest_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "ReloadWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReloadRequest" ADD CONSTRAINT "ReloadRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReloadRequest" ADD CONSTRAINT "ReloadRequest_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReloadRequest" ADD CONSTRAINT "ReloadRequest_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReloadRequest" ADD CONSTRAINT "ReloadRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_reloadRequestId_fkey" FOREIGN KEY ("reloadRequestId") REFERENCES "ReloadRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "BusParcel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "StaffTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusParcel" ADD CONSTRAINT "BusParcel_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusParcel" ADD CONSTRAINT "BusParcel_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusParcel" ADD CONSTRAINT "BusParcel_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_repairJobId_fkey" FOREIGN KEY ("repairJobId") REFERENCES "RepairJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reloadRequestId_fkey" FOREIGN KEY ("reloadRequestId") REFERENCES "ReloadRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "ReloadWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;


DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['RepairJob','RepairEvent','RepairPart','ReloadWallet','WalletMovement','ReloadRequest','StaffTask','TaskEvent','BusParcel','NotificationTemplate','NotificationIntent'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

UPDATE "Role" SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['repairs.view','repairs.manage','repairs.credentials','reloads.request','reloads.process','reloads.wallets','tasks.manage','notifications.manage']))
WHERE name = 'Owner/Admin';
UPDATE "Role" SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['repairs.view','repairs.manage','repairs.credentials','reloads.request','reloads.process','reloads.wallets','tasks.manage']))
WHERE name = 'Manager';
UPDATE "Role" SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['repairs.view','repairs.manage','reloads.process']))
WHERE name = 'Cashier';
UPDATE "Role" SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['repairs.view','repairs.manage','repairs.credentials']))
WHERE name = 'Technician';
