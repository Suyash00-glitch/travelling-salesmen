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
} from '../operations.js';

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
      order: { select: { number: true, buyer: { select: { name: true, city: true } } } },
      rolls: {
        include: {
          roll: {
            select: {
              id: true, code: true, length: true, quality: true,
              production: { select: { item: { select: { fabric: true, color: true } } } },
            },
          },
        },
      },
      invoice: { select: { number: true, total: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Real loading history per truck, newest first; the creator is the dispatcher.
  const logs = await db.auditLog.findMany({
    where: { entityId: { in: shipments.map((s) => s.id) } },
    orderBy: { createdAt: 'desc' },
    select: { entityId: true, action: true, detail: true, actorName: true, createdAt: true },
  });

  res.json(
    page(
      req,
      shipments.map((s) => {
        const events = logs.filter((l) => l.entityId === s.id);
        return {
          ...s,
          rolls: s.rolls.map(({ roll: { production, ...roll }, ...row }) => ({
            ...row,
            roll: { ...roll, fabric: production.item.fabric, color: production.item.color },
          })),
          dispatcher: events.find((e) => e.action === 'shipment.created')?.actorName ?? null,
          events: events.map(({ entityId: _entityId, ...e }) => e),
        };
      }),
    ),
  );
});

// Create new shipment
write(dispatchRouter, '/', 'dispatch', contracts.shipmentSchema, (tx, input, actor) =>
  createShipment(tx, input, actor),
);

// Verify roll barcode scan
const verifySchema = z.object({ code: z.string().min(1) });
write(dispatchRouter, '/:id/verify', 'dispatch', verifySchema, (tx, input, actor, req) =>
  verifyRoll(tx, id(req), input.code, actor),
);

// Confirm shipment dispatch
write(dispatchRouter, '/:id/confirm', 'dispatch', empty, (tx, _input, actor, req) =>
  confirmShipment(tx, id(req), actor),
);

// Cancel shipment
write(dispatchRouter, '/:id/cancel', 'dispatch', reason, (tx, input, actor, req) =>
  cancelShipment(tx, id(req), input.reason, actor),
);
