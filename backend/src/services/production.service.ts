import { db, Prisma, type Tx } from '@loomos/db';
import {
  stageForRole,
  type CompleteInput,
  type CurrentUser,
  type OutputInput,
  type StandaloneBatchInput,
} from '@loomos/shared';
import { audit, code, D, ensure, sum, type Actor } from '../lib/domain.js';
import { notify, managers, stageTeams } from './notification.service.js';
import { finishReworkRun, activeRework } from './rework.service.js';
import { reserveFromLot, consumeFromLot, releaseReservations } from './inventory.service.js';
import { openAttendance, onShiftNow } from './workforce.service.js';

// A job card is one production stage of one batch. Its life:
//   PLANNED → READY → ASSIGNED → IN_PROGRESS → COMPLETED
// READY means the previous stage handed it over. ASSIGNED means a machine and operator are
// chosen. Nothing runs until someone presses "Start production", which checks everything first.
// PAUSED and BLOCKED are stops; starting again runs the same checks. CANCELLED ends it.
// Who may do what is decided by the routes (see ROLE_PERMISSIONS_TEMPLATE); here we only keep
// operators inside their own stage and their own jobs.

// ==================== SHARED HELPERS ====================

// Operators can only act on their own stage; managers and admins can act on any.
export function ensureStageAccess(actor: Actor, stage: string) {
  const own = stageForRole(actor.role);
  ensure(!own || own === stage, `This job belongs to the ${stage.toLowerCase()} team.`, 403);
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

const stoppable = ['IN_PROGRESS'];
const startable = ['ASSIGNED', 'PAUSED', 'BLOCKED'];
// A running job is never re-planned underneath the operator: pause it first, then move it.
const assignable = ['READY', 'ASSIGNED', 'PAUSED', 'BLOCKED'];

// Release the machine a job was running on and close its open run records.
async function stopRun(tx: Tx, jobId: string, machineId: string | null) {
  if (machineId) {
    await tx.machine.updateMany({ where: { id: machineId, status: 'RUNNING' }, data: { status: 'IDLE', reportedAt: new Date() } });
  }
  await tx.workerAssignment.updateMany({ where: { jobId, endedAt: null }, data: { endedAt: new Date() } });
  await tx.machineAssignment.updateMany({ where: { jobId, endedAt: null }, data: { endedAt: new Date() } });
}

// The operator is free to take this job: active, right department, not running something else.
async function ensureWorkerFree(tx: Tx, workerId: string, jobId: string, machine: { departmentId: string | null } | null) {
  const worker = await tx.worker.findUnique({ where: { id: workerId }, include: { department: true, user: true } });
  ensure(worker?.active, 'Worker is not available.', 404);
  if (worker.departmentId && machine?.departmentId) {
    ensure(worker.departmentId === machine.departmentId, `${worker.name} belongs to ${worker.department?.name ?? 'another department'}, not this machine's department.`);
  }
  const elsewhere = await tx.jobCard.findFirst({ where: { workerId: worker.id, status: 'IN_PROGRESS', id: { not: jobId } }, include: { production: true } });
  ensure(!elsewhere, `${worker.name} is already running ${elsewhere?.production.number}.`);
  return worker;
}

// ==================== ASSIGN ====================

// The production manager chooses (or changes) the machine and operator for a stage. Nothing starts here.
export async function assignJob(
  tx: Tx,
  id: string,
  input: { machineId: string; workerId: string; reason?: string },
  actor: Actor,
) {
  const job = await tx.jobCard.findUnique({ where: { id }, include: { production: true, machine: true, worker: true } });
  ensure(job, 'Job not found.', 404);
  ensureStageAccess(actor, job.stage);
  ensure(job.production.status !== 'CANCELLED', 'This batch has been cancelled.');
  ensure(job.status !== 'IN_PROGRESS', 'This job is running. Pause it first, then move it.');
  ensure(assignable.includes(job.status), job.status === 'PLANNED' ? 'The previous stage has not finished yet.' : 'This stage is already closed.');

  const machine = await tx.machine.findUnique({ where: { id: input.machineId } });
  ensure(machine, 'Machine not found.', 404);
  ensure(machine.active, `${machine.code} has been deactivated.`);
  ensure(machine.type === job.stage, `${machine.code} is not a ${job.stage.toLowerCase()} machine.`);
  ensure(!['BREAKDOWN', 'MAINTENANCE', 'OFFLINE'].includes(machine.status), `${machine.code} is ${machine.status.toLowerCase()} and cannot take work.`);
  const busy = await tx.jobCard.findFirst({ where: { machineId: machine.id, status: 'IN_PROGRESS', id: { not: id } } });
  ensure(!busy, `${machine.code} is already running another job.`);
  const worker = await ensureWorkerFree(tx, input.workerId, id, machine);

  const status = job.status === 'READY' ? 'ASSIGNED' : job.status;
  await tx.jobCard.update({ where: { id }, data: { machineId: machine.id, workerId: worker.id, status } });

  const change = `${job.production.number} · ${job.stage.toLowerCase()} assigned to ${machine.code} · ${worker.name}${input.reason ? ` · ${input.reason}` : ''}`;
  await audit(tx, actor, job.machineId || job.workerId ? 'production.reassigned' : 'production.assigned', job.productionId, change);
  if (worker.user && worker.user.id !== actor.id) {
    await notify(tx, {
      userIds: [worker.user.id],
      title: `New task: ${job.production.number}`,
      message: `${job.stage.toLowerCase()} on ${machine.code} · ${job.production.fabric}${input.reason ? ` · ${input.reason}` : ''}`,
      category: 'PRODUCTION',
      link: '/production',
    });
  }
  return { id, status };
}

// ==================== SHIFT HANDOVER ====================

// When shifts change, the supervisor hands a running (or paused) job to the incoming operator.
// The machine stays the same; the new operator must be checked in on the current shift.
export async function handoverJob(tx: Tx, id: string, input: { workerId: string; reason?: string }, actor: Actor) {
  const job = await tx.jobCard.findUnique({ where: { id }, include: { production: true, machine: true, worker: true } });
  ensure(job, 'Job not found.', 404);
  ensure(['IN_PROGRESS', 'PAUSED'].includes(job.status), 'Only running or paused jobs can be handed over.');
  ensure(job.machine, 'This job has no machine. Assign a machine and operator instead.');
  ensure(job.workerId !== input.workerId, `${job.worker?.name} is already on this job.`);

  const worker = await ensureWorkerFree(tx, input.workerId, id, job.machine);
  const attendance = await onShiftNow(tx, worker.id);
  ensure(attendance, `${worker.name} is not checked in on the current shift. Check them in first.`);

  const running = job.status === 'IN_PROGRESS';
  await tx.workerAssignment.updateMany({ where: { jobId: id, endedAt: null }, data: { endedAt: new Date() } });
  await tx.machineAssignment.updateMany({ where: { jobId: id, endedAt: null }, data: { endedAt: new Date() } });
  await tx.jobCard.update({
    where: { id },
    data: {
      workerId: worker.id,
      shiftId: attendance.shiftId,
      ...(running
        ? {
            assignments: { create: { workerId: worker.id } },
            machineRuns: { create: { machineId: job.machine.id, workerId: worker.id, shiftId: attendance.shiftId, reason: 'Shift handover' } },
          }
        : {}),
    },
  });
  const detail = `${job.production.number} · ${job.stage.toLowerCase()} on ${job.machine.code} handed over from ${job.worker?.name ?? 'nobody'} to ${worker.name} (${attendance.shift.name})${input.reason ? ` · ${input.reason}` : ''}`;
  await audit(tx, actor, 'production.handover', job.productionId, detail);
  if (worker.user && worker.user.id !== actor.id) {
    await notify(tx, {
      userIds: [worker.user.id],
      title: `Handed over to you: ${job.production.number}`,
      message: `${job.stage.toLowerCase()} on ${job.machine.code} · ${job.production.fabric}${running ? ' · running now' : ' · paused, press Start when ready'}`,
      category: 'PRODUCTION',
      link: '/production',
    });
  }
  return { id, status: job.status };
}

// ==================== START ====================

export async function startJob(tx: Tx, id: string, actor: Actor) {
  const job = await tx.jobCard.findUnique({
    where: { id },
    include: { production: { include: { jobs: true, recipe: true, reservations: true } }, machine: true, worker: true },
  });
  ensure(job, 'Job not found.', 404);
  ensureStageAccess(actor, job.stage);
  ensure(job.status !== 'IN_PROGRESS', 'This job is already running.');
  ensure(job.production.status !== 'CANCELLED', 'This batch has been cancelled.');
  ensure(startable.includes(job.status), job.status === 'READY' ? 'Please select an available machine and operator before starting production.' : 'This job is still waiting for the previous stage.');
  ensure(job.production.jobs.every((j) => j.sequence >= job.sequence || j.status === 'COMPLETED'), 'Finish the previous stage before starting this one.');

  // 1. Machine: chosen, working, free.
  const machine = job.machine;
  ensure(machine, 'Please select an available machine and operator before starting production.');
  ensure(machine.active, `${machine.code} has been deactivated. Choose another machine.`);
  ensure(machine.status === 'IDLE', `${machine.code} is ${machine.status.toLowerCase()}. Choose an idle machine.`);
  const machineBusy = await tx.jobCard.findFirst({ where: { machineId: machine.id, status: 'IN_PROGRESS', id: { not: id } } });
  ensure(!machineBusy, `${machine.code} is already running another job.`);

  // 2. Operator: chosen, present on a shift right now, not busy elsewhere.
  const worker = job.worker;
  ensure(worker?.active, 'Please select an available machine and operator before starting production.');
  if (stageForRole(actor.role)) ensure(worker.id === actor.workerId, 'This job is assigned to another operator.', 403);
  const attendance = await onShiftNow(tx, worker.id);
  ensure(attendance, (await openAttendance(tx, worker.id))
    ? `${worker.name}'s shift has ended. The shift supervisor must check them out and in again before work can start.`
    : `${worker.name} is not checked in. Ask the shift supervisor to check them in first.`);
  const workerBusy = await tx.jobCard.findFirst({ where: { workerId: worker.id, status: 'IN_PROGRESS', id: { not: id } }, include: { production: true } });
  ensure(!workerBusy, `${worker.name} is already running ${workerBusy?.production.number}.`);

  // 3. Material: the first stage reserves the yarn it needs, using only stock that really exists.
  if (job.sequence === 0) {
    const recipe = job.production.recipe;
    const needed = job.target.mul(recipe.kgPerMetre).mul(D(1).plus(recipe.wastePercent.div(100))).toDecimalPlaces(3);
    const held = sum(job.production.reservations.filter((r) => !r.released).map((r) => r.quantity.minus(r.consumed)));
    let shortage = needed.minus(held);
    // Yarn bought for this order is used first, then general stock, then (last) yarn bought for other orders.
    const orderId = job.production.orderId;
    const rank = (lot: { orderId: string | null }) => (lot.orderId && lot.orderId === orderId ? 0 : lot.orderId ? 2 : 1);
    const lots = (await tx.yarnLot.findMany({
      where: { material: recipe.material, specification: recipe.specification },
      orderBy: { createdAt: 'asc' },
    })).sort((a, b) => rank(a) - rank(b));
    for (const lot of lots) {
      if (shortage.lte(0)) break;
      const take = Prisma.Decimal.min(shortage, lot.onHand.minus(lot.reserved));
      if (take.lte(0)) continue;
      await reserveFromLot(tx, lot.id, job.productionId, take);
      shortage = shortage.minus(take);
    }
    ensure(shortage.lte(0), `Not enough ${recipe.material} in store: ${shortage.toFixed(1)} kg short. Receive more yarn first.`);
  }

  // Everything checks out: run it.
  await tx.workerAssignment.updateMany({ where: { workerId: worker.id, endedAt: null }, data: { endedAt: new Date() } });
  const updated = await tx.jobCard.update({
    where: { id },
    data: {
      shiftId: attendance.shiftId,
      status: 'IN_PROGRESS',
      startedAt: job.startedAt ?? new Date(),
      assignments: { create: { workerId: worker.id } },
      machineRuns: { create: { machineId: machine.id, workerId: worker.id, shiftId: attendance.shiftId, reason: job.startedAt ? 'Restarted' : 'Started' } },
    },
  });
  await tx.machine.update({ where: { id: machine.id }, data: { status: 'RUNNING', reportedAt: new Date() } });

  if (job.production.status === 'REWORK') {
    await tx.reworkJob.updateMany({
      where: { productionId: job.productionId, status: 'OPEN', returnStage: { not: null } },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });
  } else {
    await tx.productionOrder.update({ where: { id: job.productionId }, data: { status: 'IN_PROGRESS' } });
  }
  if (job.production.orderId) {
    await tx.salesOrder.updateMany({ where: { id: job.production.orderId, status: { in: ['PLANNED', 'CONFIRMED'] } }, data: { status: 'IN_PRODUCTION' } });
  }
  await audit(tx, actor, 'production.started', job.productionId, `${job.production.number} · ${job.stage.toLowerCase()} started on ${machine.code} by ${worker.name} (${attendance.shift.name})`);
  return updated;
}

// ==================== OUTPUT & FINISH ====================

export async function recordOutput(tx: Tx, id: string, input: OutputInput, actor: Actor) {
  const job = await tx.jobCard.findUnique({
    where: { id },
    include: { machine: true, worker: true, production: { include: { recipe: true, jobs: true, reservations: { include: { lot: true } } } } },
  });
  ensure(job, 'Job not found.', 404);
  ensureStageAccess(actor, job.stage);
  ensure(job.status === 'IN_PROGRESS', 'Start the job before recording output.');
  if (stageForRole(actor.role)) ensure(job.workerId === actor.workerId, 'This job is assigned to another operator.', 403);

  const production = job.production;
  const recipe = production.recipe;
  const last = job.sequence === Math.max(...production.jobs.map((j) => j.sequence));
  const inRework = production.status === 'REWORK';
  const qty = Number(input.quantity);
  ensure(D(qty).plus(job.output).lte(job.target.mul(1.05)), `Output would exceed the stage target of ${job.target.toString()} m.`);
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

  // The first stage consumes yarn from what was reserved for this batch, lot by lot (oldest
  // reservation first). Only if the run used more than was reserved does it take extra stock.
  if (job.sequence === 0) {
    const consumedKg = (input.consumedKg && input.consumedKg > 0 ? D(input.consumedKg) : D(qty).mul(recipe.kgPerMetre)).toDecimalPlaces(3);
    const reservations = production.reservations
      .filter((r) => !r.released && (!input.lotId || r.lotId === input.lotId))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    ensure(reservations.length || input.lotId, 'No yarn is reserved for this batch. Reserve yarn before recording output.');
    const portions: { lotId: string; qty: Prisma.Decimal }[] = [];
    let remaining = consumedKg;
    for (const r of reservations) {
      if (remaining.lte(0)) break;
      const take = Prisma.Decimal.min(remaining, Prisma.Decimal.max(r.quantity.minus(r.consumed), 0));
      if (take.gt(0)) portions.push({ lotId: r.lotId, qty: take });
      remaining = remaining.minus(take);
    }
    if (remaining.gt(0)) {
      // Used more than was reserved: take the rest from the chosen (or last reserved) lot if it has stock.
      const extraLot = input.lotId ?? reservations[reservations.length - 1]?.lotId;
      ensure(extraLot, 'No yarn is reserved for this batch. Reserve yarn before recording output.');
      portions.push({ lotId: extraLot, qty: remaining });
    }
    let cost = D(0);
    for (const portion of portions) {
      const lot = await tx.yarnLot.findUniqueOrThrow({ where: { id: portion.lotId } });
      ensure(lot.material === recipe.material, `${lot.code} is ${lot.material}, not ${recipe.material}.`);
      await consumeFromLot(tx, lot.id, production.id, portion.qty);
      const portionCost = portion.qty.mul(lot.costPerKg);
      cost = cost.plus(portionCost);
      await tx.materialConsumption.create({ data: { entryId: entry.id, lotId: lot.id, quantity: portion.qty, cost: portionCost } });
      await tx.stockMovement.create({ data: { lotId: lot.id, kind: 'CONSUMPTION', quantity: portion.qty.negated(), reason: `Production output · ${production.number}`, source: entry.id } });
    }
    await tx.costAllocation.create({ data: { ...costRow('MATERIAL', cost, 'Actual consumed kilograms × receipt unit cost'), source: `${entry.id}:material` } });
  }

  const machineCost = job.machine ? job.machine.hourlyCost.mul(hours) : D(0);
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
    ensure(Math.abs(rollLengths.reduce((a, b) => a + b, 0) - qty) < 0.01, 'Roll lengths must add up to the recorded output.');
    const costs = await tx.costAllocation.findMany({ where: { productionId: production.id } });
    const rate = sum(costs.map((c) => c.amount)).div(production.target);
    for (const length of rollLengths) {
      await tx.fabricRoll.create({ data: { code: code('RL'), productionId: production.id, entryId: entry.id, length, cost: rate.mul(length) } });
    }
  }

  await tx.jobCard.update({ where: { id }, data: { output: { increment: qty } } });
  if (job.machine) await tx.machine.update({ where: { id: job.machine.id }, data: { reportedAt: new Date() } });
  await audit(tx, actor, 'production.output', production.id, `${production.number} · ${job.machine?.code ?? 'Floor'} · ${qty} m ${job.stage.toLowerCase()} output recorded`);
  return entry;
}

