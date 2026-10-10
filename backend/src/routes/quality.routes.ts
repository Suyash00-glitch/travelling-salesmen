import { Router } from 'express';
import { z } from 'zod';
import { db } from '@loomos/db';
import * as contracts from '@loomos/shared';
import { authorize } from '../middleware/auth.js';
import { ensure } from '../lib/domain.js';
import { page, id, write } from '../lib/route-helpers.js';
import { rollPassport } from '../modules/reporting/reporting.service.js';
import { inspectRoll, reworkRoll } from '../modules/quality/quality.service.js';

export const qualityRouter = Router();

// List fabric rolls
qualityRouter.get('/', authorize('rolls'), async (req, res) => {
  const rolls = await db.fabricRoll.findMany({
    include: {
      production: {
        include: {
          item: {
            include: {
              order: {
                include: { buyer: true },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json(
    page(
      req,
      rolls.map((r) => ({
        ...r,
        cost: undefined,
        production: {
          id: r.production.id,
          number: r.production.number,
          item: {
            fabric: r.production.item.fabric,
            color: r.production.item.color,
            order: {
              id: r.production.item.order.id,
              number: r.production.item.order.number,
              buyer: { name: r.production.item.order.buyer.name },
            },
          },
        },
      })),
    ),
  );
});

// Single roll digital passport
qualityRouter.get('/:id', async (req, res) => {
  ensure(
    req.actor.role === 'BUYER' || contracts.can(req.actor.role, 'rolls'),
    'Access denied.',
    403,
  );
  res.json(await rollPassport(id(req), req.actor));
});

// Record 4-point quality inspection
write(
  qualityRouter,
  '/:id/inspections',
  'quality',
  contracts.inspectionSchema,
  (tx, input, actor, req) => inspectRoll(tx, id(req), input, actor),
);

// Submit roll rework
const reworkSchema = z.object({
  cost: z.coerce.number().min(0).max(1000000),
  notes: z.string().min(3),
});

write(qualityRouter, '/:id/rework', 'quality', reworkSchema, (tx, input, actor, req) =>
  reworkRoll(tx, id(req), input.cost, input.notes, actor),
);
