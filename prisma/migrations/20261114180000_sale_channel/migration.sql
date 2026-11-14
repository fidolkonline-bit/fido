-- Sale type: IN_STORE (normal), FINTREX (Fintrex payment scheme), COD (online cash-on-delivery order).
ALTER TABLE "Sale" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'IN_STORE';
ALTER TABLE "Sale" ADD COLUMN "channelRef" TEXT;
CREATE INDEX "Sale_channel_soldAt_idx" ON "Sale"("channel", "soldAt");
