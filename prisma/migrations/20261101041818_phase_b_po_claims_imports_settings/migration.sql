-- AlterTable
ALTER TABLE "GoodsReceipt" ADD COLUMN     "purchaseOrderId" TEXT;

-- AlterTable
ALTER TABLE "NumberScheme" ADD COLUMN     "includeYear" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "claimId" TEXT;

-- AlterTable
ALTER TABLE "ReceiptLine" ADD COLUMN     "poLineId" TEXT;

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ORDERED',
    "expectedAt" TIMESTAMP(3),
    "notes" TEXT,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qtyOrdered" DECIMAL(14,4) NOT NULL,
    "qtyReceived" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierClaim" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "reason" TEXT,
    "notes" TEXT,
    "claimValue" DECIMAL(14,2) NOT NULL,
    "creditAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "refundAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "replacedValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "rejectedValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lossValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "createdById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "SupplierClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierClaimLine" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "costLayerId" TEXT NOT NULL,
    "deviceId" TEXT,
    "lotCode" TEXT,
    "qty" DECIMAL(14,4) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "fromBucket" TEXT NOT NULL,
    "qtyReplaced" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "qtyRejected" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "rejectedTo" TEXT,

    CONSTRAINT "SupplierClaimLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRY_RUN',
    "rows" JSONB NOT NULL,
    "summary" JSONB,
    "locationId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_number_key" ON "PurchaseOrder"("number");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_idempotencyKey_key" ON "PurchaseOrder"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierClaim_number_key" ON "SupplierClaim"("number");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierClaim_idempotencyKey_key" ON "SupplierClaim"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptLine" ADD CONSTRAINT "ReceiptLine_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierClaim" ADD CONSTRAINT "SupplierClaim_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierClaim" ADD CONSTRAINT "SupplierClaim_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierClaim" ADD CONSTRAINT "SupplierClaim_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierClaimLine" ADD CONSTRAINT "SupplierClaimLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "SupplierClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierClaimLine" ADD CONSTRAINT "SupplierClaimLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "SupplierClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "PurchaseOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseOrderLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierClaim" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierClaimLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppSetting" ENABLE ROW LEVEL SECURITY;

UPDATE "Role" SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['purchases.claims','imports.run']))
WHERE name IN ('Owner/Admin', 'Manager');
UPDATE "Role" SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['purchases.claims']))
WHERE name = 'Stock clerk';
