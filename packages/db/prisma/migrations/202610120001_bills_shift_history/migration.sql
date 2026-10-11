-- Supplier bills can be entered by accounts, not only created by yarn receipts.
ALTER TABLE "SupplierBill" DROP CONSTRAINT "SupplierBill_receiptId_fkey";

ALTER TABLE "SupplierBill" ADD COLUMN "billDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "category" TEXT NOT NULL DEFAULT 'YARN',
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN "number" TEXT NOT NULL DEFAULT '',
ADD COLUMN "recordedBy" TEXT NOT NULL DEFAULT '',
ADD COLUMN "supplierId" TEXT,
ALTER COLUMN "receiptId" DROP NOT NULL;

-- Existing bills all came from yarn receipts: copy the supplier, reference and date across.
UPDATE "SupplierBill" b
SET "supplierId" = l."supplierId",
    "number" = r."reference",
    "billDate" = r."receivedAt",
    "createdAt" = r."receivedAt",
    "description" = 'Yarn receipt ' || r."reference"
FROM "GoodsReceipt" r
JOIN "YarnLot" l ON l."id" = r."lotId"
WHERE r."id" = b."receiptId";

ALTER TABLE "SupplierBill" ALTER COLUMN "supplierId" SET NOT NULL;

CREATE INDEX "SupplierBill_billDate_idx" ON "SupplierBill"("billDate");

ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Shifts can be retired without losing their history.
ALTER TABLE "Shift" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

-- Yarn can be received for a specific customer order.
ALTER TABLE "YarnLot" ADD COLUMN "orderId" TEXT;
ALTER TABLE "YarnLot" ADD CONSTRAINT "YarnLot_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
