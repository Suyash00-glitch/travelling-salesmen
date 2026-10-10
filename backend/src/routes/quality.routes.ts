import { Router } from 'express';
import { z } from 'zod';
import { db, type Prisma } from '@loomos/db';
import * as contracts from '@loomos/shared';
import { authorize } from '../middleware/auth.js';
import { ensure } from '../lib/domain.js';
import { page, id, write } from '../lib/route-helpers.js';
import { rollPassport, inspectRoll, reworkRoll } from '../services/quality.service.js';
import { batchRef } from '../services/production.service.js';

export const qualityRouter = Router();

// List fabric rolls, with optional filters: customer, order, quality result, stock or order rolls.
qualityRouter.get('/', authorize('rolls'), async (req, res) => {
  const where: Prisma.FabricRollWhereInput = {};
  const production: Prisma.ProductionOrderWhereInput = {};
  if (req.query.buyerId) production.order = { buyerId: String(req.query.buyerId) };
  if (req.query.orderId) production.orderId = String(req.query.orderId);
  if (req.query.source === 'STOCK') production.orderId = null;
  if (req.query.source === 'ORDER') production.orderId = { not: null };
  if (Object.keys(production).length) where.production = production;
  if (req.query.quality) where.quality = String(req.query.quality);

  const rolls = await db.fabricRoll.findMany({
    where,
    include: { production: { include: { order: { include: { buyer: true } } } } },
    orderBy: { createdAt: 'desc' },
  });

  res.json(page(req, rolls.map((r) => ({ ...r, cost: undefined, production: batchRef(r.production) }))));
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
