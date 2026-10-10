import { db, Prisma, type Tx } from '@loomos/db';
import type { CurrentUser, OrderInput } from '@loomos/shared';
import { audit, code, D, ensure, sum, type Actor } from '../lib/domain.js';
import { notify, managers, stageTeams } from './notification.service.js';

export async function createOrder(tx: Tx, input: OrderInput, actor: Actor, status = 'CONFIRMED') {
  ensure(await tx.buyer.findUnique({ where: { id: input.buyerId } }), 'Buyer not found.', 404);
  for (const item of input.items) {
    ensure(await tx.recipe.findUnique({ where: { id: item.recipeId } }), 'Recipe not found.', 404);
  }
  const order = await tx.salesOrder.create({
    data: {
      number: code('SO'),
      buyerId: input.buyerId,
      deadline: new Date(input.deadline),
      priority: input.priority,
      instructions: input.instructions,
      status,
      items: { create: input.items },
    },
    include: { items: true, buyer: true },
  });
  await audit(tx, actor, 'order.created', order.id, status === 'PENDING_REVIEW'
    ? `${order.number} · Buyer request received, waiting for review`
    : `${order.number} · New buyer order confirmed`);

  if (status === 'PENDING_REVIEW') {
    await notify(tx, {
      roles: managers,
      title: `New order request from ${order.buyer.name}`,
      message: `${order.number} is waiting for your review.`,
      category: 'ORDER',
      link: `/orders/${order.id}`,
    });
  }
  return order;
}

export async function acceptOrder(tx: Tx, id: string, actor: Actor) {
  const order = await tx.salesOrder.findUnique({ where: { id } });
  ensure(order, 'Order not found.', 404);
  ensure(order.status === 'PENDING_REVIEW', 'Only orders waiting for review can be accepted.');
  await tx.salesOrder.update({ where: { id }, data: { status: 'CONFIRMED' } });
  await audit(tx, actor, 'order.accepted', id, `${order.number} · Accepted and sent to spinning`);
  return planOrder(tx, id, actor);
}

export async function rejectOrder(tx: Tx, id: string, reason: string, actor: Actor) {
  const order = await tx.salesOrder.findUnique({ where: { id } });
  ensure(order, 'Order not found.', 404);
  ensure(order.status === 'PENDING_REVIEW', 'Only orders waiting for review can be declined.');
  await audit(tx, actor, 'order.rejected', id, `${order.number} · Declined: ${reason}`);
  return tx.salesOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
}

// Creates one production batch per order line, with a job card for every stage of the recipe.
export async function planOrder(tx: Tx, id: string, actor: Actor) {
  const order = await tx.salesOrder.findUnique({
    where: { id },
    include: { items: { include: { recipe: true, production: true } } },
  });
  ensure(order, 'Order not found.', 404);
  ensure(order.status === 'CONFIRMED', 'Only confirmed orders can be planned.');

  for (const item of order.items) {
    ensure(!item.production, 'This order is already planned.');
    const batch = await tx.productionOrder.create({
      data: {
        number: code('WO'),
        itemId: item.id,
        orderId: order.id,
        recipeId: item.recipeId,
        fabric: item.fabric,
        color: item.color,
        unitPrice: item.price,
        purpose: 'ORDER',
        priority: order.priority,
        dueDate: order.deadline,
        createdBy: actor.name,
        target: item.quantity,
        jobs: {
          create: item.recipe.route.map((stage, sequence) => ({
            stage,
            sequence,
            target: item.quantity,
            status: sequence === 0 ? 'READY' : 'PLANNED',
          })),
        },
      },
    });

    await audit(tx, actor, 'production.created', batch.id, `${batch.number} · ${item.quantity.toString()} m ${item.fabric} planned for order ${order.number}`);
    const firstStage = item.recipe.route[0];
    await notify(tx, {
      roles: stageTeams[firstStage] ?? [],
      title: `${batch.number} is ready for ${firstStage.toLowerCase()}`,
      message: `${item.fabric} · ${item.color} · ${item.quantity.toString()} m for order ${order.number}.`,
      category: 'PRODUCTION',
      link: '/production',
      skipUserId: actor.id,
    });
  }
  await tx.salesOrder.update({ where: { id }, data: { status: 'PLANNED' } });
  await audit(tx, actor, 'order.planned', id, `${order.number} · Production route created`);
  return { id };
}

export async function materialPlan(id: string) {
  const order = await db.salesOrder.findUnique({
    where: { id },
    include: { items: { include: { recipe: true, production: { include: { reservations: { include: { lot: true } } } } } } },
  });
  ensure(order, 'Order not found.', 404);

  const pools = new Map<string, Prisma.Decimal>();
  const lines = [];

  for (const item of order.items) {
    const recipe = item.recipe;
    const lots = await db.yarnLot.findMany({ where: { material: recipe.material, specification: recipe.specification } });
    const key = `${recipe.material}:${recipe.specification}`;
    if (!pools.has(key)) pools.set(key, sum(lots.map((l) => l.onHand.minus(l.reserved))));

    const required = item.quantity.mul(recipe.kgPerMetre).mul(D(1).plus(recipe.wastePercent.div(100))).toDecimalPlaces(3);
    const reserved = sum(item.production?.reservations.filter((r) => !r.released).map((r) => r.quantity.minus(r.consumed)) ?? []);
    const consumed = sum(item.production?.reservations.map((r) => r.consumed) ?? []);
    const remaining = Prisma.Decimal.max(required.minus(reserved).minus(consumed), 0);
    const available = pools.get(key)!;
    const shortage = Prisma.Decimal.max(remaining.minus(available), 0);

    pools.set(key, Prisma.Decimal.max(available.minus(remaining), 0));
    lines.push({
      itemId: item.id,
      fabric: item.fabric,
      productionId: item.production?.id,
      material: recipe.material,
      specification: recipe.specification,
      required,
      reserved,
      consumed,
      available,
      shortage,
      lots: lots.map((l) => ({ ...l, available: l.onHand.minus(l.reserved) })),
    });
  }
  return lines;
}

