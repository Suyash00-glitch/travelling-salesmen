import { Router } from 'express';
import { db } from '@loomos/db';
import { authorize } from '../middleware/auth.js';
import { id, write, reason } from '../lib/route-helpers.js';
import { machineSummaries } from '../modules/reporting/reporting.service.js';
import { machineAction } from '../modules/production/production.service.js';

export const machinesRouter = Router();

// Get machine fleet telemetry summaries
machinesRouter.get('/', authorize('machines'), async (_req, res) => {
  res.json(await machineSummaries());
});

// Get machine production history and downtime events
machinesRouter.get('/:id/history', authorize('machines'), async (req, res) => {
  const [entries, downtime] = await Promise.all([
    db.productionEntry.findMany({
      where: { job: { machineId: id(req) } },
      include: { job: { select: { stage: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    db.downtimeEvent.findMany({
      where: { machineId: id(req) },
      orderBy: { startedAt: 'desc' },
    }),
  ]);
  res.json({ entries, downtime });
});

// Report breakdown
write(machinesRouter, '/:id/breakdown', 'machines', reason, (tx, input, actor, req) =>
  machineAction(tx, id(req), 'breakdown', input.reason, actor),
);

// Recover machine
write(machinesRouter, '/:id/recover', 'machines', reason, (tx, input, actor, req) =>
  machineAction(tx, id(req), 'recover', input.reason, actor),
);
