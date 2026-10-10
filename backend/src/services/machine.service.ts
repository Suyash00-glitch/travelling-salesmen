import { db, type Tx } from '@loomos/db';
import { audit, businessDay, ensure, sum, type Actor } from '../lib/domain.js';
import { ensureStageAccess, batchRef } from './production.service.js';
import { notify, managers } from './notification.service.js';

// Machines: add, edit, deactivate (maintenance / administrators); breakdown reported by the floor;
// repair confirmed by maintenance. Permissions are checked by the routes; this file holds the rules.

const unavailable = ['BREAKDOWN', 'MAINTENANCE', 'OFFLINE'];

export async function createMachine(tx: Tx, input: { code: string; name: string; type: string; location: string; capacityPerHour: number; hourlyCost: number; departmentId?: string }, actor: Actor) {
  ensure(!(await tx.machine.findUnique({ where: { code: input.code } })), 'A machine with this code already exists.');
  const machine = await tx.machine.create({ data: { ...input, factoryId: actor.factoryId ?? null, departmentId: input.departmentId ?? null } });
  await audit(tx, actor, 'machine.created', machine.id, `${machine.code} · ${machine.name} added`);
  return machine;
}

export async function updateMachine(tx: Tx, id: string, input: Partial<{ code: string; name: string; type: string; location: string; capacityPerHour: number; hourlyCost: number; departmentId?: string }>, actor: Actor) {
  const machine = await tx.machine.findUnique({ where: { id } });
  ensure(machine, 'Machine not found.', 404);
  if (input.type && input.type !== machine.type) {
    ensure(!(await tx.jobCard.count({ where: { machineId: id, status: { in: ['IN_PROGRESS', 'ASSIGNED', 'PAUSED', 'BLOCKED'] } } })), 'Finish or move the machine’s current jobs before changing its type.');
  }
  const updated = await tx.machine.update({ where: { id }, data: { ...input, departmentId: input.departmentId ?? machine.departmentId } });
  await audit(tx, actor, 'machine.updated', id, `${updated.code} details updated`);
  return updated;
}

// Machines are never deleted (their history matters). Deactivating hides them from assignment.
export async function setMachineActive(tx: Tx, id: string, active: boolean, reason: string, actor: Actor) {
  const machine = await tx.machine.findUnique({ where: { id } });
  ensure(machine, 'Machine not found.', 404);
  if (!active) {
    ensure(!(await tx.jobCard.count({ where: { machineId: id, status: 'IN_PROGRESS' } })), `${machine.code} is running a job. Move the job first.`);
    // Jobs planned on this machine go back to "needs a machine"; stopped jobs keep their status but lose the machine.
    await tx.jobCard.updateMany({ where: { machineId: id, status: 'ASSIGNED' }, data: { machineId: null, status: 'READY' } });
    await tx.jobCard.updateMany({ where: { machineId: id, status: { in: ['PAUSED', 'BLOCKED'] } }, data: { machineId: null } });
    await tx.downtimeEvent.updateMany({ where: { machineId: id, endedAt: null }, data: { endedAt: new Date(), resolution: `Deactivated: ${reason}` } });
  }
  const updated = await tx.machine.update({ where: { id }, data: { active, status: active ? 'IDLE' : 'OFFLINE', reportedAt: new Date() } });
  await audit(tx, actor, active ? 'machine.activated' : 'machine.deactivated', id, `${machine.code} · ${reason}`);
  return updated;
}

