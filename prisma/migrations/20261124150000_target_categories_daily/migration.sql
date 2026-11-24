-- AlterTable
ALTER TABLE "SalesTarget" ADD COLUMN     "cadence" TEXT NOT NULL DEFAULT 'PERIOD',
ADD COLUMN     "categoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
