-- Quick receive: shop staff add stock without cost; the owner adds cost, supplier and payment later.

-- DropForeignKey
ALTER TABLE "GoodsReceipt" DROP CONSTRAINT "GoodsReceipt_supplierId_fkey";

-- AlterTable
ALTER TABLE "CostLayer" ADD COLUMN     "costPending" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "GoodsReceipt" ADD COLUMN     "costAddedAt" TIMESTAMP(3),
ADD COLUMN     "costAddedById" TEXT,
ALTER COLUMN "supplierId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ReceiptLine" ADD COLUMN     "newProduct" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only a GRN still waiting for cost may have no supplier.
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_supplier_required" CHECK ("supplierId" IS NOT NULL OR status = 'PENDING_COST');

-- Shop staff (Cashier) may quick receive; owners already get every permission.
UPDATE "Role" SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['purchases.quick_receive']))
WHERE name IN ('Owner/Admin', 'Cashier');
