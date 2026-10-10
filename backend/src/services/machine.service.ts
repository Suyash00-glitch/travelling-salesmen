import { db, type Tx } from '@loomos/db';
import { audit, businessDay, ensure, sum, type Actor } from '../lib/domain.js';
import { ensureStageAccess, batchRef } from './production.service.js';
import { notify, managers } from './notification.service.js';

export async function machineAction(tx: Tx, id: string, action: 'breakdown' | 'recover', reason: string, actor: Actor) {
  const machine = await tx.machine.findUnique({ where: { id } });
  ensure(machine, 'Machine not found.', 404);
  ensureStageAccess(actor, machine.type);

  if (action === 'breakdown') {
    ensure(machine.status !== 'BREAKDOWN', 'This breakdown has already been reported.');
    await tx.downtimeEvent.create({ data: { machineId: id, reason } });
    const jobs = await tx.jobCard.findMany({ where: { machineId: id, status: 'IN_PROGRESS' }, include: { production: true } });
    for (const job of jobs) {
      // The stage stops; a manager can restart it on another machine.
      await tx.jobCard.update({ where: { id: job.id }, data: { status: 'BLOCKED' } });
      await tx.workerAssignment.updateMany({ where: { jobId: job.id, endedAt: null }, data: { endedAt: new Date() } });
      await tx.productionIssue.create({
        data: {
          productionId: job.productionId,
          jobId: job.id,
          stage: job.stage,
          type: 'MACHINE_BREAKDOWN',
          description: `${machine.code}: ${reason}`,
          reportedBy: actor.name,
        },
      });
      await audit(tx, actor, 'production.issue', job.productionId, `${job.production.number} · ${job.stage.toLowerCase()} blocked: ${machine.code} broke down (${reason})`);
    }
    await notify(tx, {
      roles: [...managers, 'MAINTENANCE_ENGINEER', 'SHIFT_SUPERVISOR'],
      title: `${machine.code} has broken down`,
      message: `${reason}${jobs.length ? ` · ${jobs.length} running job(s) stopped` : ''}`,
      category: 'MACHINE',
      link: '/machines',
      skipUserId: actor.id,
    });
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

export async function machineSummaries(day = businessDay()) {
  const machines = await db.machine.findMany({
    include: {
      jobs: {
        where: { status: { in: ['IN_PROGRESS', 'BLOCKED', 'PAUSED'] } },
        include: { worker: true, production: { include: { order: { include: { buyer: true } } } } },
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
      worker: j.worker ? { name: j.worker.name } : null,
      production: batchRef(j.production),
    })),
  }));
}
