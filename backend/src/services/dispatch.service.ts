import type { Tx } from '@loomos/db';
import { audit, code, ensure, sum, type Actor } from '../lib/domain.js';
import { notify } from './notification.service.js';

export async function createShipment(tx: Tx, input: { orderId: string; rollIds: string[]; transport: string; driverName?: string; driverPhone?: string; expectedAt?: string }, actor: Actor) {
  ensure(new Set(input.rollIds).size === input.rollIds.length, 'A roll cannot be selected twice.');
  const rolls = await tx.fabricRoll.findMany({ where: { id: { in: input.rollIds } }, include: { production: true } });
  ensure(rolls.length === input.rollIds.length, 'One or more rolls could not be found.', 404);

  const order = await tx.salesOrder.findUnique({ where: { id: input.orderId }, include: { items: true, shipments: true } });
  ensure(order, 'Order not found.', 404);
  ensure(!['CANCELLED', 'COMPLETED'].includes(order.status), 'Order is not eligible for dispatch.');

  for (const roll of rolls) {
    ensure(roll.quality === 'PASSED', 'Only quality-approved rolls can be shipped.');
    ensure(!roll.activeShipmentId, 'A selected roll is already reserved or dispatched.');
    if (roll.production.orderId) {
      ensure(roll.production.orderId === input.orderId, 'All rolls must belong to the selected buyer order.');
    } else {
      // Finished stock can fill any order for the same fabric.
      ensure(order.items.some((i) => i.recipeId === roll.production.recipeId), `${roll.code} is ${roll.production.fabric}, which this order did not ask for.`);
    }
  }

  const quantity = sum(rolls.map((r) => r.length));
  ensure(quantity.plus(sum(order.shipments.filter((s) => s.status !== 'CANCELLED').map((s) => s.quantity))).lte(sum(order.items.map((i) => i.quantity))), 'Shipment exceeds the remaining order quantity.');

  const shipment = await tx.shipment.create({
    data: {
      number: code('DSP'),
      orderId: input.orderId,
      transport: input.transport,
      driverName: input.driverName ?? '',
      driverPhone: input.driverPhone ?? '',
      expectedAt: input.expectedAt ? new Date(input.expectedAt) : null,
      quantity,
      rolls: { create: rolls.map((r) => ({ rollId: r.id })) },
    },
  });
  await tx.fabricRoll.updateMany({ where: { id: { in: input.rollIds } }, data: { activeShipmentId: shipment.id } });
  await audit(tx, actor, 'shipment.created', shipment.id, `${shipment.number} · ${quantity} m reserved for dispatch`);
  return shipment;
}

export async function verifyRoll(tx: Tx, id: string, rollCode: string, actor: Actor) {
  const shipment = await tx.shipment.findUnique({ where: { id }, include: { rolls: { include: { roll: true } } } });
  ensure(shipment, 'Shipment not found.', 404);
  ensure(shipment.status === 'DRAFT', 'Only draft shipments can be verified.');
  const row = shipment.rolls.find((r) => r.roll.code === rollCode || r.roll.id === rollCode);
  ensure(row, 'This roll does not belong to the shipment.');
  if (!row.verified) await audit(tx, actor, 'shipment.verified', id, `${row.roll.code} label scanned and loaded`);
  return tx.shipmentRoll.update({ where: { id: row.id }, data: { verified: true } });
}

