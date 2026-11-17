-- Short supplier code used to number GRN lots (e.g. MTCP-0001).
ALTER TABLE "Contact" ADD COLUMN "supplierCode" TEXT;
ALTER TABLE "Contact" ADD COLUMN "lotSeq" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "Contact_supplierCode_key" ON "Contact"("supplierCode");
