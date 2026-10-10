import { db, Prisma, type Tx } from '@loomos/db';
import { hasPermission, type ReworkRequestInput } from '@loomos/shared';
import { audit, D, ensure, sum, type Actor } from '../lib/domain.js';
import { notify, managers, stageTeams } from './notification.service.js';

// How rework works:
// 1. Someone finds a problem and picks the stage the batch must go back to.
// 2. Every stage from that point on is reset; the return stage becomes "Ready to Accept".
// 3. The floor team re-runs the stages as normal (the batch shows status REWORK).
// 4. When the last stage finishes, the rework is closed and the rolls go back to quality check.

export function ensureCanRework(actor: Actor) {
  ensure(
    hasPermission(actor, 'production', 'update') || hasPermission(actor, 'quality', 'update'),
    'Your role cannot send work back for rework.',
    403,
  );
}

// The stage-return rework that is currently open for a batch, if any.
export function activeRework(tx: Tx, productionId: string) {
  return tx.reworkJob.findFirst({
    where: { productionId, returnStage: { not: null }, status: { in: ['OPEN', 'IN_PROGRESS'] } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function raiseRework(tx: Tx, productionId: string, input: ReworkRequestInput, actor: Actor) {
  ensureCanRework(actor);
  const batch = await tx.productionOrder.findUnique({
    where: { id: productionId },
    include: { jobs: { orderBy: { sequence: 'asc' } }, rolls: true },
  });
  ensure(batch, 'Batch not found.', 404);
  ensure(batch.status !== 'CANCELLED', 'This batch has been cancelled.');
  ensure(!(await activeRework(tx, productionId)), `${batch.number} already has rework in progress. Finish or cancel it first.`);

  const returnJob = batch.jobs.find((j) => j.stage === input.returnStage);
  ensure(returnJob, `${batch.number} does not go through ${input.returnStage.toLowerCase()}.`);
  ensure(
    ['IN_PROGRESS', 'COMPLETED', 'PAUSED', 'BLOCKED'].includes(returnJob.status),
    `${batch.number} has not reached ${input.returnStage.toLowerCase()} yet, so it cannot be sent back there.`,
  );

  const rolls = batch.rolls.filter((r) => input.rollIds.includes(r.id));
  ensure(rolls.length === input.rollIds.length, 'Some selected rolls do not belong to this batch.');
  ensure(rolls.every((r) => !r.activeShipmentId), 'Rolls already loaded for dispatch cannot be reworked.');
  ensure(batch.status !== 'COMPLETED' || rolls.length, 'This batch is finished: select the rolls that need rework.');

  // Rolls being reworked set the quantity; otherwise the whole batch is re-run from the return stage.
  const quantity = rolls.length ? sum(rolls.map((r) => r.length)) : D(input.quantity || returnJob.target);
  const runningJob = batch.jobs.find((j) => j.status === 'IN_PROGRESS');
  const fromStage = rolls.length ? 'QUALITY' : (runningJob?.stage ?? [...batch.jobs].reverse().find((j) => j.status === 'COMPLETED')?.stage ?? input.returnStage);

  if (input.machineId) {
    const machine = await tx.machine.findUnique({ where: { id: input.machineId } });
    ensure(machine?.type === input.returnStage, `Pick a ${input.returnStage.toLowerCase()} machine for this rework.`);
  }
  const worker = input.workerId ? await tx.worker.findUnique({ where: { id: input.workerId }, include: { user: true } }) : null;
  ensure(!input.workerId || worker?.active, 'Worker is not available.', 404);

  // Stop whatever is running and reset the stages from the return stage onwards.
  for (const job of batch.jobs) {
    if (job.status === 'IN_PROGRESS' && job.machineId) {
      await tx.machine.updateMany({ where: { id: job.machineId, status: 'RUNNING' }, data: { status: 'IDLE', reportedAt: new Date() } });
    }
    await tx.workerAssignment.updateMany({ where: { jobId: job.id, endedAt: null }, data: { endedAt: new Date() } });
    if (job.sequence < returnJob.sequence) continue;
    const isReturn = job.id === returnJob.id;
    await tx.jobCard.update({
      where: { id: job.id },
      data: {
        status: isReturn ? 'READY' : 'PLANNED',
        output: 0,
        target: rolls.length ? quantity : job.target,
        startedAt: null,
        endedAt: null,
        machineId: isReturn ? (input.machineId ?? null) : null,
        workerId: isReturn ? (input.workerId ?? null) : null,
      },
    });
  }

  // Rolls wait for the rework; any "repair at bay" job for them is replaced by this one.
  if (rolls.length) {
    await tx.fabricRoll.updateMany({
      where: { id: { in: rolls.map((r) => r.id) } },
      data: { quality: 'REWORK', location: `Rework · back to ${input.returnStage.toLowerCase()}` },
    });
    await tx.reworkJob.updateMany({
      where: { rollId: { in: rolls.map((r) => r.id) }, returnStage: null, status: 'OPEN' },
      data: { status: 'CANCELLED', outcome: `Sent back to ${input.returnStage.toLowerCase()} instead`, resolvedBy: actor.name, completedAt: new Date() },
    });
  }

  const rework = await tx.reworkJob.create({
    data: {
      productionId,
      rollId: rolls.length === 1 ? rolls[0].id : null,
      defectType: input.defectType,
      reason: input.reason,
      fromStage,
      returnStage: input.returnStage,
      quantity,
      rollCodes: rolls.map((r) => r.code),
      machineId: input.machineId ?? null,
      workerId: input.workerId ?? null,
      raisedBy: actor.name,
    },
  });

  await tx.productionOrder.update({ where: { id: productionId }, data: { status: 'REWORK' } });
  if (batch.orderId) {
    await tx.salesOrder.updateMany({
      where: { id: batch.orderId, status: { in: ['QUALITY', 'READY', 'PLANNED'] } },
      data: { status: 'IN_PRODUCTION' },
    });
  }

  const what = rolls.length ? `${rolls.length} roll(s), ${quantity.toString()} m` : `${quantity.toString()} m`;
  await audit(tx, actor, 'production.rework', productionId, `${batch.number} · ${what} sent back to ${input.returnStage.toLowerCase()} · ${input.defectType.toLowerCase().replace(/_/g, ' ')}: ${input.reason}`);
  if (batch.orderId) await audit(tx, actor, 'production.rework', batch.orderId, `${batch.number} sent back to ${input.returnStage.toLowerCase()} for rework`);

  await notify(tx, {
    roles: [...(stageTeams[input.returnStage] ?? []), ...managers],
    userIds: worker?.user ? [worker.user.id] : [],
    title: `Rework: ${batch.number} back to ${input.returnStage.toLowerCase()}`,
    message: `${what} · ${input.reason}`,
    category: 'REWORK',
    link: `/batches?open=${productionId}`,
    skipUserId: actor.id,
  });
  return rework;
}

// Called when the last stage of a rework run finishes.
export async function finishReworkRun(tx: Tx, productionId: string, actor: Actor) {
  const rework = await activeRework(tx, productionId);
  if (!rework) return;

  const costs = await tx.costAllocation.findMany({
    where: { productionId, category: 'REWORK', createdAt: { gte: rework.createdAt } },
  });
  let outcome = `Re-processed from ${rework.returnStage?.toLowerCase()} and finished`;

  if (rework.rollCodes.length) {
    await tx.fabricRoll.updateMany({
      where: { productionId, code: { in: rework.rollCodes } },
      data: { quality: 'PENDING', location: 'QC • Bay 01' },
    });
    outcome += `; ${rework.rollCodes.length} roll(s) back in quality check`;
  }

  await tx.reworkJob.update({
    where: { id: rework.id },
    data: {
      status: 'COMPLETED',
      outcome,
      resolvedBy: actor.name,
      completedAt: new Date(),
      cost: sum(costs.map((c) => c.amount)),
    },
  });
  await audit(tx, actor, 'production.rework.completed', productionId, outcome);
}

export async function cancelRework(tx: Tx, reworkId: string, reason: string, actor: Actor) {
  ensure(hasPermission(actor, 'production', 'manage'), 'Only production managers can cancel rework.', 403);
  const rework = await tx.reworkJob.findUnique({ where: { id: reworkId }, include: { production: { include: { jobs: true } } } });
  ensure(rework, 'Rework not found.', 404);
  ensure(['OPEN', 'IN_PROGRESS'].includes(rework.status), 'This rework is already closed.');
  ensure(rework.status === 'OPEN', 'The rework has already started on the floor. Finish it, or cancel the batch.');

  await tx.reworkJob.update({
    where: { id: reworkId },
    data: { status: 'CANCELLED', outcome: `Cancelled: ${reason}`, resolvedBy: actor.name, completedAt: new Date() },
  });

  // Nothing was re-run yet.
  const batch = rework.production;
  if (batch && rework.returnStage && rework.rollCodes.length) {
    // Finished rolls: close the reset stages again and send the rolls back to quality check.
    for (const job of batch.jobs.filter((j) => j.status !== 'COMPLETED')) {
      await tx.jobCard.update({ where: { id: job.id }, data: { status: 'COMPLETED', output: job.target, endedAt: new Date() } });
    }
    await tx.productionOrder.update({ where: { id: batch.id }, data: { status: 'COMPLETED' } });
    await tx.fabricRoll.updateMany({
      where: { productionId: batch.id, code: { in: rework.rollCodes } },
      data: { quality: 'PENDING', location: 'QC • Bay 01' },
    });
  } else if (batch && rework.returnStage) {
    // Batch still in production: it simply carries on from the return stage as normal work.
    await tx.productionOrder.update({ where: { id: batch.id }, data: { status: 'IN_PROGRESS' } });
  }
  await audit(tx, actor, 'production.rework.cancelled', rework.productionId ?? reworkId, reason);
  return { id: reworkId };
}

export interface ReworkFilters {
  status?: string;
  stage?: string;
  defectType?: string;
  buyerId?: string;
  from?: string;
  to?: string;
}

// Full rework history with simple filters.
export async function listReworks(filters: ReworkFilters) {
  const where: Prisma.ReworkJobWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.stage) where.returnStage = filters.stage;
  if (filters.defectType) where.defectType = filters.defectType;
  if (filters.buyerId) where.production = { order: { buyerId: filters.buyerId } };
  if (filters.from || filters.to) {
    where.createdAt = {
      gte: filters.from ? new Date(`${filters.from}T00:00:00+05:30`) : undefined,
      lt: filters.to ? new Date(new Date(`${filters.to}T00:00:00+05:30`).getTime() + 86400000) : undefined,
    };
  }
  return db.reworkJob.findMany({
    where,
    include: {
      machine: { select: { code: true } },
      worker: { select: { name: true } },
      production: { select: { id: true, number: true, fabric: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}