export async function confirmShipment(tx: Tx, id: string, actor: Actor) {
  const shipment = await tx.shipment.findUnique({
    where: { id },
    include: { rolls: { include: { roll: { include: { production: true } } } }, order: { include: { items: true, shipments: true } } },
  });
  ensure(shipment, 'Shipment not found.', 404);
  ensure(shipment.status === 'DRAFT', 'Shipment has already been confirmed or cancelled.');

  for (const row of shipment.rolls) {
    ensure(row.verified, 'Verify every roll label before dispatch.');
    ensure(row.roll.quality === 'PASSED' && row.roll.activeShipmentId === id, 'Roll is no longer available for this shipment.');
  }
  ensure(sum(shipment.rolls.map((r) => r.roll.length)).eq(shipment.quantity), 'Selected roll quantities do not reconcile.');

  // Order batches carry their own price; stock rolls use the order's price for that fabric.
  const priceOf = (production: { orderId: string | null; unitPrice: { toString(): string }; recipeId: string }) => {
    if (production.orderId) return production.unitPrice;
    const item = shipment.order.items.find((i) => i.recipeId === production.recipeId) ?? shipment.order.items[0];
    return item.price;
  };
  const total = sum(shipment.rolls.map((r) => r.roll.length.mul(priceOf(r.roll.production).toString())));
  const invoice = await tx.invoice.create({ data: { number: code('INV'), shipmentId: id, total, dueAt: new Date(Date.now() + 30 * 86400000) } });

  await tx.shipment.update({ where: { id }, data: { status: 'DISPATCHED', confirmedAt: new Date() } });
  await tx.fabricRoll.updateMany({ where: { activeShipmentId: id }, data: { location: 'Dispatched' } });

  const shipped = sum(shipment.order.shipments.filter((s) => s.status === 'DISPATCHED').map((s) => s.quantity)).plus(shipment.quantity);
  await tx.salesOrder.update({ where: { id: shipment.orderId }, data: { status: shipped.eq(sum(shipment.order.items.map((i) => i.quantity))) ? 'COMPLETED' : 'PARTIAL' } });
  await audit(tx, actor, 'shipment.confirmed', id, `${shipment.number} · ${shipment.quantity} m dispatched and invoiced`);
  await audit(tx, actor, 'shipment.confirmed', shipment.orderId, `${shipment.number} · ${shipment.quantity} m dispatched`);

  // Let the buyer know their fabric is on the way.
  const buyerUsers = await tx.user.findMany({ where: { buyerId: shipment.order.buyerId, active: true }, select: { id: true } });
  await notify(tx, {
    userIds: buyerUsers.map((u) => u.id),
    title: `${shipment.order.number} has been dispatched`,
    message: `${shipment.quantity.toString()} m on ${shipment.transport}.`,
    category: 'DISPATCH',
    link: '/buyer',
  });
  return invoice;
}

export async function cancelShipment(tx: Tx, id: string, reason: string, actor: Actor) {
  const shipment = await tx.shipment.findUnique({ where: { id }, include: { invoice: { include: { payments: true } } } });
  ensure(shipment, 'Shipment not found.', 404);
  ensure(shipment.status !== 'CANCELLED', 'Shipment already cancelled.');
  ensure(!shipment.invoice?.payments.length, 'Reverse payments before cancelling an invoiced shipment.');

  if (shipment.invoice) await tx.invoice.update({ where: { id: shipment.invoice.id }, data: { status: 'VOID' } });
  await tx.shipment.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason } });
  await tx.fabricRoll.updateMany({ where: { activeShipmentId: id }, data: { activeShipmentId: null, location: 'Warehouse A · Finished goods' } });

  const remaining = await tx.shipment.count({ where: { orderId: shipment.orderId, status: 'DISPATCHED' } });
  await tx.salesOrder.update({ where: { id: shipment.orderId }, data: { status: remaining ? 'PARTIAL' : 'READY' } });
  await audit(tx, actor, 'shipment.cancelled', id, reason);
  return { id };
}

// The goods reached the buyer. Only dispatched shipments can be delivered.
export async function deliverShipment(tx: Tx, id: string, input: { receivedBy: string; note: string }, actor: Actor) {
  const shipment = await tx.shipment.findUnique({ where: { id }, include: { order: { include: { buyer: true } } } });
  ensure(shipment, 'Shipment not found.', 404);
  ensure(shipment.status === 'DISPATCHED', 'Only shipments on the road can be marked delivered.');
  await tx.shipment.update({ where: { id }, data: { status: 'DELIVERED', deliveredAt: new Date(), receivedBy: input.receivedBy } });
  await tx.fabricRoll.updateMany({ where: { activeShipmentId: id }, data: { location: 'Delivered' } });
  await audit(tx, actor, 'shipment.delivered', id, `${shipment.number} delivered${input.receivedBy ? ` · received by ${input.receivedBy}` : ''}${input.note ? ` · ${input.note}` : ''}`);
  await audit(tx, actor, 'shipment.delivered', shipment.orderId, `${shipment.number} delivered to ${shipment.order.buyer.name}`);
  const buyerUsers = await tx.user.findMany({ where: { buyerId: shipment.order.buyerId, active: true }, select: { id: true } });
  await notify(tx, {
    userIds: buyerUsers.map((u) => u.id),
    title: `${shipment.order.number} delivered`,
    message: `${shipment.quantity.toString()} m arrived.${input.note ? ` ${input.note}` : ''}`,
    category: 'DISPATCH',
    link: '/buyer',
  });
  return { id };
}
