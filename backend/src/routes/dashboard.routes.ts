import { Router } from 'express';
import { z } from 'zod';
import { db } from '@loomos/db';
import * as contracts from '@loomos/shared';
import { authorize } from '../middleware/auth.js';
import { dashboard } from '../services/dashboard.service.js';
import { analytics } from '../services/analytics.service.js';
import { listNotifications, markRead, checkDelays } from '../services/notification.service.js';
import { subscribe } from '../lib/events.js';

export const dashboardRouter = Router();

dashboardRouter.get('/lookups', async (req, res) => {
  if (req.actor.role === 'BUYER') {
    // Buyers need fabric choices to place an order, but never costing details.
    res.json({
      buyers: [],
      suppliers: [],
      recipes: await db.recipe.findMany({
        where: { active: true },
        select: { id: true, name: true, material: true, specification: true, route: true, pricePerMetre: true },
      }),
      workers: [],
      shifts: [],
      machines: [],
    });
    return;
  }

  const [buyers, suppliers, recipes, workers, shifts, machines, factories, departments, roles] = await Promise.all([
    db.buyer.findMany(),
    db.supplier.findMany(),
    db.recipe.findMany({ where: { active: true } }),
    db.worker.findMany({ where: { active: true }, select: { id: true, name: true, designation: true, departmentId: true } }),
    db.shift.findMany(),
    db.machine.findMany({
      where: { active: true },
      select: { id: true, name: true, code: true, type: true, status: true, departmentId: true },
    }),
    db.factory.findMany({ where: { active: true }, select: { id: true, name: true, code: true } }),
    db.department.findMany({ where: { active: true }, select: { id: true, name: true, code: true, factoryId: true } }),
    db.role.findMany({ select: { id: true, name: true, code: true, isSystem: true } }),
  ]);

  res.json({
    buyers,
    suppliers,
    recipes: recipes.map((r) => ({
      ...r,
      overheadPerMetre: contracts.can(req.actor, 'finance') ? r.overheadPerMetre : undefined,
    })),
    workers,
    shifts,
    machines,
    factories,
    departments,
    roles,
  });
});

dashboardRouter.get('/dashboard', authorize('dashboard'), async (req, res) => {
  const date = req.query.date ? z.string().date().parse(req.query.date) : undefined;
  res.json(await dashboard(req.actor, date));
});

// Factory analytics for charts. Filters: from, to (yyyy-mm-dd), buyerId, stage.
dashboardRouter.get('/analytics', authorize('dashboard'), async (req, res) => {
  const day = z.string().date().optional();
  res.json(
    await analytics({
      from: day.parse(req.query.from || undefined),
      to: day.parse(req.query.to || undefined),
      buyerId: req.query.buyerId ? String(req.query.buyerId) : undefined,
      stage: req.query.stage ? String(req.query.stage) : undefined,
    }),
  );
});

// Stored notifications for the signed-in user. The browser polls this every 30 seconds.
dashboardRouter.get('/notifications/feed', async (req, res) => {
  await checkDelays();
  res.json(await listNotifications(req.actor.id));
});

dashboardRouter.post('/notifications/read-all', async (req, res) => {
  res.json(await markRead(req.actor.id));
});

dashboardRouter.post('/notifications/:id/read', async (req, res) => {
  res.json(await markRead(req.actor.id, String(req.params.id)));
});

// Live update stream: the browser refreshes its data whenever anything changes
dashboardRouter.get('/events', (_req, res) => {
  subscribe(res);
});
