import { Router } from 'express';
import { z } from 'zod';
import { db } from '@loomos/db';
import * as contracts from '@loomos/shared';
import { ensure } from '../lib/domain.js';
import { page, id, write, empty, reason } from '../lib/route-helpers.js';
import {
  createShipment,
  verifyRoll,
  confirmShipment,
  cancelShipment,
} from '../modules/dispatch/dispatch.service.js';

export const dispatchRouter = Router();

// List shipments with role scoping (Buyers see only their shipments)
dispatchRouter.get('/', async (req, res) => {
  ensure(
    req.actor.role === 'BUYER' ||
      contracts.can(req.actor.role, 'dispatch') ||
      contracts.can(req.actor.role, 'finance'),
    'Access denied.',
    403,
  );

  const shipments = await db.shipment.findMany({
    where: req.actor.role === 'BUYER' ? { order: { buyerId: req.actor.buyerId ?? 'none' } } : {},
    include: {
      order: { select: { number: true, buyer: { select: { name: true } } } },
      rolls: {
        include: {
          roll: { select: { id: true, code: true, length: true, quality: true } },
        },
      },
      invoice: { select: { number: true, total: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json(page(req, shipments));
});

// Create new shipment
write(dispatchRouter, '/', 'dispatch', contracts.shipmentSchema, (tx, input, actor) =>
  createShipment(tx, input, actor),
);

// Verify roll barcode scan
const verifySchema = z.object({ code: z.string().min(1) });
write(dispatchRouter, '/:id/verify', 'dispatch', verifySchema, (tx, input, _actor, req) =>
  verifyRoll(tx, id(req), input.code),
);

// Confirm shipment dispatch
write(dispatchRouter, '/:id/confirm', 'dispatch', empty, (tx, _input, actor, req) =>
  confirmShipment(tx, id(req), actor),
);

// Cancel shipment
write(dispatchRouter, '/:id/cancel', 'dispatch', reason, (tx, input, actor, req) =>
  cancelShipment(tx, id(req), input.reason, actor),
);
