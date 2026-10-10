import { db, Prisma, type Tx } from '@loomos/db';
import type { ReceiptInput } from '@loomos/shared';
import { audit, code, D, ensure, sum, type Actor } from '../lib/domain.js';

// ==================== STOCK SAFETY ====================
// Every change to a lot's quantities goes through these helpers. They update the row with a
// condition in SQL, so two users acting at the same time can never over-reserve or go negative.

// Reserve `qty` kg of a lot for a batch. Fails if the lot does not have that much free.
export async function reserveFromLot(tx: Tx, lotId: string, productionId: string, qty: Prisma.Decimal) {
  if (qty.lte(0)) return;
  const changed = await tx.$executeRaw`UPDATE "YarnLot" SET "reserved" = "reserved" + ${qty}
    WHERE "id" = ${lotId} AND "onHand" - "reserved" >= ${qty}`;
  ensure(changed === 1, 'Not enough free yarn in this lot. Someone may have reserved it just now.');
  await tx.stockReservation.upsert({
    where: { lotId_productionId: { lotId, productionId } },
    create: { lotId, productionId, quantity: qty },
    update: { quantity: { increment: qty }, released: false },
  });
}

// Take `qty` kg out of a lot for production. The reserved part of it is released at the same time.
export async function consumeFromLot(tx: Tx, lotId: string, productionId: string, qty: Prisma.Decimal) {
  const reservation = await tx.stockReservation.findUnique({ where: { lotId_productionId: { lotId, productionId } } });
  const fromReservation = reservation && !reservation.released
    ? Prisma.Decimal.min(qty, Prisma.Decimal.max(reservation.quantity.minus(reservation.consumed), 0))
    : D(0);
  const changed = await tx.$executeRaw`UPDATE "YarnLot"
    SET "onHand" = "onHand" - ${qty}, "reserved" = "reserved" - ${fromReservation}
    WHERE "id" = ${lotId} AND "onHand" >= ${qty} AND "reserved" >= ${fromReservation}`;
  ensure(changed === 1, 'This lot does not have enough yarn left for that quantity.');
  if (reservation && fromReservation.gt(0)) {
    await tx.stockReservation.update({ where: { id: reservation.id }, data: { consumed: { increment: fromReservation } } });
  }
}

// Give back whatever a batch reserved but never used (batch finished or cancelled).
export async function releaseReservations(tx: Tx, productionId: string) {
  const reservations = await tx.stockReservation.findMany({ where: { productionId, released: false } });
  for (const r of reservations) {
    const unused = Prisma.Decimal.max(r.quantity.minus(r.consumed), 0);
    if (unused.gt(0)) {
      await tx.$executeRaw`UPDATE "YarnLot" SET "reserved" = GREATEST("reserved" - ${unused}, 0) WHERE "id" = ${r.lotId}`;
    }
    await tx.stockReservation.update({ where: { id: r.id }, data: { released: true } });
  }
}

// Stock grouped by material and specification: what the inventory page and dashboards show.
export async function materialSummary() {
  const [lots, consumption] = await Promise.all([
    db.yarnLot.findMany(),
    db.materialConsumption.groupBy({ by: ['lotId'], _sum: { quantity: true } }),
  ]);
  const consumedByLot = new Map(consumption.map((c) => [c.lotId, c._sum.quantity ?? D(0)]));
  const groups = new Map<string, { material: string; specification: string; lots: number; onHand: Prisma.Decimal; reserved: Prisma.Decimal; consumed: Prisma.Decimal; threshold: Prisma.Decimal }>();
  for (const lot of lots) {
    const key = `${lot.material} · ${lot.specification}`;
    const g = groups.get(key) ?? { material: lot.material, specification: lot.specification, lots: 0, onHand: D(0), reserved: D(0), consumed: D(0), threshold: D(0) };
    g.lots += 1;
    g.onHand = g.onHand.plus(lot.onHand);
    g.reserved = g.reserved.plus(lot.reserved);
    g.consumed = g.consumed.plus(consumedByLot.get(lot.id) ?? 0);
    g.threshold = g.threshold.plus(lot.threshold);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({
    ...g,
    available: g.onHand.minus(g.reserved),
    low: g.onHand.minus(g.reserved).lt(g.threshold),
  }));
}

