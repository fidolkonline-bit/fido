-- How many barcode labels have been printed for each GRN line.
ALTER TABLE "ReceiptLine" ADD COLUMN "labelsPrinted" INTEGER NOT NULL DEFAULT 0;