// The operator (or manager) pauses a running job: machine freed, nothing lost.
export async function pauseJob(tx: Tx, id: string, actor: Actor, reason = '') {
  const job = await tx.jobCard.findUnique({ where: { id }, include: { production: true } });
  ensure(job, 'Job not found.', 404);
  ensureStageAccess(actor, job.stage);
  ensure(stoppable.includes(job.status), 'Only running jobs can be paused.');
  if (stageForRole(actor.role)) ensure(job.workerId === actor.workerId, 'This job is assigned to another operator.', 403);
  await tx.jobCard.update({ where: { id }, data: { status: 'PAUSED' } });
  await stopRun(tx, id, job.machineId);
  await audit(tx, actor, 'production.pause', job.productionId, `${job.production.number} · ${job.stage.toLowerCase()} paused${reason ? `: ${reason}` : ''}`);
  return { id };
}

// Finish the stage. The final output of this run is recorded first (if any), then the batch moves on.
// A stage can only finish with real output; if less was made than planned, the next stage's
// target becomes what actually exists, and the shortfall is written to the history.
export async function completeJob(tx: Tx, id: string, input: CompleteInput, actor: Actor) {
  let job = await tx.jobCard.findUnique({
    where: { id },
    include: { production: { include: { jobs: { orderBy: { sequence: 'asc' } }, reservations: true, recipe: true } } },
  });
  ensure(job, 'Job not found.', 404);
  ensureStageAccess(actor, job.stage);
  ensure(stoppable.includes(job.status), 'Only running jobs can be finished.');
  if (stageForRole(actor.role)) ensure(job.workerId === actor.workerId, 'This job is assigned to another operator.', 403);

  if (input.quantity > 0) {
    await recordOutput(tx, id, { ...input, quantity: input.quantity, hours: input.hours || 1, waste: input.waste }, actor);
    job = (await tx.jobCard.findUnique({ where: { id }, include: { production: { include: { jobs: { orderBy: { sequence: 'asc' } }, reservations: true, recipe: true } } } }))!;
  }
  ensure(job.output.gt(0), 'Record the output of this run before finishing the stage.');

  const production = job.production;
  const next = production.jobs.find((j) => j.sequence === job.sequence + 1);
  const shortfall = job.target.minus(job.output);

  await tx.jobCard.update({ where: { id }, data: { status: 'COMPLETED', endedAt: new Date() } });
  await stopRun(tx, id, job.machineId);
  // Only the first stage uses yarn. Once it is done, whatever was reserved and not used goes back to the store.
  if (job.sequence === 0) await releaseReservations(tx, production.id);

  if (next) {
    // Hand-off: the next team now sees this stage and must assign a machine and operator.
    await tx.jobCard.update({ where: { id: next.id }, data: { status: 'READY', target: shortfall.gt(0) ? job.output : next.target } });
    await notify(tx, {
      roles: stageTeams[next.stage] ?? [],
      title: `${production.number} is ready for ${next.stage.toLowerCase()}`,
      message: `${job.stage.toLowerCase()} finished · ${production.fabric} · ${production.color} · ${job.output.toString()} m`,
      category: 'PRODUCTION',
      link: '/production',
      skipUserId: actor.id,
    });
  } else {
    await finishBatch(tx, production.id, actor);
  }

  const short = shortfall.gt(0) ? ` · ${shortfall.toString()} m short of the ${job.target.toString()} m planned` : '';
  await audit(tx, actor, 'production.complete', production.id, `${production.number} · ${job.stage.toLowerCase()} completed with ${job.output.toString()} m${short} · ${next ? `sent to ${next.stage.toLowerCase()}` : 'fabric rolls sent to quality check'}`);
  if (shortfall.gt(0)) {
    await notify(tx, {
      roles: managers,
      title: `${production.number}: ${job.stage.toLowerCase()} finished short`,
      message: `${job.output.toString()} m made of ${job.target.toString()} m planned. ${next ? 'The next stage target was reduced to match.' : 'Fewer rolls than planned went to quality check.'}`,
      category: 'PRODUCTION',
      link: `/batches?open=${production.id}`,
      skipUserId: actor.id,
    });
  }
  return { id };
}

