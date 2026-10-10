import { db, Prisma, type Tx } from '@loomos/db';
import {
  hasPermission,
  stageForRole,
  type CurrentUser,
  type OutputInput,
  type StandaloneBatchInput,
} from '@loomos/shared';
import { audit, code, D, ensure, sum, type Actor } from '../lib/domain.js';
import { notify, managers, stageTeams } from './notification.service.js';
import { finishReworkRun, activeRework } from './rework.service.js';

// ==================== SHARED HELPERS ====================

// Operators can only act on their own stage; managers and admins can act on any.
export function ensureStageAccess(actor: Actor, stage: string) {
  const own = stageForRole(actor.role);
  ensure(!own || own === stage, `This job belongs to the ${stage.toLowerCase()} team.`, 403);
}

export function ensureManager(actor: Actor) {
  ensure(hasPermission(actor, 'production', 'manage'), 'Only production managers can do this.', 403);
}

type BatchWithOrder = {
  id: string;
  number: string;
  fabric: string;
  color: string;
  recipeId: string;
  purpose: string;
  order: { id: string; number: string; buyer: { id: string; name: string } } | null;
};

// The short batch description every screen uses. `order` is null for stock batches.
export function batchRef(p: BatchWithOrder) {
  return {
    id: p.id,
    number: p.number,
    fabric: p.fabric,
    color: p.color,
    recipeId: p.recipeId,
    purpose: p.purpose,
    order: p.order
      ? { id: p.order.id, number: p.order.number, buyer: { id: p.order.buyer.id, name: p.order.buyer.name } }
      : null,
  };
}

const freeMachine = (tx: Tx, machineId: string | null) =>
  machineId
    ? tx.machine.updateMany({ where: { id: machineId, status: 'RUNNING' }, data: { status: 'IDLE', reportedAt: new Date() } })
    : null;

// ==================== FLOOR WORK: START, OUTPUT, FINISH ====================

const workingStatuses = ['READY', 'PAUSED', 'BLOCKED'];

