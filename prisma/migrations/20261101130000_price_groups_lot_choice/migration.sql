-- AlterTable
ALTER TABLE "CustomerGroup" ADD COLUMN     "adjustmentPct" DECIMAL(6,2),
ADD COLUMN     "priceGroupId" TEXT;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "priceGroupId" TEXT,
ADD COLUMN     "priceGroupName" TEXT,
ADD COLUMN     "pricingBasis" TEXT;

-- AlterTable
ALTER TABLE "SaleLine" ADD COLUMN     "listPrice" DECIMAL(14,2),
ADD COLUMN     "priceGroupId" TEXT,
ADD COLUMN     "priceGroupName" TEXT,
ADD COLUMN     "priceRule" TEXT;

-- CreateTable
CREATE TABLE "PriceGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceGroupAccess" (
    "priceGroupId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "PriceGroupAccess_pkey" PRIMARY KEY ("priceGroupId","roleId")
);

-- CreateTable
CREATE TABLE "ProductPrice" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "priceGroupId" TEXT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "zeroConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceGroup_name_key" ON "PriceGroup"("name");

-- CreateIndex
CREATE INDEX "ProductPrice_priceGroupId_idx" ON "ProductPrice"("priceGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductPrice_productId_priceGroupId_key" ON "ProductPrice"("productId", "priceGroupId");

-- AddForeignKey
ALTER TABLE "CustomerGroup" ADD CONSTRAINT "CustomerGroup_priceGroupId_fkey" FOREIGN KEY ("priceGroupId") REFERENCES "PriceGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceGroupAccess" ADD CONSTRAINT "PriceGroupAccess_priceGroupId_fkey" FOREIGN KEY ("priceGroupId") REFERENCES "PriceGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceGroupAccess" ADD CONSTRAINT "PriceGroupAccess_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_priceGroupId_fkey" FOREIGN KEY ("priceGroupId") REFERENCES "PriceGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_priceGroupId_fkey" FOREIGN KEY ("priceGroupId") REFERENCES "PriceGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_priceGroupId_fkey" FOREIGN KEY ("priceGroupId") REFERENCES "PriceGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Every app table is closed to Supabase's public API; the app reaches Postgres only through Prisma.
ALTER TABLE "PriceGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PriceGroupAccess" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductPrice" ENABLE ROW LEVEL SECURITY;

-- Initial configuration imported from the old system's selling-price groups. Editable afterwards; ids are what links to them.
INSERT INTO "PriceGroup" ("id", "name", "sortOrder") VALUES
  (gen_random_uuid()::text, 'Discounted Prices', 1),
  (gen_random_uuid()::text, 'Regular Customer Prices', 2),
  (gen_random_uuid()::text, 'Shop Prices', 3),
  (gen_random_uuid()::text, 'VIP Customer Prices', 4),
  (gen_random_uuid()::text, 'Whole Sale Prices', 5);