// The last stage is done: close the batch, release unused yarn and hand the rolls to quality.
async function finishBatch(tx: Tx, productionId: string, actor: Actor) {
  const production = await tx.productionOrder.findUniqueOrThrow({ where: { id: productionId } });

  if (production.status === 'REWORK') await finishReworkRun(tx, productionId, actor);

  await tx.productionOrder.update({ where: { id: productionId }, data: { status: 'COMPLETED' } });
  await releaseReservations(tx, productionId);

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

// ==================== MANAGER ACTIONS ====================

// Production for stock, internal use, replacement or urgent needs: no customer order required.
export async function createStandaloneBatch(tx: Tx, input: StandaloneBatchInput, actor: Actor) {
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
    ensure(machine && machine.type === stage && machine.active, `The machine chosen for ${stage.toLowerCase()} is not an active ${stage.toLowerCase()} machine.`);
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
        create: stages.map((stage, sequence) => {
          const machineId = plannedMachines[stage] ?? null;
          const workerId = sequence === 0 ? (input.workerId ?? null) : null;
          return {
            stage,
            sequence,
            target: input.quantity,
            // The first stage is ready at once; if a machine and worker were chosen it is already assigned.
            status: sequence === 0 ? (machineId && workerId ? 'ASSIGNED' : 'READY') : 'PLANNED',
            machineId,
            workerId,
          };
        }),
      },
    },
  });

  await audit(tx, actor, 'production.created', batch.id, `${batch.number} · ${input.quantity} m ${recipe.name} for ${input.purpose.toLowerCase()} created by ${actor.name}`);
  await notify(tx, {
    roles: stageTeams[stages[0]] ?? [],
    title: `New ${input.purpose.toLowerCase()} batch ${batch.number}`,
    message: `${input.quantity} m ${recipe.name} · ${input.color} starts at ${stages[0].toLowerCase()}.`,
    category: 'PRODUCTION',
    link: '/production',
    skipUserId: actor.id,
  });
  return batch;
}

