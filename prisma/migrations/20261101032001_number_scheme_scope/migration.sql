-- DropIndex
DROP INDEX "NumberScheme_docType_locationId_key";

-- AlterTable
ALTER TABLE "NumberScheme" DROP COLUMN "locationId",
ADD COLUMN     "scope" TEXT NOT NULL DEFAULT 'ALL',
ALTER COLUMN "digits" SET DEFAULT 4;

-- CreateIndex
CREATE UNIQUE INDEX "NumberScheme_docType_scope_key" ON "NumberScheme"("docType", "scope");