export async function receiveYarn(tx: Tx, input: ReceiptInput, actor: Actor) {
  ensure(await tx.supplier.findUnique({ where: { id: input.supplierId } }), 'Supplier not found.', 404);
  if (input.purchaseId) {
    const po = await tx.purchaseOrder.findUnique({ where: { id: input.purchaseId }, include: { receipts: true } });
    ensure(po, 'Purchase order not found.', 404);
    ensure(
      po.supplierId === input.supplierId &&
        po.material === input.material &&
        po.color === input.color &&
        po.specification === input.specification,
      'Receipt must match the purchase order.',
    );
    const total = sum(po.receipts.map((r) => r.quantity)).plus(input.quantity);
    ensure(total.lte(po.quantity), 'Receipt exceeds the purchase quantity.');
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: total.eq(po.quantity) ? 'RECEIVED' : 'PARTIAL' } });
  }

  const lot = await tx.yarnLot.create({
    data: {
      code: code('YL'),
      supplierId: input.supplierId,
      material: input.material,
      color: input.color,
      specification: input.specification,
      location: input.location,
      onHand: input.quantity,
      costPerKg: input.costPerKg,
      threshold: input.threshold,
    },
  });

  const receipt = await tx.goodsReceipt.create({
    data: {
      reference: input.reference,
      purchaseId: input.purchaseId,
      lotId: lot.id,
      quantity: input.quantity,
      bill: { create: { total: D(input.quantity).mul(input.costPerKg), dueAt: new Date(Date.now() + 30 * 86400000) } },
    },
  });

  await tx.stockMovement.create({
    data: { lotId: lot.id, kind: 'RECEIPT', quantity: input.quantity, reason: 'Supplier goods receipt', source: receipt.id },
  });
  await audit(tx, actor, 'inventory.received', lot.id, `${lot.code} · ${input.quantity} kg ${input.material} received`);
  return lot;
}

export async function reserveYarn(tx: Tx, input: { lotId: string; productionId: string; quantity: number }, actor: Actor) {
  const lot = await tx.yarnLot.findUnique({ where: { id: input.lotId } });
  const production = await tx.productionOrder.findUnique({
    where: { id: input.productionId },
    include: { recipe: true, reservations: true },
  });
  ensure(lot && production, 'Lot or production order not found.', 404);
  ensure(!['COMPLETED', 'CANCELLED'].includes(production.status), 'Production order is closed.');
  ensure(lot.material === production.recipe.material && lot.specification === production.recipe.specification, 'Yarn does not match this fabric recipe.');
  ensure(lot.onHand.minus(lot.reserved).gte(input.quantity), 'Insufficient available yarn.');

  const required = production.target.mul(production.recipe.kgPerMetre).mul(D(1).plus(production.recipe.wastePercent.div(100))).toDecimalPlaces(3);
  ensure(sum(production.reservations.filter((r) => !r.released).map((r) => r.quantity)).plus(input.quantity).lte(required), 'Reservation exceeds the recipe requirement.');

  await reserveFromLot(tx, lot.id, production.id, D(input.quantity));
  await audit(tx, actor, 'inventory.reserved', lot.id, `${input.quantity} kg reserved for ${production.number}`);
  return { lotId: lot.id, productionId: production.id };
}

// Manual correction: returns (+), or damaged / written-off stock (−). Never below what is reserved.
export async function adjustStock(tx: Tx, id: string, quantity: number, reason: string, actor: Actor, kind?: string) {
  const lot = await tx.yarnLot.findUnique({ where: { id } });
  ensure(lot, 'Lot not found.', 404);
  const changed = await tx.$executeRaw`UPDATE "YarnLot" SET "onHand" = "onHand" + ${quantity}
    WHERE "id" = ${id} AND "onHand" + ${quantity} >= "reserved"`;
  ensure(changed === 1, 'Adjustment would reduce stock below the reserved quantity.');
  const result = await tx.yarnLot.findUniqueOrThrow({ where: { id } });
  await tx.stockMovement.create({
    data: { lotId: id, kind: kind ?? (quantity > 0 ? 'RETURN' : 'ADJUSTMENT'), quantity, reason, source: code('ADJ') },
  });
  await audit(tx, actor, 'inventory.adjusted', id, reason);
  return result;
}
