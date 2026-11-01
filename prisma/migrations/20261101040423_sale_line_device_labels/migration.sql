-- AlterTable
ALTER TABLE "SaleLine" ADD COLUMN     "deviceLabels" TEXT[] DEFAULT ARRAY[]::TEXT[];


-- Backfill labels for devices already sold.
UPDATE "SaleLine" sl SET "deviceLabels" = sub.labels
FROM (SELECT "saleLineId", array_agg(COALESCE(imei1, serial, id) ORDER BY "createdAt") AS labels FROM "DeviceIdentity" WHERE "saleLineId" IS NOT NULL GROUP BY "saleLineId") sub
WHERE sl.id = sub."saleLineId";
