import { Router } from 'express';
import { db } from '@loomos/db';
import * as contracts from '@loomos/shared';
import { authorize } from '../middleware/auth.js';
import { page, id, write, empty } from '../lib/route-helpers.js';
import {
  startJob,
  recordOutput,
  transitionJob,
  advanceProductionJob,
} from '../operations.js';

export const productionRouter = Router();

// List active and queued production job cards
productionRouter.get('/', authorize('production'), async (req, res) => {
  // Stage operators only ever receive their own stage's jobs.
  const stage = contracts.stageForRole(req.actor.role);
  const jobs = await db.jobCard.findMany({
    where: stage ? { stage } : {},
    include: {
      machine: { select: { id: true, name: true, code: true, type: true, status: true } },
      worker: { select: { id: true, name: true } },
      production: {
        include: {
          item: { include: { order: { include: { buyer: true } } } },
          reservations: { include: { lot: true } },
          jobs: { select: { sequence: true, stage: true, status: true } },
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
  contracts.assignmentSchema.partial(),
  (tx, input, actor, req) => startJob(tx, id(req), input, actor),
);

// One-tap action: accept a waiting job, or finish a running one and hand it to the next team
write(
  productionRouter,
  '/jobs/:id/advance',
  'production',
  empty,
  (tx, _input, actor, req) => advanceProductionJob(tx, id(req), actor),
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
