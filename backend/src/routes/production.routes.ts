import { Router } from 'express';
import { db } from '@loomos/db';
import * as contracts from '@loomos/shared';
import { authorize } from '../middleware/auth.js';
import { ensure } from '../lib/domain.js';
import { page, id, write, empty } from '../lib/route-helpers.js';
import {
  startJob,
  recordOutput,
  transitionJob,
} from '../modules/production/production.service.js';

export const productionRouter = Router();

// List active and queued production job cards
productionRouter.get('/', authorize('production'), async (req, res) => {
  const jobs = await db.jobCard.findMany({
    where: req.actor.role === 'OPERATOR' ? { workerId: req.actor.workerId ?? 'none' } : {},
    include: {
      machine: { select: { id: true, name: true, code: true, type: true, status: true } },
      worker: { select: { id: true, name: true } },
      production: {
        include: {
          item: { include: { order: { include: { buyer: true } } } },
          reservations: { include: { lot: true } },
          jobs: { select: { sequence: true } },
        },
      },
    },
    orderBy: [{ productionId: 'asc' }, { sequence: 'asc' }],
  });
  res.json(page(req, jobs));
});

// Start / assign a job card
write(
  productionRouter,
  '/jobs/:id/start',
  'production',
  contracts.assignmentSchema,
  (tx, input, actor, req) => {
    ensure(actor.role !== 'OPERATOR', 'A manager must assign jobs.', 403);
    return startJob(tx, id(req), input, actor);
  },
);

// Record meter output
write(
  productionRouter,
  '/jobs/:id/output',
  'production',
  contracts.outputSchema,
  (tx, input, actor, req) => recordOutput(tx, id(req), input, actor),
);

// Pause job
write(
  productionRouter,
  '/jobs/:id/pause',
  'production',
  empty,
  (tx, _input, actor, req) => transitionJob(tx, id(req), 'pause', actor),
);

// Complete job
write(
  productionRouter,
  '/jobs/:id/complete',
  'production',
  empty,
  (tx, _input, actor, req) => transitionJob(tx, id(req), 'complete', actor),
);
