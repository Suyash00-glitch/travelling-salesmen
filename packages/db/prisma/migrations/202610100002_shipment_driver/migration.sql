-- Driver contact for each truck shipment
ALTER TABLE "Shipment" ADD COLUMN "driverName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Shipment" ADD COLUMN "driverPhone" TEXT NOT NULL DEFAULT '';
