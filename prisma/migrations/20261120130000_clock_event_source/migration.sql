-- AlterTable
ALTER TABLE "ClockEvent" ADD COLUMN     "deviceId" TEXT,
ADD COLUMN     "ip" TEXT,
ADD COLUMN     "sessionId" TEXT;

-- AddForeignKey
ALTER TABLE "ClockEvent" ADD CONSTRAINT "ClockEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "ShopDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

