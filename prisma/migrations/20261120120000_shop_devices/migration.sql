-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "deviceId" TEXT;

-- CreateTable
CREATE TABLE "ShopDevice" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "registeredById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ShopDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopDevice_tokenHash_key" ON "ShopDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "ShopDevice_locationId_idx" ON "ShopDevice"("locationId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "ShopDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopDevice" ADD CONSTRAINT "ShopDevice_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopDevice" ADD CONSTRAINT "ShopDevice_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Block Supabase REST access, like every other table.
ALTER TABLE "ShopDevice" ENABLE ROW LEVEL SECURITY;
