-- DropIndex
DROP INDEX "CommissionAccrual_saleLineId_role_key";

-- AlterTable
ALTER TABLE "CommissionAccrual" ADD COLUMN     "returnLineId" TEXT;

-- AlterTable
ALTER TABLE "CostAllocation" ADD COLUMN     "returnedQty" DECIMAL(14,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CostLayer" ADD COLUMN     "originLayerId" TEXT,
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceType" TEXT;

-- AlterTable
ALTER TABLE "DeviceIdentity" ADD COLUMN     "costLayerId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "expenseId" TEXT,
ADD COLUMN     "returnId" TEXT;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "credited" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SaleLine" ADD COLUMN     "returnedQty" DECIMAL(14,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SaleReturn" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "customerId" TEXT,
    "reason" TEXT,
    "totalValue" DECIMAL(14,2) NOT NULL,
    "debtOffset" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "refunded" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "storeCredit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "settlement" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleReturnLine" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "saleLineId" TEXT NOT NULL,
    "qty" DECIMAL(14,4) NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "costValue" DECIMAL(14,4) NOT NULL,
    "disposition" TEXT NOT NULL,
    "condition" TEXT,

    CONSTRAINT "SaleReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreCreditEntry" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreCreditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "recoveredAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustmentLine" (
    "id" TEXT NOT NULL,
    "adjustmentId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "costLayerId" TEXT,
    "lotCode" TEXT,
    "qty" DECIMAL(14,4) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "fromBucket" TEXT,
    "toBucket" TEXT,

    CONSTRAINT "StockAdjustmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_TRANSIT',
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT NOT NULL,
    "receivedById" TEXT,
    "dispatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3),

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferLine" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sourceLayerId" TEXT NOT NULL,
    "lotCode" TEXT,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "originReceivedAt" TIMESTAMP(3) NOT NULL,
    "qtySent" DECIMAL(14,4) NOT NULL,
    "qtyReceived" DECIMAL(14,4),

    CONSTRAINT "StockTransferLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "contactId" TEXT,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SaleReturn_number_key" ON "SaleReturn"("number");

-- CreateIndex
CREATE UNIQUE INDEX "SaleReturn_idempotencyKey_key" ON "SaleReturn"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SaleReturn_saleId_idx" ON "SaleReturn"("saleId");

-- CreateIndex
CREATE INDEX "StoreCreditEntry_contactId_idx" ON "StoreCreditEntry"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustment_number_key" ON "StockAdjustment"("number");

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustment_idempotencyKey_key" ON "StockAdjustment"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_number_key" ON "StockTransfer"("number");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_idempotencyKey_key" ON "StockTransfer"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_name_key" ON "ExpenseCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_number_key" ON "Expense"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_idempotencyKey_key" ON "Expense"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Expense_expenseDate_idx" ON "Expense"("expenseDate");

-- CreateIndex
CREATE INDEX "CommissionAccrual_saleLineId_idx" ON "CommissionAccrual"("saleLineId");

-- AddForeignKey
ALTER TABLE "DeviceIdentity" ADD CONSTRAINT "DeviceIdentity_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceIdentity" ADD CONSTRAINT "DeviceIdentity_costLayerId_fkey" FOREIGN KEY ("costLayerId") REFERENCES "CostLayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceIdentity" ADD CONSTRAINT "DeviceIdentity_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "SaleLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnLine" ADD CONSTRAINT "SaleReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "SaleReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnLine" ADD CONSTRAINT "SaleReturnLine_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "SaleLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreCreditEntry" ADD CONSTRAINT "StoreCreditEntry_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentLine" ADD CONSTRAINT "StockAdjustmentLine_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "StockAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentLine" ADD CONSTRAINT "StockAdjustmentLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "SaleReturn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Keep new tables away from Supabase's public REST API (see enable_rls migration).
ALTER TABLE "SaleReturn" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SaleReturnLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoreCreditEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockAdjustment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockAdjustmentLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockTransfer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockTransferLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExpenseCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Expense" ENABLE ROW LEVEL SECURITY;
