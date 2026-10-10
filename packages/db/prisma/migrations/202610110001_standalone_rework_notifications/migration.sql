-- DropForeignKey
ALTER TABLE "CostAllocation" DROP CONSTRAINT "CostAllocation_orderId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionOrder" DROP CONSTRAINT "ProductionOrder_itemId_fkey";

-- DropForeignKey
ALTER TABLE "ReworkJob" DROP CONSTRAINT "ReworkJob_rollId_fkey";

-- AlterTable
ALTER TABLE "CostAllocation" ADD COLUMN     "productionId" TEXT,
ALTER COLUMN "orderId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ProductionOrder" ADD COLUMN     "color" TEXT,
ADD COLUMN     "createdBy" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "fabric" TEXT,
ADD COLUMN     "notes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "orderId" TEXT,
ADD COLUMN     "priority" TEXT NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'ORDER',
ADD COLUMN     "recipeId" TEXT,
ADD COLUMN     "replacesId" TEXT,
ADD COLUMN     "unitPrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
ALTER COLUMN "itemId" DROP NOT NULL;

-- Backfill: existing batches copy their recipe, fabric, colour, price and order from the order line.
UPDATE "ProductionOrder" p
SET "recipeId" = i."recipeId", "fabric" = i."fabric", "color" = i."color",
    "unitPrice" = i."price", "orderId" = i."orderId"
FROM "SalesOrderItem" i
WHERE p."itemId" = i."id";

ALTER TABLE "ProductionOrder" ALTER COLUMN "recipeId" SET NOT NULL,
ALTER COLUMN "fabric" SET NOT NULL,
ALTER COLUMN "color" SET NOT NULL;

-- Backfill: link existing costs and rework records to their batch.
UPDATE "CostAllocation" c
SET "productionId" = j."productionId"
FROM "ProductionEntry" e JOIN "JobCard" j ON j."id" = e."jobId"
WHERE c."source" = e."id";


-- AlterTable
ALTER TABLE "ReworkJob" ADD COLUMN     "defectType" TEXT NOT NULL DEFAULT 'QUALITY_FAILURE',
ADD COLUMN     "fromStage" TEXT NOT NULL DEFAULT 'QUALITY',
ADD COLUMN     "machineId" TEXT,
ADD COLUMN     "outcome" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "productionId" TEXT,
ADD COLUMN     "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
ADD COLUMN     "raisedBy" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "resolvedBy" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "returnStage" TEXT,
ADD COLUMN     "rollCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "workerId" TEXT,
ALTER COLUMN "rollId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "approvalStatus" TEXT NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "note" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "phone" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "requestedRole" TEXT;

-- CreateTable
CREATE TABLE "ProductionIssue" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "jobId" TEXT,
    "stage" TEXT,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT NOT NULL DEFAULT '',
    "reportedBy" TEXT NOT NULL,
    "resolvedBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ProductionIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "link" TEXT NOT NULL DEFAULT '',
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionIssue_status_createdAt_idx" ON "ProductionIssue"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_read_createdAt_idx" ON "Notification"("userId", "read", "createdAt");

-- CreateIndex
CREATE INDEX "ProductionOrder_status_createdAt_idx" ON "ProductionOrder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ReworkJob_status_createdAt_idx" ON "ReworkJob"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "SalesOrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "ProductionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReworkJob" ADD CONSTRAINT "ReworkJob_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "FabricRoll"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReworkJob" ADD CONSTRAINT "ReworkJob_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "ProductionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReworkJob" ADD CONSTRAINT "ReworkJob_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReworkJob" ADD CONSTRAINT "ReworkJob_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionIssue" ADD CONSTRAINT "ProductionIssue_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "ProductionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: link existing roll rework records to their batch.
UPDATE "ReworkJob" r
SET "productionId" = f."productionId", "rollCodes" = ARRAY[f."code"]
FROM "FabricRoll" f
WHERE r."rollId" = f."id";
