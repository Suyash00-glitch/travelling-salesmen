-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "checkInAt" TIMESTAMP(3),
ADD COLUMN     "checkOutAt" TIMESTAMP(3),
ADD COLUMN     "note" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "overtimeHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
ADD COLUMN     "recordedBy" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "DowntimeEvent" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'BREAKDOWN',
ADD COLUMN     "reportedBy" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "resolution" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "adjustment" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "dueAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Machine" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "OperatingExpense" ADD COLUMN     "recordedBy" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pricePerMetre" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "expectedAt" TIMESTAMP(3),
ADD COLUMN     "receivedBy" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "MachineAssignment" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "workerId" TEXT,
    "shiftId" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "MachineAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "buyerId" TEXT,
    "supplierId" TEXT,
    "orderId" TEXT,
    "invoiceId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL DEFAULT '',
    "decidedBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MachineAssignment_machineId_startedAt_idx" ON "MachineAssignment"("machineId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_number_key" ON "Claim"("number");

-- CreateIndex
CREATE INDEX "Claim_status_createdAt_idx" ON "Claim"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "MachineAssignment" ADD CONSTRAINT "MachineAssignment_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineAssignment" ADD CONSTRAINT "MachineAssignment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineAssignment" ADD CONSTRAINT "MachineAssignment_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineAssignment" ADD CONSTRAINT "MachineAssignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: materials take the price of their latest order line; invoices are due 30 days after issue.
UPDATE "Recipe" r SET "pricePerMetre" = COALESCE(
  (SELECT i."price" FROM "SalesOrderItem" i JOIN "SalesOrder" o ON o."id" = i."orderId"
   WHERE i."recipeId" = r."id" ORDER BY o."createdAt" DESC LIMIT 1), 0);
UPDATE "Invoice" SET "dueAt" = "createdAt" + INTERVAL '30 days' WHERE "dueAt" IS NULL;