export async function cancelBatch(tx: Tx, productionId: string, reason: string, actor: Actor) {
  const batch = await tx.productionOrder.findUnique({ where: { id: productionId }, include: { jobs: true } });
  ensure(batch, 'Batch not found.', 404);
  ensure(!['COMPLETED', 'CANCELLED'].includes(batch.status), 'Only unfinished batches can be cancelled.');

  for (const job of batch.jobs.filter((j) => j.status !== 'COMPLETED')) {
    await stopRun(tx, job.id, job.status === 'IN_PROGRESS' ? job.machineId : null);
    await tx.jobCard.update({ where: { id: job.id }, data: { status: 'CANCELLED', endedAt: new Date() } });
  }
  await releaseReservations(tx, productionId);
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
    roles: managers,
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
    roles: stageTeams[firstStage] ?? [],
    title: `Replacement batch ${batch.number}`,
    message: `Replaces ${original.number} · ${input.quantity} m ${original.fabric}. ${input.reason}`,
    category: 'PRODUCTION',
    link: '/production',
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
  workerId?: string;
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

const openJob = ['IN_PROGRESS', 'READY', 'ASSIGNED', 'PAUSED', 'BLOCKED'];

// Which department the batch is sitting in right now.
function currentDepartment(b: BatchRow) {
  const active = b.jobs.find((j) => openJob.includes(j.status)) ?? b.jobs.find((j) => j.status === 'PLANNED' || j.status === 'CANCELLED');
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
  if (b.jobs.every((j) => ['PLANNED', 'READY', 'ASSIGNED'].includes(j.status))) return 'PENDING';
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
  if (filters.workerId) and.push({ jobs: { some: { workerId: filters.workerId } } });
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