// Breakdown: the machine stops, its running job is blocked and a problem is logged on the batch.
export async function reportBreakdown(tx: Tx, id: string, reason: string, actor: Actor) {
  const machine = await tx.machine.findUnique({ where: { id } });
  ensure(machine, 'Machine not found.', 404);
  ensureStageAccess(actor, machine.type);
  ensure(machine.active, `${machine.code} is deactivated.`);
  ensure(machine.status !== 'BREAKDOWN', 'This breakdown has already been reported.');
  ensure(machine.status !== 'MAINTENANCE', `${machine.code} is already under maintenance.`);

  await tx.downtimeEvent.create({ data: { machineId: id, kind: 'BREAKDOWN', reason, reportedBy: actor.name } });
  const jobs = await tx.jobCard.findMany({ where: { machineId: id, status: 'IN_PROGRESS' }, include: { production: true } });
  for (const job of jobs) {
    await tx.jobCard.update({ where: { id: job.id }, data: { status: 'BLOCKED' } });
    await tx.workerAssignment.updateMany({ where: { jobId: job.id, endedAt: null }, data: { endedAt: new Date() } });
    await tx.machineAssignment.updateMany({ where: { jobId: job.id, endedAt: null }, data: { endedAt: new Date() } });
    await tx.productionIssue.create({
      data: { productionId: job.productionId, jobId: job.id, stage: job.stage, type: 'MACHINE_BREAKDOWN', description: `${machine.code}: ${reason}`, reportedBy: actor.name },
    });
    await audit(tx, actor, 'production.issue', job.productionId, `${job.production.number} · ${job.stage.toLowerCase()} blocked: ${machine.code} broke down (${reason})`);
  }
  await tx.machine.update({ where: { id }, data: { status: 'BREAKDOWN', reportedAt: new Date() } });
  await notify(tx, {
    roles: [...managers, 'MAINTENANCE_ENGINEER', 'SHIFT_SUPERVISOR'],
    title: `${machine.code} has broken down`,
    message: `${reason}${jobs.length ? ` · ${jobs.length} running job(s) stopped. Move them to another machine or wait for the repair.` : ''}`,
    category: 'MACHINE',
    link: '/machines',
    skipUserId: actor.id,
  });
  await audit(tx, actor, 'machine.breakdown', id, `${machine.code} · ${reason}`);
  return { id };
}

// Planned maintenance takes an idle machine out of service.
export async function startMaintenance(tx: Tx, id: string, reason: string, actor: Actor) {
  const machine = await tx.machine.findUnique({ where: { id } });
  ensure(machine, 'Machine not found.', 404);
  ensure(machine.active, `${machine.code} is deactivated.`);
  ensure(machine.status === 'IDLE', `${machine.code} must be idle before maintenance starts.`);
  await tx.downtimeEvent.create({ data: { machineId: id, kind: 'MAINTENANCE', reason, reportedBy: actor.name } });
  await tx.machine.update({ where: { id }, data: { status: 'MAINTENANCE', reportedAt: new Date() } });
  await audit(tx, actor, 'machine.maintenance', id, `${machine.code} · ${reason}`);
  return { id };
}

// Repair or maintenance finished: the machine is available again once maintenance confirms it.
export async function recordRepair(tx: Tx, id: string, resolution: string, actor: Actor) {
  const machine = await tx.machine.findUnique({ where: { id } });
  ensure(machine, 'Machine not found.', 404);
  ensure(unavailable.includes(machine.status), `${machine.code} is already available.`);
  ensure(machine.active, `${machine.code} is deactivated. Activate it instead.`);
  await tx.downtimeEvent.updateMany({ where: { machineId: id, endedAt: null }, data: { endedAt: new Date(), resolution } });
  await tx.machine.update({ where: { id }, data: { status: 'IDLE', reportedAt: new Date() } });
  await audit(tx, actor, 'machine.repaired', id, `${machine.code} · ${resolution}`);
  const blocked = await tx.jobCard.count({ where: { machineId: id, status: 'BLOCKED' } });
  if (blocked) {
    await notify(tx, {
      roles: managers,
      title: `${machine.code} is back in service`,
      message: `${blocked} blocked job(s) can be started again on it.`,
      category: 'MACHINE',
      link: '/production',
      skipUserId: actor.id,
    });
  }
  return { id };
}

export async function machineSummaries(day = businessDay()) {
  const machines = await db.machine.findMany({
    include: {
      jobs: {
        where: { status: { in: ['IN_PROGRESS', 'BLOCKED', 'PAUSED', 'ASSIGNED'] } },
        include: { worker: true, shift: true, production: { include: { order: { include: { buyer: true } } } } },
      },
      downtime: { where: { endedAt: null } },
      department: { select: { code: true, name: true } },
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
      worker: j.worker ? { id: j.worker.id, name: j.worker.name } : null,
      shift: j.shift ? { name: j.shift.name } : null,
      production: batchRef(j.production),
    })),
  }));
}

// Everything that happened on one machine: output, downtime, and who ran it when.
export async function machineHistory(id: string) {
  const [entries, downtime, runs] = await Promise.all([
    db.productionEntry.findMany({ where: { job: { machineId: id } }, include: { job: { select: { stage: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }),
    db.downtimeEvent.findMany({ where: { machineId: id }, orderBy: { startedAt: 'desc' }, take: 50 }),
    db.machineAssignment.findMany({
      where: { machineId: id },
      include: { worker: { select: { name: true } }, shift: { select: { name: true } }, job: { select: { stage: true, production: { select: { number: true } } } } },
      orderBy: { startedAt: 'desc' },
      take: 50,
    }),
  ]);
  return { entries, downtime, runs };
}
