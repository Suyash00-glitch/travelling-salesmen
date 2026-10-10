import { db, Prisma, type Tx } from '@loomos/db';
import { can, hasPermission, stageForRole, type CurrentUser, type OrderInput, type ReceiptInput, type OutputInput } from '@loomos/shared';
import { audit, code, D, ensure, sum, businessDay, type Actor } from './lib/domain.js';

// ==========================================
// 1. ORDERS
// ==========================================

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
    include: { items: true },
  });
  await audit(tx, actor, 'order.created', order.id, status === 'PENDING_REVIEW'
    ? `${order.number} · Buyer request received, waiting for review`
    : `${order.number} · New buyer order confirmed`);
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

export async function planOrder(tx: Tx, id: string, actor: Actor) {
  const order = await tx.salesOrder.findUnique({
    where: { id },
    include: { items: { include: { recipe: true, production: true } } },
  });
  ensure(order, 'Order not found.', 404);
  ensure(order.status === 'CONFIRMED', 'Only confirmed orders can be planned.');

  for (const item of order.items) {
    ensure(!item.production, 'This order is already planned.');
    await tx.productionOrder.create({
      data: {
        number: code('WO'),
        itemId: item.id,
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

  const pools = new Map<string, ReturnType<typeof D>>();
  const lines = [];

  for (const item of order.items) {
    const recipe = item.recipe;
    const lots = await db.yarnLot.findMany({ where: { material: recipe.material, specification: recipe.specification } });
    const key = `${recipe.material}:${recipe.specification}`;
    if (!pools.has(key)) pools.set(key, sum(lots.map((l) => l.onHand.minus(l.reserved))));

    const required = item.quantity.mul(recipe.kgPerMetre).mul(D(1).plus(recipe.wastePercent.div(100))).toDecimalPlaces(3);
    const reserved = sum(item.production?.reservations.filter((r) => !r.released).map((r) => r.quantity.minus(r.consumed)) ?? []);
    const consumed = sum(item.production?.reservations.map((r) => r.consumed) ?? []);
    const remaining = required.minus(reserved).minus(consumed).greaterThan(0) ? required.minus(reserved).minus(consumed) : D(0);
    const available = pools.get(key)!;
    const shortage = remaining.minus(available).greaterThan(0) ? remaining.minus(available) : D(0);

    pools.set(key, available.minus(remaining).greaterThan(0) ? available.minus(remaining) : D(0));
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

// ==========================================
// 2. INVENTORY
// ==========================================

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
    include: { item: { include: { recipe: true } }, reservations: true },
  });
  ensure(lot && production, 'Lot or production order not found.', 404);
  ensure(!['COMPLETED', 'CANCELLED'].includes(production.status), 'Production order is closed.');
  ensure(lot.material === production.item.recipe.material && lot.specification === production.item.recipe.specification, 'Yarn does not match this fabric recipe.');
  ensure(lot.onHand.minus(lot.reserved).gte(input.quantity), 'Insufficient available yarn.');

  const required = production.target.mul(production.item.recipe.kgPerMetre).mul(D(1).plus(production.item.recipe.wastePercent.div(100))).toDecimalPlaces(3);
  ensure(sum(production.reservations.filter((r) => !r.released).map((r) => r.quantity)).plus(input.quantity).lte(required), 'Reservation exceeds the recipe requirement.');

  const reservation = await tx.stockReservation.upsert({
    where: { lotId_productionId: { lotId: lot.id, productionId: production.id } },
    create: { lotId: lot.id, productionId: production.id, quantity: input.quantity },
    update: { quantity: { increment: input.quantity }, released: false },
  });
  await tx.yarnLot.update({ where: { id: lot.id }, data: { reserved: { increment: input.quantity } } });
  await audit(tx, actor, 'inventory.reserved', lot.id, `${input.quantity} kg reserved for ${production.number}`);
  return reservation;
}

export async function adjustStock(tx: Tx, id: string, quantity: number, reason: string, actor: Actor) {
  const lot = await tx.yarnLot.findUnique({ where: { id } });
  ensure(lot, 'Lot not found.', 404);
  ensure(lot.onHand.plus(quantity).gte(lot.reserved), 'Adjustment would reduce stock below reserved quantity.');

  const result = await tx.yarnLot.update({ where: { id }, data: { onHand: { increment: quantity } } });
  await tx.stockMovement.create({
    data: { lotId: id, kind: quantity > 0 ? 'RETURN' : 'ADJUSTMENT', quantity, reason, source: code('ADJ') },
  });
  await audit(tx, actor, 'inventory.adjusted', id, reason);
  return result;
}

// ==========================================
// 3. PRODUCTION & MACHINES
// ==========================================

const workingStatuses = ['READY', 'PAUSED', 'BLOCKED'];

// Operators can only act on their own stage; managers and admins can act on any.
export function ensureStageAccess(actor: Actor, stage: string) {
  const own = stageForRole(actor.role);
  ensure(!own || own === stage, `This job belongs to the ${stage.toLowerCase()} team.`, 403);
}

export async function startJob(
  tx: Tx,
  id: string,
  input: { machineId?: string; workerId?: string; shiftId?: string },
  actor: Actor,
) {
  const job = await tx.jobCard.findUnique({
    where: { id },
    include: { production: { include: { jobs: true, item: { include: { recipe: true } }, reservations: true } } },
  });
  ensure(job, 'Job not found.', 404);
  ensureStageAccess(actor, job.stage);
  if (job.status === 'IN_PROGRESS') return job;
  ensure(workingStatuses.includes(job.status), 'This job is still waiting for the previous stage.');
  ensure(
    job.production.jobs.every((j) => j.sequence >= job.sequence || j.status === 'COMPLETED'),
    'Finish the previous stage before starting this one.',
  );

  // First stage reserves the yarn it needs, using only stock that really exists.
  if (job.sequence === 0) {
    const recipe = job.production.item.recipe;
    const needed = job.target.mul(recipe.kgPerMetre).mul(D(1).plus(recipe.wastePercent.div(100))).toDecimalPlaces(3);
    let shortage = needed.minus(sum(job.production.reservations.filter((r) => !r.released).map((r) => r.quantity)));
    const lots = await tx.yarnLot.findMany({
      where: { material: recipe.material, specification: recipe.specification },
      orderBy: { createdAt: 'asc' },
    });
    for (const lot of lots) {
      if (shortage.lte(0)) break;
      const take = Prisma.Decimal.min(shortage, lot.onHand.minus(lot.reserved));
      if (take.lte(0)) continue;
      await tx.stockReservation.upsert({
        where: { lotId_productionId: { lotId: lot.id, productionId: job.productionId } },
        create: { lotId: lot.id, productionId: job.productionId, quantity: take },
        update: { quantity: { increment: take }, released: false },
      });
      await tx.yarnLot.update({ where: { id: lot.id }, data: { reserved: { increment: take } } });
      shortage = shortage.minus(take);
    }
    ensure(shortage.lte(0), `Not enough ${recipe.material} yarn in store: ${shortage.toFixed(1)} kg short. Receive more yarn first.`);
  }

  const machine = input.machineId
    ? await tx.machine.findUnique({ where: { id: input.machineId } })
    : await tx.machine.findFirst({ where: { type: job.stage, status: 'IDLE' }, orderBy: { code: 'asc' } });
  ensure(machine, `No idle ${job.stage.toLowerCase()} machine is free right now.`, 409);
  ensure(machine.type === job.stage, `${machine.code} is not a ${job.stage.toLowerCase()} machine.`);
  ensure(machine.status === 'IDLE', `${machine.code} is ${machine.status.toLowerCase()}. Pick an idle machine.`);

  // Default to the logged-in operator, so a worker can accept a job with one tap.
  const workerId = input.workerId ?? actor.workerId ?? undefined;
  const worker = workerId ? await tx.worker.findUnique({ where: { id: workerId } }) : null;
  const shift = input.shiftId
    ? await tx.shift.findUnique({ where: { id: input.shiftId } })
    : await tx.shift.findFirst({ orderBy: { startHour: 'asc' } });

  if (worker) {
    await tx.workerAssignment.updateMany({
      where: { workerId: worker.id, endedAt: null },
      data: { endedAt: new Date() },
    });
  }

  const updated = await tx.jobCard.update({
    where: { id },
    data: {
      machineId: machine.id,
      workerId: worker?.id ?? null,
      shiftId: shift?.id ?? null,
      status: 'IN_PROGRESS',
      startedAt: job.startedAt ?? new Date(),
      assignments: worker ? { create: { workerId: worker.id } } : undefined,
    },
  });
  await tx.machine.update({ where: { id: machine.id }, data: { status: 'RUNNING', reportedAt: new Date() } });
  await tx.productionOrder.update({ where: { id: job.productionId }, data: { status: 'IN_PROGRESS' } });
  await tx.salesOrder.update({ where: { id: job.production.item.orderId }, data: { status: 'IN_PRODUCTION' } });
  await audit(tx, actor, 'production.started', job.production.item.orderId, `${machine.code} · ${job.stage.toLowerCase()} accepted by ${worker?.name ?? actor.name}`);
  return updated;
}

export async function recordOutput(tx: Tx, id: string, input: OutputInput, actor: Actor) {
  const job = await tx.jobCard.findUnique({
    where: { id },
    include: { machine: true, worker: true, production: { include: { item: { include: { recipe: true } }, jobs: true, reservations: { include: { lot: true } } } } },
  });
  ensure(job, 'Job not found.', 404);
  ensureStageAccess(actor, job.stage);
  ensure(job.status === 'IN_PROGRESS', 'Accept the job before recording output.');

  const currentJob = await tx.jobCard.findUniqueOrThrow({
    where: { id },
    include: { machine: true, worker: true, production: { include: { item: { include: { recipe: true } }, jobs: true, reservations: { include: { lot: true } } } } },
  });

  const recipe = currentJob.production.item.recipe;
  const last = currentJob.sequence === Math.max(...currentJob.production.jobs.map((j) => j.sequence));
  const qty = Number(input.quantity);
  const hours = Number(input.hours) || 2;
  const waste = Number(input.waste) || 0;

  const entry = await tx.productionEntry.create({
    data: { jobId: id, quantity: qty, waste, hours },
  });

  if (currentJob.sequence === 0) {
    let lotId = input.lotId;
    if (!lotId) {
      const res = currentJob.production.reservations.find((r) => !r.released);
      lotId = res?.lotId;
    }
    if (!lotId) {
      const lot = await tx.yarnLot.findFirst();
      lotId = lot?.id;
    }
    const consumedKg = (input.consumedKg && input.consumedKg > 0)
      ? Number(input.consumedKg)
      : D(qty).mul(recipe.kgPerMetre).toNumber();

    if (lotId) {
      const lot = await tx.yarnLot.findUnique({ where: { id: lotId } });
      const costPerKg = lot?.costPerKg ?? D(260);
      const cost = D(consumedKg).mul(costPerKg);
      await tx.materialConsumption.create({ data: { entryId: entry.id, lotId, quantity: consumedKg, cost } });
      await tx.yarnLot.update({ where: { id: lotId }, data: { onHand: { decrement: consumedKg } } }).catch(() => {});
      await tx.stockMovement.create({ data: { lotId, kind: 'CONSUMPTION', quantity: D(consumedKg).negated(), reason: `Production output · ${currentJob.production.number}`, source: entry.id } });
      await tx.costAllocation.create({ data: { orderId: currentJob.production.item.orderId, category: 'MATERIAL', amount: cost, source: entry.id, methodology: 'Actual consumed kilograms × receipt unit cost' } });
    }
  }

  const machineCost = currentJob.machine ? currentJob.machine.hourlyCost.mul(hours) : D(200).mul(hours);
  const labour = currentJob.worker ? (currentJob.worker.wageType === 'HOURLY' ? currentJob.worker.rate.mul(hours) : currentJob.worker.rate.mul(qty)) : D(0);

  await tx.costAllocation.createMany({
    data: [
      { category: 'MACHINE', amount: machineCost, methodology: 'Reported run hours × machine hourly rate' },
      { category: 'LABOUR', amount: labour, methodology: 'Reported job hours or output × worker rate; payroll tracked separately' },
      ...(last ? [{ category: 'OVERHEAD', amount: D(qty).mul(recipe.overheadPerMetre), methodology: 'Final-stage output × configured overhead per metre' }] : []),
    ].map((c) => ({ ...c, orderId: currentJob.production.item.orderId, source: entry.id })),
  });

  if (last) {
    const rollLengths = (input.rollLengths && input.rollLengths.length > 0)
      ? input.rollLengths
      : Array.from({ length: Math.ceil(qty / 200) }, (_, i) => Math.min(200, qty - i * 200));
    const costs = await tx.costAllocation.findMany({ where: { orderId: currentJob.production.item.orderId } });
    const totalCost = sum(costs.map((c) => c.amount));
    const rate = qty > 0 ? totalCost.div(qty) : D(100);
    for (const length of rollLengths) {
      await tx.fabricRoll.create({ data: { code: code('RL'), productionId: currentJob.productionId, entryId: entry.id, length, cost: rate.mul(length) } });
    }
  }

  await tx.jobCard.update({ where: { id }, data: { output: { increment: qty } } });
  if (currentJob.machine) {
    await tx.machine.update({ where: { id: currentJob.machine.id }, data: { reportedAt: new Date() } });
  }
  await audit(tx, actor, 'production.output', id, `${currentJob.machine?.code ?? 'Floor'} · ${qty} m output recorded`);
  return entry;
}

export async function transitionJob(tx: Tx, id: string, action: 'pause' | 'complete', actor: Actor) {
  const job = await tx.jobCard.findUnique({
    where: { id },
    include: { production: { include: { jobs: { orderBy: { sequence: 'asc' } }, reservations: true, item: { include: { recipe: true } } } } },
  });
  ensure(job, 'Job not found.', 404);
  ensureStageAccess(actor, job.stage);
  ensure(job.status === 'IN_PROGRESS', 'Only running jobs can be paused or completed.');

  // Auto-record full output if completing and output is less than target
  if (action === 'complete' && job.output.lt(job.target)) {
    const remaining = job.target.minus(job.output).toNumber();
    await recordOutput(tx, id, {
      quantity: remaining,
      waste: 0,
      hours: 2,
      lotId: job.production.reservations.find((r) => !r.released)?.lotId,
      consumedKg: job.sequence === 0 ? D(remaining).mul(job.production.item.recipe.kgPerMetre).toNumber() : 0,
      rollLengths: (job.sequence === job.production.jobs.length - 1)
        ? Array.from({ length: Math.ceil(remaining / 200) }, (_, i) => Math.min(200, remaining - i * 200))
        : [],
    }, actor);
  }

  await tx.jobCard.update({
    where: { id },
    data: { status: action === 'complete' ? 'COMPLETED' : 'PAUSED', endedAt: action === 'complete' ? new Date() : null },
  });
  await tx.workerAssignment.updateMany({ where: { jobId: id, endedAt: null }, data: { endedAt: new Date() } });
  if (job.machineId) await tx.machine.update({ where: { id: job.machineId }, data: { status: 'IDLE', reportedAt: new Date() } });

  if (action === 'complete') {
    const next = job.production.jobs.find((j) => j.sequence === job.sequence + 1);
    if (next) {
      // Hand-off: the next team now sees this job as "Ready to Accept".
      await tx.jobCard.update({ where: { id: next.id }, data: { status: 'READY' } });
    } else {
      await tx.productionOrder.update({ where: { id: job.productionId }, data: { status: 'COMPLETED' } });
      for (const r of job.production.reservations.filter((r) => !r.released)) {
        await tx.yarnLot.update({ where: { id: r.lotId }, data: { reserved: { decrement: r.quantity.minus(r.consumed) } } }).catch(() => {});
        await tx.stockReservation.update({ where: { id: r.id }, data: { released: true } }).catch(() => {});
      }
      await tx.salesOrder.update({ where: { id: job.production.item.orderId }, data: { status: 'QUALITY' } });
    }
  }

  const nextStage = job.production.jobs.find((j) => j.sequence === job.sequence + 1)?.stage;
  const detail = action === 'pause'
    ? `${job.stage.toLowerCase()} paused`
    : `${job.stage.toLowerCase()} completed · ${nextStage ? `sent to ${nextStage.toLowerCase()}` : 'fabric rolls sent to quality check'}`;
  await audit(tx, actor, `production.${action}`, job.production.item.orderId, detail);
  return { id };
}

// One-tap floor action: accept a waiting job, or finish a running one and hand it on.
export async function advanceProductionJob(tx: Tx, id: string, actor: Actor) {
  const job = await tx.jobCard.findUnique({ where: { id } });
  ensure(job, 'Job not found.', 404);
  if (job.status === 'IN_PROGRESS') {
    await transitionJob(tx, id, 'complete', actor);
  } else {
    await startJob(tx, id, {}, actor);
  }
  return tx.jobCard.findUnique({ where: { id } });
}

export async function machineAction(tx: Tx, id: string, action: 'breakdown' | 'recover', reason: string, actor: Actor) {
  const machine = await tx.machine.findUnique({ where: { id } });
  ensure(machine, 'Machine not found.', 404);
  ensureStageAccess(actor, machine.type);
  if (action === 'breakdown') {
    ensure(machine.status !== 'BREAKDOWN', 'This breakdown has already been reported.');
    await tx.downtimeEvent.create({ data: { machineId: id, reason } });
    const jobs = await tx.jobCard.findMany({ where: { machineId: id, status: 'IN_PROGRESS' } });
    for (const job of jobs) {
      await tx.jobCard.update({ where: { id: job.id }, data: { status: 'BLOCKED' } });
      await tx.workerAssignment.updateMany({ where: { jobId: job.id, endedAt: null }, data: { endedAt: new Date() } });
    }
  } else {
    ensure(['BREAKDOWN', 'MAINTENANCE', 'OFFLINE'].includes(machine.status), 'Machine is already available.');
    await tx.downtimeEvent.updateMany({ where: { machineId: id, endedAt: null }, data: { endedAt: new Date() } });
  }
  const result = await tx.machine.update({
    where: { id },
    data: { status: action === 'breakdown' ? 'BREAKDOWN' : 'IDLE', reportedAt: new Date() },
  });
  await audit(tx, actor, `machine.${action}`, id, `${machine.code} · ${reason}`);
  return result;
}

// ==========================================
// 4. QUALITY CONTROL
// ==========================================

export async function inspectRoll(tx: Tx, id: string, input: { result: string; defects: string[]; notes: string }, actor: Actor) {
  const roll = await tx.fabricRoll.findUnique({ where: { id }, include: { production: { include: { item: true } } } });
  ensure(roll, 'Roll not found.', 404);
  ensure(!roll.activeShipmentId, 'A reserved or shipped roll cannot be inspected.');
  ensure(roll.quality === 'PENDING', 'Start rework before recording a new inspection.');

  const inspection = await tx.qualityInspection.create({ data: { rollId: id, inspector: actor.name, ...input } });
  await tx.fabricRoll.update({
    where: { id },
    data: {
      quality: input.result,
      location: input.result === 'PASSED' ? 'Warehouse A · Finished goods' : input.result === 'REWORK' ? 'Rework · Bay 02' : 'QC · Hold',
    },
  });
  if (input.result === 'REWORK') {
    await tx.reworkJob.create({ data: { rollId: id, reason: input.defects.join(', ') } });
  }
  const pending = await tx.fabricRoll.count({ where: { production: { item: { orderId: roll.production.item.orderId } }, quality: { not: 'PASSED' } } });
  const incomplete = await tx.productionOrder.count({ where: { item: { orderId: roll.production.item.orderId }, status: { not: 'COMPLETED' } } });
  if (!pending && !incomplete) {
    await tx.salesOrder.update({ where: { id: roll.production.item.orderId }, data: { status: 'READY' } });
  }
  await audit(tx, actor, 'quality.inspected', id, `${roll.code} · ${input.result.toLowerCase()}`);
  return inspection;
}

export async function reworkRoll(tx: Tx, id: string, cost: number, notes: string, actor: Actor) {
  const roll = await tx.fabricRoll.findUnique({ where: { id }, include: { production: { include: { item: true } }, reworks: true } });
  ensure(roll, 'Roll not found.', 404);
  ensure(roll.quality === 'REWORK' && !roll.activeShipmentId, 'Only unshipped rework rolls can be returned to inspection.');

  const job = roll.reworks.find((j) => j.status === 'OPEN');
  ensure(job, 'No open rework job.');

  await tx.reworkJob.update({ where: { id: job.id }, data: { status: 'COMPLETED', cost, completedAt: new Date() } });
  await tx.costAllocation.create({ data: { orderId: roll.production.item.orderId, category: 'REWORK', amount: D(cost), source: job.id, methodology: notes } });
  await tx.fabricRoll.update({ where: { id }, data: { quality: 'PENDING', cost: { increment: cost } } });
  await audit(tx, actor, 'quality.rework', id, `${roll.code} · Rework completed, awaiting reinspection`);
  return { id };
}

// ==========================================
// 5. DISPATCH & LOGISTICS
// ==========================================

export async function createShipment(tx: Tx, input: { orderId: string; rollIds: string[]; transport: string; driverName?: string; driverPhone?: string }, actor: Actor) {
  ensure(new Set(input.rollIds).size === input.rollIds.length, 'A roll cannot be selected twice.');
  const rolls = await tx.fabricRoll.findMany({ where: { id: { in: input.rollIds } }, include: { production: { include: { item: true } } } });
  ensure(rolls.length === input.rollIds.length, 'One or more rolls could not be found.', 404);

  for (const roll of rolls) {
    ensure(roll.quality === 'PASSED', 'Only quality-approved rolls can be shipped.');
    ensure(!roll.activeShipmentId, 'A selected roll is already reserved or dispatched.');
    ensure(roll.production.item.orderId === input.orderId, 'All rolls must belong to the selected buyer order.');
  }

  const order = await tx.salesOrder.findUnique({ where: { id: input.orderId }, include: { items: true, shipments: true } });
  ensure(order, 'Order not found.', 404);
  ensure(!['CANCELLED', 'COMPLETED'].includes(order.status), 'Order is not eligible for dispatch.');

  const quantity = sum(rolls.map((r) => r.length));
  ensure(quantity.plus(sum(order.shipments.filter((s) => s.status !== 'CANCELLED').map((s) => s.quantity))).lte(sum(order.items.map((i) => i.quantity))), 'Shipment exceeds the remaining order quantity.');

  const shipment = await tx.shipment.create({
    data: {
      number: code('DSP'),
      orderId: input.orderId,
      transport: input.transport,
      driverName: input.driverName ?? '',
      driverPhone: input.driverPhone ?? '',
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
    include: { rolls: { include: { roll: { include: { production: { include: { item: true } } } } } }, order: { include: { items: true, shipments: true } } },
  });
  ensure(shipment, 'Shipment not found.', 404);
  ensure(shipment.status === 'DRAFT', 'Shipment has already been confirmed or cancelled.');

  for (const row of shipment.rolls) {
    ensure(row.verified, 'Verify every roll label before dispatch.');
    ensure(row.roll.quality === 'PASSED' && row.roll.activeShipmentId === id, 'Roll is no longer available for this shipment.');
  }
  ensure(sum(shipment.rolls.map((r) => r.roll.length)).eq(shipment.quantity), 'Selected roll quantities do not reconcile.');

  const total = sum(shipment.rolls.map((r) => r.roll.length.mul(r.roll.production.item.price)));
  const invoice = await tx.invoice.create({ data: { number: code('INV'), shipmentId: id, total } });

  await tx.shipment.update({ where: { id }, data: { status: 'DISPATCHED', confirmedAt: new Date() } });
  await tx.fabricRoll.updateMany({ where: { activeShipmentId: id }, data: { location: 'Dispatched' } });

  const shipped = sum(shipment.order.shipments.filter((s) => s.status === 'DISPATCHED').map((s) => s.quantity)).plus(shipment.quantity);
  await tx.salesOrder.update({ where: { id: shipment.orderId }, data: { status: shipped.eq(sum(shipment.order.items.map((i) => i.quantity))) ? 'COMPLETED' : 'PARTIAL' } });
  await audit(tx, actor, 'shipment.confirmed', id, `${shipment.number} · ${shipment.quantity} m dispatched and invoiced`);
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

export async function buyerPayment(tx: Tx, id: string, input: { amount: number; reference: string }, actor: Actor) {
  const invoice = await tx.invoice.findUnique({ where: { id }, include: { payments: true } });
  ensure(invoice, 'Invoice not found.', 404);
  ensure(invoice.status !== 'VOID', 'A void invoice cannot receive payments.');

  const paid = sum(invoice.payments.map((p) => p.amount)).plus(input.amount);
  ensure(paid.lte(invoice.total), 'Payment exceeds the outstanding balance.');

  const payment = await tx.buyerPayment.create({ data: { invoiceId: id, ...input } });
  await tx.invoice.update({ where: { id }, data: { status: paid.eq(invoice.total) ? 'PAID' : 'PARTIAL' } });
  await audit(tx, actor, 'finance.payment', id, `${D(input.amount).toFixed(2)} received against ${invoice.number}`);
  return payment;
}

// ==========================================
// 6. WORKFORCE
// ==========================================

export async function recordAttendance(tx: Tx, input: { workerId: string; shiftId: string; date: string; hours: number; status: string }, actor: Actor) {
  const worker = await tx.worker.findUnique({ where: { id: input.workerId } });
  ensure(worker?.active, 'Worker is not available.', 404);

  const shift = await tx.shift.findUnique({ where: { id: input.shiftId } });
  ensure(shift, 'Shift not found.', 404);
  ensure(D(input.hours).lte(shift.hours), 'Attendance hours cannot exceed the shift duration.');
  ensure(input.status === 'PRESENT' || input.hours === 0, 'Absent workers must have zero hours.');
  ensure(new Date(input.date).getTime() <= Date.now(), 'Future attendance cannot be recorded.');

  const day = businessDay(new Date(`${input.date}T12:00:00+05:30`));
  const entries = await tx.productionEntry.findMany({ where: { job: { workerId: worker.id }, createdAt: { gte: day, lt: new Date(day.getTime() + 86400000) } } });
  const quantity = sum(entries.map((e) => e.quantity));
  const amount = input.status === 'PRESENT' ? worker.rate.mul(worker.wageType === 'HOURLY' ? D(input.hours) : quantity) : D(0);

  const attendance = await tx.attendance.create({
    data: {
      ...input,
      date: new Date(input.date),
      wage: {
        create: {
          workerId: worker.id,
          amount,
          calculation: worker.wageType === 'HOURLY' ? `${input.hours} hours × ${worker.rate} / hour` : `${quantity} metres × ${worker.rate} / metre; one worker-day snapshot`,
        },
      },
    },
  });
  await audit(tx, actor, 'workforce.attendance', worker.id, `${worker.name} · ${input.hours} hours recorded`);
  return attendance;
}

// ==========================================
// 7. REPORTING & DASHBOARD
// ==========================================

const orderInclude = {
  buyer: true,
  items: { include: { recipe: true, production: { include: { jobs: { include: { machine: true } }, rolls: true, reservations: true } } } },
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
    const rolls = order.items.flatMap((i) => i.production?.rolls ?? []);
    const produced = sum(rolls.map((r) => r.length));
    const approved = sum(rolls.filter((r) => r.quality === 'PASSED').map((r) => r.length));
    const dispatched = sum(order.shipments.filter((s) => s.status === 'DISPATCHED').map((s) => s.quantity));
    const jobs = order.items.flatMap((i) => i.production?.jobs ?? []);
    const reasons: string[] = [];
    const remaining = quantity.minus(produced);
    const hoursLeft = Math.max(0, (order.deadline.getTime() - Date.now()) / 3600000);

    if (order.status !== 'COMPLETED' && order.deadline < new Date()) reasons.push('Delivery deadline has passed');
    if (jobs.some((j) => j.machine?.status === 'BREAKDOWN')) reasons.push('Assigned machine is in breakdown');
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
      stage: jobs.find((j) => j.status === 'IN_PROGRESS')?.stage ?? jobs.find((j) => j.status !== 'COMPLETED')?.stage ?? orderStageNames[order.status] ?? 'PLANNING',
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

export async function machineSummaries(day = businessDay()) {
  const machines = await db.machine.findMany({
    include: {
      jobs: { where: { status: { in: ['IN_PROGRESS', 'BLOCKED', 'PAUSED'] } }, include: { worker: true, production: { include: { item: { include: { order: { include: { buyer: true } } } } } } } },
      downtime: { where: { endedAt: null } },
    },
    orderBy: { code: 'asc' },
  });

  const entries = await db.productionEntry.findMany({
    where: { createdAt: { gte: day, lt: new Date(day.getTime() + 86400000) } },
    include: { job: true },
  });

  return machines.map((m) => ({
    ...m,
    hourlyCost: undefined,
    todayOutput: sum(entries.filter((e) => e.job.machineId === m.id).map((e) => e.quantity)).toString(),
    jobs: m.jobs.map((j) => ({
      ...j,
      worker: j.worker ? { name: j.worker.name } : null,
      production: {
        number: j.production.number,
        item: {
          fabric: j.production.item.fabric,
          color: j.production.item.color,
          order: { id: j.production.item.order.id, number: j.production.item.order.number, buyer: { name: j.production.item.order.buyer.name } },
        },
      },
    })),
  }));
}

export async function financialReport(month?: string) {
  const from = month ? new Date(`${month}-01T00:00:00+05:30`) : undefined;
  const until = from ? new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1) - 330 * 60000) : undefined;
  const end = month
    ? new Date(`${Number(month.slice(5)) === 12 ? Number(month.slice(0, 4)) + 1 : month.slice(0, 4)}-${String(Number(month.slice(5)) === 12 ? 1 : Number(month.slice(5)) + 1).padStart(2, '0')}-01T00:00:00+05:30`)
    : until;
  const createdAt = from ? { gte: from, lt: end } : undefined;

  const [invoices, payments, costs, expenses, bills, wages, supplierPayments, orders] = await Promise.all([
    db.invoice.findMany({ where: { status: { not: 'VOID' }, createdAt }, include: { payments: true, shipment: { include: { order: { include: { buyer: true } } } } } }),
    db.buyerPayment.findMany({ where: { createdAt } }),
    db.costAllocation.findMany({ where: { createdAt } }),
    db.operatingExpense.findMany({ where: { createdAt } }),
    db.supplierBill.findMany({ include: { payments: true, receipt: { include: { lot: { include: { supplier: true } } } } } }),
    db.wageEntry.findMany({ include: { worker: true, attendance: true } }),
    db.supplierPayment.findMany({ where: { createdAt } }),
    db.salesOrder.findMany({ include: { buyer: true, items: true, costs: true, shipments: { include: { invoice: true } } } }),
  ]);

  const billed = sum(invoices.map((i) => i.total));
  const received = sum(payments.map((p) => p.amount));
  const cost = sum(costs.map((c) => c.amount));
  const overhead = sum(expenses.map((e) => e.amount));

  return {
    billed,
    received,
    cost,
    expenses: overhead,
    outstanding: sum(invoices.map((i) => i.total.minus(sum(i.payments.map((p) => p.amount))))),
    estimatedProfit: billed.minus(cost).minus(overhead),
    cashMovement: received.minus(sum(supplierPayments.map((p) => p.amount))).minus(sum(wages.filter((w) => w.paidAt && (!from || w.paidAt >= from) && (!end || w.paidAt < end)).map((w) => w.amount))).minus(overhead),
    invoices: invoices.map((i) => ({ id: i.id, number: i.number, buyer: i.shipment.order.buyer.name, order: i.shipment.order.number, total: i.total, paid: sum(i.payments.map((p) => p.amount)), status: i.status, createdAt: i.createdAt })),
    bills: bills.map((b) => ({ id: b.id, supplier: b.receipt.lot.supplier.name, reference: b.receipt.reference, total: b.total, paid: sum(b.payments.map((p) => p.amount)), dueAt: b.dueAt })),
    wages: sum(wages.map((w) => w.amount)),
    costBreakdown: ['MATERIAL', 'LABOUR', 'MACHINE', 'OVERHEAD', 'REWORK'].map((category) => ({ category, amount: sum(costs.filter((c) => c.category === category).map((c) => c.amount)) })),
    orders: orders.map((o) => ({ id: o.id, number: o.number, buyer: o.buyer.name, estimatedRevenue: sum(o.items.map((i) => i.price.mul(i.quantity))), billed: sum(o.shipments.filter((s) => s.invoice && s.invoice.status !== 'VOID').map((s) => s.invoice!.total)), actualCost: sum(o.costs.map((c) => c.amount)), margin: sum(o.shipments.filter((s) => s.invoice && s.invoice.status !== 'VOID').map((s) => s.invoice!.total)).minus(sum(o.costs.map((c) => c.amount))) })),
  };
}

export async function dashboard(user: CurrentUser, date?: string) {
  const day = date ? businessDay(new Date(`${date}T12:00:00+05:30`)) : businessDay();
  const [orders, machines, lots, rolls, entries, activity] = await Promise.all([
    orderSummaries(user),
    machineSummaries(day),
    db.yarnLot.findMany(),
    db.fabricRoll.findMany({ include: { activeShipment: true } }),
    db.productionEntry.findMany({ where: { createdAt: { gte: new Date(day.getTime() - 6 * 86400000), lt: new Date(day.getTime() + 86400000) } }, include: { job: { include: { production: true } } } }),
    db.auditLog.findMany({ take: 8, orderBy: { createdAt: 'desc' }, where: !can(user.role, 'finance') ? { action: { not: { startsWith: 'finance.' } } } : undefined }),
  ]);

  const active = orders.filter((o) => !['COMPLETED', 'CANCELLED'].includes(o.status));
  const alerts: { id: string; title: string; description: string; severity: 'warning' | 'danger' | 'success'; href: string }[] = [];

  if (can(user.role, 'machines')) {
    machines.filter((m) => m.status === 'BREAKDOWN').forEach((m) => alerts.push({ id: m.id, title: `${m.code} needs attention`, description: m.downtime[0]?.reason ?? 'Breakdown reported by the floor team', severity: 'danger', href: '/machines' }));
  }
  if (can(user.role, 'inventory')) {
    lots.filter((l) => l.onHand.minus(l.reserved).lt(l.threshold)).forEach((l) => alerts.push({ id: l.id, title: `${l.material} running low`, description: `${l.onHand.minus(l.reserved)} kg available · ${l.specification}`, severity: 'warning', href: '/inventory' }));
  }
  if (can(user.role, 'orders')) {
    active.filter((o) => o.risk.reasons.length).slice(0, 3).forEach((o) => alerts.push({ id: o.id, title: `${o.number} · Delivery risk`, description: o.risk.reasons[0], severity: 'warning', href: `/orders/${o.id}` }));
  }
  if (can(user.role, 'quality')) {
    const rejected = rolls.filter((r) => r.quality === 'REWORK');
    if (rejected.length) alerts.push({ id: 'rework', title: `${rejected.length} rolls need rework`, description: 'Review defects before reinspection.', severity: 'warning', href: '/quality' });
  }

  const series = Array.from({ length: 7 }, (_, i) => {
    const start = new Date(day.getTime() - (6 - i) * 86400000);
    const end = new Date(start.getTime() + 86400000);
    return {
      date: start.toISOString(),
      label: new Intl.DateTimeFormat('en', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(start),
      output: sum(entries.filter((e) => e.createdAt >= start && e.createdAt < end).map((e) => e.quantity)).toNumber(),
      target: sum(machines.filter((m) => m.status !== 'OFFLINE').map((m) => D(m.capacityPerHour).mul(8))).toNumber(),
    };
  });

  return {
    date: day,
    activeOrders: active.length,
    dueSoon: active.filter((o) => new Date(o.deadline).getTime() - day.getTime() < 7 * 86400000).length,
    delayed: active.filter((o) => new Date(o.deadline) < day).length,
    availableYarn: sum(lots.map((l) => l.onHand.minus(l.reserved))).toString(),
    todayOutput: String(series[6].output),
    previousOutput: String(series[5].output),
    pendingQuality: rolls.filter((r) => r.quality === 'PENDING').length,
    passed: rolls.filter((r) => r.quality === 'PASSED').length,
    rejected: rolls.filter((r) => r.quality === 'REJECTED').length,
    finishedRolls: rolls.filter((r) => r.quality === 'PASSED' && !r.activeShipmentId).length,
    pendingDispatch: rolls.filter((r) => r.activeShipment?.status === 'DRAFT').length,
    running: machines.filter((m) => m.status === 'RUNNING').length,
    idle: machines.filter((m) => m.status === 'IDLE').length,
    breakdown: machines.filter((m) => m.status === 'BREAKDOWN').length,
    totalMachines: machines.length,
    series,
    orders: orders.slice(0, 5),
    machines,
    alerts,
    activity,
    finance: can(user.role, 'finance') ? await financialReport() : undefined,
  };
}

export async function rollPassport(id: string, user: CurrentUser) {
  const roll = await db.fabricRoll.findFirst({
    where: { OR: [{ id }, { code: id }] },
    include: {
      inspections: { orderBy: { createdAt: 'desc' } },
      reworks: true,
      production: { include: { item: { include: { order: { include: { buyer: true } }, recipe: true } }, jobs: { include: { machine: true, entries: { include: { consumptions: { include: { lot: { include: { supplier: true } } } } } } } } } },
      shipmentHistory: { include: { shipment: true } },
    },
  });
  ensure(roll, 'Roll not found.', 404);
  if (user.role === 'BUYER') ensure(roll.production.item.order.buyerId === user.buyerId, 'Roll not found.', 404);

  return {
    id: roll.id,
    code: roll.code,
    length: roll.length,
    quality: roll.quality,
    location: roll.location,
    fabric: roll.production.item.fabric,
    color: roll.production.item.color,
    order: roll.production.item.order.number,
    buyer: roll.production.item.order.buyer.name,
    createdAt: roll.createdAt,
    inspections: roll.inspections,
    stages: roll.production.jobs.map((j) => ({ stage: j.stage, status: j.status, machine: j.machine?.code, output: j.output, startedAt: j.startedAt, endedAt: j.endedAt })),
    lots: user.role === 'BUYER' ? [] : roll.production.jobs.flatMap((j) => j.entries.flatMap((e) => e.consumptions.map((c) => ({ code: c.lot.code, material: c.lot.material, supplier: c.lot.supplier.name, quantity: c.quantity })))),
    shipments: roll.shipmentHistory.map((s) => ({ number: s.shipment.number, status: s.shipment.status, transport: s.shipment.transport })),
  };
}

// ==========================================
// 8. TEAM INBOX
// ==========================================

type Notice = { id: string; title: string; description: string; severity: 'warning' | 'danger' | 'success'; href: string };

// Work waiting for the signed-in user's team. Built from live data, so it is
// always accurate and needs no separate notification table.
export async function workInbox(user: CurrentUser): Promise<Notice[]> {
  const notices: Notice[] = [];
  const stage = stageForRole(user.role);

  if (stage || can(user.role, 'production')) {
    const ready = await db.jobCard.findMany({
      where: { status: 'READY', ...(stage ? { stage } : {}) },
      include: { production: { include: { item: true } } },
      orderBy: { production: { createdAt: 'asc' } },
    });
    for (const job of ready) {
      notices.push({
        id: `job-${job.id}`,
        title: `${job.production.number} is ready for ${job.stage.toLowerCase()}`,
        description: `${job.production.item.fabric} · ${job.production.item.color} · ${job.target.toString()} m · Tap to accept`,
        severity: 'success',
        href: '/production',
      });
    }
  }

  if (hasPermission(user, 'orders', 'approve')) {
    const requests = await db.salesOrder.findMany({ where: { status: 'PENDING_REVIEW' }, include: { buyer: true } });
    for (const order of requests) {
      notices.push({ id: `order-${order.id}`, title: `New order from ${order.buyer.name}`, description: `${order.number} is waiting for your review`, severity: 'warning', href: `/orders/${order.id}` });
    }
  }

  // Quality and dispatch work is grouped per order, so each new batch gets its own notice.
  const rollsByOrder = async (where: Prisma.FabricRollWhereInput) => {
    const rolls = await db.fabricRoll.findMany({ where, include: { production: { include: { item: { include: { order: true } } } } } });
    const groups = new Map<string, { number: string; count: number }>();
    for (const roll of rolls) {
      const order = roll.production.item.order;
      const group = groups.get(order.id) ?? { number: order.number, count: 0 };
      group.count += 1;
      groups.set(order.id, group);
    }
    return groups;
  };

  if (hasPermission(user, 'quality', 'update')) {
    for (const [orderId, g] of await rollsByOrder({ quality: 'PENDING' })) {
      notices.push({ id: `quality-${orderId}`, title: `${g.number}: ${g.count} roll${g.count > 1 ? 's' : ''} to inspect`, description: 'Check each roll and mark it passed or failed', severity: 'warning', href: '/quality' });
    }
  }

  if (hasPermission(user, 'dispatch', 'update')) {
    for (const [orderId, g] of await rollsByOrder({ quality: 'PASSED', activeShipmentId: null })) {
      notices.push({ id: `dispatch-${orderId}`, title: `${g.number}: ${g.count} roll${g.count > 1 ? 's' : ''} ready to ship`, description: 'Passed quality check · create a shipment', severity: 'success', href: '/dispatch' });
    }
  }

  return notices;
}
