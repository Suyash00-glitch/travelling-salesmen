import { Router, type Request } from 'express';
import { db, type Prisma } from '@loomos/db';
import * as contracts from '@loomos/shared';
import { authorize } from '../middleware/auth.js';
import { page, id, write, empty, reason } from '../lib/route-helpers.js';
import {
  startJob,
  recordOutput,
  transitionJob,
  advanceProductionJob,
  createStandaloneBatch,
  reassignJob,
  cancelBatch,
  createReplacement,
  listBatches,
  batchDetail,
  batchRef,
} from '../services/production.service.js';
import { raiseRework, cancelRework, listReworks } from '../services/rework.service.js';
import { reportIssue, resolveIssue } from '../services/issue.service.js';

export const productionRouter = Router();

// Read a text filter from the query string ("" and missing both mean "no filter").
const q = (req: Request, name: string) => (req.query[name] ? String(req.query[name]) : undefined);

// Floor job cards. Stage operators only ever receive their own stage's jobs.
productionRouter.get('/', authorize('production'), async (req, res) => {
  const stage = contracts.stageForRole(req.actor.role) ?? q(req, 'stage');
  const where: Prisma.JobCardWhereInput = {
    status: { not: 'CANCELLED' },
    production: { status: { not: 'CANCELLED' } },
  };
  if (stage) where.stage = stage;
  if (q(req, 'machineId')) where.machineId = q(req, 'machineId');
  if (q(req, 'buyerId')) where.production = { ...(where.production as object), order: { buyerId: q(req, 'buyerId') } };
  if (q(req, 'orderId')) where.production = { ...(where.production as object), orderId: q(req, 'orderId') };

  const jobs = await db.jobCard.findMany({
    where,
    include: {
      machine: { select: { id: true, name: true, code: true, type: true, status: true } },
      worker: { select: { id: true, name: true } },
      production: {
        include: {
          order: { include: { buyer: true } },
          reservations: { include: { lot: true } },
          jobs: { select: { sequence: true, stage: true, status: true } },
        },
      },
    },
    orderBy: [{ productionId: 'asc' }, { sequence: 'asc' }],
  });

  res.json(
    page(
      req,
      jobs.map((j) => ({
        ...j,
        production: {
          ...batchRef(j.production),
          status: j.production.status,
          priority: j.production.priority,
          reservations: j.production.reservations,
          jobs: j.production.jobs,
        },
      })),
    ),
  );
});

// ==================== BATCHES ====================

// All batches with combinable filters: customer, order, status, department, machine, dates, purpose, rework.
productionRouter.get('/batches', authorize('production'), async (req, res) => {
  const batches = await listBatches(
    {
      buyerId: q(req, 'buyerId'),
      orderId: q(req, 'orderId'),
      status: q(req, 'status'),
      department: q(req, 'department'),
      machineId: q(req, 'machineId'),
      from: q(req, 'from'),
      to: q(req, 'to'),
      purpose: q(req, 'purpose'),
      rework: q(req, 'rework'),
      search: q(req, 'search'),
    },
    req.actor,
  );
  res.json(page(req, batches));
});

productionRouter.get('/batches/:id', authorize('production'), async (req, res) => {
  res.json(await batchDetail(id(req)));
});

// Standalone batch: production without a customer order (stock, internal, replacement, urgent).
write(productionRouter, '/batches', 'production', contracts.standaloneBatchSchema, (tx, input, actor) =>
  createStandaloneBatch(tx, input, actor),
);

write(productionRouter, '/batches/:id/rework', ['production', 'quality'], contracts.reworkRequestSchema, (tx, input, actor, req) =>
  raiseRework(tx, id(req), input, actor),
);

write(productionRouter, '/batches/:id/issues', ['production', 'quality'], contracts.issueSchema, (tx, input, actor, req) =>
  reportIssue(tx, id(req), input, actor),
);

write(productionRouter, '/batches/:id/cancel', 'production', reason, (tx, input, actor, req) =>
  cancelBatch(tx, id(req), input.reason, actor),
);

write(productionRouter, '/batches/:id/replacement', 'production', contracts.replacementSchema, (tx, input, actor, req) =>
  createReplacement(tx, id(req), input, actor),
);

// ==================== REWORK & ISSUES ====================

productionRouter.get('/reworks', authorize('production'), async (req, res) => {
  const reworks = await listReworks({
    status: q(req, 'status'),
    stage: q(req, 'stage'),
    defectType: q(req, 'defectType'),
    buyerId: q(req, 'buyerId'),
    from: q(req, 'from'),
    to: q(req, 'to'),
  });
  res.json(page(req, reworks));
});

write(productionRouter, '/reworks/:id/cancel', 'production', reason, (tx, input, actor, req) =>
  cancelRework(tx, id(req), input.reason, actor),
);

write(productionRouter, '/issues/:id/resolve', 'production', contracts.resolveIssueSchema, (tx, input, actor, req) =>
  resolveIssue(tx, id(req), input.resolution, actor),
);

// ==================== JOB CARDS ====================

// Start / assign a job card
write(productionRouter, '/jobs/:id/start', 'production', contracts.assignmentSchema.partial(), (tx, input, actor, req) =>
  startJob(tx, id(req), input, actor),
);

// One-tap action: accept a waiting job, or finish a running one and hand it to the next team
write(productionRouter, '/jobs/:id/advance', 'production', empty, (tx, _input, actor, req) =>
  advanceProductionJob(tx, id(req), actor),
);

// Record metre output
write(productionRouter, '/jobs/:id/output', 'production', contracts.outputSchema, (tx, input, actor, req) =>
  recordOutput(tx, id(req), input, actor),
);

write(productionRouter, '/jobs/:id/pause', 'production', empty, (tx, _input, actor, req) =>
  transitionJob(tx, id(req), 'pause', actor),
);

write(productionRouter, '/jobs/:id/complete', 'production', empty, (tx, _input, actor, req) =>
  transitionJob(tx, id(req), 'complete', actor),
);

// Move a stage to another machine or worker
write(productionRouter, '/jobs/:id/reassign', 'production', contracts.reassignSchema, (tx, input, actor, req) =>
  reassignJob(tx, id(req), input, actor),
);
