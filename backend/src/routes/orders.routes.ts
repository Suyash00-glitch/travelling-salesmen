import { Router } from 'express';
import { z } from 'zod';
import { db } from '@loomos/db';
import * as contracts from '@loomos/shared';
import { authorize } from '../middleware/auth.js';
import { ensure, audit, type Actor } from '../lib/domain.js';
import { page, id, write, empty, reason } from '../lib/route-helpers.js';
import {
  orderSummaries,
  createOrder,
  planOrder,
  acceptOrder,
  rejectOrder,
  materialPlan,
} from '../operations.js';

// Accepting, planning and editing orders is for the office team, not buyers or the floor.
const ensureCanManage = (actor: Actor) =>
  ensure(contracts.hasPermission(actor, 'orders', 'approve'), 'Only managers can review and plan orders.', 403);

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

// Create new sales order. Buyer requests wait for review; office orders start right away.
write(ordersRouter, '/', 'orders', contracts.orderSchema, async (tx, input, actor) => {
  if (actor.role === 'BUYER') {
    ensure(actor.buyerId, 'Your login is not linked to a buyer account.', 403);
    return createOrder(tx, { ...input, buyerId: actor.buyerId }, actor, 'PENDING_REVIEW');
  }
  const order = await createOrder(tx, input, actor);
  try {
    await planOrder(tx, order.id, actor);
  } catch {
    // If auto-planning has missing recipes or prerequisites, keep order CONFIRMED
  }
  return order;
});

// Accept a buyer request: confirms it and sends it to spinning
write(ordersRouter, '/:id/accept', 'orders', empty, (tx, _input, actor, req) => {
  ensureCanManage(actor);
  return acceptOrder(tx, id(req), actor);
});

// Decline a buyer request with a reason the buyer can see
write(ordersRouter, '/:id/reject', 'orders', reason, (tx, input, actor, req) => {
  ensureCanManage(actor);
  return rejectOrder(tx, id(req), input.reason, actor);
});

// Plan production jobs for order
write(ordersRouter, '/:id/plan', 'orders', empty, (tx, _input, actor, req) => {
  ensureCanManage(actor);
  return planOrder(tx, id(req), actor);
});

// Edit order priority, deadline, instructions
const editOrderSchema = z.object({
  deadline: z.string().date(),
  priority: z.enum(['NORMAL', 'HIGH', 'URGENT']),
  instructions: z.string().max(2000),
});

write(ordersRouter, '/:id/edit', 'orders', editOrderSchema, async (tx, input, actor, req) => {
  ensureCanManage(actor);
  const order = await tx.salesOrder.findUnique({ where: { id: id(req) } });
  ensure(order && !['COMPLETED', 'CANCELLED'].includes(order.status), 'Order is closed or missing.');
  const updated = await tx.salesOrder.update({
    where: { id: id(req) },
    data: { ...input, deadline: new Date(input.deadline) },
  });
  await audit(tx, actor, 'order.edited', id(req), 'Order deadline, priority and instructions updated');
  return updated;
});