const orderInclude = {
  buyer: true,
  items: { include: { recipe: true, production: { include: { jobs: { include: { machine: true } }, reservations: true } } } },
  // All batches for the order, including replacement batches.
  productions: { include: { jobs: { include: { machine: true } }, rolls: true } },
  shipments: true,
} satisfies Prisma.SalesOrderInclude;

// What a buyer sees once no production stage is active.
const orderStageNames: Record<string, string> = {
  PENDING_REVIEW: 'WAITING FOR REVIEW',
  CANCELLED: 'DECLINED',
  QUALITY: 'QUALITY CHECK',
  READY: 'READY TO SHIP',
  PARTIAL: 'PARTLY DISPATCHED',
  COMPLETED: 'DELIVERED',
};

export async function orderSummaries(user: CurrentUser) {
  const orders = await db.salesOrder.findMany({
    where: user.role === 'BUYER' ? { buyerId: user.buyerId ?? 'none' } : {},
    include: orderInclude,
    orderBy: { createdAt: 'desc' },
  });

  return orders.map((order) => {
    const quantity = sum(order.items.map((i) => i.quantity));
    const batches = order.productions.filter((p) => p.status !== 'CANCELLED');
    const rolls = batches.flatMap((p) => p.rolls);
    const produced = sum(rolls.map((r) => r.length));
    const approved = sum(rolls.filter((r) => r.quality === 'PASSED').map((r) => r.length));
    const dispatched = sum(order.shipments.filter((s) => s.status === 'DISPATCHED').map((s) => s.quantity));
    const jobs = batches.flatMap((p) => p.jobs);
    const reasons: string[] = [];
    const remaining = quantity.minus(produced);
    const hoursLeft = Math.max(0, (order.deadline.getTime() - Date.now()) / 3600000);

    if (order.status !== 'COMPLETED' && order.deadline < new Date()) reasons.push('Delivery deadline has passed');
    if (jobs.some((j) => j.machine?.status === 'BREAKDOWN')) reasons.push('Assigned machine is in breakdown');
    if (batches.some((p) => p.status === 'REWORK')) reasons.push('A batch is being reworked');
    if (order.items.some((i) => i.production && i.production.status !== 'COMPLETED' && sum(i.production.reservations.filter((r) => !r.released).map((r) => r.quantity)).lt(i.quantity.mul(i.recipe.kgPerMetre)))) {
      reasons.push('Yarn reservation is incomplete');
    }
    const capacity = sum(jobs.filter((j) => j.status !== 'COMPLETED' && j.machine && j.machine.status !== 'BREAKDOWN').map((j) => j.machine!.capacityPerHour));
    if (remaining.gt(0) && capacity.gt(0) && remaining.div(capacity).gt(D(hoursLeft).div(3))) {
      reasons.push('Remaining output exceeds one-shift capacity before deadline');
    }

    return {
      id: order.id,
      number: order.number,
      buyer: { id: order.buyer.id, name: order.buyer.name, initials: order.buyer.initials, city: order.buyer.city },
      status: order.status,
      priority: order.priority,
      deadline: order.deadline,
      createdAt: order.createdAt,
      instructions: order.instructions,
      quantity: quantity.toString(),
      value: sum(order.items.map((i) => i.quantity.mul(i.price))).toString(),
      produced: produced.toString(),
      approved: approved.toString(),
      dispatched: dispatched.toString(),
      progress: quantity.gt(0) ? Math.min(100, Math.round(produced.div(quantity).mul(100).toNumber())) : 0,
      stage: jobs.find((j) => j.status === 'IN_PROGRESS')?.stage
        ?? jobs.find((j) => !['COMPLETED', 'CANCELLED'].includes(j.status))?.stage
        ?? orderStageNames[order.status]
        ?? 'PLANNING',
      risk: { level: reasons.length ? 'ATTENTION' : 'ON_TRACK', reasons },
      items: order.items.map((i) => ({
        id: i.id,
        fabric: i.fabric,
        color: i.color,
        quantity: i.quantity,
        price: i.price,
        recipeId: i.recipeId,
        recipe: { name: i.recipe.name, specification: i.recipe.specification },
        production: i.production
          ? {
              id: i.production.id,
              number: i.production.number,
              status: i.production.status,
              target: i.production.target,
              jobs: i.production.jobs.map((j) => ({
                id: j.id,
                stage: j.stage,
                sequence: j.sequence,
                status: j.status,
                target: j.target,
                output: j.output,
                ...(user.role === 'BUYER' ? {} : { machineId: j.machineId, workerId: j.workerId, shiftId: j.shiftId }),
              })),
            }
          : null,
      })),
    };
  });
}
