import { Router } from 'express';
import { z } from 'zod';
import { db } from '@loomos/db';
import * as contracts from '@loomos/shared';
import { authorize } from '../middleware/auth.js';
import { page, id, write } from '../lib/route-helpers.js';
import {
  receiveYarn,
  reserveYarn,
  adjustStock,
} from '../modules/inventory/inventory.service.js';

export const inventoryRouter = Router();

// List yarn lots with available quantities
inventoryRouter.get('/', authorize('inventory'), async (req, res) => {
  const lots = await db.yarnLot.findMany({
    include: { supplier: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(page(req, lots.map((l) => ({ ...l, available: l.onHand.minus(l.reserved) }))));
});

// Get stock movements for a specific lot
inventoryRouter.get('/:id/movements', authorize('inventory'), async (req, res) => {
  res.json(
    await db.stockMovement.findMany({
      where: { lotId: id(req) },
      orderBy: { createdAt: 'desc' },
    }),
  );
});

// Receive yarn shipment into inventory
write(inventoryRouter, '/receipts', 'inventory', contracts.receiptSchema, (tx, input, actor) =>
  receiveYarn(tx, input, actor),
);

// Reserve yarn for an order
write(inventoryRouter, '/reservations', 'inventory', contracts.reservationSchema, (tx, input, actor) =>
  reserveYarn(tx, input, actor),
);

// Adjust stock with reason
const adjustStockSchema = z.object({
  quantity: z.coerce.number().min(-1000000).max(1000000),
  reason: z.string().min(3),
});

write(inventoryRouter, '/:id/adjust', 'inventory', adjustStockSchema, (tx, input, actor, req) =>
  adjustStock(tx, id(req), input.quantity, input.reason, actor),
);
