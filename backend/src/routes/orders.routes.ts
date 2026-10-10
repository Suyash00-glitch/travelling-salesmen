import { Router } from 'express';
import { z } from 'zod';
import { db } from '@loomos/db';
import * as contracts from '@loomos/shared';
import { authorize } from '../middleware/auth.js';
import { ensure, audit } from '../lib/domain.js';
import { page, id, write, empty } from '../lib/route-helpers.js';
import { orderSummaries } from '../modules/reporting/reporting.service.js';
import {
  createOrder,
  planOrder,
  materialPlan,
} from '../modules/orders/orders.service.js';

export const ordersRouter = Router();

// List orders with optional search filter and status filter
ordersRouter.get('/', authorize('orders'), async (req, res) => {
  let data = await orderSummaries(req.actor);
  if (req.query.q) {
    data = data.filter((o) =>
      JSON.stringify(o).toLowerCase().includes(String(req.query.q).toLowerCase()),
    );
  }
  if (req.query.status) {
    data = data.filter((o) => o.status === req.query.status);
  }
  res.json(page(req, data));
});

// Single order details with audit timeline
ordersRouter.get('/:id', authorize('orders'), async (req, res) => {
  const order = (await orderSummaries(req.actor)).find((o) => o.id === id(req));
  ensure(order, 'Order not found.', 404);
  const timeline = await db.auditLog.findMany({
    where: { entityId: order.id },
    orderBy: { createdAt: 'asc' },
    select: { action: true, detail: true, createdAt: true },
  });
  res.json({ ...order, timeline });
});

// Material plan requirements for order
ordersRouter.get('/:id/materials', authorize('inventory'), async (req, res) => {
  res.json(await materialPlan(id(req)));
});

// Create new sales order
write(ordersRouter, '/', 'production', contracts.orderSchema, (tx, input, actor) =>
  createOrder(tx, input, actor),
);

// Plan production jobs for order
write(ordersRouter, '/:id/plan', 'production', empty, (tx, _input, actor, req) =>
  planOrder(tx, id(req), actor),
);

// Edit order priority, deadline, instructions
const editOrderSchema = z.object({
  deadline: z.string().date(),
  priority: z.enum(['NORMAL', 'HIGH', 'URGENT']),
  instructions: z.string().max(2000),
});

write(ordersRouter, '/:id/edit', 'production', editOrderSchema, async (tx, input, actor, req) => {
  const order = await tx.salesOrder.findUnique({ where: { id: id(req) } });
  ensure(order && !['COMPLETED', 'CANCELLED'].includes(order.status), 'Order is closed or missing.');
  const updated = await tx.salesOrder.update({
    where: { id: id(req) },
    data: { ...input, deadline: new Date(input.deadline) },
  });
  await audit(tx, actor, 'order.edited', id(req), 'Order deadline, priority and instructions updated');
  return updated;
});
