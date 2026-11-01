-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'LKR',
    "timeZone" TEXT NOT NULL DEFAULT 'Asia/Colombo',
    "fyStartMonth" INTEGER NOT NULL DEFAULT 1,
    "saleRounding" DECIMAL(6,2) NOT NULL DEFAULT 0.5,
    "allowOversell" BOOLEAN NOT NULL DEFAULT false,
    "commissionBasis" TEXT NOT NULL DEFAULT 'INVOICE_VALUE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberScheme" (
    "id" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "digits" INTEGER NOT NULL DEFAULT 5,
    "locationId" TEXT,

    CONSTRAINT "NumberScheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAccount" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "allowLogin" BOOLEAN NOT NULL DEFAULT true,
    "roleId" TEXT NOT NULL,
    "maxDiscountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "locationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],
    "system" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserLocation" (
    "accountId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,

    CONSTRAINT "UserLocation_pkey" PRIMARY KEY ("accountId","locationId")
);

-- CreateTable
CREATE TABLE "CommissionProfile" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "isCustomer" BOOLEAN NOT NULL DEFAULT true,
    "isSupplier" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "taxNumber" TEXT,
    "groupId" TEXT,
    "creditLimit" DECIMAL(14,2),
    "payTermDays" INTEGER,
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "poolRate" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "userShare" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "agentShare" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "legacyId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "allowDecimal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warranty" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationDays" INTEGER NOT NULL,

    CONSTRAINT "Warranty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'SINGLE',
    "barcode" TEXT,
    "categoryId" TEXT,
    "brandId" TEXT,
    "unitId" TEXT,
    "warrantyId" TEXT,
    "stockManaged" BOOLEAN NOT NULL DEFAULT true,
    "trackDevices" BOOLEAN NOT NULL DEFAULT false,
    "notForSale" BOOLEAN NOT NULL DEFAULT false,
    "alertQty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "defaultCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "sellPrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "minSellPrice" DECIMAL(14,2),
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "supplierRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotCode" TEXT,
    "qtyReceived" DECIMAL(14,4) NOT NULL,
    "qtyAccepted" DECIMAL(14,4) NOT NULL,
    "qtyRejected" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "newSellPrice" DECIMAL(14,2),

    CONSTRAINT "ReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostLayer" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "receiptLineId" TEXT,
    "lotCode" TEXT,
    "qtyIn" DECIMAL(14,4) NOT NULL,
    "qtyRemaining" DECIMAL(14,4) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "bucket" TEXT NOT NULL DEFAULT 'SALEABLE',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostLayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "costLayerId" TEXT,
    "qty" DECIMAL(14,4) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "reference" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceIdentity" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "receiptLineId" TEXT,
    "imei1" TEXT,
    "imei2" TEXT,
    "serial" TEXT,
    "condition" TEXT NOT NULL DEFAULT 'NEW',
    "state" TEXT NOT NULL DEFAULT 'SALEABLE',
    "locationId" TEXT,
    "saleLineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "customerId" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'FINAL',
    "paymentState" TEXT NOT NULL DEFAULT 'PAID',
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "rounding" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "commissionMode" TEXT NOT NULL DEFAULT 'NONE',
    "salespersonId" TEXT,
    "agentId" TEXT,
    "createdById" TEXT NOT NULL,
    "registerId" TEXT,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleLine" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "qty" DECIMAL(14,4) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "costTotal" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "categoryId" TEXT,
    "poolRate" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "userShare" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "agentShare" DECIMAL(9,6) NOT NULL DEFAULT 0,

    CONSTRAINT "SaleLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostAllocation" (
    "id" TEXT NOT NULL,
    "saleLineId" TEXT NOT NULL,
    "costLayerId" TEXT NOT NULL,
    "qty" DECIMAL(14,4) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "CostAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionAccrual" (
    "id" TEXT NOT NULL,
    "saleLineId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "basis" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,4) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ACCRUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionAccrual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "locationId" TEXT,
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "accountId" TEXT,
    "contactId" TEXT,
    "saleId" TEXT,
    "receiptId" TEXT,
    "registerId" TEXT,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegisterSession" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "openingCash" DECIMAL(14,2) NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "expectedCash" DECIMAL(14,2),
    "countedCash" DECIMAL(14,2),
    "variance" DECIMAL(14,2),
    "denominations" JSONB,
    "notes" TEXT,

    CONSTRAINT "RegisterSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Location_code_key" ON "Location"("code");

-- CreateIndex
CREATE UNIQUE INDEX "NumberScheme_docType_locationId_key" ON "NumberScheme"("docType", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "LoginAccount_personId_key" ON "LoginAccount"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "LoginAccount_username_key" ON "LoginAccount"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_accountId_idx" ON "Session"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionProfile_personId_key" ON "CommissionProfile"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionProfile_code_key" ON "CommissionProfile"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerGroup_name_key" ON "CustomerGroup"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_code_key" ON "Contact"("code");

-- CreateIndex
CREATE INDEX "Contact_name_idx" ON "Contact"("name");

-- CreateIndex
CREATE INDEX "Contact_phone_idx" ON "Contact"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_name_key" ON "Brand"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_name_key" ON "Unit"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Warranty_name_key" ON "Warranty"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "Product"("name");

-- CreateIndex
CREATE INDEX "Product_barcode_idx" ON "Product"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_number_key" ON "GoodsReceipt"("number");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_idempotencyKey_key" ON "GoodsReceipt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "GoodsReceipt_supplierId_idx" ON "GoodsReceipt"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "CostLayer_receiptLineId_key" ON "CostLayer"("receiptLineId");

-- CreateIndex
CREATE INDEX "CostLayer_productId_locationId_bucket_receivedAt_idx" ON "CostLayer"("productId", "locationId", "bucket", "receivedAt");

-- CreateIndex
CREATE INDEX "StockMovement_productId_locationId_createdAt_idx" ON "StockMovement"("productId", "locationId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_sourceType_sourceId_idx" ON "StockMovement"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "DeviceIdentity_imei1_idx" ON "DeviceIdentity"("imei1");

-- CreateIndex
CREATE INDEX "DeviceIdentity_serial_idx" ON "DeviceIdentity"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_number_key" ON "Sale"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_idempotencyKey_key" ON "Sale"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Sale_soldAt_idx" ON "Sale"("soldAt");

-- CreateIndex
CREATE INDEX "Sale_customerId_idx" ON "Sale"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionAccrual_saleLineId_role_key" ON "CommissionAccrual"("saleLineId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Account_name_key" ON "Account"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_number_key" ON "Payment"("number");

-- CreateIndex
CREATE INDEX "Payment_paidAt_idx" ON "Payment"("paidAt");

-- CreateIndex
CREATE INDEX "RegisterSession_locationId_closedAt_idx" ON "RegisterSession"("locationId", "closedAt");

-- CreateIndex
CREATE INDEX "AuditEvent_subjectType_subjectId_idx" ON "AuditEvent"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginAccount" ADD CONSTRAINT "LoginAccount_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginAccount" ADD CONSTRAINT "LoginAccount_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LoginAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLocation" ADD CONSTRAINT "UserLocation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LoginAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLocation" ADD CONSTRAINT "UserLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionProfile" ADD CONSTRAINT "CommissionProfile_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CustomerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_warrantyId_fkey" FOREIGN KEY ("warrantyId") REFERENCES "Warranty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptLine" ADD CONSTRAINT "ReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptLine" ADD CONSTRAINT "ReceiptLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostLayer" ADD CONSTRAINT "CostLayer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostLayer" ADD CONSTRAINT "CostLayer_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostLayer" ADD CONSTRAINT "CostLayer_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "ReceiptLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_costLayerId_fkey" FOREIGN KEY ("costLayerId") REFERENCES "CostLayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceIdentity" ADD CONSTRAINT "DeviceIdentity_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceIdentity" ADD CONSTRAINT "DeviceIdentity_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "ReceiptLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "RegisterSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "SaleLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_costLayerId_fkey" FOREIGN KEY ("costLayerId") REFERENCES "CostLayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionAccrual" ADD CONSTRAINT "CommissionAccrual_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "SaleLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionAccrual" ADD CONSTRAINT "CommissionAccrual_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "RegisterSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterSession" ADD CONSTRAINT "RegisterSession_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterSession" ADD CONSTRAINT "RegisterSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