export async function startJob(
  tx: Tx,
  id: string,
  input: { machineId?: string; workerId?: string; shiftId?: string },
  actor: Actor,
) {
  const job = await tx.jobCard.findUnique({
    where: { id },
    include: { production: { include: { jobs: true, recipe: true, reservations: true } } },
  });
  ensure(job, 'Job not found.', 404);
  ensureStageAccess(actor, job.stage);
  if (job.status === 'IN_PROGRESS') return job;
  ensure(job.production.status !== 'CANCELLED', 'This batch has been cancelled.');
  ensure(workingStatuses.includes(job.status), 'This job is still waiting for the previous stage.');
  ensure(
    job.production.jobs.every((j) => j.sequence >= job.sequence || j.status === 'COMPLETED'),
    'Finish the previous stage before starting this one.',
  );

  // First stage reserves the yarn it needs, using only stock that really exists.
  if (job.sequence === 0) {
    const recipe = job.production.recipe;
    const needed = job.target.mul(recipe.kgPerMetre).mul(D(1).plus(recipe.wastePercent.div(100))).toDecimalPlaces(3);
    let shortage = needed.minus(sum(job.production.reservations.filter((r) => !r.released).map((r) => r.quantity.minus(r.consumed))));
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

  // Machine: the one chosen now, else the one planned for this job, else any idle machine of the right type.
  const planned = job.machineId ? await tx.machine.findUnique({ where: { id: job.machineId } }) : null;
  const machine = input.machineId
    ? await tx.machine.findUnique({ where: { id: input.machineId } })
    : planned?.status === 'IDLE'
      ? planned
      : await tx.machine.findFirst({ where: { type: job.stage, status: 'IDLE' }, orderBy: { code: 'asc' } });
  ensure(machine, `No idle ${job.stage.toLowerCase()} machine is free right now.`, 409);
  ensure(machine.type === job.stage, `${machine.code} is not a ${job.stage.toLowerCase()} machine.`);
  ensure(machine.status === 'IDLE', `${machine.code} is ${machine.status.toLowerCase()}. Pick an idle machine.`);

  // Worker: chosen now, else planned, else the logged-in operator (one-tap accept).
  const workerId = input.workerId ?? job.workerId ?? actor.workerId ?? undefined;
  const worker = workerId ? await tx.worker.findUnique({ where: { id: workerId } }) : null;
  const shift = input.shiftId
    ? await tx.shift.findUnique({ where: { id: input.shiftId } })
    : await tx.shift.findFirst({ orderBy: { startHour: 'asc' } });

  if (worker) {
    await tx.workerAssignment.updateMany({ where: { workerId: worker.id, endedAt: null }, data: { endedAt: new Date() } });
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

  if (job.production.status === 'REWORK') {
    // The rework is now physically under way.
    await tx.reworkJob.updateMany({
      where: { productionId: job.productionId, status: 'OPEN', returnStage: { not: null } },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });
  } else {
    await tx.productionOrder.update({ where: { id: job.productionId }, data: { status: 'IN_PROGRESS' } });
  }
  if (job.production.orderId) {
    await tx.salesOrder.update({ where: { id: job.production.orderId }, data: { status: 'IN_PRODUCTION' } });
  }
  await audit(tx, actor, 'production.started', job.productionId, `${job.production.number} · ${job.stage.toLowerCase()} started on ${machine.code} by ${worker?.name ?? actor.name}`);
  return updated;
}

export async function recordOutput(tx: Tx, id: string, input: OutputInput, actor: Actor) {
  const job = await tx.jobCard.findUnique({
    where: { id },
    include: { machine: true, worker: true, production: { include: { recipe: true, jobs: true, reservations: { include: { lot: true } } } } },
  });
  ensure(job, 'Job not found.', 404);
  ensureStageAccess(actor, job.stage);
  ensure(job.status === 'IN_PROGRESS', 'Accept the job before recording output.');

  const production = job.production;
  const recipe = production.recipe;
  const last = job.sequence === Math.max(...production.jobs.map((j) => j.sequence));
  const inRework = production.status === 'REWORK';
  const qty = Number(input.quantity);
  const hours = Number(input.hours) || 2;
  const waste = Number(input.waste) || 0;

  const entry = await tx.productionEntry.create({ data: { jobId: id, quantity: qty, waste, hours } });

  // Costs belong to the batch, and also to the customer order when there is one.
  // While a batch is being reworked every cost is booked as rework cost.
  const costRow = (category: string, amount: Prisma.Decimal, methodology: string) => ({
    orderId: production.orderId,
    productionId: production.id,
    category: inRework ? 'REWORK' : category,
    amount,
    source: entry.id,
    methodology,
  });

  if (job.sequence === 0) {
    const lotId = input.lotId
      ?? production.reservations.find((r) => !r.released)?.lotId
      ?? (await tx.yarnLot.findFirst({ where: { material: recipe.material } }))?.id;
    const consumedKg = input.consumedKg && input.consumedKg > 0 ? Number(input.consumedKg) : D(qty).mul(recipe.kgPerMetre).toNumber();

    if (lotId) {
      const lot = await tx.yarnLot.findUnique({ where: { id: lotId } });
      const cost = D(consumedKg).mul(lot?.costPerKg ?? D(260));
      await tx.materialConsumption.create({ data: { entryId: entry.id, lotId, quantity: consumedKg, cost } });
      // Yarn leaves the store; the part that was reserved for this batch is no longer reserved.
      const reservation = production.reservations.find((r) => r.lotId === lotId && !r.released);
      const fromReservation = reservation
        ? Prisma.Decimal.min(D(consumedKg), Prisma.Decimal.max(reservation.quantity.minus(reservation.consumed), 0))
        : D(0);
      await tx.yarnLot.update({
        where: { id: lotId },
        data: { onHand: { decrement: consumedKg }, reserved: { decrement: fromReservation } },
      });
      if (reservation) {
        await tx.stockReservation.update({ where: { id: reservation.id }, data: { consumed: { increment: fromReservation } } });
      }
      await tx.stockMovement.create({ data: { lotId, kind: 'CONSUMPTION', quantity: D(consumedKg).negated(), reason: `Production output · ${production.number}`, source: entry.id } });
      await tx.costAllocation.create({ data: { ...costRow('MATERIAL', cost, 'Actual consumed kilograms × receipt unit cost'), source: `${entry.id}:material` } });
    }
  }

  const machineCost = job.machine ? job.machine.hourlyCost.mul(hours) : D(200).mul(hours);
  const labour = job.worker ? (job.worker.wageType === 'HOURLY' ? job.worker.rate.mul(hours) : job.worker.rate.mul(qty)) : D(0);
  await tx.costAllocation.create({ data: { ...costRow('MACHINE', machineCost, 'Reported run hours × machine hourly rate'), source: `${entry.id}:machine` } });
  await tx.costAllocation.create({ data: { ...costRow('LABOUR', labour, 'Reported job hours or output × worker rate'), source: `${entry.id}:labour` } });
  if (last && !inRework) {
    await tx.costAllocation.create({ data: { ...costRow('OVERHEAD', D(qty).mul(recipe.overheadPerMetre), 'Final-stage output × configured overhead per metre'), source: `${entry.id}:overhead` } });
  }

  // The last stage turns output into fabric rolls, unless this run is reworking rolls that already exist.
  const rework = inRework ? await activeRework(tx, production.id) : null;
  const reworkingRolls = Boolean(rework?.rollCodes.length);
  if (last && !reworkingRolls) {
    const rollLengths = input.rollLengths?.length
      ? input.rollLengths
      : Array.from({ length: Math.ceil(qty / 200) }, (_, i) => Math.min(200, qty - i * 200));
    const costs = await tx.costAllocation.findMany({ where: { productionId: production.id } });
    const rate = qty > 0 ? sum(costs.map((c) => c.amount)).div(production.target) : D(100);
    for (const length of rollLengths) {
      await tx.fabricRoll.create({ data: { code: code('RL'), productionId: production.id, entryId: entry.id, length, cost: rate.mul(length) } });
    }
  }

  await tx.jobCard.update({ where: { id }, data: { output: { increment: qty } } });
  if (job.machine) await tx.machine.update({ where: { id: job.machine.id }, data: { reportedAt: new Date() } });
  await audit(tx, actor, 'production.output', production.id, `${production.number} · ${job.machine?.code ?? 'Floor'} · ${qty} m ${job.stage.toLowerCase()} output recorded`);
  return entry;
}

export async function transitionJob(tx: Tx, id: string, action: 'pause' | 'complete', actor: Actor) {
  const job = await tx.jobCard.findUnique({
    where: { id },
    include: { production: { include: { jobs: { orderBy: { sequence: 'asc' } }, reservations: true, recipe: true } } },
  });
  ensure(job, 'Job not found.', 404);
  ensureStageAccess(actor, job.stage);
  ensure(job.status === 'IN_PROGRESS', 'Only running jobs can be paused or completed.');
  const production = job.production;
  const last = job.sequence === production.jobs[production.jobs.length - 1].sequence;

  // Completing a job records whatever output is still missing.
  if (action === 'complete' && job.output.lt(job.target)) {
    const remaining = job.target.minus(job.output).toNumber();
    await recordOutput(tx, id, {
      quantity: remaining,
      waste: 0,
      hours: 2,
      lotId: production.reservations.find((r) => !r.released)?.lotId,
      consumedKg: job.sequence === 0 ? D(remaining).mul(production.recipe.kgPerMetre).toNumber() : 0,
      rollLengths: last ? Array.from({ length: Math.ceil(remaining / 200) }, (_, i) => Math.min(200, remaining - i * 200)) : [],
    }, actor);
  }

  await tx.jobCard.update({
    where: { id },
    data: { status: action === 'complete' ? 'COMPLETED' : 'PAUSED', endedAt: action === 'complete' ? new Date() : null },
  });
  await tx.workerAssignment.updateMany({ where: { jobId: id, endedAt: null }, data: { endedAt: new Date() } });
  await freeMachine(tx, job.machineId);

  const next = production.jobs.find((j) => j.sequence === job.sequence + 1);
  if (action === 'complete') {
    if (next) {
      // Hand-off: the next team now sees this job as "Ready to Accept".
      await tx.jobCard.update({ where: { id: next.id }, data: { status: 'READY' } });
      await notify(tx, {
        roles: stageTeams[next.stage] ?? [],
        title: `${production.number} is ready for ${next.stage.toLowerCase()}`,
        message: `${job.stage.toLowerCase()} finished · ${production.fabric} · ${production.color} · ${next.target.toString()} m`,
        category: 'PRODUCTION',
        link: '/production',
        skipUserId: actor.id,
      });
    } else {
      await finishBatch(tx, production.id, actor);
    }
  }

  const detail = action === 'pause'
    ? `${production.number} · ${job.stage.toLowerCase()} paused`
    : `${production.number} · ${job.stage.toLowerCase()} completed · ${next ? `sent to ${next.stage.toLowerCase()}` : 'fabric rolls sent to quality check'}`;
  await audit(tx, actor, `production.${action}`, production.id, detail);
  return { id };
}

// The last stage is done: close the batch, release unused yarn and hand the rolls to quality.
async function finishBatch(tx: Tx, productionId: string, actor: Actor) {
  const production = await tx.productionOrder.findUniqueOrThrow({ where: { id: productionId }, include: { reservations: true } });

  if (production.status === 'REWORK') await finishReworkRun(tx, productionId, actor);

  await tx.productionOrder.update({ where: { id: productionId }, data: { status: 'COMPLETED' } });
  for (const r of production.reservations.filter((r) => !r.released)) {
    const unused = Prisma.Decimal.max(r.quantity.minus(r.consumed), 0);
    await tx.yarnLot.update({ where: { id: r.lotId }, data: { reserved: { decrement: unused } } });
    await tx.stockReservation.update({ where: { id: r.id }, data: { released: true } });
  }

  // The order moves to quality check once none of its batches are still being made.
  if (production.orderId) {
    const stillRunning = await tx.productionOrder.count({
      where: { orderId: production.orderId, id: { not: productionId }, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
    });
    if (!stillRunning) {
      await tx.salesOrder.updateMany({
        where: { id: production.orderId, status: { in: ['CONFIRMED', 'PLANNED', 'IN_PRODUCTION', 'READY'] } },
        data: { status: 'QUALITY' },
      });
    }
  }

  await notify(tx, {
    roles: stageTeams.QUALITY,
    title: `${production.number}: rolls ready for inspection`,
    message: `${production.fabric} · ${production.color} finished production and is waiting for quality check.`,
    category: 'QUALITY',
    link: '/quality',
    skipUserId: actor.id,
  });
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

// ==================== MANAGER ACTIONS ====================

// Production for stock, internal use, replacement or urgent needs: no customer order required.
export async function createStandaloneBatch(tx: Tx, input: StandaloneBatchInput, actor: Actor) {
  ensureManager(actor);
  const recipe = await tx.recipe.findUnique({ where: { id: input.recipeId } });
  ensure(recipe, 'Fabric recipe not found.', 404);

  const stages = input.stages ? recipe.route.filter((s) => input.stages!.includes(s as never)) : recipe.route;
  ensure(stages.length, 'Choose at least one production stage.');

  const plannedMachines: Record<string, string | undefined> = {
    SPINNING: input.spinningMachineId,
    WEAVING: input.weavingMachineId,
    DYEING: input.dyeingMachineId,
  };
  for (const stage of stages) {
    const machineId = plannedMachines[stage];
    if (!machineId) continue;
    const machine = await tx.machine.findUnique({ where: { id: machineId } });
    ensure(machine && machine.type === stage, `The machine chosen for ${stage.toLowerCase()} is not a ${stage.toLowerCase()} machine.`);
  }
  if (input.workerId) ensure(await tx.worker.findUnique({ where: { id: input.workerId } }), 'Worker not found.', 404);

  const batch = await tx.productionOrder.create({
    data: {
      number: code('WO'),
      recipeId: recipe.id,
      fabric: recipe.name,
      color: input.color,
      purpose: input.purpose,
      priority: input.priority,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      notes: input.notes,
      createdBy: actor.name,
      target: input.quantity,
      jobs: {
        create: stages.map((stage, sequence) => ({
          stage,
          sequence,
          target: input.quantity,
          status: sequence === 0 ? 'READY' : 'PLANNED',
          machineId: plannedMachines[stage] ?? null,
          workerId: sequence === 0 ? (input.workerId ?? null) : null,
        })),
      },
    },
  });

  await audit(tx, actor, 'production.created', batch.id, `${batch.number} · ${input.quantity} m ${recipe.name} for ${input.purpose.toLowerCase()} created by ${actor.name}`);
  await notify(tx, {
    roles: [...(stageTeams[stages[0]] ?? []), ...managers],
    title: `New ${input.purpose.toLowerCase()} batch ${batch.number}`,
    message: `${input.quantity} m ${recipe.name} · ${input.color} starts at ${stages[0].toLowerCase()}.`,
    category: 'PRODUCTION',
    link: `/batches?open=${batch.id}`,
    skipUserId: actor.id,
  });
  return batch;
}

// Move a job to another machine and/or worker, for example after a breakdown or absence.
export async function reassignJob(tx: Tx, jobId: string, input: { machineId?: string; workerId?: string; reason: string }, actor: Actor) {
  ensureManager(actor);
  const job = await tx.jobCard.findUnique({ where: { id: jobId }, include: { production: true, machine: true, worker: true } });
  ensure(job, 'Job not found.', 404);
  ensure(!['COMPLETED', 'CANCELLED'].includes(job.status), 'This stage is already closed.');
  ensure(input.machineId || input.workerId, 'Choose a new machine or a new worker.');
  const running = job.status === 'IN_PROGRESS';
  const changes: string[] = [];

  if (input.machineId && input.machineId !== job.machineId) {
    const machine = await tx.machine.findUnique({ where: { id: input.machineId } });
    ensure(machine, 'Machine not found.', 404);
    ensure(machine.type === job.stage, `${machine.code} is not a ${job.stage.toLowerCase()} machine.`);
    ensure(machine.status === 'IDLE', `${machine.code} is ${machine.status.toLowerCase()}. Pick an idle machine.`);
    if (running) {
      await freeMachine(tx, job.machineId);
      await tx.machine.update({ where: { id: machine.id }, data: { status: 'RUNNING', reportedAt: new Date() } });
    }
    await tx.jobCard.update({ where: { id: jobId }, data: { machineId: machine.id } });
    changes.push(`machine ${job.machine?.code ?? 'none'} → ${machine.code}`);
  }

  if (input.workerId && input.workerId !== job.workerId) {
    const worker = await tx.worker.findUnique({ where: { id: input.workerId }, include: { user: true } });
    ensure(worker?.active, 'Worker is not available.', 404);
    if (running) {
      await tx.workerAssignment.updateMany({ where: { jobId, endedAt: null }, data: { endedAt: new Date() } });
      await tx.workerAssignment.create({ data: { workerId: worker.id, jobId } });
    }
    await tx.jobCard.update({ where: { id: jobId }, data: { workerId: worker.id } });
    changes.push(`worker ${job.worker?.name ?? 'none'} → ${worker.name}`);
    if (worker.user) {
      await notify(tx, {
        userIds: [worker.user.id],
        title: `You were assigned to ${job.production.number}`,
        message: `${job.stage.toLowerCase()} · ${job.production.fabric}. Reason: ${input.reason}`,
        category: 'PRODUCTION',
        link: '/production',
        skipUserId: actor.id,
      });
    }
  }

  ensure(changes.length, 'Nothing changed: pick a different machine or worker.');
  await audit(tx, actor, 'production.reassigned', job.productionId, `${job.production.number} · ${job.stage.toLowerCase()} ${changes.join(', ')} · ${input.reason}`);
  return { id: jobId };
}

export async function cancelBatch(tx: Tx, productionId: string, reason: string, actor: Actor) {
  ensureManager(actor);
  const batch = await tx.productionOrder.findUnique({ where: { id: productionId }, include: { jobs: true, reservations: true } });
  ensure(batch, 'Batch not found.', 404);
  ensure(!['COMPLETED', 'CANCELLED'].includes(batch.status), 'Only unfinished batches can be cancelled.');

  for (const job of batch.jobs.filter((j) => j.status !== 'COMPLETED')) {
    if (job.status === 'IN_PROGRESS') await freeMachine(tx, job.machineId);
    await tx.workerAssignment.updateMany({ where: { jobId: job.id, endedAt: null }, data: { endedAt: new Date() } });
    await tx.jobCard.update({ where: { id: job.id }, data: { status: 'CANCELLED', endedAt: new Date() } });
  }
  // Give unused yarn back to the store.
  for (const r of batch.reservations.filter((r) => !r.released)) {
    const unused = Prisma.Decimal.max(r.quantity.minus(r.consumed), 0);
    await tx.yarnLot.update({ where: { id: r.lotId }, data: { reserved: { decrement: unused } } });
    await tx.stockReservation.update({ where: { id: r.id }, data: { released: true } });
  }
  await tx.reworkJob.updateMany({
    where: { productionId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
    data: { status: 'CANCELLED', outcome: 'Batch cancelled', resolvedBy: actor.name, completedAt: new Date() },
  });
  await tx.productionIssue.updateMany({
    where: { productionId, status: 'OPEN' },
    data: { status: 'RESOLVED', resolution: `Batch cancelled: ${reason}`, resolvedBy: actor.name, resolvedAt: new Date() },
  });
  await tx.productionOrder.update({ where: { id: productionId }, data: { status: 'CANCELLED' } });

  await audit(tx, actor, 'production.cancelled', productionId, `${batch.number} · Cancelled: ${reason}`);
  await notify(tx, {
    roles: [...managers, 'SHIFT_SUPERVISOR'],
    title: `${batch.number} was cancelled`,
    message: reason,
    category: 'PRODUCTION',
    link: `/batches?open=${productionId}`,
    skipUserId: actor.id,
  });
  return { id: productionId };
}

// A fresh batch that makes up for a failed, rejected or cancelled one. It belongs to the same order.
export async function createReplacement(tx: Tx, productionId: string, input: { quantity: number; reason: string }, actor: Actor) {
  ensureManager(actor);
  const original = await tx.productionOrder.findUnique({ where: { id: productionId }, include: { jobs: { orderBy: { sequence: 'asc' } } } });
  ensure(original, 'Batch not found.', 404);

  const batch = await tx.productionOrder.create({
    data: {
      number: code('WO'),
      orderId: original.orderId,
      recipeId: original.recipeId,
      fabric: original.fabric,
      color: original.color,
      unitPrice: original.unitPrice,
      purpose: 'REPLACEMENT',
      priority: 'HIGH',
      dueDate: original.dueDate,
      notes: input.reason,
      createdBy: actor.name,
      replacesId: original.id,
      target: input.quantity,
      jobs: {
        create: original.jobs.map((j, sequence) => ({
          stage: j.stage,
          sequence,
          target: input.quantity,
          status: sequence === 0 ? 'READY' : 'PLANNED',
        })),
      },
    },
  });

  const firstStage = original.jobs[0]?.stage ?? 'SPINNING';
  await audit(tx, actor, 'production.replacement', original.id, `${batch.number} created to replace ${original.number}: ${input.reason}`);
  await audit(tx, actor, 'production.created', batch.id, `${batch.number} · Replacement for ${original.number} · ${input.quantity} m`);
  await notify(tx, {
    roles: [...(stageTeams[firstStage] ?? []), ...managers],
    title: `Replacement batch ${batch.number}`,
    message: `Replaces ${original.number} · ${input.quantity} m ${original.fabric}. ${input.reason}`,
    category: 'PRODUCTION',
    link: `/batches?open=${batch.id}`,
    skipUserId: actor.id,
  });
  return batch;
}

// ==================== BATCH LISTS AND FILTERS ====================

export interface BatchFilters {
  buyerId?: string;
  orderId?: string;
  status?: string; // PENDING, ONGOING, COMPLETED, FAILED or REWORK
  department?: string; // SPINNING, WEAVING, DYEING, QUALITY, DISPATCH or FINISHED
  machineId?: string;
  from?: string;
  to?: string;
  purpose?: string; // ORDER, STANDALONE or a specific purpose
  rework?: string; // "yes" = only batches that have had rework
  search?: string;
}

const batchInclude = {
  order: { include: { buyer: true } },
  jobs: { include: { machine: true, worker: true }, orderBy: { sequence: 'asc' } },
  rolls: { select: { id: true, code: true, length: true, quality: true, activeShipmentId: true } },
  reworks: { select: { status: true } },
  issues: { select: { status: true } },
} satisfies Prisma.ProductionOrderInclude;

type BatchRow = Prisma.ProductionOrderGetPayload<{ include: typeof batchInclude }>;

// Which department the batch is sitting in right now.
function currentDepartment(b: BatchRow) {
  const active = b.jobs.find((j) => ['IN_PROGRESS', 'READY', 'PAUSED', 'BLOCKED'].includes(j.status))
    ?? b.jobs.find((j) => j.status === 'PLANNED' || j.status === 'CANCELLED');
  if (active) return active.stage;
  if (b.rolls.some((r) => r.quality === 'PENDING' || r.quality === 'REWORK')) return 'QUALITY';
  if (b.orderId && b.rolls.some((r) => r.quality === 'PASSED' && !r.activeShipmentId)) return 'DISPATCH';
  return 'FINISHED';
}

// The simple status groups used by filters and charts.
export function statusGroup(b: {
  status: string;
  reworks: { status: string }[];
  rolls: { quality: string }[];
  jobs: { status: string }[];
}) {
  if (b.status === 'CANCELLED') return 'FAILED';
  if (b.status === 'REWORK' || b.reworks.some((r) => r.status === 'OPEN' || r.status === 'IN_PROGRESS')) return 'REWORK';
  if (b.rolls.length && b.rolls.every((r) => r.quality === 'REJECTED')) return 'FAILED';
  if (b.status === 'COMPLETED') return 'COMPLETED';
  if (b.jobs.every((j) => j.status === 'PLANNED' || j.status === 'READY')) return 'PENDING';
  return 'ONGOING';
}

function batchSummary(b: BatchRow) {
  const lastJob = b.jobs[b.jobs.length - 1];
  return {
    ...batchRef(b),
    status: b.status,
    priority: b.priority,
    target: b.target.toString(),
    produced: (lastJob?.output ?? D(0)).toString(),
    department: currentDepartment(b),
    statusGroup: statusGroup(b),
    dueDate: (b.dueDate ?? b.order?.deadline ?? null)?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    notes: b.notes,
    openReworks: b.reworks.filter((r) => r.status === 'OPEN' || r.status === 'IN_PROGRESS').length,
    openIssues: b.issues.filter((i) => i.status === 'OPEN').length,
    machines: [...new Set(b.jobs.map((j) => j.machine?.code).filter((c): c is string => Boolean(c)))],
    jobs: b.jobs.map((j) => ({
      id: j.id,
      stage: j.stage,
      sequence: j.sequence,
      status: j.status,
      target: j.target.toString(),
      output: j.output.toString(),
      machineId: j.machineId,
      machineCode: j.machine?.code ?? null,
      workerId: j.workerId,
      workerName: j.worker?.name ?? null,
    })),
  };
}

export async function listBatches(filters: BatchFilters, user: CurrentUser) {
  const where: Prisma.ProductionOrderWhereInput = {};
  if (filters.buyerId) where.order = { buyerId: filters.buyerId };
  if (filters.orderId) where.orderId = filters.orderId;
  if (filters.purpose === 'ORDER') where.purpose = 'ORDER';
  else if (filters.purpose === 'STANDALONE') where.purpose = { not: 'ORDER' };
  else if (filters.purpose) where.purpose = filters.purpose;
  if (filters.rework === 'yes') where.reworks = { some: {} };
  if (filters.from || filters.to) {
    where.createdAt = {
      gte: filters.from ? new Date(`${filters.from}T00:00:00+05:30`) : undefined,
      lt: filters.to ? new Date(new Date(`${filters.to}T00:00:00+05:30`).getTime() + 86400000) : undefined,
    };
  }

  const and: Prisma.ProductionOrderWhereInput[] = [];
  if (filters.machineId) {
    and.push({ OR: [{ jobs: { some: { machineId: filters.machineId } } }, { reworks: { some: { machineId: filters.machineId } } }] });
  }
  if (filters.search) {
    const contains = { contains: filters.search, mode: 'insensitive' as const };
    and.push({ OR: [{ number: contains }, { fabric: contains }, { color: contains }, { order: { number: contains } }, { order: { buyer: { name: contains } } }] });
  }
  // Stage operators only see batches that pass through their stage.
  const ownStage = stageForRole(user.role);
  if (ownStage) and.push({ jobs: { some: { stage: ownStage } } });
  if (and.length) where.AND = and;

  const rows = await db.productionOrder.findMany({ where, include: batchInclude, orderBy: { createdAt: 'desc' } });
  return rows
    .map(batchSummary)
    .filter((b) => !filters.status || b.statusGroup === filters.status)
    .filter((b) => !filters.department || b.department === filters.department);
}

export async function batchDetail(id: string) {
  const batch = await db.productionOrder.findUnique({
    where: { id },
    include: {
      ...batchInclude,
      replaces: { select: { id: true, number: true } },
      replacements: { select: { id: true, number: true, status: true } },
    },
  });
  ensure(batch, 'Batch not found.', 404);

  const [reworks, issues, history] = await Promise.all([
    db.reworkJob.findMany({
      where: { productionId: id },
      include: { machine: { select: { code: true } }, worker: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    db.productionIssue.findMany({ where: { productionId: id }, orderBy: { createdAt: 'desc' } }),
    db.auditLog.findMany({ where: { entityId: { in: [id, ...batch.jobs.map((j) => j.id)] } }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ]);

  return {
    ...batchSummary(batch),
    replaces: batch.replaces,
    replacements: batch.replacements,
    rolls: batch.rolls,
    reworks,
    issues,
    history,
  };
}
