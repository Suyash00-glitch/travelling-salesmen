import type { Tx } from '@loomos/db';
import { hasPermission, type IssueInput } from '@loomos/shared';
import { audit, ensure, type Actor } from '../lib/domain.js';
import { notify, managers } from './notification.service.js';

// A production issue is a simple record of "what went wrong" plus "what we did about it".
// Corrective actions themselves (reassign, restart, rework, replacement, cancel) are separate buttons.

const issueLabels: Record<string, string> = {
  MACHINE_BREAKDOWN: 'Machine breakdown',
  WORKER_UNAVAILABLE: 'Worker unavailable',
  MATERIAL_SHORTAGE: 'Material shortage',
  WRONG_QUANTITY: 'Incorrect quantity',
  QUALITY_FAILURE: 'Quality failure',
  DELAY: 'Production delay',
  INTERRUPTION: 'Production interrupted',
  OTHER: 'Production problem',
};

export async function reportIssue(tx: Tx, productionId: string, input: IssueInput, actor: Actor) {
  ensure(hasPermission(actor, 'production', 'update') || hasPermission(actor, 'quality', 'update'), 'Your role cannot report production problems.', 403);
  const batch = await tx.productionOrder.findUnique({ where: { id: productionId }, include: { jobs: true } });
  ensure(batch, 'Batch not found.', 404);

  const job = input.jobId
    ? batch.jobs.find((j) => j.id === input.jobId)
    : batch.jobs.find((j) => ['IN_PROGRESS', 'READY', 'PAUSED', 'BLOCKED'].includes(j.status));
  ensure(!input.jobId || job, 'That stage does not belong to this batch.');

  // Optionally stop the running stage until the problem is fixed. "Restart" picks it up again.
  if (input.holdJob && job?.status === 'IN_PROGRESS') {
    await tx.jobCard.update({ where: { id: job.id }, data: { status: 'BLOCKED' } });
    await tx.workerAssignment.updateMany({ where: { jobId: job.id, endedAt: null }, data: { endedAt: new Date() } });
    if (job.machineId) {
      await tx.machine.updateMany({ where: { id: job.machineId, status: 'RUNNING' }, data: { status: 'IDLE', reportedAt: new Date() } });
    }
  }

  const issue = await tx.productionIssue.create({
    data: {
      productionId,
      jobId: job?.id ?? null,
      stage: job?.stage ?? null,
      type: input.type,
      description: input.description,
      reportedBy: actor.name,
    },
  });

  const title = `${issueLabels[input.type] ?? 'Problem'} on ${batch.number}`;
  await audit(tx, actor, 'production.issue', productionId, `${title}${job ? ` (${job.stage.toLowerCase()})` : ''}: ${input.description}${input.holdJob ? ' · stage put on hold' : ''}`);
  await notify(tx, {
    roles: [...managers, 'SHIFT_SUPERVISOR', ...(input.type === 'MACHINE_BREAKDOWN' ? ['MAINTENANCE_ENGINEER'] : [])],
    title,
    message: input.description,
    category: input.type === 'DELAY' ? 'DELAY' : 'ISSUE',
    link: `/batches?open=${productionId}`,
    skipUserId: actor.id,
  });
  return issue;
}

export async function resolveIssue(tx: Tx, issueId: string, resolution: string, actor: Actor) {
  ensure(hasPermission(actor, 'production', 'update'), 'Your role cannot close production problems.', 403);
  const issue = await tx.productionIssue.findUnique({ where: { id: issueId }, include: { production: true } });
  ensure(issue, 'Problem record not found.', 404);
  ensure(issue.status === 'OPEN', 'This problem is already resolved.');

  await tx.productionIssue.update({
    where: { id: issueId },
    data: { status: 'RESOLVED', resolution, resolvedBy: actor.name, resolvedAt: new Date() },
  });
  await audit(tx, actor, 'production.issue.resolved', issue.productionId, `${issueLabels[issue.type] ?? 'Problem'} on ${issue.production.number} resolved: ${resolution}`);
  return { id: issueId };
}
