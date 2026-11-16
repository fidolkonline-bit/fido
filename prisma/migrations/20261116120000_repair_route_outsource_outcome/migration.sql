-- Repairs: in-house vs outsourced route, outside-shop trips, and the repaired / not repaired outcome. Additive only.
-- AlterTable
ALTER TABLE "RepairJob" ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "outcomeReason" TEXT,
ADD COLUMN     "route" TEXT;

-- CreateTable
CREATE TABLE "RepairOutsource" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedAt" TIMESTAMP(3),
    "quote" DECIMAL(14,2),
    "returnedAt" TIMESTAMP(3),
    "cost" DECIMAL(14,2),
    "result" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairOutsource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepairOutsource_jobId_idx" ON "RepairOutsource"("jobId");

-- CreateIndex
CREATE INDEX "RepairOutsource_vendorId_idx" ON "RepairOutsource"("vendorId");

-- AddForeignKey
ALTER TABLE "RepairOutsource" ADD CONSTRAINT "RepairOutsource_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "RepairJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairOutsource" ADD CONSTRAINT "RepairOutsource_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairOutsource" ADD CONSTRAINT "RepairOutsource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Block the Supabase REST API, like every other public table (Prisma connects as owner).
ALTER TABLE "RepairOutsource" ENABLE ROW LEVEL SECURITY;
